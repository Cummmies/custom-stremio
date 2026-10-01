#!/bin/sh
# Builds stremio-core-web for the WebAssembly of Samsung TVs from 2020: their
# built-in Chromium 69 has the 2017 basics plus sign extension and mutable
# globals, and no reference types, bulk memory, non-trapping float-to-int or
# multi-value (docs/samsung-tv.md). The result works in every browser; the TV
# build uses it through CORE_DIR (vite.config.js).
#
#   scripts/build-core-tv.sh OUT_DIR
#
# Needs: git, Rust with the wasm32-unknown-unknown target, python3, Node (npx,
# for binaryen's wasm-opt and wabt's validator), and wasm-bindgen-cli matching
# the core's wasm-bindgen version.
set -eu
OUT=$(realpath -m "${1:?output directory}")
# The version the app uses (package.json / package-lock.json).
VERSION=$(node -p "require('./node_modules/@stremio/stremio-core-web/package.json').version")
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
WORK=${CORE_SRC:-$(mktemp -d)/stremio-core}

if [ ! -d "$WORK/.git" ]; then
  git clone --quiet --filter=blob:none https://github.com/Stremio/stremio-core "$WORK"
fi
git -C "$WORK" fetch --quiet --tags
git -C "$WORK" checkout --quiet "stremio-core-web-v$VERSION"

cd "$WORK/stremio-core-web"
RUSTFLAGS="-C target-feature=-reference-types,-bulk-memory,-nontrapping-fptoint,-multivalue" \
  cargo build --release --target wasm32-unknown-unknown -F wasm
python3 "$SCRIPTS/strip-wasm-section.py" \
  ../target/wasm32-unknown-unknown/release/stremio_core_web.wasm \
  "$WORK/stremio_core_web.wasm" target_features
mkdir -p "$OUT"
wasm-bindgen --target web --no-typescript --out-dir "$OUT" "$WORK/stremio_core_web.wasm"
# Rust's prebuilt standard library still uses bulk memory and non-trapping
# float-to-int: lower those into plain instructions, and optimize like the
# published build (wasm-pack runs wasm-opt -O).
npx -y -p binaryen@132 wasm-opt "$OUT/stremio_core_web_bg.wasm" -o "$OUT/stremio_core_web_bg.wasm" \
  --enable-sign-ext --enable-mutable-globals --enable-bulk-memory --enable-nontrapping-float-to-int \
  --llvm-memory-copy-fill-lowering --llvm-nontrapping-fptoint-lowering -O
# Check: valid with only what Chromium 69 has.
node "$SCRIPTS/check-wasm-features.mjs" "$OUT/stremio_core_web_bg.wasm"
ls -l "$OUT"
