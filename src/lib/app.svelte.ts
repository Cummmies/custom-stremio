// App-wide state shared by the shell and every screen.
import { core } from '$lib/core';
import { watchServer } from '$lib/core/server';
import type { Ctx, ServerStatus } from '$lib/core/types';

class AppState {
    ctx = $state<Ctx | null>(null);
    server = $state<ServerStatus>({ state: 'starting' });
    loginOpen = $state(false);
    sidebarCollapsed = $state(false);

    user = $derived(this.ctx?.profile.auth?.user ?? null);

    #started = false;

    start() {
        if (this.#started) return;
        this.#started = true;

        core.watch<Ctx>('ctx', (s) => (this.ctx = s));
        watchServer((s) => (this.server = s));

        // Same background sync the official app runs on launch and on focus.
        const sync = () => {
            for (const action of ['PullAddonsFromAPI', 'SyncLibraryWithAPI', 'PullNotifications']) {
                core.dispatch({ action: 'Ctx', args: { action } });
            }
            core.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        };
        sync();
        window.addEventListener('focus', sync);

        try {
            this.sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === '1';
        } catch {}
    }

    toggleSidebar() {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        try {
            localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed ? '1' : '0');
        } catch {}
    }

    logout() {
        core.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
    }
}

export const app = new AppState();
