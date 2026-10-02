use std::{env, fs, path::Path, path::PathBuf};

// register_listener/remove_listener: how the page subscribes to `prop` and
// `event` (addPluginListener); they need permissions like any command.
const COMMANDS: &[&str] = &["start", "command", "set", "get", "stop", "orientation", "thumb_frame", "thumb_close", "now_playing", "now_playing_clear", "pip_toggle", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        bundle_mpvkit();
    }
}

/// MPVKit ships libmpv, FFmpeg and friends as xcframeworks of *static*
/// libraries. Swift Package Manager downloads them while the plugin's Swift
/// package builds, but nothing links them into the app. So copy each one's
/// iOS slice here as lib<Name>.a and have rustc bundle it into the app's
/// static library, along with the system libraries they need.
fn bundle_mpvkit() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("mpvkit");
    fs::create_dir_all(&out).unwrap();
    let target = env::var("TARGET").unwrap_or_default();
    let simulator = target.ends_with("-sim") || target.starts_with("x86_64");
    let arch = if target.starts_with("x86_64") { "x86_64" } else { "arm64" };

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let mut xcframeworks = Vec::new();
    for root in [PathBuf::from(env::var("OUT_DIR").unwrap()), manifest.join("ios").join(".build")] {
        find_xcframeworks(&root, &mut xcframeworks, 0);
    }
    let mut linked = std::collections::HashSet::new();
    for xc in xcframeworks {
        let Some(slice) = fs::read_dir(&xc).ok().into_iter().flatten().flatten().map(|e| e.path()).find(|p| {
            let n = p.file_name().unwrap().to_string_lossy().to_string();
            // e.g. "ios-arm64" (iPhone), "ios-arm64_x86_64-simulator"; not
            // "ios-arm64_x86_64-maccatalyst" (iPad apps on a Mac).
            n.starts_with("ios-") && !n.contains("maccatalyst") && n.contains("simulator") == simulator
        }) else {
            continue;
        };
        for entry in fs::read_dir(&slice).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            let binary = match path.extension().and_then(|e| e.to_str()) {
                Some("framework") => path.join(&name),
                Some("a") => path.clone(),
                _ => continue,
            };
            let name = name.trim_start_matches("lib").to_string();
            if !binary.is_file() || !linked.insert(name.clone()) {
                continue;
            }
            // Prefixed so rustc can't pick up a same-named universal copy that
            // SwiftPM leaves in its own build folder (also on the search path).
            thin(&binary, &out.join(format!("libmpvkit_{name}.a")), arch);
            println!("cargo:rustc-link-lib=static=mpvkit_{name}");
        }
    }
    println!("cargo:rustc-link-search=native={}", out.display());
    // What MPVKit's libraries need from the system (its Package.swift linker settings).
    for fw in ["AVFoundation", "AudioToolbox", "CoreAudio", "CoreFoundation", "CoreMedia", "CoreVideo", "Metal", "VideoToolbox", "QuartzCore", "IOSurface"] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    for lib in ["bz2", "c++", "expat", "iconv", "resolv", "xml2", "z"] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
    if linked.is_empty() {
        println!("cargo:warning=MPVKit's libraries weren't found; the app won't link libmpv.");
    }
}

/// The frameworks' binaries are "universal" files wrapping the archive, which
/// rustc can't read; take out the one architecture as a plain .a.
fn thin(binary: &Path, dest: &Path, arch: &str) {
    let _ = fs::remove_file(dest);
    let thinned = std::process::Command::new("lipo")
        .arg(binary)
        .args(["-thin", arch, "-output"])
        .arg(dest)
        .status()
        .is_ok_and(|s| s.success());
    // Not a universal file (already a plain archive): use it as it is.
    if !thinned {
        fs::copy(binary, dest).unwrap();
    }
}

fn find_xcframeworks(dir: &Path, found: &mut Vec<PathBuf>, depth: u32) {
    if depth > 8 {
        return;
    }
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.extension().is_some_and(|e| e == "xcframework") {
            found.push(path);
        } else {
            find_xcframeworks(&path, found, depth + 1);
        }
    }
}
