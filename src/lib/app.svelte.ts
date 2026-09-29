// App-wide state shared by the shell and every screen.
import { core } from '$lib/core';
import { watchServer } from '$lib/core/server';
import type { Ctx, Library, MetaItemPreview, ServerStatus } from '$lib/core/types';
import { profiles } from '$lib/profiles.svelte';
import { anime } from '$lib/anime.svelte';

class AppState {
    ctx = $state<Ctx | null>(null);
    server = $state<ServerStatus>({ state: 'starting' });
    library = $state<Library | null>(null);
    loginOpen = $state(false);
    loginMode = $state<'login' | 'add'>('login');

    user = $derived(this.ctx?.profile.auth?.user ?? null);
    libraryIds = $derived(new Set(this.library?.catalog.map((i) => i._id) ?? []));

    #started = false;

    start() {
        if (this.#started) return;
        this.#started = true;

        core.watch<Ctx>('ctx', (s) => {
            this.ctx = s;
            // Every account you sign in to becomes a saved profile on this PC.
            if (s.profile.auth) profiles.remember(s.profile.auth);
        });
        // "Ask who's watching" on launch, when there's more than one profile.
        if (profiles.askOnLaunch && profiles.list.length > 1) profiles.pickerOpen = true;
        core.watch<Library>('library', (s) => (this.library = s));
        watchServer((s) => (this.server = s));

        // The whole library stays loaded; screens filter it locally, which is instant.
        core.dispatch(
            { action: 'Load', args: { model: 'LibraryWithFilters', args: { request: { type: null, sort: 'lastwatched' } } } },
            'library'
        );

        // Same background sync the official app runs on launch and on focus.
        const sync = () => {
            for (const action of ['PullAddonsFromAPI', 'SyncLibraryWithAPI', 'PullNotifications']) {
                core.dispatch({ action: 'Ctx', args: { action } });
            }
            core.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        };
        sync();
        window.addEventListener('focus', sync);
        this.#listenForAddonLinks();
        // Which titles are anime (for Easy Mode's dub handling); refreshed weekly.
        anime.start();
    }

    /** A stremio://…/manifest.json link was opened: offer to install that addon. */
    pendingAddonUrl = $state<string | null>(null);

    async #listenForAddonLinks() {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
        const handle = (urls: string[] | null) => {
            const link = urls?.find((u) => /^stremio:\/\/.+manifest\.json/i.test(u));
            if (link) this.pendingAddonUrl = link.replace(/^stremio:\/\//i, 'https://');
        };
        handle(await getCurrent().catch(() => null));
        await onOpenUrl(handle);
    }

    inLibrary(id: string) {
        return this.libraryIds.has(id);
    }

    addToLibrary(preview: object) {
        core.dispatch({ action: 'Ctx', args: { action: 'AddToLibrary', args: preview } });
    }

    removeFromLibrary(id: string) {
        core.dispatch({ action: 'Ctx', args: { action: 'RemoveFromLibrary', args: id } });
    }

    toggleLibrary(item: MetaItemPreview) {
        if (this.inLibrary(item.id)) this.removeFromLibrary(item.id);
        else this.addToLibrary(item);
    }

    /** "Who's watching?" */
    openProfiles() {
        profiles.error = null;
        profiles.pickerOpen = true;
    }

    /** Sign in to another account; it's saved as a new profile. */
    addProfile() {
        this.loginMode = 'add';
        this.loginOpen = true;
    }

    openLogin() {
        this.loginMode = 'login';
        this.loginOpen = true;
    }

    /** Logs out for real (ends the session) and forgets this profile on this PC. */
    logout() {
        const uid = this.user?._id;
        if (uid) profiles.forget(uid);
        core.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
    }
}

export const app = new AppState();
