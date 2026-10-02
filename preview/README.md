# Preview site

The app in a browser, on every device, with made-up titles: look at a change
on the TV, iPhone, iPad or PC layout without installing anything, and have the
TV remote's navigation checked on every screen automatically.

**https://cummmies.github.io/custom-stremio/main/** (each branch has its own:
`…/custom-stremio/<branch>/`, linked from the
[front page](https://cummmies.github.io/custom-stremio/)).

Every push builds it (`.github/workflows/preview.yml`). A push to a branch
other than `main` shows a change there before it reaches the apps; `main`'s
TV and iOS updates are separate (`tv.yml`, `web.yml`).

## What's on it

- **Try it**: pick a device and a screen; the app runs in the page. On the
  TV, the keyboard is the remote: arrows move, Enter is OK, Esc is Back.
  "Slow network" makes catalogs take a few seconds, the way they can on a TV.
- **Screenshots**: every screen on every device, the TV ones on both of its
  engines (Chromium 69, the TV's built-in one, and 94, the newer one). A
  branch's pictures are compared with `main`'s, `main`'s with its last run:
  what changed is outlined.
- **Navigation**: on each TV screen, every arrow pressed on every item reached
  (up to a limit). Problems: a press that skipped over items, jumped more
  than most of a screen, or lost focus. Warnings: items the arrows never
  reach, or that end up off the screen or covered. The run shows red on
  GitHub when there are problems.

## How it works

The app is the TV build, unchanged (what the TV runs), with three files added
by `scripts/preview/make-site.mjs`:

- `boot.js` runs first: picks the device (a TV is a Tizen user agent for the
  app; the others undo the TV look), the screen size, sample profiles or a
  Continue Watching row, and stands in for Samsung's video player.
- `sw.js`, a service worker, answers every request to another site (addons,
  images, intro timings) from `fixtures.js`, so nothing real is contacted and
  every run looks the same.
- `fixtures.js`: the made-up catalogs, titles, episodes, streams and artwork.

The screens are listed in `screens.json` (a screen can press keys after it
opens: `steps`). The checks are `scripts/preview/check.mjs`, which drives
Chrome over the DevTools protocol (`cdp.mjs`), and `audit.js`, which lists what
the remote can focus the way `src/lib/tv/remote.ts` does.

## Locally

```sh
# The TV build (as tv.yml does; CORE_DIR: a TV core, see docs/samsung-tv.md)
sed -i '/export const ssr/d' src/routes/+layout.ts
TV_BUILD=1 CORE_DIR=… npm run build && node scripts/tv-boot.mjs build
git checkout src/routes/+layout.ts

node scripts/preview/make-site.mjs build site
node scripts/preview/serve.mjs site 4173            # http://localhost:4173/
node scripts/preview/check.mjs site --chrome "$(command -v google-chrome)" \
    [--tv69 …/chrome] [--tv94 …/chrome] [--only home,show]
```

The checks need a Chrome; the TV ones need Chromium 69 and 94
(`chromium-browser-snapshots`, positions in `preview.yml`).
