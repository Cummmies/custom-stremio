// Checks GitHub Releases for a signed update, downloads it quietly, and lets
// the person restart when it suits them (never mid-movie).
//
// Desktop: the whole app (Tauri's updater). iOS: the web side only, over the
// air (src-tauri/src/web_update.rs); a Reload switches to it. Native changes
// on iOS still come as a new .ipa. Samsung TV: the same idea
// (src/lib/tv/webUpdate.ts); installed-app changes need a reinstall.
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { inTauri, isDesktop, isIOS, isTV } from '$lib/platform';
import * as tvUpdate from '$lib/tv/webUpdate';

type Phase = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';

class Updates {
    phase = $state<Phase>('idle');
    current = $state<string | null>(null);
    version = $state<string | null>(null);
    progress = $state<number | null>(null);
    error = $state<string | null>(null);
    dismissed = $state(false);

    #update: { downloadAndInstall: Function; download: Function; install: () => Promise<void> } | null = null;

    /** Whether this update installs with a page reload (iOS) rather than a restart. */
    readonly reloads = isIOS || isTV;

    get supported() {
        return isDesktop || isIOS || (isTV && tvUpdate.canUpdate());
    }

    async check({ quiet = false } = {}) {
        if (!this.supported || this.phase === 'checking' || this.phase === 'downloading') return;
        if (isIOS) return this.#checkWeb(quiet);
        if (isTV) return this.#checkTV(quiet);
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

    async #checkWeb(quiet: boolean) {
        this.phase = 'checking';
        this.error = null;
        try {
            const r = await invoke<{ ready: boolean; label: string | null }>('web_update_check');
            this.version = r.label;
            this.phase = r.ready ? 'ready' : 'up-to-date';
        } catch (e) {
            this.phase = quiet ? 'idle' : 'error';
            this.error = String(e);
        }
    }

    async #checkTV(quiet: boolean) {
        this.phase = 'checking';
        this.error = null;
        try {
            const ready = await tvUpdate.checkAndDownload((p) => {
                this.phase = 'downloading';
                this.progress = p;
            });
            this.version = ready ? tvUpdate.versionLabel(ready) : null;
            this.phase = ready ? 'ready' : 'up-to-date';
        } catch (e) {
            this.phase = quiet ? 'idle' : 'error';
            this.error = String(e);
        }
    }

    async restartToUpdate() {
        if (isTV) {
            if (this.phase === 'ready') location.reload();
            return;
        }
        if (this.reloads) {
            if (this.phase !== 'ready') return;
            await invoke('web_update_apply');
            location.reload();
            return;
        }
        if (!this.#update || this.phase !== 'ready') return;
        await this.#update.install();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
    }
}

export const updates = new Updates();

/**
 * Call once the app has started: tells the iOS web updater this bundle loads
 * fine, so it isn't rolled back on the next launch.
 */
export function confirmWebBundle() {
    if (isIOS && inTauri) invoke('web_update_confirm').catch(() => {});
    if (isTV) tvUpdate.confirmStarted();
}
