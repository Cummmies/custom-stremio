# Samsung TV (Tizen) plan

Status: **first version built** (`.github/workflows/tv.yml`): the app as an
installed TV app (`.wgt`) with AVPlay and remote navigation, installed with
TizenBrew Installer (`Cummmies/custom-stremio`). The sections below are the
original plan and what testing on a UN55TU8200 found; "How the TV app works"
describes what was built.

## How the TV app works

- **Same app, TV build.** `npm run build` with `TV_BUILD=1` (hash routing,
  `svelte.config.js`) and `CORE_DIR` (Stremio's core rebuilt without
  WebAssembly reference types, `scripts/build-core-tv.sh`). `tv.yml` packages
  `build/` with `tv/wgt/config.xml` into `CustomStremio.wgt`, signs it with the
  certificate from `tv-cert.yml`, and attaches it to the **tv** release, which
  it marks as the latest (TizenBrew Installer takes the latest release's
  `.wgt`). Every push that touches the app rebuilds it.
- **Over-the-air updates** (`src/lib/tv/webUpdate.ts`, `tv/boot.js`): each
  build's `_app/` files also go to the `tv-web` branch, and its manifest
  (`tv-web.json`: version, native level, entry files, file list, commit) to
  the tv release. The app checks it at launch and when it comes back to the
  front, downloads a newer build into its storage (`wgt-private/web/<version>`;
  files the installed app already has are copied, not downloaded), and offers
  **Update ready · Reload**. `tv/boot.js`, in the installed `index.html`,
  starts the newest copy: the page stays the installed one (Samsung's APIs and
  permissions) and only the app's code comes from storage. A copy that fails to
  load, or doesn't confirm it started, is dropped for the installed one.
  `tv/wgt/native-api.txt`: bump it when the installed part changes (config.xml
  privileges, boot.js); older installs then ignore new bundles until
  reinstalled.
- **Login with a code** (`src/lib/components/LinkLogin.svelte`), the default
  on the TV: Stremio's link API through the core's `auth_link` model, a QR code
  and a code to enter on another device; the TV logs in by itself.
