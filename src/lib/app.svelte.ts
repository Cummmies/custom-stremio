// App-wide state shared by the shell and every screen.
import { core } from '$lib/core';
import { watchServer } from '$lib/core/server';
import type { Ctx, Library, MetaItemPreview, ServerStatus } from '$lib/core/types';

class AppState {
    ctx = $state<Ctx | null>(null);
    server = $state<ServerStatus>({ state: 'starting' });
    library = $state<Library | null>(null);
    loginOpen = $state(false);

    user = $derived(this.ctx?.profile.auth?.user ?? null);
    libraryIds = $derived(new Set(this.library?.catalog.map((i) => i._id) ?? []));

    #started = false;

    start() {
        if (this.#started) return;
        this.#started = true;

        core.watch<Ctx>('ctx', (s) => (this.ctx = s));
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
    }

    inLibrary(id: string) {
        return this.libraryIds.has(id);
    }

    toggleLibrary(item: MetaItemPreview) {
        core.dispatch({
            action: 'Ctx',
            args: this.inLibrary(item.id)
                ? { action: 'RemoveFromLibrary', args: item.id }
                : { action: 'AddToLibrary', args: item },
        });
    }

    logout() {
        core.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
    }
}

export const app = new AppState();
