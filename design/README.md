# Design

`logo.svg` is the app's logo: the source for every icon.

- In the app: `src/lib/assets/logo.svg` (the same drawing, metadata removed).
- Browser tab: `static/favicon.png` (the logo, 64 px, transparent).
- Desktop icons: `src-tauri/icons/` (all but `ios/`), the logo alone on a
  transparent background, as Windows shows app icons: `logo.svg` with its
  viewBox widened to `-8 -8 272 272` (a little margin) and 1024 px, then
  `npx tauri icon <that.svg> -o <dir>`, copying everything except `ios/` and
  `android/`.
- iPhone icons: `src-tauri/icons/ios/`, from a 1024 px square with the logo at
  about two-thirds size on an opaque dark gradient (`#202027` → `#111115` →
  `#0a0a0d`, top to bottom). They must have no transparency at all, or iOS
  shows a light fringe at the edges, so they're saved as plain RGB.
- TV: `tv/wgt/icon.png`, 512 px, the same background with the logo at
  about 56%: the Samsung launcher shows the icon edge to edge.
