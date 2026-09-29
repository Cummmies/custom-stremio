# Bundled streaming server (optional)

Drop Stremio's streaming server files here to ship them inside the app,
the same way the official desktop app does:

- `stremio-runtime.exe` (Stremio's renamed Node.js runtime)
- `server.js`
- `ffmpeg.exe`, `ffprobe.exe` and the `*.dll` files next to them (for transcoding)

You can copy them from `%LOCALAPPDATA%\Programs\StremioService`.

If this folder has no server, the app falls back to an existing Stremio Service
install, and if Stremio Service is already running it just uses that.

Note: `server.js` is not open source. Bundling it is fine for personal use, but
don't redistribute builds that include it publicly. The binaries here are gitignored.