- **Platform**: `isTV` (`src/lib/platform.ts`): no streaming server (debrid
  links only), its own synced device settings (`tv`), skip lookups fetched
  directly (the installed app isn't bound by CORS).
- **Routing**: the app opens from a local file, so it routes by hash.
  `src/lib/nav.ts` turns app paths (`/title/…`) into `#/title/…` for `goto`
  and for links.
- **Player**: `src/lib/player/avplay.svelte.ts` implements `PlayerBackend` on
  AVPlay; subtitles are drawn by the player page (`subtitleText`): the file's
  own tracks come from AVPlay as text, addon subtitles are fetched and timed
  in `src/lib/player/subtitles.ts`.
- **Remote**: `src/lib/tv/remote.ts`: arrows move focus to the nearest
  button/link/field in that direction, Back sends Escape (closes menus, leaves
  the player) and otherwise goes back or exits at Home, the media keys reach
  the player. Focus outline in `src/lib/styles/tv.css`.
- **Older engine**: about Chromium 94. `src/lib/polyfills.ts` adds the newer
  built-ins the app and Svelte use (`structuredClone`, `findLast`, …) and the
  TV build targets `chrome94`. Error pages show the real error
  (`src/hooks.client.ts`).
- **TV design** (after Apple's tvOS guidelines; `src/lib/styles/tv.css`): the
  app is zoomed 1.75× (desktop layout at ~1100 px wide; tvOS body text is
  29 pt on a 1920-pt screen, the app's 14 px), with vh/vw rewritten for zoom by
  the TV build (`tvViewportUnits` in vite.config.js; Chromium 94 sizes vh/vw
  zoom times too big). Focus lifts posters and turns buttons white instead of
  drawing rings; no backdrop blur (slow on a TV GPU). Navigation
  (`src/lib/tv/remote.ts`): left/right stay in the row, rows remember their
  item, reversing up/down returns where you came from, each page focuses its
  main action (`data-tv-focus`), a vanished focus moves to what's in its
  place, text fields open the keyboard only on OK, OK clicks anything
  focusable, scrolling is instant. Tested in Chromium 94 with a fake catalog.

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

## Our TV: UN55TU8200 (2020, Tizen 5.5)

First run of the test module (`tv/`, see `tv/README.md`) through TizenBrew:

- **The browser is newer than Tizen 5.5's original Chromium 69**: optional
  chaining, class/private fields, static blocks, `Array.at`, flex `gap`,
  `:focus-visible` and module workers all work (about Chromium 94; no
  `structuredClone`). The app's code and CSS need little or no lowering.
- **Stremio's core is blocked by one thing**: its WebAssembly uses reference
  types (`externref`), which this V8 (9.4) only has behind a flag. Bulk
  memory, non-trapping float-to-int, sign extension and multi-value are
  fine. **Fixed by rebuilding it** (tested: validates without reference
  types, same exports, the app runs on it in Chromium):

  ```sh
  git clone https://github.com/Stremio/stremio-core && cd stremio-core
  git checkout stremio-core-web-v0.63.2 && cd stremio-core-web
  RUSTFLAGS="-C target-feature=-reference-types" \
    cargo build --release --target wasm32-unknown-unknown -F wasm
  # Rust's prebuilt std still marks reference-types in the target_features
  # section, which makes wasm-bindgen use externref; drop that section.
  python3 strip_section.py ../target/wasm32-unknown-unknown/release/stremio_core_web.wasm \
    stremio_core_web.wasm target_features
  cargo install wasm-bindgen-cli --version 0.2.121 --locked
  wasm-bindgen --target web --no-typescript --out-dir out stremio_core_web.wasm
  ```

  wasm-bindgen also re-encodes the `call_indirect`s the prebuilt std wrote
  in the newer form. Output: 6.5 MB (published: 5.1 MB after `wasm-opt`;
  optional). The same build works everywhere, so desktop and iOS can use it
  too.
- **No AVPlay in a TizenBrew module**: `webapis.js` loads (`productinfo`,
  `avinfo`, `tvinfo`, `network`…, HDR TV: yes) but has no `avplay`, even
  with a player element on the page.
- **HTML5 `<video>` is the player, and it's good**: an HEVC 10-bit HDR10
  MKV with E-AC-3 + AC-3 audio played at 1080p (despite `canPlayType`
  saying no to MKV), `audioTracks` listed both, and a WebVTT `<track>`
  showed. H.264 MP4 started in under 2 s. Embedded subtitle tracks don't
  show up in `textTracks`, so subtitles come from addons (or are extracted
  by the service). DTS isn't supported.
- **No seek-bar thumbnails**: drawing the video to a canvas gives a black
  frame (the video is on a hardware plane).
- **Node.js service**: Node 16.5 (V8 9.4), WebAssembly yes, its proxy
  works (IntroDB needs it, CORS). With
  `v8.setFlagsFromString('--experimental-wasm-reftypes')` the published
  core compiles there in 1.3 s, a fallback if the rebuilt core has trouble.
- **As an installed app (.wgt, TizenBrew Installer)** with the undocumented
  `http://samsung.com/tv/metadata/use.uwe` metadata (TizenBrew sets it too):
  the newer engine (`?.`, class/private fields, flex gap, module workers,
  bulk memory / non-trapping WebAssembly) **and** `webapis.avplay`. Without
  that metadata the app gets Chromium 69. AVPlay plays H.264 MP4 and the
  HEVC HDR10 MKV, `getTotalTrackInfo` lists every track (HEVC video,
  E-AC-3 English, AC-3 Japanese, the embedded English subtitle), and
  `setExternalSubtitlePath` with a URL is accepted. The app's own Node 16.5
  service starts (launched with `launchAppControl`) and listens.
- **But the TV doesn't always pick the newer engine**: the installed app has
  started on it once and on Chromium 69 another time (the start-up report
  said "engine: OLD"). So the TV build runs on Chromium 69 too:
  - JavaScript: Vite's `chrome69` target; module workers become classic ones
    (`worker.format: 'iife'`); a few built-ins are polyfilled in `tv/boot.js`
    (before the app loads) and `src/lib/polyfills.ts`.
  - WebAssembly: Chromium 69 has only the 2017 basics, sign extension and
    mutable globals. `scripts/build-core-tv.sh` also turns off bulk memory,
    non-trapping float-to-int and multi-value, then lowers what Rust's
    prebuilt standard library still uses with binaryen's `wasm-opt`, and
    checks the result with wabt.
  - CSS: `scripts/tv-legacy-css.mjs` rewrites `:where()`, `:is()` and
    `:focus-visible` (each makes Chromium 69 drop the whole rule; Svelte puts
    `:where()` on every component style), adds fixed values before
    `min()`/`max()`/`clamp()`, turns `translate`/`scale`/`rotate` into
    `transform`, and adds stand-ins for flex `gap` and `aspect-ratio` under
    `html.tv-legacy` (set by `tv/boot.js` when the engine lacks
    `aspect-ratio`).
  - Tested in Chromium 69 (snapshot 576713) and 94 (snapshot 911577) over the
    DevTools protocol with the TV's user agent and fake catalogs: Home, a
    title, its sources, the player (up to AVPlay, which only the TV has),
    search and the menus, all by arrow keys and OK.
- **Chromium 69 won't run JavaScript modules from files**: module scripts
  need a JavaScript MIME type, and a file has none ("Failed to fetch
  dynamically imported module" in the start-up report). The newer engine
  doesn't mind, which is why the app worked only on some launches. The TV
  build therefore also has the whole app as one classic script
  (`_app/immutable/tv/app.HASH.js`, made by `scripts/tv-boot.mjs` with
  rolldown), and `tv/boot.js` loads that with a `<script>` tag on both
  engines. Each module's `import.meta.url` becomes `window.__tvUrl(path)`,
  so the core's worker and WebAssembly and each page's CSS resolve against
  the copy that started (installed or downloaded). Testing this needs the
  app opened from files (`file://`), not from a local web server, which is
  how earlier Chromium 69 tests missed it.
  SvelteKit's page sets a settings object whose name changes with every
  build (`__sveltekit_xxxx`); a downloaded copy runs on the installed page,
  so the script first finds the page's object and gives it its own name
  (a tiny module bundled first), or a newer copy fails in `kit.start`.
- **Remote and player (tvOS)**: on the video, OK pauses, Left/Right skip
  10 s, Up/Down bring up the controls on the timeline; on the timeline
  Left/Right skip (30 s when held), Down reaches the buttons; the controls
  fade after a few seconds and focus goes back to the video. The volume
  slider is hidden (the remote has its own).
- **Seek-bar thumbnails**: not available on the TV. They need frames of the
  video, and Samsung's player (AVPlay) draws on a hardware plane the app
  can't read; a `<video>` drawn to a canvas is black too. Options: the
  streaming server on a PC making them with ffmpeg, or WebCodecs on the
  newer engine (only some launches, and only if the TV decodes the codec
  there): untested.
- **The remote's OK sends a keydown and no keypress**, and buttons only click
  on keypress, so Play and other buttons did nothing. `$lib/tv/remote.ts`
  clicks the focused control on OK.
- **Hash routing**: the route and its query live in the address's hash
  (`#/title/…?video=…`), so `page.url.pathname` and `page.url.searchParams`
  are empty on the TV. Code reads them through `appUrl(page.url)`
  (`$lib/nav`).
- **Loading updates**: navigating the installed app to a page served by its
  service (`http://127.0.0.1:8090/…`) gives a black screen, even with
  `tizen:allow-navigation`; dropped. A copy written to `wgt-private` and
  opened from there loads and its scripts run, but its inline `<style>` was
  ignored (unstyled page). Being checked: which inline styles/scripts a
  page from storage may use (Svelte sets `style=""` attributes). Also testing the iPhone-like way: download the
  new files into the app's own storage (`wgt-private`) and open them from
  there, which keeps the page local (AVPlay, same-origin workers).
- **Memory**: 1 GB, little free. Keep the TV build lean.
- Network from the page: Cinemeta, the Stremio API and TheIntroDB work
  directly; IntroDB needs the service proxy.

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
  `application.launch`, and `filesystem.read`/`filesystem.write` for
  over-the-air updates. (They were dropped for a while on the suspicion that
  they made the TV pick its old engine; the engine turned out to vary between
  launches anyway, and the app now runs on both.)

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
- **TizenBrew** (the plan; already on the TV): adds and updates "modules"
  from GitHub or npm, no PC needed. This app becomes one (see "TizenBrew
  module" below).
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

- **TizenBrew module** (the plan): TizenBrew loads the module's files from
  GitHub on each launch, so pushing a new build is the whole update.
- **Packaged app** (the `.wgt` holds the web build): every update means
  reinstalling from a PC. Simple, works offline.
- **Hosted app** (recommended once it works): the `.wgt` only holds a small
  loader that opens the web build from the public "web" release, like the iPhone
  app's over-the-air updates. Every push to `main` reaches the TV on its next
  launch with no reinstall. It needs the same signature check and a fallback
  copy inside the `.wgt` for when the network is down.

## TizenBrew module

TizenBrew (already on the TV) runs "app" modules: plain web pages it
downloads through jsDelivr and serves from its own little server on the TV
(`http://127.0.0.1:8081/module/...`). A module can come from npm or straight
from **GitHub** (Module Manager → **Add GitHub Module**), which is the plan:
no npm account, no Tizen Studio, no Samsung certificate.

- A `tv.yml` workflow builds the TV version of `src/` and pushes it to a
  `tv` branch holding only the built files plus this `package.json`:

  ```json
  {
    "name": "custom-stremio-tv",
    "version": "0.1.0",
    "packageType": "app",
    "appName": "Custom Stremio",
    "appPath": "app/index.html",
    "keys": ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaFastForward", "MediaRewind", "MediaStop"]
  }
  ```

- On the TV: TizenBrew → Module Manager → Add GitHub Module →
  `Cummmies/custom-stremio@tv`.
- Updates: TizenBrew fetches the files from jsDelivr every launch, so a push
  to `tv` is the update. jsDelivr caches a branch for up to 12 hours; the
  workflow asks it to purge (`purge.jsdelivr.net`) so it's minutes instead.
- jsDelivr only serves **public** repos, and files up to 20 MB (the core's
  WebAssembly is well under).
- `serviceFile` can add a Node.js script that TizenBrew runs in the
  background, useful for requests the page can't make itself (CORS), like
  `skip_lookup` on desktop.

The catch: a page loaded through TizenBrew doesn't get all of Tizen's APIs
(Jellyfin's module ships an adapter that stubs `tizen.application`,
`systeminfo` and `tvinputdevice`; TizenBrew registers the `keys` itself).
Whether **`webapis.avplay`** is reachable from a module is the first thing to
test. If it isn't:

- play with the HTML5 `<video>` element instead (also hardware decoded on
  Tizen, but fewer formats and weaker audio/subtitle track switching), or
- ship a real `.wgt` (full APIs) as a GitHub release; the TizenBrew Installer
  installs apps straight from a GitHub `user/repo`. Updates then mean
  reinstalling, unless the `.wgt` loads its pages from the `tv` branch.

## Phases

| Phase | What | Rough size |
| --- | --- | --- |
| 0 | A test TizenBrew module that reports the TV's Chromium, whether the core's WebAssembly loads, whether `webapis.avplay` exists, and tries `<video>` + canvas thumbnails | an evening |
| 1 | Build target and CSS fallbacks for the TV's Chromium; `isTV`; hide unsupported settings | 1–2 days |
| 2 | AVPlay backend: play, seek, tracks, addon subtitles, errors | 2–4 days |
| 3 | Remote navigation and the 10-foot layout | 3–5 days |
| 4 | Code/QR login, if the link API is usable; "Streaming server" address setting for torrents through the PC (also on iPhone) | 1–2 days |
| 5 | Hosted updates and a CI workflow | 1–2 days |

Phase 0 decides the rest: a 2022+ TV makes phase 1 small, and a WebAssembly
problem in the core would need solving before anything else.
