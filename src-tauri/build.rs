fn main() {
    // Rebuild when the icons change, so the .exe's embedded icon isn't stale.
    println!("cargo:rerun-if-changed=icons");
    // Which web build is built in (src/web_update.rs); set by the iOS CI build.
    println!("cargo:rerun-if-env-changed=WEB_BUILD_VERSION");
    println!("cargo:rerun-if-changed=native-api.txt");
    tauri_build::build()
}
