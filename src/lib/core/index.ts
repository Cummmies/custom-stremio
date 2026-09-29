// Main-thread side of stremio-core. Talks to core.worker.ts using the same
// request/response bridge the official stremio-web uses.
import Bridge from '@stremio/stremio-core-web/bridge.js';

export type CoreAction = { action: string; args?: unknown };
type StateListener = (models: string[]) => void;
type EventListener = (event: string, args: any) => void;

const APP_VERSION = '0.1.0';

const stateListeners = new Set<StateListener>();
const eventListeners = new Set<EventListener>();

const worker = new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' });
const bridge = new Bridge(window, worker);

// Must exist before init: the core starts emitting events while initializing.
(window as any).onCoreEvent = ({ name, args }: { name: string; args: any }) => {
    if (name === 'NewState') {
        stateListeners.forEach((l) => l(args));
    } else if (name === 'CoreEvent') {
        eventListeners.forEach((l) => l(args.event, args.args));
    }
};

const ready: Promise<void> = bridge.call(['init'], [{ appVersion: APP_VERSION, shellVersion: null }]);

export const core = {
    ready,

    async getState<T = any>(model: string): Promise<T> {
        await ready;
        return bridge.call(['getState'], [model]);
    },

    async dispatch(action: CoreAction, model?: string): Promise<void> {
        await ready;
        return bridge.call(['dispatch'], [action, model, location.hash]);
    },

    /** Turns the encoded stream in a player deep link back into a Stream object. */
    async decodeStream<T = any>(encoded: string): Promise<T> {
        await ready;
        return bridge.call(['decodeStream'], [encoded]);
    },

    async encodeStream(stream: object): Promise<string> {
        await ready;
        return bridge.call(['encodeStream'], [stream]);
    },

    onEvent(listener: EventListener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
    },

    /**
     * Calls `onChange` with the model's state now and whenever the core says it
     * changed. Updates are coalesced (~one per frame), so a burst of catalog
     * responses causes one re-render instead of dozens. setTimeout rather than
     * requestAnimationFrame so state still arrives while the window is hidden.
     */
    watch<T = any>(model: string, onChange: (state: T) => void): () => void {
        let active = true;
        let scheduled = false;
        let request = 0;

        const refresh = async () => {
            scheduled = false;
            const id = ++request;
            const state = await core.getState<T>(model);
            if (active && id === request) onChange(state);
        };
        const listener: StateListener = (models) => {
            if (!scheduled && models.includes(model)) {
                scheduled = true;
                setTimeout(refresh, 16);
            }
        };

        stateListeners.add(listener);
        refresh();
        return () => {
            active = false;
            stateListeners.delete(listener);
        };
    },
};

if (import.meta.env.DEV) (window as any).__core = core;
