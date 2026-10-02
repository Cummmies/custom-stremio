# Design

`logo.svg` is the app's logo: the source for every icon.

- In the app: `src/lib/assets/logo.svg` (the same drawing, metadata removed).
- Browser tab: `static/favicon.png` (the logo, 64 px, transparent).
- App icons (desktop, iPhone): `src-tauri/icons/`, made from a 1024 px
  square with the logo at about two-thirds size on an opaque dark gradient
  (`#202027` → `#111115` → `#0a0a0d`, top to bottom). `npx tauri icon
  <square.png> -o src-tauri/icons` makes the desktop set; the iPhone set
  (`ios/`) must have no transparency at all, or iOS shows a light fringe at
  the edges, so it's saved as plain RGB.
- TV: `tv/wgt/icon.png`, 512 px, the same background with the logo at
  about 56%: the Samsung launcher shows the icon edge to edge.
