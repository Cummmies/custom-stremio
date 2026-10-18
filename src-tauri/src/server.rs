//! Starts Stremio's streaming server (server.js) in the background, the same way
//! the official desktop app does: run `stremio-runtime.exe server.js` hidden, wait
//! for it to report ready, and make sure it dies when this app exits.
//!
//! Without one on this PC, Settings offers to set it up (`server_install`): it
//! downloads Stremio Service's Windows build from Stremio's own GitHub releases
//! and unpacks it into this app's data folder, where it's found from then on.
//! Nothing is installed system-wide; the tray app in the download isn't run.
//!
//! That copy is kept current (`server_update_download`, then
//! `server_update_apply`): the app asks now and then; a newer Stremio Service
//! release is downloaded next to it, and swapped in when nothing's playing (the
//! app says when), or at the next launch, before the server starts.

use serde::Serialize;
use std::{
    env,
    io::{BufRead, BufReader},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 11470;
const DEFAULT_URL: &str = "http://127.0.0.1:11470/";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const READY_MARKER: &str = "EngineFS server started at ";

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ServerStatus {
    Starting,
    Ready { url: String, source: ServerSource },
    Missing { message: String },
    /// Setting it up (`server_install`): downloading, then unpacking.
    Installing { percent: Option<u8> },
    Failed { message: String },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerSource {
    /// Something was already listening on 11470 (e.g. the Stremio Service tray app).
    External,
    /// We launched server.js ourselves.
    Managed,
}

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    #[cfg(windows)]
    job: Option<win32job::Job>,
}

pub struct StreamingServer {
    status: Mutex<ServerStatus>,
    inner: Mutex<Inner>,
}

impl StreamingServer {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(ServerStatus::Starting),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn status(&self) -> ServerStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(mut child) = inner.child.take() {
            child.kill().ok();
            child.wait().ok();
        }
        #[cfg(windows)]
        {
            inner.job = None;
        }
    }
}

fn set_status(app: &AppHandle, status: ServerStatus) {
    let server = app.state::<Arc<StreamingServer>>();
    *server.status.lock().unwrap() = status.clone();
    app.emit("server-status", status).ok();
}

fn port_open() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn has_server(dir: &Path) -> bool {
    dir.join("stremio-runtime.exe").is_file() && dir.join("server.js").is_file()
}

/// Where `server_install` puts the server: this app's own data folder.
fn installed_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("streaming-server"))
}

/// Where to look for `stremio-runtime.exe` + `server.js`, in priority order.
fn find_server_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = env::var("STREMIO_SERVER_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    // Bundled with this app (src-tauri/server/ -> resources).
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("server"));
    }
    // Set up from Settings (server_install).
    if let Some(dir) = installed_dir(app) {
        candidates.push(dir);
    }
    // Existing installs of Stremio Service / the official app.
    if let Ok(local) = env::var("LOCALAPPDATA") {
        let programs = PathBuf::from(local).join("Programs");
        candidates.push(programs.join("StremioService"));
        candidates.push(programs.join("Stremio"));
        candidates.push(programs.join("LNV").join("Stremio-5"));
    }
    candidates.into_iter().find(|dir| has_server(dir))
}

fn spawn(dir: &Path) -> std::io::Result<Child> {
    let mut command = Command::new(dir.join("stremio-runtime.exe"));
    command
        .arg(dir.join("server.js"))
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn()
}

/// Kill the server automatically if this app crashes or is force-closed.
#[cfg(windows)]
fn attach_job(child: &Child) -> Option<win32job::Job> {
    use std::os::windows::io::AsRawHandle;
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    let job = win32job::Job::create_with_limit_info(&info).ok()?;
    job.assign_process(child.as_raw_handle() as isize).ok()?;
    Some(job)
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        // A newer copy downloaded last time, not swapped in yet: now, before it runs.
        if !port_open() {
            if let Some(dir) = installed_dir(&app) {
                swap_in_staged(&dir).ok();
            }
        }
        if port_open() {
            set_status(&app, ServerStatus::Ready { url: DEFAULT_URL.into(), source: ServerSource::External });
            return;
        }

        let Some(dir) = find_server_dir(&app) else {
            set_status(&app, ServerStatus::Missing {
                message: "Torrents need Stremio’s streaming server. Set it up in Settings.".into(),
            });
            return;
        };

        let mut child = match spawn(&dir) {
            Ok(child) => child,
            Err(err) => {
                set_status(&app, ServerStatus::Failed { message: format!("Could not start server: {err}") });
                return;
            }
        };
        let stdout = child.stdout.take();

        {
            let server = app.state::<Arc<StreamingServer>>();
            let mut inner = server.inner.lock().unwrap();
            #[cfg(windows)]
            {
                inner.job = attach_job(&child);
            }
            inner.child = Some(child);
        }

        // Watch stdout for the ready line; keep draining it afterwards so the pipe never fills up.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<String>();
        if let Some(stdout) = stdout {
            thread::spawn(move || {
                let mut sent = false;
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if !sent {
                        if let Some(pos) = line.find(READY_MARKER) {
                            let url = line[pos + READY_MARKER.len()..].trim().trim_end_matches('/');
                            ready_tx.send(format!("{url}/")).ok();
                            sent = true;
                        }
                    }
                }
            });
        }

        let started = Instant::now();
        loop {
            if let Ok(url) = ready_rx.recv_timeout(Duration::from_millis(250)) {
                set_status(&app, ServerStatus::Ready { url, source: ServerSource::Managed });
                return;
            }
            // Fallback in case the log line format ever changes.
            if port_open() {
                set_status(&app, ServerStatus::Ready { url: DEFAULT_URL.into(), source: ServerSource::Managed });
                return;
            }
            let exited = {
                let server = app.state::<Arc<StreamingServer>>();
                let mut inner = server.inner.lock().unwrap();
                inner.child.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
            };
            if exited {
                set_status(&app, ServerStatus::Failed { message: "Streaming server exited during startup.".into() });
                return;
            }
            if started.elapsed() > STARTUP_TIMEOUT {
                set_status(&app, ServerStatus::Failed { message: "Streaming server did not start within 30s.".into() });
                return;
            }
        }
    });
}

