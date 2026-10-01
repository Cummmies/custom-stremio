# Samsung TV (Tizen) plan

Status: plan only, nothing built yet. Written so it can be picked up later.

## The short version

Samsung TVs run Tizen, and Tizen apps are web apps. The same SvelteKit build
that the iPhone app shows can run on the TV, packaged as a Tizen web app
(`.wgt`) and sideloaded with Samsung's developer tools. What has to be new:

1. **A player** on Samsung's own video player (AVPlay), since mpv can't run there.
2. **Remote control navigation**: every screen reachable with arrows, OK and Back.
3. **A 10-foot layout**: big text and a clear focus highlight, read from a sofa.
4. **Packaging, signing and install** with Tizen Studio's command-line tools.

Everything else (Stremio's core, addons, library, Easy Mode, skips, Up Next,
profiles, Customize Home, settings sync) is shared code and comes along.

## What decides how hard it is: the TV's year

Each Tizen version ships a fixed, old Chromium, and the app has to run on it:

| TV year | Tizen | Chromium |
| --- | --- | --- |
| 2019 | 5.0 | 63 |
| 2020 | 5.5 | 69 |
| 2021 | 6.0 | 76 |
| 2022 | 6.5 | 85 |
| 2023 | 7.0 | 94 |
| 2024 | 8.0 | 108 |

(Check the model's exact version: Settings → Support → About This TV, or the
model code, e.g. `QE55Q80TAT` → the `T` is 2020.)

- **2022 and newer**: the current code needs little more than a build target.
- **2020–2021**: the build has to be compiled down (Vite `build.target`
  `chrome69`, which turns `?.`, `??` and private class fields into older
  JavaScript). CSS `gap` in flex layouts doesn't exist before Chromium 84, so
  rows and toolbars that rely on it need a fallback (margins, under a
  `.tv` class).
- **Any year**: test that `stremio-core-web`'s WebAssembly loads. Older Chromiums
  lack some newer WebAssembly features (bulk memory, reference types); if the
  core uses them, it has to be rebuilt without them. This is the biggest
  unknown and the first thing to check.

## 1. Platform

- `src/lib/platform.ts`: add `isTV` (the `tizen` global exists) next to
  `isDesktop` and `isIOS`.
- `src/lib/cloudSync.svelte.ts`: `DEVICE_KIND` becomes `'tv'` there, so the TV
  gets its own device settings and leaves the PC's and phone's alone.
- Hide what can't work: upscaling, passthrough settings, Discord, window modes,
  the streaming server section, keyboard shortcuts, the desktop updater.

## 2. Player: AVPlay backend

A new `src/lib/player/avplay.svelte.ts` implementing `PlayerBackend`
(`src/lib/player/backend.ts`), picked in `player.ts` when `isTV`.

| Backend method | AVPlay |
| --- | --- |
| load | `webapis.avplay.open(url)`, `setDisplayRect(0, 0, 1920, 1080)`, `prepareAsync`, `play` |
| play / pause / seek | `play`, `pause`, `seekTo(ms)` |
| time, duration | `getCurrentTime`, `getDuration`, plus `oncurrentplaytime` events |
| buffering, end, errors | `setListener`: `onbufferingstart/complete`, `onstreamcompleted`, `onerror` |
| audio / subtitle tracks | `getTotalTrackInfo`, `setSelectTrack('AUDIO' / 'TEXT', index)` |
| addon subtitles | `setExternalSubtitlePath(url)`; AVPlay hands each line to `onsubtitlechange` and the app draws it in its own overlay |
| subtitle delay | `setSubtitlePosition(ms)` |
| volume | the TV's own (remote volume keys), not in-app |

Features flag: no seek-bar thumbnails at first (see below), no upscaling, no passthrough settings (the TV handles audio output). HDR10, HLG
and Dolby Vision play natively; the TV switches mode by itself.

Chapters: AVPlay doesn't expose them, so skips come from TheIntroDB / IntroDB
only (plus the end-of-file credits guess).

Formats: what the TV's decoders take (H.264, HEVC, AV1 on newer models; AAC,
AC3, EAC3; DTS dropped on 2018+ models). MKV is supported. Files the TV can't
play fail, and Easy Mode moves on to the next source; it should prefer formats
the TV handles (add a TV rule to the ranking: avoid DTS-only audio).

**Seek-bar thumbnails.** On the PC and iPhone, a second hidden mpv decodes
frames for them. On the TV, AVPlay draws the video on a hardware layer *behind*
the web page, so the page can never read its pixels, and TVs have few hardware
decoders, so a second hidden player usually isn't allowed (Plex's Tizen app
has the same gap). Things to try in phase 0: a hidden `<video>` element drawn
to a `<canvas>` (may work for H.264 MP4, rarely for MKV/HEVC), or having the
PC make them when the TV uses its streaming server (option A below).

## 3. Streams and network

Torrents need Stremio's streaming server, a Node.js program that downloads the
torrent and serves it as a video. Three ways to get it on the TV:

- **A. Use the PC's server (recommended first).** The desktop app already runs
  it. The TV (and iPhone) gets a "Streaming server" setting with the PC's
  address, e.g. `http://192.168.1.20:11470`, and plays torrents through it.
  Works while the PC is on; nothing new runs on the TV.
