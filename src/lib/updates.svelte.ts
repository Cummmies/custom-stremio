// Checks GitHub Releases for a signed update, downloads it quietly, and lets
// the person restart when it suits them (never mid-movie).
import { getVersion } from '@tauri-apps/api/app';
import { isDesktop } from '$lib/platform';

type Phase = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';

class Updates {
    phase = $state<Phase>('idle');
    current = $state<string | null>(null);
    version = $state<string | null>(null);
    progress = $state<number | null>(null);
    error = $state<string | null>(null);
    dismissed = $state(false);

    #update: { downloadAndInstall: Function; download: Function; install: () => Promise<void> } | null = null;

    /** The desktop app updates itself; iOS installs are replaced by sideloading. */
    get supported() {
        return isDesktop;
    }

    async check({ quiet = false } = {}) {
        if (!this.supported || this.phase === 'checking' || this.phase === 'downloading') return;
        this.current ??= await getVersion().catch(() => null);
        this.phase = 'checking';
        this.error = null;
        try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check();
            if (!update) {
                this.phase = 'up-to-date';
                return;
            }
            this.version = update.version;
            this.#update = update as any;
            this.phase = 'downloading';
            let total = 0;
            let done = 0;
            await update.download((e) => {
                if (e.event === 'Started') total = e.data.contentLength ?? 0;
                if (e.event === 'Progress') {
                    done += e.data.chunkLength;
                    this.progress = total ? done / total : null;
                }
            });
            this.phase = 'ready';
        } catch (e) {
            this.phase = quiet ? 'idle' : 'error';
            this.error = String(e);
        }
    }

    async restartToUpdate() {
        if (!this.#update || this.phase !== 'ready') return;
        await this.#update.install();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
    }
}

export const updates = new Updates();