// --- Setting it up (Settings > Streaming Server > Set Up) -----------------------

const RELEASES_URL: &str = "https://api.github.com/repos/Stremio/stremio-service/releases/latest";
const ASSET_NAME: &str = "stremio-service-windows.zip";
/// The files the server needs (the rest of the download, the tray app, isn't used).
const WANTED: &[&str] = &["stremio-runtime.exe", "server.js", "ffmpeg.exe", "ffprobe.exe", "LICENSE.md"];
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

fn http_get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .set("User-Agent", "custom-stremio")
        .timeout(Duration::from_secs(60))
        .call()
        .map_err(|e| e.to_string())
}

/// The latest Stremio Service release: (its version, the Windows download).
fn latest_release() -> Result<(String, String), String> {
    let release: serde_json::Value = http_get(RELEASES_URL)?.into_json().map_err(|e| e.to_string())?;
    let version = release["tag_name"].as_str().unwrap_or("").to_owned();
    let url = release["assets"]
        .as_array()
        .and_then(|assets| assets.iter().find(|a| a["name"] == ASSET_NAME))
        .and_then(|a| a["browser_download_url"].as_str())
        .filter(|u| u.starts_with("https://github.com/Stremio/stremio-service/releases/download/"))
        .map(str::to_owned)
        .ok_or_else(|| "Stremio Service's download wasn't found.".to_string())?;
    Ok((version, url))
}

/// Which release a folder holds (written when it was set up), if known.
const VERSION_FILE: &str = "stremio-service-version.txt";

fn version_of(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join(VERSION_FILE)).ok().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

/// Where a newer copy waits to be swapped in.
fn staged_dir(dir: &Path) -> PathBuf {
    dir.with_extension("next")
}

/// The staged copy in place of `dir` (the server mustn't be running from it).
fn swap_in_staged(dir: &Path) -> Result<bool, String> {
    let next = staged_dir(dir);
    if !has_server(&next) {
        return Ok(false);
    }
    let old = dir.with_extension("old");
    std::fs::remove_dir_all(&old).ok();
    if dir.exists() {
        std::fs::rename(dir, &old).map_err(|e| e.to_string())?;
    }
    if let Err(e) = std::fs::rename(&next, dir) {
        // Put the old one back rather than leave none.
        std::fs::rename(&old, dir).ok();
        return Err(e.to_string());
    }
    std::fs::remove_dir_all(&old).ok();
    Ok(true)
}

fn download(app: &AppHandle, url: &str, report: bool) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let res = http_get(url)?;
    let total: Option<u64> = res.header("Content-Length").and_then(|v| v.parse().ok());
    let mut reader = res.into_reader().take(MAX_DOWNLOAD);
    let mut data = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut buf = [0u8; 64 * 1024];
    let mut last = None;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        let percent = total.map(|t| ((data.len() as u64 * 100) / t.max(1)).min(100) as u8);
        if report && percent != last {
            last = percent;
            set_status(app, ServerStatus::Installing { percent });
        }
    }
    Ok(data)
}

/// Unpacks the wanted files (by name, wherever they are in the zip) into a
/// fresh folder, notes which release it is, then swaps it in for `dir`.
fn unpack(data: &[u8], dir: &Path, version: &str) -> Result<(), String> {
    let partial = dir.with_extension("partial");
    std::fs::remove_dir_all(&partial).ok();
    std::fs::create_dir_all(&partial).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = file.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())) else {
            continue;
        };
        if file.is_dir() || !WANTED.contains(&name.as_str()) {
            continue;
        }
        let mut out = std::fs::File::create(partial.join(&name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }
    if !has_server(&partial) {
        std::fs::remove_dir_all(&partial).ok();
        return Err("The download didn't have the streaming server in it.".into());
    }
    if !version.is_empty() {
        std::fs::write(partial.join(VERSION_FILE), version).map_err(|e| e.to_string())?;
    }
    std::fs::remove_dir_all(dir).ok();
    std::fs::rename(&partial, dir).map_err(|e| e.to_string())
}

