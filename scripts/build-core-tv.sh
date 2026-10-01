#!/bin/sh
# Builds stremio-core-web without WebAssembly reference types, for Samsung TVs
# whose browser (V8 9.4) lacks them (docs/samsung-tv.md). The result works in
# every browser; the TV build uses it through CORE_DIR (vite.config.js).
#
#   scripts/build-core-tv.sh OUT_DIR
#
# Needs: git, Rust with the wasm32-unknown-unknown target, python3, and
# wasm-bindgen-cli matching the core's wasm-bindgen version.
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
RUSTFLAGS="-C target-feature=-reference-types" \
  cargo build --release --target wasm32-unknown-unknown -F wasm
python3 "$SCRIPTS/strip-wasm-section.py" \
  ../target/wasm32-unknown-unknown/release/stremio_core_web.wasm \
  "$WORK/stremio_core_web.wasm" target_features
mkdir -p "$OUT"
wasm-bindgen --target web --no-typescript --out-dir "$OUT" "$WORK/stremio_core_web.wasm"
ls -l "$OUT"
