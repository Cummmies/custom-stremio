// stremio_core_web.js reads `document.baseURI` when it is first evaluated, and
// workers have no `document`. This module is imported first so the shim exists
// before that happens (same trick as the package's own worker.js).
(self as any).document = { baseURI: self.location.href };