/// Settings' Set Up: downloads Stremio's streaming server into this app's data
/// folder and starts it. Progress and the outcome come as `server-status`.
#[tauri::command]
pub fn server_install(app: AppHandle) -> Result<(), String> {
    let server = app.state::<Arc<StreamingServer>>();
    if matches!(server.status(), ServerStatus::Installing { .. } | ServerStatus::Ready { .. } | ServerStatus::Starting) {
        return Ok(());
    }
    let dir = installed_dir(&app).ok_or("No folder to put it in.")?;
    set_status(&app, ServerStatus::Installing { percent: None });
    thread::spawn(move || {
        let result = latest_release().and_then(|(version, url)| {
            let data = download(&app, &url, true)?;
            set_status(&app, ServerStatus::Installing { percent: Some(100) });
            unpack(&data, &dir, &version)
        });
        match result {
            Ok(()) => {
                set_status(&app, ServerStatus::Starting);
                start(app);
            }
            Err(e) => set_status(&app, ServerStatus::Failed { message: format!("Couldn’t set up the streaming server: {e}") }),
        }
    });
    Ok(())
}

/// The copy Set Up made, if that's the one in use (not Stremio Service's own
/// install or tray app, which keep themselves up to date).
fn managed_copy(app: &AppHandle) -> Option<PathBuf> {
    let dir = installed_dir(app)?;
    let in_use = find_server_dir(app).is_some_and(|d| d == dir);
    let ours = matches!(app.state::<Arc<StreamingServer>>().status(), ServerStatus::Ready { source: ServerSource::Managed, .. });
    (in_use && ours).then_some(dir)
}

/// Downloads a newer Stremio Service next to the copy in use, quietly: true
/// when one is waiting for `server_update_apply`.
#[tauri::command]
pub async fn server_update_download(app: AppHandle) -> Result<bool, String> {
    let Some(dir) = managed_copy(&app) else { return Ok(false) };
    tauri::async_runtime::spawn_blocking(move || {
        let (version, url) = latest_release()?;
        if has_server(&staged_dir(&dir)) && version_of(&staged_dir(&dir)).as_deref() == Some(version.as_str()) {
            return Ok(true);
        }
        if version.is_empty() || version_of(&dir).as_deref() == Some(version.as_str()) {
            return Ok(false);
        }
        let data = download(&app, &url, false)?;
        unpack(&data, &staged_dir(&dir), &version)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The downloaded copy swapped in: the server stops, and starts again from it
/// (a few seconds). Only when nothing's playing; the app makes sure.
#[tauri::command]
pub fn server_update_apply(app: AppHandle) -> Result<bool, String> {
    let Some(dir) = managed_copy(&app) else { return Ok(false) };
    if !has_server(&staged_dir(&dir)) {
        return Ok(false);
    }
    app.state::<Arc<StreamingServer>>().stop();
    set_status(&app, ServerStatus::Starting);
    // A moment for Windows to let go of the running files.
    thread::sleep(Duration::from_millis(800));
    let swapped = swap_in_staged(&dir);
    start(app);
    swapped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, body) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn unpacks_the_server_files_wherever_they_are_in_the_zip() {
        let dir = env::temp_dir().join(format!("cs-server-test-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let data = zip_of(&[
            ("resources/bin/windows/stremio-runtime.exe", "runtime"),
            ("resources/bin/windows/server.js", "server"),
            ("resources/bin/windows/ffmpeg.exe", "ffmpeg"),
            ("target/release/stremio-service.exe", "tray"),
            ("../escape.js", "nope"),
        ]);
        unpack(&data, &dir, "v0.1.14").unwrap();
        assert!(has_server(&dir));
        assert_eq!(version_of(&dir).as_deref(), Some("v0.1.14"));
        assert!(dir.join("ffmpeg.exe").is_file());
        assert!(!dir.join("stremio-service.exe").exists());
        assert!(!dir.parent().unwrap().join("escape.js").exists());
        // Again: replaces what's there.
        unpack(&data, &dir, "v0.1.15").unwrap();
        assert!(has_server(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_zip_without_the_server_is_refused() {
        let dir = env::temp_dir().join(format!("cs-server-test-empty-{}", std::process::id()));
        let data = zip_of(&[("readme.txt", "hi")]);
        assert!(unpack(&data, &dir, "v1").is_err());
        assert!(!dir.exists());
    }

    #[test]
    fn a_staged_copy_is_swapped_in_and_the_old_one_goes() {
        let dir = env::temp_dir().join(format!("cs-server-test-swap-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(staged_dir(&dir)).ok();
        let data = zip_of(&[("stremio-runtime.exe", "runtime"), ("server.js", "server")]);
        unpack(&data, &dir, "v1").unwrap();
        // Nothing staged: nothing happens.
        assert!(!swap_in_staged(&dir).unwrap());
        unpack(&data, &staged_dir(&dir), "v2").unwrap();
        assert!(swap_in_staged(&dir).unwrap());
        assert_eq!(version_of(&dir).as_deref(), Some("v2"));
        assert!(!staged_dir(&dir).exists() && !dir.with_extension("old").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
