# Bundled libmpv (optional)

Put `libmpv-2.dll` here to ship it inside the app. Release builds on GitHub
Actions download it automatically (see `.github/workflows/release.yml`).

When this folder has no DLL, the app uses the copy from an installed Stremio
(`%LOCALAPPDATA%\Programs\Stremio` or `...\LNV\Stremio-5`), or `MPV_DLL`.
