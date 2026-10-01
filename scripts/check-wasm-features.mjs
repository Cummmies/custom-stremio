#!/usr/bin/env node
// Fails unless a .wasm validates with only the WebAssembly features of the
// Samsung TVs' built-in Chromium 69: the 2017 basics, sign extension and
// mutable globals (used by build-core-tv.sh).
//   node scripts/check-wasm-features.mjs file.wasm
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

let wabtInit;
try {
    wabtInit = createRequire(import.meta.url)('wabt');
} catch {
    const dir = execSync('mktemp -d').toString().trim();
    execSync('npm i -s --prefix ' + dir + ' wabt@1.0.36', { stdio: 'ignore' });
    wabtInit = createRequire(dir + '/')('wabt');
}
const wabt = await wabtInit();
const features = {
    mutable_globals: true, sign_extension: true,
    sat_float_to_int: false, bulk_memory: false, reference_types: false, multi_value: false,
    simd: false, threads: false, exceptions: false, tail_call: false,
};
const module = wabt.readWasm(readFileSync(process.argv[2]), features);
module.validate();
console.log(`${process.argv[2]}: valid for Chromium 69 (2017 WebAssembly + sign extension, mutable globals)`);
