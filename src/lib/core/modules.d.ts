declare module '@stremio/stremio-core-web/bridge.js' {
    export default class Bridge {
        constructor(scope: object, handler: Worker | DedicatedWorkerGlobalScope | typeof globalThis);
        call(path: string[], args: unknown[]): Promise<any>;
    }
}

declare module '@stremio/stremio-core-web/stremio_core_web.js' {
    export default function init(input?: { module_or_path: string | URL }): Promise<unknown>;
    export function initialize_runtime(emit: (event: unknown) => void): Promise<void>;
    export function get_state(field: string): any;
    export function dispatch(action: unknown, field?: string, locationHash?: string): void;
    export function decode_stream(stream: string): any;
    export function encode_stream(stream: unknown): string;
    export function analytics(event: unknown, locationHash?: string): void;
}
