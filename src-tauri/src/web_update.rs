//! Over-the-air updates for the app's web side (everything under src/: screens,
//! Easy Mode, skips…), so the iOS app picks up changes without re-sideloading.
//!
//! CI publishes each build of the web side as `web.zip`, with `web.json`
//! (version + which native build it needs) and `web.zip.sig`, signed with the
//! same key as the desktop updater. The app:
//!   1. checks web.json a few seconds after launch (`web_update_check`),
//!   2. downloads and verifies web.zip, unpacks it next to the app's data,
//!   3. switches to it when you tap Reload (`web_update_apply`) or on the next
//!      launch, serving it in place of the web files built into the app.
//!
//! A bundle only counts once the page has loaded and said so
//! (`web_update_confirm`). If the app is closed before that, the next launch
//! throws the bundle away and goes back to the built-in files, so a broken
//! update can't lock you out.
//!
//! Changes to native code (Rust, the Swift player) still need a new .ipa: a
//! bundle names the native API it was built for (native-api.txt) and is only
//! used by an app with the same one.

use std::{
    borrow::Cow,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};
use tauri::{utils::assets::AssetKey, Assets, Runtime};

/// A public repo that holds only signed update files (the source repo is private).
const BASE_URL: &str = "https://github.com/Cummmies/custom-stremio-updates/releases/download/web";

/// Bumped whenever the web side needs native commands an older app lacks.
pub const NATIVE_API: u32 = parse_u32(include_str!("../native-api.txt"));

/// When the built-in web files were built (seconds since 1970); CI sets it.
/// A downloaded bundle must be newer than this to be used.
const BUILT_IN: u64 = match option_env!("WEB_BUILD_VERSION") {
    Some(v) => parse_u64(v),
    None => 0,
};

/// The updater's public key (minisign, base64), the same as the desktop app's.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1OEEyQjBFQ0Q5QTk1NTcKUldSWGxack5EaXVLcGVCejA3L3RCd2I3bDV3Z2xPTFdMeWFQTm5Xbk4vNnFWTWJSaVFvWlorV2oK";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    /// Build time of the bundle (seconds since 1970).
    version: u64,
    native_api: u32,
    /// Shown to the person, e.g. "Sep 30 · a1b2c3d".
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// A newer bundle is downloaded and ready (tap Reload to use it).
    ready: bool,
    label: Option<String>,
}

// --- where bundles live -------------------------------------------------------

fn root() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    #[cfg(target_os = "ios")]
    let base = home.join("Library").join("Application Support");
    #[cfg(not(target_os = "ios"))]
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
        .join("com.sdola.customstremio");
    base.join("web")
}

fn bundle_dir(version: u64) -> PathBuf {
    root().join(version.to_string())
}

/// The bundle in use: `current` names its version.
fn current_version() -> Option<u64> {
    fs::read_to_string(root().join("current")).ok()?.trim().parse().ok()
}

fn set_current(version: Option<u64>) {
    let path = root().join("current");
    match version {
        Some(v) => fs::write(path, v.to_string()).ok(),
        None => fs::remove_file(path).ok(),
    };
}

/// Marks the bundle as not yet proven to load (cleared by `web_update_confirm`).
fn unconfirmed() -> PathBuf {
    root().join("unconfirmed")
}

/// Picks the bundle to serve at launch, rolling back one that never loaded.
fn active_at_launch() -> Option<PathBuf> {
    let current = current_version()?;
    let usable = current > BUILT_IN
        && fs::read_to_string(bundle_dir(current).join(".native-api")).ok().map(|s| parse_u32(&s)) == Some(NATIVE_API)
        && bundle_dir(current).join("index.html").is_file();
    if !usable || unconfirmed().exists() {
        eprintln!("web update: going back to the built-in files (bundle {current} unusable or never confirmed)");
        set_current(None);
        fs::remove_file(unconfirmed()).ok();
        fs::remove_dir_all(bundle_dir(current)).ok();
        return None;
    }
    Some(bundle_dir(current))
}

