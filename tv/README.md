# TV test

Reports what the Samsung TV app could use on a TV: its browser, Samsung's
APIs (AVPlay), JavaScript/CSS/WebAssembly support, whether Stremio's core
loads, video formats, network access and the Node.js service. The buttons on
the right try real playback.

It runs two ways, from the same files:

- **TizenBrew module**: TizenBrew → Module Manager → Add GitHub Module →
  `Cummmies/custom-stremio` (the root `package.json` points here), then open
  **Custom Stremio TV Test**. A push reaches the TV on its next launch.
- **Installed app** (`.wgt`): `tv.yml` packages `app/`, `service.js` and
  `wgt/config.xml`, signs it and publishes it as the latest release. Install
  it with TizenBrew Installer on a PC → `Cummmies/custom-stremio`. It shows
  up as **Custom Stremio** on the TV. Button 7 reloads the page from the
  app's own service, to compare a page served by us with the packaged one.

Signing needs the certificate from `.github/workflows/tv-cert.yml` (run once,
see the steps at the top of that file).

Arrows move between the tests, OK runs one, Back stops the video (and then
leaves), Play/Pause and Fast-forward/Rewind work during playback.

See `docs/samsung-tv.md`.
