import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import { readFileSync } from "node:fs";
import tvLegacyCss from "./scripts/tv-legacy-css.mjs";
const host = process.env.TAURI_DEV_HOST;
// The Stremio core this build carries, for Settings' About line.
const coreVersion = JSON.parse(readFileSync(new URL("./node_modules/@stremio/stremio-core-web/package.json", import.meta.url), "utf8")).version;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit()],

  // CORE_DIR: a stremio-core-web build to use instead of the npm package's.
  // The TV build uses one compiled without WebAssembly reference types, which
  // Samsung's 2020-22 TVs lack (docs/samsung-tv.md, scripts/build-core-tv.sh).
  resolve: process.env.CORE_DIR
    ? {
        alias: [
          { find: /^@stremio\/stremio-core-web\/stremio_core_web\.js$/, replacement: process.env.CORE_DIR + "/stremio_core_web.js" },
          { find: /^@stremio\/stremio-core-web\/stremio_core_web_bg\.wasm/, replacement: process.env.CORE_DIR + "/stremio_core_web_bg.wasm" },
        ],
      }
    : undefined,

  // stremio-core-web ships CommonJS; pre-bundle it so the module worker can import it.
  optimizeDeps: {
    include: [
      "@stremio/stremio-core-web/bridge.js",
      "@stremio/stremio-core-web/stremio_core_web.js",
    ],
  },
  // The TV build's worker is a classic script: the TV's built-in engine
  // (Chromium 69) has no module workers.
  worker: { format: process.env.TV_BUILD ? /** @type {const} */ ("iife") : /** @type {const} */ ("es") },
  define: {
    "import.meta.env.TV_BUILD": JSON.stringify(!!process.env.TV_BUILD),
    "import.meta.env.CORE_VERSION": JSON.stringify(coreVersion),
  },

  // Samsung TVs from 2020 sometimes run apps on their built-in Chromium 69 and
  // sometimes on the newer, upgradeable one, so the TV build targets 69
  // (missing APIs: src/lib/polyfills.ts).
  build: process.env.TV_BUILD ? { target: "chrome69" } : undefined,

  // The TV app is zoomed (src/lib/styles/tv.css), and under zoom vh/vw units
  // come out zoom times too big; they become calc() with --tv-vh / --tv-vw.
  // Then CSS for Chromium 69 (scripts/tv-legacy-css.mjs).
  css: process.env.TV_BUILD ? { postcss: { plugins: [tvViewportUnits(), tvLegacyCss()] } } : undefined,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

/** TV build: `100vh` → `calc(100 * var(--tv-vh, 1vh))` (and vw, dvh, svh, lvh). */
function tvViewportUnits() {
  const unit = /(-?(?:\d+\.?\d*|\.\d+))[dsl]?v([hw])\b/g;
  return {
    postcssPlugin: "tv-viewport-units",
    /** @param {{ prop: string, value: string }} decl */
    Declaration(decl) {
      // The units' own definitions (tv.css): rewritten, they'd refer to
      // themselves, which makes them empty.
      if (decl.prop.startsWith("--tv-v")) return;
      // Already converted (the fallback inside var() would match again).
      if (decl.value.includes("--tv-v")) return;
      if (unit.test(decl.value)) {
        decl.value = decl.value.replace(unit, (_, n, axis) => `calc(${n} * var(--tv-v${axis}, 1v${axis}))`);
      }
      unit.lastIndex = 0;
    },
  };
}
