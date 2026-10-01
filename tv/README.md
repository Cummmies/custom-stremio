# TV test module

A TizenBrew module that reports what the Samsung TV app could use on a TV:
its browser version, Samsung's APIs (AVPlay), JavaScript/CSS/WebAssembly
support, whether Stremio's core loads, video formats, network access and
TizenBrew's Node.js service. The buttons on the right try real playback.

On the TV: TizenBrew → Module Manager → Add GitHub Module →
`Cummmies/custom-stremio@main/tv`, then open **Custom Stremio TV Test**.

Arrows move between the tests, OK runs one, Back stops the video,
Play/Pause and Fast-forward/Rewind work during playback.

See `docs/samsung-tv.md`.