// --- serving ------------------------------------------------------------------

/// The web files the app serves: the active bundle's, else the built-in ones.
pub struct WebAssets<R: Runtime> {
    built_in: Box<dyn Assets<R>>,
    active: Arc<RwLock<Option<PathBuf>>>,
}

#[derive(Clone)]
pub struct WebUpdate {
    active: Arc<RwLock<Option<PathBuf>>>,
    /// A verified, unpacked bundle waiting for Reload.
    staged: Arc<RwLock<Option<(u64, String)>>>,
}

/// Wraps the built-in assets; returns the state the commands need.
pub fn install<R: Runtime>(context: &mut tauri::Context<R>) -> WebUpdate {
    let active = Arc::new(RwLock::new(active_at_launch()));
    let placeholder: Box<dyn Assets<R>> = Box::new(Empty);
    let built_in = context.set_assets(placeholder);
    context.set_assets(Box::new(WebAssets { built_in, active: active.clone() }));
    WebUpdate { active, staged: Arc::new(RwLock::new(None)) }
}

impl<R: Runtime> Assets<R> for WebAssets<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(dir) = self.active.read().unwrap().as_ref() {
            if let Some(path) = safe_join(dir, key.as_ref()) {
                if let Ok(bytes) = fs::read(path) {
                    return Some(Cow::Owned(bytes));
                }
            }
        }
        self.built_in.get(key)
    }

    fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
        self.built_in.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_> {
        self.built_in.csp_hashes(html_path)
    }
}

struct Empty;

impl<R: Runtime> Assets<R> for Empty {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// `dir` + an asset path ("/index.html"), refusing anything that climbs out.
fn safe_join(dir: &Path, key: &str) -> Option<PathBuf> {
    let rel = Path::new(key.trim_start_matches('/'));
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(dir.join(rel))
}

// --- commands -----------------------------------------------------------------

/// Downloads a newer bundle if there is one. Doesn't switch to it.
#[tauri::command(async)]
pub fn web_update_check(state: tauri::State<'_, WebUpdate>) -> Result<CheckResult, String> {
    if let Some((_, label)) = state.staged.read().unwrap().as_ref() {
        return Ok(CheckResult { ready: true, label: Some(label.clone()) });
    }
    let manifest: Manifest = get(&format!("{BASE_URL}/web.json"))?
        .into_json()
        .map_err(|e| format!("web.json: {e}"))?;
    let newest_here = current_version().unwrap_or(0).max(BUILT_IN);
    if manifest.version <= newest_here || manifest.native_api != NATIVE_API {
        return Ok(CheckResult { ready: false, label: None });
    }

    let zip = read_all(get(&format!("{BASE_URL}/web.zip"))?)?;
    let sig = read_all(get(&format!("{BASE_URL}/web.zip.sig"))?)?;
    verify(&zip, &sig)?;

    // Unpack beside the others, then move into place in one step.
    let staging = root().join(format!("{}.part", manifest.version));
    fs::remove_dir_all(&staging).ok();
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    unzip(&zip, &staging)?;
    if !staging.join("index.html").is_file() {
        fs::remove_dir_all(&staging).ok();
        return Err("The update has no index.html.".into());
    }
    fs::write(staging.join(".native-api"), NATIVE_API.to_string()).map_err(|e| e.to_string())?;
    let dest = bundle_dir(manifest.version);
    fs::remove_dir_all(&dest).ok();
    fs::rename(&staging, &dest).map_err(|e| e.to_string())?;

    *state.staged.write().unwrap() = Some((manifest.version, manifest.label.clone()));
    Ok(CheckResult { ready: true, label: Some(manifest.label) })
}

/// Switches to the downloaded bundle; the page reloads itself right after.
#[tauri::command]
pub fn web_update_apply(state: tauri::State<'_, WebUpdate>) -> Result<(), String> {
    let Some((version, _)) = state.staged.write().unwrap().take() else {
        return Err("No update is ready.".into());
    };
    let previous = current_version();
    fs::write(unconfirmed(), version.to_string()).map_err(|e| e.to_string())?;
    set_current(Some(version));
    *state.active.write().unwrap() = Some(bundle_dir(version));
    // The old bundle is no longer needed (the built-in files stay as the fallback).
    if let Some(p) = previous.filter(|p| *p != version) {
        fs::remove_dir_all(bundle_dir(p)).ok();
    }
    Ok(())
}

/// The page loaded fine: keep the bundle it came from.
#[tauri::command]
pub fn web_update_confirm() {
    fs::remove_file(unconfirmed()).ok();
}

// --- helpers ------------------------------------------------------------------

fn get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .timeout(std::time::Duration::from_secs(60))
        .set("User-Agent", "CustomStremio")
        .call()
        .map_err(|e| format!("{url}: {e}"))
}

