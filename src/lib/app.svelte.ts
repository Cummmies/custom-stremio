// App-wide state shared by the shell and every screen.
import { core } from '$lib/core';
import { watchServer } from '$lib/core/server';
import type { Ctx, Library, MetaItemPreview, ServerStatus } from '$lib/core/types';
import { profiles } from '$lib/profiles.svelte';
import { anime } from '$lib/anime.svelte';
import { cloudSync } from '$lib/cloudSync.svelte';
import { lightboxd } from '$lib/lightboxd.svelte';
import { playerPrefs } from '$lib/player/prefs.svelte';
import { addonLinkUrl, linkHandlingWanted } from '$lib/addonLinks';
import { isDesktop } from '$lib/platform';

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
            this.#mergeAudioLanguage(s);
        });
        // "Ask who's watching" on launch, when there's more than one profile.
        if (profiles.askOnLaunch && profiles.list.length > 1) profiles.pickerOpen = true;
        core.watch<Library>('library', (s) => (this.library = s));
        // Profile picture, Home rows and settings follow your account (via an addon).
        cloudSync.start();
        // Your Lightboxd tracker, when this profile has connected one.
        lightboxd.start();
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
        // Coming back to the app (the iPhone has no window focus): addons installed
        // meanwhile from a browser or another Stremio app show up.
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
        this.#listenForAddonLinks();
        // Which titles are anime (for Easy Mode's dub handling); refreshed weekly.
        anime.start();
    }

    /**
     * Easy Mode used to have its own audio language; now it uses the Playback one
     * (Stremio's). Once per account: when that's unset, it takes Easy Mode's.
     */
    #mergeAudioLanguage(s: Ctx) {
        const key = `audio-language-merged:${s.profile.auth?.user._id ?? 'guest'}`;
        try {
            if (localStorage.getItem(key)) return;
            localStorage.setItem(key, '1');
        } catch {
            return;
        }
        const easy = playerPrefs.easyLanguage;
        if (s.profile.settings.audioLanguage || !easy) return;
        core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: { ...s.profile.settings, audioLanguage: easy } } });
    }

    /** A stremio://…/manifest.json link was opened: offer to install that addon. */
    pendingAddonUrl = $state<string | null>(null);

    async #listenForAddonLinks() {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
        const handle = (urls: string[] | null) => {
            const link = urls?.find((u) => /^stremio:\/\/.+manifest\.json/i.test(u));
            if (link) this.pendingAddonUrl = addonLinkUrl(link);
        };
        handle(await getCurrent().catch(() => null));
        await onOpenUrl(handle);
        // Windows: the link handler names this app's .exe. After an update or a move it
        // can point at an old copy, which then gets the links instead: point it here again.
        if (isDesktop && linkHandlingWanted()) {
            const { isRegistered, register } = await import('@tauri-apps/plugin-deep-link');
            if (!(await isRegistered('stremio').catch(() => true))) await register('stremio').catch(() => {});
        }
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
    /** Opens the profiles screen straight on Add Profile. */
    addProfile() {
        profiles.pickerView = 'add';
        profiles.pickerOpen = true;
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
        // Other profiles are still saved here: ask who's watching next.
        if (profiles.list.length) this.openProfiles();
    }
}

export const app = new AppState();
