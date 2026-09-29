fn main() {
    // Rebuild when the icons change, so the .exe's embedded icon isn't stale.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