fn read_all(res: ureq::Response) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    res.into_reader()
        .take(100 * 1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Same check as Tauri's updater: minisign, key and signature base64-wrapped.
fn verify(data: &[u8], sig_file: &[u8]) -> Result<(), String> {
    verify_with(PUBLIC_KEY, data, sig_file)
}

fn verify_with(public_key: &str, data: &[u8], sig_file: &[u8]) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let key_text = String::from_utf8(b64.decode(public_key.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let sig_b64 = String::from_utf8_lossy(sig_file);
    let sig_text = String::from_utf8(b64.decode(sig_b64.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let key = minisign_verify::PublicKey::decode(&key_text).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|e| e.to_string())?;
    key.verify(data, &sig, true).map_err(|_| "The update's signature doesn't match.".to_string())
}

fn unzip(data: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = file.enclosed_name() else { continue };
        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        fs::write(&out, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

const fn parse_u64(s: &str) -> u64 {
    let b = s.as_bytes();
    let mut i = 0;
    let mut n = 0u64;
    while i < b.len() {
        if b[i].is_ascii_digit() {
            n = n * 10 + (b[i] - b'0') as u64;
        }
        i += 1;
    }
    n
}

const fn parse_u32(s: &str) -> u32 {
    parse_u64(s) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_decodes() {
        use base64::Engine;
        let text = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(PUBLIC_KEY).unwrap()).unwrap();
        minisign_verify::PublicKey::decode(&text).unwrap();
    }

    #[test]
    fn rejects_bad_signatures() {
        assert!(verify(b"data", b"not a signature").is_err());
    }

    /// A key and signature made by `tauri signer` (what CI uses), when present.
    #[test]
    fn verifies_tauri_signer_output() {
        let dir = std::env::var("SIGN_TEST_DIR").unwrap_or_default();
        let Ok(key) = fs::read_to_string(Path::new(&dir).join("test.key.pub")) else { return };
        let data = fs::read(Path::new(&dir).join("web.zip")).unwrap();
        let sig = fs::read(Path::new(&dir).join("web.zip.sig")).unwrap();
        verify_with(&key, &data, &sig).unwrap();
        let mut tampered = data.clone();
        tampered[0] ^= 1;
        assert!(verify_with(&key, &tampered, &sig).is_err());
    }

    #[test]
    fn paths_stay_inside_the_bundle() {
        let dir = Path::new("/b");
        assert_eq!(safe_join(dir, "/index.html"), Some(PathBuf::from("/b/index.html")));
        assert_eq!(safe_join(dir, "/_app/x.js"), Some(PathBuf::from("/b/_app/x.js")));
        assert_eq!(safe_join(dir, "/../secret"), None);
        assert_eq!(safe_join(dir, "/a/../../secret"), None);
    }

    #[test]
    fn parses_numbers() {
        assert_eq!(parse_u64("1790800000\n"), 1790800000);
        assert_eq!(parse_u32("3"), 3);
    }
}