- **B. Run a torrent engine on the TV.** Tizen apps can include a background
  "web service" that runs on the TV's own Node.js (TizenBrew's modules use
  this on sideloaded TVs). But that Node is very old (4.4.3 on Tizen 3/4),
  Stremio's `server.js` won't run on it and may not be redistributed anyway,
  and TVs have little memory and storage for a torrent cache. It would mean
  writing our own small engine in old JavaScript. Possible, slow going;
  only worth it if A isn't enough.
- **C. A hosted torrent-to-stream addon** (Webtor-style). Someone else's
  servers see what you watch; not planned.

Without any of these, debrid links play as on iOS, and Easy Mode already
filters to them when no server is reachable.
- **Skip lookups**: on desktop/iOS they go through the native `skip_lookup`
  command. On the TV, plain `fetch` works because packaged Tizen apps aren't
  bound by CORS when `config.xml` allows the origin:
  `<access origin="*" subdomains="true"/>`. `src/lib/player/skips.ts` gets a
  `fetch` branch.
- `config.xml` also needs the privileges: `internet`, `tv.inputdevice`,
  `application.launch`.

## 4. Remote control

- **Spatial navigation**: arrows move focus to the nearest focusable item in
  that direction. Use a library (e.g. `@noriginmedia/norigin-spatial-navigation`
  or `js-spatial-navigation`) wired to the existing buttons and poster cards,
  with rows remembering their last focused item.
- **Keys**: arrows, Enter, Back (`keyCode 10009`) as the app's back button.
  Media keys (Play, Pause, Play/Pause, Fast-forward, Rewind, Stop) and the
  colour keys have to be registered first:
  `tizen.tvinputdevice.registerKey('MediaPlayPause')` etc.
- **Player**: left/right seek 10 s (held: faster), up/down show the controls,
  OK toggles pause, Back hides the controls and then leaves.
- **Text input**: the TV's on-screen keyboard appears for inputs; search keeps
  working, just slowly.

## 5. 10-foot layout

The TV renders at 1920×1080 CSS pixels. Under `:root.tv`:

- Bigger type (body ~28px), posters sized for 6–7 per row.
- Focus: scale 1.08 and a white outline/glow on the focused card or button;
  never rely on hover.
- Safe margins: keep content ~5% in from the edges (overscan).
- The TopNav becomes a left-side rail, as on Samsung's own apps.

## 6. Login

Typing an email and password with a remote is painful. Stremio's own TV apps
show a code to enter on another device (`link.stremio.com`); if that API is
usable by other apps (to verify), the TV shows the code and a QR, and polls
until it's linked. Fallback: the normal login form with the on-screen keyboard.
Once logged in, settings sync brings the profile, Home layout and settings over.

## 7. Building, signing, installing

Three ways to sideload:

- **Tizen Studio** (official): described below.
- **TizenBrew** (recommended for daily use): a homebrew app installed once
  (with Tizen Studio or its installer); after that it adds and updates
  "modules" from GitHub or npm, no PC needed. This app can be published as a
  TizenBrew module, which also solves updates (section 8). Its install guides
  cover 2023–2025 TVs (Tizen 6–8).
- **From an Android phone** with Termux and `sdb`, no PC (community scripts).

USB-stick installs only work on pre-Tizen (pre-2015) Samsung TVs.

Tizen Studio details:

- **Tools**: Tizen Studio's command-line tools (`tizen`, `sdb`), on Windows.
- **Certificate**: a Samsung certificate (free, made in Tizen Studio's
  Certificate Manager with a Samsung account). It's tied to the TV's DUID, so
  it only installs on TVs listed in it.
- **TV**: Apps → type `12345` on the remote → Developer mode on, with the PC's IP.
  Then `sdb connect <tv-ip>`, `tizen install -n CustomStremio.wgt`.
- **Build**: `npm run build` with the TV target, copy `build/` plus `config.xml`
  and the icon into a folder, `tizen package -t wgt -s <profile>`.
- **CI** (later): a `tv.yml` workflow that packages and signs the `.wgt`, with
  the certificate and its password in repository secrets.

Developer-mode installs don't expire like iOS free signing does, but the TV
drops developer mode after some time with no developer connection on some
models; reinstalling fixes it.

## 8. Updates

Three options:

- **TizenBrew module**: TizenBrew checks for new module versions itself, so
  publishing a new build is the whole update. Simplest if TizenBrew is used.
- **Packaged app** (the `.wgt` holds the web build): every update means
  reinstalling from a PC. Simple, works offline.
- **Hosted app** (recommended once it works): the `.wgt` only holds a small
  loader that opens the web build from the public "web" release, like the iPhone
  app's over-the-air updates. Every push to `main` reaches the TV on its next
  launch with no reinstall. It needs the same signature check and a fallback
  copy inside the `.wgt` for when the network is down.

## Phases

| Phase | What | Rough size |
| --- | --- | --- |
| 0 | Find the TV's Tizen version; package the current build as a `.wgt` (or TizenBrew module); check the core's WebAssembly loads; try the `<video>` + canvas thumbnails | an evening |
| 1 | Build target and CSS fallbacks for the TV's Chromium; `isTV`; hide unsupported settings | 1–2 days |
| 2 | AVPlay backend: play, seek, tracks, addon subtitles, errors | 2–4 days |
| 3 | Remote navigation and the 10-foot layout | 3–5 days |
| 4 | Code/QR login, if the link API is usable; "Streaming server" address setting for torrents through the PC (also on iPhone) | 1–2 days |
| 5 | Hosted updates and a CI workflow | 1–2 days |

Phase 0 decides the rest: a 2022+ TV makes phase 1 small, and a WebAssembly
problem in the core would need solving before anything else.
