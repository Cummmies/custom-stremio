import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

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
  worker: { format: /** @type {const} */ ("es") },

  // The Samsung TV's engine is about Chromium 94 (missing APIs: src/lib/polyfills.ts).
  build: process.env.TV_BUILD ? { target: "chrome94" } : undefined,

  // The TV app is zoomed (src/lib/styles/tv.css), and under zoom vh/vw units
  // come out zoom times too big; they become calc() with --tv-vh / --tv-vw.
  css: process.env.TV_BUILD ? { postcss: { plugins: [tvViewportUnits()] } } : undefined,

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
    /** @param {{ value: string }} decl */
    Declaration(decl) {
      // Already converted (the fallback inside var() would match again).
      if (decl.value.includes("--tv-v")) return;
      if (unit.test(decl.value)) {
        decl.value = decl.value.replace(unit, (_, n, axis) => `calc(${n} * var(--tv-v${axis}, 1v${axis}))`);
      }
      unit.lastIndex = 0;
    },
  };
}
