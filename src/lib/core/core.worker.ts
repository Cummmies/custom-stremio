/// <reference lib="webworker" />
// Runs stremio-core (Rust -> WASM) off the main thread so catalog loading,
// library sync etc. never block scrolling or animations.
import './worker-shim';
import Bridge from '@stremio/stremio-core-web/bridge.js';
import * as coreWeb from '@stremio/stremio-core-web/stremio_core_web.js';
import wasmUrl from '@stremio/stremio-core-web/stremio_core_web_bg.wasm?url';

// The package is CommonJS; depending on the bundler's interop, `default` is either
// the init function itself or the whole `module.exports` object.
const mod: any = (coreWeb as any).default?.initialize_runtime ? (coreWeb as any).default : coreWeb;
const initWasm = typeof mod.default === 'function' ? mod.default : mod.default.default;
const { initialize_runtime, get_state, dispatch, decode_stream, encode_stream, analytics } = mod;

const scope = self as any;
const bridge = new Bridge(self, self);

// The core calls these globals; they proxy to the main thread (localStorage and
// location.hash only exist there).
scope.get_location_hash = () => bridge.call(['location', 'hash'], []);
scope.local_storage_get_item = (key: string) => bridge.call(['localStorage', 'getItem'], [key]);
scope.local_storage_set_item = (key: string, value: string) => bridge.call(['localStorage', 'setItem'], [key, value]);
scope.local_storage_remove_item = (key: string) => bridge.call(['localStorage', 'removeItem'], [key]);

scope.init = async ({ appVersion, shellVersion }: { appVersion: string; shellVersion: string | null }) => {
    scope.app_version = appVersion;
    scope.shell_version = shellVersion;
    scope.getState = get_state;
    scope.dispatch = dispatch;
    scope.decodeStream = decode_stream;
    scope.encodeStream = encode_stream;
    scope.analytics = analytics;
    await initWasm({ module_or_path: await wasmSource() });
    await initialize_runtime((event: unknown) => bridge.call(['onCoreEvent'], [event]));
};

/**
 * The core's WebAssembly. The TV app runs from local files, where fetch() may
 * not be allowed; read it with XHR there.
 */
async function wasmSource(): Promise<string | ArrayBuffer> {
    if (new URL(wasmUrl, self.location.href).protocol !== 'file:') return wasmUrl;
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', wasmUrl);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => (xhr.response ? resolve(xhr.response) : reject(new Error('Core not found')));
        xhr.onerror = () => reject(new Error('Core not loaded'));
        xhr.send();
    });
}
