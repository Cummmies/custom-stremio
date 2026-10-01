# TV test module

A TizenBrew module that reports what the Samsung TV app could use on a TV:
its browser version, Samsung's APIs (AVPlay), JavaScript/CSS/WebAssembly
support, whether Stremio's core loads, video formats, network access and
TizenBrew's Node.js service. The buttons on the right try real playback.

On the TV: TizenBrew → Module Manager → Add GitHub Module →
`Cummmies/custom-stremio`, then open **Custom Stremio TV Test**.
(The repository's root `package.json` points TizenBrew here;
`Cummmies/custom-stremio@main/tv` also works.)

Arrows move between the tests, OK runs one, Back stops the video,
Play/Pause and Fast-forward/Rewind work during playback.

See `docs/samsung-tv.md`.
