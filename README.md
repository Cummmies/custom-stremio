# Custom Stremio

A Stremio client built with Tauri 2 and SvelteKit, running on Windows and iPhone.
It uses Stremio's own core (`stremio-core-web`) for accounts, addons, the library
and watch progress, and plays video with mpv: libmpv on Windows, MPVKit on iOS.

On top of what Stremio does:

- **Easy Mode**: picks and plays the best source by itself (quality, debrid, audio
  language, anime dub/sub preferences), retrying another source when one fails.
- **Skips**: Skip Intro / Recap / Credits from the file's chapters or the
  TheIntroDB / IntroDB databases, with Intro/Outro (Credits on movies) marked on
  the seek bar.
- **Up Next**, "Are you still watching?", seek-bar thumbnails, HDR, profiles with
  pictures, **Customize Home** (reorder, rename, hide and combine rows).
- **Settings sync** through a Stremio addon (see below).
- A phone layout that follows Apple's guidelines, with touch controls in the player.

## Project layout

| Path | What |
| --- | --- |
| `src/` | The app's screens (SvelteKit, Svelte 5). Shared by every platform. |
| `src/lib/platform.ts` | Which app this is: desktop, iOS or a plain browser. |
| `src/lib/player/` | Player: `backend.ts` (the interface every player implements), `mpv.svelte.ts` (mpv, desktop and iOS), Easy Mode, ranking, skips, thumbnails. |
| `src/lib/cloudSync.svelte.ts` | Settings sync through the sync addon. |
| `src/lib/updates.svelte.ts` | Updates: the whole app on Windows, the web side on iOS. |
| `src-tauri/src/` | Rust: libmpv player, streaming server, Discord, Windows media overlay, storage, skip lookups, web updates. |
| `src-tauri/plugins/mpv/` | The iOS player: a Tauri plugin in Swift on MPVKit (`ios/Sources/MpvPlugin`). |
| `.github/workflows/` | `release.yml` (Windows), `ios.yml` (iPhone), `tv.yml` (Samsung TV), `web.yml` (iOS web updates), `preview.yml` and `pages.yml` (GitHub Pages). |
| `docs/` | Plans, e.g. [`samsung-tv.md`](docs/samsung-tv.md). |

## Desktop (Windows)

Needs Node 22, Rust (stable) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev      # run
npm run check          # type check
npm run tauri build    # installer
```

Playback needs `libmpv-2.dll`: put it in `src-tauri/lib/`, or have Stremio installed
(its copy is used), or point `MPV_DLL` at one. Torrents need Stremio's streaming
server; see `src-tauri/server/README.md`. Debrid links don't.

### Releasing

1. Bump `version` in `src-tauri/tauri.conf.json` and `package.json`.
2. Commit, then push a tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The tag builds all three apps into one GitHub Release, **Stremio
   v0.2.0**, marked as the latest (`.github/actions/release`; each adds its
   file as it finishes):
   - `release.yml`: the signed Windows installer and `latest.json`; installed
     copies offer the update by themselves.
   - `ios.yml`: `CustomStremio.ipa` for sideloading.
   - `tv.yml`: `CustomStremio.wgt`, which TizenBrew Installer installs from the
     latest release.

Between releases, the iPhone and TV apps update their screens over the air
(the **web** and **tv** pre-releases), so a new release is only needed for
native changes or a fresh install.

## iPhone

The iOS app is built on GitHub's Mac runners (no Mac needed) and installed by
sideloading. It needs iOS 18 or later.

### Building

Each release (`v*` tag) has `CustomStremio.ipa`. For a build in between:
Actions → **iOS** → **Run workflow**; when it finishes, the run's **Artifacts**
has **CustomStremio-ios** with `CustomStremio.ipa`.

The build is unsigned (`tauri ios build --no-sign`) and then ad-hoc signed, so the
sideloading app can sign it with your Apple ID. A build only needs redoing when
native code changes: `src-tauri/` (Rust, the Swift player, `Info.ios.plist`,
icons). Everything under `src/` reaches the phone as an over-the-air update.

### Sideloading

Any of these work with a free Apple ID:

- **SideStore** or **AltStore**: add the `.ipa`; they re-sign it every 7 days by
  themselves (Apple's limit for free accounts; a paid developer account makes
  it a year).
- **LiveContainer**: runs it inside its own container. If it says the code
  signature is invalid, check Settings → JIT-Less Diagnose: the certificate it
  holds may have expired; refresh LiveContainer in SideStore and re-import the
  certificate, then Force Sign the app.
- **Sideloadly** from a PC.

The first time, turn on Developer Mode (Settings → Privacy & Security).

### What's different on iOS

- Torrents aren't playable: there's no streaming server on iOS. Debrid links are,
  and Easy Mode only picks those.
- Upscaling, HDMI audio passthrough, Discord, window modes and the Windows media
  overlay are desktop-only and hidden.
- HDR plays in HDR on the iPhone screen (EDR), switched on for HDR video only.
- The player locks to landscape; browsing is portrait.
- Picture in Picture: swiping home while a video plays moves it into a PiP
  window. mpv comes from [Streamyfin's MPVKit fork](https://github.com/streamyfin/MPVKit)
  (`src-tauri/plugins/mpv/ios/Package.swift`; a GPL build), whose
  vo_avfoundation draws into the layer PiP shows: one picture, one stream.
- Control Center and the Lock Screen show what's playing, with play/pause,
  ±10 s and seeking.

## Over-the-air updates (iOS)

The iPhone app updates its web side (`src/`) without reinstalling:

1. Every push to `main` that touches the web side runs `web.yml`: it builds
   `src/`, zips it as `web.zip`, signs it with the updater key, and publishes
   `web.zip`, `web.zip.sig` and `web.json` to the **web** pre-release.
2. The app checks `web.json` a few seconds after launch and when it comes back
   to the front (at most every 30 minutes), downloads a newer bundle, verifies
   its signature, and shows **Update ready · Reload**.
3. A bundle that fails to load is thrown away on the next launch.

`src-tauri/native-api.txt` says which native build the web side needs. Bump it when
the web side starts using a new native command (a new plugin command, say); apps
with an older native build then ignore new bundles until they're reinstalled, and
the next `.ipa` must be built and installed.

Updates are downloaded without signing in, so **the repository must be public**
for them to work (Windows updates too). While it's private, apps simply find no
update. To keep the source private for good, publish the release files to a
separate public repository instead.

### Secrets

| Secret | Used by | What |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `release.yml`, `web.yml` | Contents of `~/.tauri/custom-stremio.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | same | Empty unless the key has a password |

The matching public key is in `tauri.conf.json` (updater) and
`src-tauri/src/web_update.rs` (web updates).

## Settings sync

While you're logged in, the app keeps a **Custom Stremio Sync** addon in your
Stremio account. Stremio syncs addons to every device, so it carries this app's own
data: the profile's name, color and picture, the Customize Home layout, and the
settings. Settings about the device (upscaling, passthrough, volume, window
pausing) are kept per kind of device and only applied to that kind.

The addon has no catalogs or streams and an address that never resolves, so no
Stremio app ever requests anything from it. The data sits in the manifest's
`contactEmail` field, because Stremio's core drops manifest fields it doesn't know.
Changes go up a few seconds after they're made; logging in takes the account's
copy when it's newer. See `src/lib/cloudSync.svelte.ts`.

## Notes

- `server.js` (Stremio's streaming server) isn't open source: fine to bundle for
  personal use, not to redistribute.
- Discord Rich Presence needs a Discord Application ID in
  `src-tauri/src/discord.rs` (`CLIENT_ID`); it's empty for now.
