<script lang="ts">
    import { core } from '$lib/core';
    import { invoke } from '@tauri-apps/api/core';
    import { app } from '$lib/app.svelte';
    import type { Settings } from '$lib/core/types';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import { getTvSize, setTvSize, tvSizes, type TvSize } from '$lib/tv/size';
    import Toggle from '$lib/components/Toggle.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import ServerStatus from '$lib/components/ServerStatus.svelte';
    import { inTauri } from '$lib/player/mpv.svelte';
    import { isDesktop, isIOS, isTV } from '$lib/platform';
    import { notify } from '$lib/notify.svelte';
    import { errorReportsOn, setErrorReports } from '$lib/errorReports';
    import { player } from '$lib/player/player';
    import { updates } from '$lib/updates.svelte';
    import { whatsNew } from '$lib/whatsNew.svelte';
    import {
        presetOf,
        subtitleBottom,
        subtitleCss,
        SUB_COLORS,
        SUB_EDGES,
        SUB_FONTS,
        SUB_POSITION_MAX,
        SUB_PRESETS,
        SUB_SIZES,
        type SubPreset,
        type SubStyle,
    } from '$lib/player/subtitleStyle';
    import { profiles } from '$lib/profiles.svelte';
    import { cloudSync } from '$lib/cloudSync.svelte';
    import Avatar from '$lib/components/Avatar.svelte';
    import PhotoControls from '$lib/components/PhotoControls.svelte';
    import { playerPrefs, upscalerLabels, type Upscaler } from '$lib/player/prefs.svelte';
    import { titleTracks } from '$lib/player/titleTracks.svelte';
    import { displayHdr } from '$lib/player/hdr.svelte';
    import { setLinkHandlingWanted } from '$lib/addonLinks';
    import { tracker } from '$lib/tracker.svelte';
    import { day, lb, today, type BackupConflict, type SignedInDevice } from '$lib/tracker/api';
    import { pushWatchedToStremio, type PushResult } from '$lib/stremioPush';
    import { menu } from '$lib/menu.svelte';
    import { openExternal } from '$lib/links';
    import { ACTIONS, chordOf, formatChord, hotkeys, labelOf, type HotkeyAction } from '$lib/hotkeys.svelte';
    import type { IconName } from '$lib/components/Icon.svelte';

    const settings = $derived(app.ctx?.profile.settings ?? null);
    const myProfile = $derived(profiles.get(app.user?._id));

    // stremio:// link handling (registered per user in Windows, not synced).
    let handlesLinks = $state(false);
    let tvSize = $state<TvSize>(isTV ? getTvSize() : 'medium');
    $effect(() => {
        if (!inTauri) return;
        import('@tauri-apps/plugin-deep-link').then(async ({ isRegistered }) => {
            handlesLinks = await isRegistered('stremio').catch(() => false);
            // Turned on before it was remembered: remember it, so it follows the app.
            if (handlesLinks) setLinkHandlingWanted(true);
        });
    });
    async function setLinkHandling(on: boolean) {
        const { register, unregister } = await import('@tauri-apps/plugin-deep-link');
        try {
            await (on ? register('stremio') : unregister('stremio'));
            handlesLinks = on;
            setLinkHandlingWanted(on);
        } catch {
            handlesLinks = !on;
        }
    }

    // Settings live in the Stremio profile, so they sync with the official apps.
    function update(patch: Partial<Settings>) {
        if (!settings) return;
        core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: { ...settings, ...patch } } });
    }

    // ISO 639-2 codes, as Stremio stores them.
    const languages = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'],
        ['por', 'Portuguese'], ['rus', 'Russian'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese'],
        ['ara', 'Arabic'], ['hin', 'Hindi'], ['tur', 'Turkish'], ['pol', 'Polish'], ['dut', 'Dutch'],
        ['swe', 'Swedish'], ['nor', 'Norwegian'], ['dan', 'Danish'], ['fin', 'Finnish'], ['gre', 'Greek'],
        ['heb', 'Hebrew'], ['ukr', 'Ukrainian'], ['cze', 'Czech'], ['hun', 'Hungarian'], ['rum', 'Romanian'],
        ['bul', 'Bulgarian'], ['vie', 'Vietnamese'], ['tha', 'Thai'], ['ind', 'Indonesian'],
    ].map(([value, label]) => ({ value, label }));

    const audioOptions = $derived([{ value: null as string | null, label: 'Default' }, ...languages]);
    const subtitleOptions = $derived([{ value: null as string | null, label: 'Off' }, ...languages]);

    let serverUrl = $state('');
    $effect(() => {
        if (settings) serverUrl = settings.streamingServerUrl;
    });
    const serverUrlChanged = $derived(!!settings && serverUrl.trim() !== settings.streamingServerUrl);

    /** Downloads Stremio's streaming server into this app (src-tauri/src/server.rs). */
    let serverSetupError = $state<string | null>(null);
    async function setUpServer() {
        serverSetupError = null;
        try {
            await invoke('server_install');
        } catch {
            // An app from before this could set it up (the update brought only the screens).
            serverSetupError = 'This version of the app can’t set it up. Install the latest version, or Stremio Service.';
        }
    }
    const canSetUpServer = $derived(isDesktop && (app.server.state === 'missing' || app.server.state === 'failed'));

    // Subtitle Style: one change at a time, shown in the preview straight away.
    const subStyle = $derived(playerPrefs.subStyle);
    const subPreset = $derived(presetOf(subStyle) ?? 'custom');
    const setSub = (patch: Partial<SubStyle>) => (playerPrefs.subStyle = { ...subStyle, ...patch });
    const optionsOf = <T extends string>(labels: Record<T, string>) =>
        (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
    const presetOptions = $derived([
        ...(Object.keys(SUB_PRESETS) as SubPreset[]).map((value) => ({ value: value as SubPreset | 'custom', label: SUB_PRESETS[value].label })),
        ...(presetOf(playerPrefs.subStyle) ? [] : [{ value: 'custom' as const, label: 'Custom' }]),
    ]);
    let previewHeight = $state(0);

    function saveServerUrl(e: SubmitEvent) {
        e.preventDefault();
        let url = serverUrl.trim();
        if (!/^https?:\/\//.test(url)) return;
        if (!url.endsWith('/')) url += '/';
        update({ streamingServerUrl: url });
        core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } });
    }

    // Anime: which release of a new episode counts (subtitled or dubbed), kept
    // with the account (the tracker), for the calendar, new-episode counts and
    // notifications.
    type AnimeTrack = 'sub' | 'dub';
    const animeTrackOptions: { value: AnimeTrack; label: string }[] = [
        { value: 'sub', label: 'Subtitled' },
        { value: 'dub', label: 'Dubbed' },
    ];
    let animeTrack = $state<AnimeTrack | null>(null);
    let animeTrackFailed = $state(false);
    // Related Titles: an anime's side stories too, or only its prequels and
    // sequels (the same setting as the website's).
    type RelatedScope = 'all' | 'main';
    const relatedOptions: { value: RelatedScope; label: string }[] = [
        { value: 'all', label: 'Include Spin-offs & Side Stories' },
        { value: 'main', label: 'Prequels & Sequels Only' },
    ];
    let relatedScope = $state<RelatedScope>('all');
    let relatedFailed = $state(false);
    $effect(() => {
        if (!tracker.ready || !app.user) return;
        tracker.request<{ anime_track: AnimeTrack; related_scope?: RelatedScope }>('/preferences').then((res) => {
            if (!res) return;
            animeTrack = res.anime_track;
            if (res.related_scope) relatedScope = res.related_scope;
        });
    });
    async function setRelatedScope(scope: RelatedScope) {
        const before = relatedScope;
        relatedScope = scope;
        relatedFailed = false;
        const res = await tracker.request('/preferences', { method: 'PUT', body: { related_scope: scope } });
        if (!res) {
            relatedScope = before;
            relatedFailed = true;
        }
    }

    // API Keys & Integrations (admins): the keys the server fetches titles with,
    // the same as the website's. Shown only as set or not.
    type ApiKeys = { tmdb: string; omdb: string; animeschedule: string; animeschedule_id: string };
    const isAdmin = $derived(!!tracker.saved?.user?.is_admin);
    let apiKeys = $state<ApiKeys | null>(null);
    let keyEdits = $state({ tmdb: '', omdb: '', animeschedule: '', animeschedule_id: '' });
    let keysNote = $state<string | null>(null);
    let keysError = $state(false);
    let keysBusy = $state(false);
    $effect(() => {
        if (!tracker.ready || !isAdmin) return;
        tracker.request<ApiKeys>('/admin/api-keys').then((res) => res && (apiKeys = res));
    });
    async function saveKeys(e: Event) {
        e.preventDefault();
        const body = Object.fromEntries(Object.entries(keyEdits).filter(([, v]) => v.trim()));
        if (!Object.keys(body).length) return;
        keysBusy = true;
        keysNote = null;
        const res = await tracker.requestOrStatus<ApiKeys>('/admin/api-keys', { method: 'PUT', body, timeout: 30_000 });
        keysBusy = false;
        if ('data' in res) {
            apiKeys = res.data;
            keyEdits = { tmdb: '', omdb: '', animeschedule: '', animeschedule_id: '' };
            keysError = false;
            keysNote = 'Saved. The server fetches titles with them now.';
        } else {
            keysError = true;
            keysNote = res.detail ?? 'Couldn’t save. Try again in a moment.';
        }
    }
    async function setAnimeTrack(track: AnimeTrack) {
        const before = animeTrack;
        animeTrack = track;
        animeTrackFailed = false;
        const res = await tracker.request<{ anime_track: AnimeTrack }>('/preferences', { method: 'PUT', body: { anime_track: track } });
        if (!res) {
            animeTrack = before;
            animeTrackFailed = true;
            return;
        }
        // What's new and when changes with it.
        void tracker.check();
        void notify.refresh();
    }

    // Privacy: error reports (on unless turned off here), and the policy and terms.
    let sendErrors = $state(errorReportsOn());

    // Data: your watchlist, watches, scores and lists as a backup file, and
    // importing one (PC and iPhone; not the TV).
    let dataBusy = $state<'download' | 'download-full' | 'import' | 'resolve' | null>(null);
    let dataNote = $state<string | null>(null);
    let dataError = $state(false);
    let pendingConflicts = $state<BackupConflict[] | null>(null);
    let importInput = $state<HTMLInputElement>();

    /** Full: profile, pictures, favorites, friends and settings too. */
    async function downloadBackup(full: boolean) {
        dataBusy = full ? 'download-full' : 'download';
        dataNote = null;
        dataError = false;
        const data = await lb.backup(full);
        dataBusy = null;
        if (!data) {
            dataError = true;
            dataNote = 'Couldn’t connect. Try again in a moment.';
            return;
        }
        const name = `custom-stremio-${full ? 'full-backup' : 'watch-history'}-${today()}.json`;
        const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
        // iPhone: the share sheet, with Save to Files. PC: a download.
        if (isIOS && navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file] });
            } catch {
                // Closed without saving.
            }
            return;
        }
        const url = URL.createObjectURL(file);
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        dataNote = 'Backup downloaded.';
    }

    async function importBackup(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const picked = input.files?.[0];
        input.value = '';
        if (!picked) return;
        dataBusy = 'import';
        dataNote = null;
        dataError = false;
        pendingConflicts = null;
        let contents: unknown;
        try {
            contents = JSON.parse(await picked.text());
        } catch {
            dataBusy = null;
            dataError = true;
            dataNote = 'That isn’t a backup file.';
            return;
        }
        const res = await lb.importBackup(contents);
        dataBusy = null;
        if (!res) {
            dataError = true;
            dataNote = 'Couldn’t import it. Check that it’s a backup file, then try again.';
            return;
        }
        const n = res.applied_count;
        const said = [n ? `Imported ${n} ${n === 1 ? 'title' : 'titles'}.` : ''];
        const r = res.restored;
        if (r) {
            if (r.profile) said.push('Your profile, pictures and favorites are back.');
            const people = (k: number) => `${k} ${k === 1 ? 'friend' : 'friends'}`;
            if (r.friends_back) said.push(`${people(r.friends_back)} ${r.friends_back === 1 ? 'is' : 'are'} back.`);
            if (r.friend_requests) said.push(`Asked ${people(r.friend_requests)} to be friends again.`);
            if (r.friends_later) said.push(`Import it again in an hour to ask ${people(r.friends_later)} more.`);
            if (r.handle_taken) said.push(`Someone here already has @${r.handle_taken}, so your username wasn’t changed.`);
        }
        dataNote = said.filter(Boolean).join(' ') || 'Nothing to import.';
        if (res.conflicts.length) pendingConflicts = res.conflicts;
        else void markInStremio();
    }

    /** What the backup brought back, ticked in Stremio too. */
    async function markInStremio() {
        const before = dataNote;
        const res: PushResult | null = await pushWatchedToStremio(true);
        if (!res || (!res.movies && !res.shows && !res.added)) return;
        const parts = [res.movies ? `${res.movies} ${res.movies === 1 ? 'movie' : 'movies'}` : '', res.shows ? `${res.episodes} ${res.episodes === 1 ? 'episode' : 'episodes'}` : '']
            .filter(Boolean)
            .join(' and ');
        const told = [res.added ? `Added ${res.added} ${res.added === 1 ? 'title' : 'titles'} to your Stremio library.` : '', parts ? `Marked ${parts} as watched in Stremio.` : '']
            .filter(Boolean)
            .join(' ');
        if (dataNote === before) dataNote = `${before ?? ''} ${told}`.trim();
    }

    async function resolveConflicts(decision: 'keep_local' | 'use_imported') {
        if (!pendingConflicts) return;
        if (decision === 'keep_local') {
            pendingConflicts = null;
            void markInStremio();
            return;
        }
        dataBusy = 'resolve';
        const res = await lb.resolveBackup(decision, pendingConflicts);
        dataBusy = null;
        if (!res) {
            dataError = true;
            dataNote = 'Couldn’t connect. Try again in a moment.';
            return;
        }
        dataNote = `Updated ${res.resolved_count} ${res.resolved_count === 1 ? 'title' : 'titles'} from the backup.`;
        pendingConflicts = null;
        void markInStremio();
    }

    // Every shortcut in the app. Keep in step with the key handlers in
    // routes/+layout.svelte, routes/player/+page.svelte and SeekBar.svelte.
    const seekStep = $derived(Math.round(((settings?.seekTimeDuration as number | undefined) ?? 10000) / 1000));
    const fineStep = $derived(Math.max(1, Math.round(seekStep / 3)));
    const shortcutGroups = $derived<{ title: string; items: [string, string[]][] }[]>([
        {
            title: 'Browsing',
            items: [
                ['Search', ['Ctrl K', 'Ctrl F', '/']],
                ['Settings', ['Ctrl ,']],
                ['Move between titles in a row, or the banner', ['← →']],
                ['Open the menu for the focused item', ['Shift F10']],
            ],
        },
        {
            title: 'Seek Bar (After Clicking or Tabbing to It)',
            items: [
                ['Back to the start', ['Home']],
                ['To the end', ['End']],
            ],
        },
    ]);

    // --- the player's shortcuts, remappable ($lib/hotkeys.svelte.ts) ---
    /** The action waiting for its new key, and why the last one was refused. */
    let capturing = $state<HotkeyAction | null>(null);
    let hotkeyError = $state<{ action: HotkeyAction | null; text: string } | null>(null);

    function captureKey(action: HotkeyAction) {
        hotkeyError = null;
        capturing = capturing === action ? null : action;
    }

    // While waiting: the next key press (with its modifiers) is the new key;
    // Esc on its own cancels. Caught before the app's own shortcuts see it.
    $effect(() => {
        const action = capturing;
        if (!action) return;
        const onkey = (e: KeyboardEvent) => {
            const chord = chordOf(e);
            if (!chord) return; // a lone modifier: wait for the key
            e.preventDefault();
            e.stopImmediatePropagation();
            capturing = null;
            if (chord.key === 'escape' && !chord.ctrl && !chord.alt && !chord.shift && !chord.meta) return;
            const problem = hotkeys.rebind(action, chord);
            hotkeyError = problem ? { action, text: problem } : null;
        };
        window.addEventListener('keydown', onkey, true);
        return () => window.removeEventListener('keydown', onkey, true);
    });

    function resetHotkey(action?: HotkeyAction) {
        capturing = null;
        const problem = hotkeys.reset(action);
        hotkeyError = problem ? { action: action ?? null, text: problem } : null;
    }

    // --- Devices: where you're signed in; sign out one you've lost. ---
    const PLATFORM_NAMES: Record<string, string> = { desktop: 'PC', windows: 'PC', ios: 'iPhone', tv: 'TV', web: 'Web' };
    let devicesList = $state<SignedInDevice[] | null>(null);
    async function loadDevices() {
        devicesList = (await lb.devices())?.devices ?? [];
    }
    $effect(() => {
        if (app.user && tracker.ready && devicesList === null) void loadDevices();
    });
    function signOutDevice(e: MouseEvent, d: SignedInDevice) {
        const name = d.name || PLATFORM_NAMES[d.platform] || 'this device';
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { header: `Sign out ${name}?`, detail: 'It stops showing your history, ratings and friends until it signs in again.' },
                {
                    label: 'Sign Out',
                    destructive: true,
                    onselect: async () => {
                        if (await lb.signOutDevice(d.id)) devicesList = (devicesList ?? []).filter((x) => x.id !== d.id);
                    },
                },
            ],
            'end'
        );
    }

    // --- PC and TV: a sidebar of sections, one shown at a time (as macOS's
    // System Settings and tvOS's Settings). The sidebar is read from the
    // sections showing on this device, so each keeps its own rules. On a TV,
    // moving through the sidebar shows each section without a press. Phones:
    // one page, as iOS Settings. ---
    const ICONS: Record<string, IconName> = {
        Account: 'user',
        Playback: 'play',
        'Subtitle Style': 'captions',
        Video: 'film',
        'Easy Mode': 'star',
        Spoilers: 'eye',
        Devices: 'phone',
        Integrations: 'puzzle',
        Anime: 'tv',
        Notifications: 'bell',
        Data: 'sort',
        'Streaming Server': 'link',
        Display: 'tv',
        Home: 'home',
        'Keyboard Shortcuts': 'grip',
        Updates: 'replay',
        Privacy: 'eyeOff',
    };
    const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const wideQuery = typeof matchMedia !== 'undefined' ? matchMedia('(min-width: 980px)') : null;
    let wide = $state(wideQuery?.matches ?? false);
    $effect(() => {
        const on = () => (wide = wideQuery?.matches ?? false);
        wideQuery?.addEventListener('change', on);
        return () => wideQuery?.removeEventListener('change', on);
    });
    const twoPane = $derived(isTV || wide);

    let panesEl = $state<HTMLElement>();
    let paneList = $state<{ key: string; title: string }[]>([]);
    const PANE_KEY = 'settings:pane';
    function firstPane() {
        const hash = typeof location !== 'undefined' ? location.hash.slice(1) : '';
        if (hash) return hash;
        try {
            return sessionStorage.getItem(PANE_KEY) ?? '';
        } catch {
            return '';
        }
    }
    let pane = $state(firstPane());
    $effect(() => {
        const el = panesEl;
        if (!el) return;
        const read = () => {
            const found = [...el.querySelectorAll<HTMLElement>(':scope > section')].map((sec) => {
                const title = sec.querySelector('h2')?.textContent?.trim() ?? '';
                sec.dataset.pane = sec.id || slug(title);
                return { key: sec.dataset.pane, title };
            });
            if (found.map((f) => f.key).join() !== paneList.map((f) => f.key).join()) paneList = found;
        };
        read();
        const watch = new MutationObserver(read);
        watch.observe(el, { childList: true });
        return () => watch.disconnect();
    });
    /** The section showing: the one chosen, else the first there is. */
    const shownPane = $derived(paneList.some((p) => p.key === pane) ? pane : (paneList[0]?.key ?? ''));

    // --- Search: the settings themselves, filtered as you type (the rows
    // that match, from every section, each still the control it is). ---
    let query = $state('');
    let noMatches = $state(false);
    const searching = $derived(query.trim().length > 0);
    const HIDE = 'data-search-hide';
    $effect(() => {
        const el = panesEl;
        void paneList;
        if (!el) return;
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        for (const n of el.querySelectorAll(`[${HIDE}], [data-first-shown]`)) {
            n.removeAttribute(HIDE);
            n.removeAttribute('data-first-shown');
        }
        const sections = [...el.querySelectorAll<HTMLElement>(':scope > section')];
        if (!words.length) {
            for (const sec of sections) sec.hidden = twoPane && sec.dataset.pane !== shownPane;
            noMatches = false;
            return;
        }
        const has = (text: string | null | undefined) => {
            const t = (text ?? '').toLowerCase();
            return words.every((w) => t.includes(w));
        };
        // Hides what's around the matching rows that holds none of them (a
        // preview, a note), keeping the way down to each match.
        const prune = (parent: Element, hits: Element[]) => {
            for (const child of parent.children) {
                if (child.tagName === 'H2' || hits.includes(child)) continue;
                if (hits.some((h) => child.contains(h))) prune(child, hits);
                else child.setAttribute(HIDE, '');
            }
        };
        let any = false;
        for (const sec of sections) {
            sec.hidden = false;
            // The section's own name: all of it.
            if (has(sec.querySelector('h2')?.textContent)) {
                any = true;
                continue;
            }
            const hits = [...sec.querySelectorAll('.row')].filter((r) => has(r.textContent));
            if (!hits.length) {
                sec.hidden = true;
                continue;
            }
            any = true;
            prune(sec, hits);
            // The first row left in a group has no line above it.
            for (const group of sec.querySelectorAll('.group')) {
                const first = [...group.children].find((c) => c.classList.contains('row') && !c.hasAttribute(HIDE));
                first?.setAttribute('data-first-shown', '');
            }
        }
        noMatches = !any;
        // Results start at the top.
        if (twoPane) el.scrollTop = 0;
    });
    function searchKey(e: KeyboardEvent) {
        if (e.key === 'Escape' && query) {
            e.preventDefault();
            e.stopPropagation();
            query = '';
        }
    }
    function choose(key: string) {
        query = '';
        pane = key;
        try {
            sessionStorage.setItem(PANE_KEY, key);
        } catch {
            /* remembered for this visit only */
        }
    }
</script>

<svelte:head><title>Settings · Stremio</title></svelte:head>

<div class="page" class:two-pane={twoPane}>
    <h1>Settings</h1>

    {#snippet searchField()}
        <label class="search" role="search">
            <Icon name="search" size={16} />
            <input type="search" bind:value={query} onkeydown={searchKey} placeholder="Search" aria-label="Search Settings" autocomplete="off" spellcheck="false" />
        </label>
    {/snippet}

    {#if twoPane}
        <nav class="sidebar" aria-label="Settings sections">
            {#if !isTV}{@render searchField()}{/if}
            {#each paneList as p (p.key)}
                <button
                    class="side-item"
                    class:on={!searching && p.key === shownPane}
                    aria-current={p.key === shownPane ? 'page' : undefined}
                    onclick={() => choose(p.key)}
                    onfocus={() => isTV && choose(p.key)}
                >
                    <Icon name={ICONS[p.title] ?? 'gear'} size={18} />
                    <span>{p.title}</span>
                </button>
            {/each}
        </nav>
    {:else if !isTV}
        {@render searchField()}
    {/if}

    <div class="panes" class:searching bind:this={panesEl}>
    {#if noMatches}<p class="no-results">No settings match “{query.trim()}”.</p>{/if}

    <section>
        <h2>Account</h2>
        <div class="group">
            <div class="row account-row">
                <div class="account">
                    <Avatar profile={myProfile} fallbackName={app.user?.email ?? '?'} size={48} />
                    <div>
                        <div class="title">{myProfile?.name ?? app.user?.email ?? 'Not logged in'}</div>
                        <div class="sub">{app.user ? app.user.email : 'Log in to sync your library, addons and settings.'}</div>
                    </div>
                </div>
                {#if app.user}
                    <button class="btn" onclick={() => app.openProfiles()}>Switch Profile…</button>
                {:else}
                    <div class="account-actions">
                        {#if profiles.list.length}
                            <button class="btn" onclick={() => app.openProfiles()}>Switch Profile…</button>
                        {/if}
                        <button class="btn primary" onclick={() => app.openLogin()}>Log In…</button>
                    </div>
                {/if}
            </div>
            {#if myProfile}
                <div class="row stack">
                    <div>
                        <div class="title">Name</div>
                        <div class="sub">Shown on your profile and in the app.</div>
                    </div>
                    <input
                        class="name-input"
                        value={myProfile.name}
                        maxlength="40"
                        aria-label="Name"
                        onchange={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (!v) return void (e.currentTarget.value = myProfile.name);
                            profiles.update(myProfile.uid, { name: v });
                            // One name: your profile's too.
                            if (tracker.ready) void lb.updateProfile({ name: v });
                        }}
                        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                </div>
                {#if !isTV}<!-- a TV has no files to choose a picture from -->
                <div class="row">
                    <div>
                        <div class="title">Picture</div>
                        <div class="sub">Shown on your profile and in the app.</div>
                    </div>
                    <PhotoControls uid={myProfile.uid} />
                </div>
                {/if}
            {/if}
            {#if app.user && tracker.ready}
                <a class="row link" href="/profile">
                    <div>
                        <div class="title">Your Profile</div>
                        <div class="sub">Your username, bio, banner and favorites, and who can see them.</div>
                    </div>
                    <Icon name="chevronRight" size={16} />
                </a>
                {#if tracker.saved?.user?.is_staff ?? tracker.saved?.user?.is_admin}
                    <a class="row link" href="/reports">
                        <div>
                            <div class="title">Reports</div>
                            <div class="sub">Reviews and profiles people reported.</div>
                        </div>
                        <Icon name="chevronRight" size={16} />
                    </a>
                {/if}
            {/if}
            {#if app.user}
                <div class="row">
                    <div>
                        <div class="title">Sync</div>
                        <div class="sub" class:sync-error={!!cloudSync.status?.error}>
                            {#if cloudSync.status?.error}
                                Couldn’t save to your Stremio account: {cloudSync.status.error}
                            {:else if cloudSync.status}
                                Saved to your Stremio account at {new Date(cloudSync.status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                            {:else}
                                Your profile name and picture, Home rows and app settings follow your Stremio account.
                            {/if}
                        </div>
                    </div>
                </div>
                <button class="row action destructive" onclick={() => app.logout()}>Log Out</button>
            {/if}
        </div>
    </section>

    {#if app.user && tracker.ready}
        <section>
            <h2>Devices</h2>
            <div class="group">
                {#if devicesList === null}
                    <div class="row"><div class="sub">Loading…</div></div>
                {:else}
                    {#each devicesList as d (d.id)}
                        <div class="row">
                            <div>
                                <div class="title">{d.name || PLATFORM_NAMES[d.platform] || 'A device'}</div>
                                <div class="sub">{d.this ? 'This device' : `${PLATFORM_NAMES[d.platform] ?? 'Device'}${d.last_used ? ` · last used ${day(d.last_used)}` : ''}`}</div>
                            </div>
                            {#if !d.this}
                                <button class="btn" onclick={(e) => signOutDevice(e, d)}>Sign Out…</button>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </section>
    {/if}

    {#if settings}
        <section>
            <h2>Playback</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Audio language</div>
                        <div class="sub">Played when a stream has several audio tracks. Easy Mode also picks sources in it first.</div>
                    </div>
                    <PopupButton label="Audio language" value={settings.audioLanguage} options={audioOptions} onchange={(v) => update({ audioLanguage: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Subtitles</div>
                        <div class="sub">Turned on automatically in this language when available.</div>
                    </div>
                    <PopupButton label="Subtitle language" value={settings.subtitlesLanguage} options={subtitleOptions} onchange={(v) => update({ subtitlesLanguage: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Hide HDR sources when the screen isn’t in HDR</div>
                        <div class="sub">
                            HDR on a screen that isn’t showing it looks flat and dim. They stay under “Show hidden” in the source list.
                            {!displayHdr.supported
                                ? 'This screen isn’t showing HDR now, so they’re hidden.'
                                : isDesktop && !playerPrefs.hdrPassthrough
                                  ? 'HDR passthrough is off, so they’re hidden.'
                                  : 'This screen is showing HDR now, so they’re listed.'}
                        </div>
                    </div>
                    <Toggle label="Hide HDR sources when the screen isn’t in HDR" checked={playerPrefs.hideHdrOnSdr} onchange={(v) => (playerPrefs.hideHdrOnSdr = v)} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Remembered for each show</div>
                        <div class="sub">
                            The audio and subtitles you pick while watching are used again for the rest of that show or movie.
                            {titleTracks.count ? `${titleTracks.count} remembered on this device.` : ''}
                        </div>
                    </div>
                    <button class="btn" disabled={!titleTracks.count} onclick={() => titleTracks.clear()}>Forget All</button>
                </div>
                <div class="row">
                    <div>
                        <div class="title">Play next episode automatically</div>
                        <div class="sub">Keeps going through a series without stopping.</div>
                    </div>
                    <Toggle label="Play next episode automatically" checked={settings.bingeWatching} onchange={(v) => update({ bingeWatching: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Skip intros and recaps automatically</div>
                        <div class="sub">When their timing is known. Otherwise a Skip button appears{isDesktop ? ', and S skips anytime' : ''}.</div>
                    </div>
                    <Toggle label="Skip intros and recaps automatically" checked={playerPrefs.autoSkip} onchange={(v) => (playerPrefs.autoSkip = v)} />
                </div>
                {#if isDesktop}
                <div class="row">
                    <div>
                        <div class="title">Pause when minimized</div>
                        <div class="sub">Pauses playback when you minimize the window.</div>
                    </div>
                    <Toggle label="Pause when minimized" checked={playerPrefs.pauseOnMinimize} onchange={(v) => (playerPrefs.pauseOnMinimize = v)} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Pause when the window loses focus</div>
                        <div class="sub">Pauses playback when you switch to another window. Not in picture in picture.</div>
                    </div>
                    <Toggle label="Pause when the window loses focus" checked={playerPrefs.pauseOnLostFocus} onchange={(v) => (playerPrefs.pauseOnLostFocus = v)} />
                </div>
                {/if}
                <div class="row">
                    <div>
                        <div class="title">Ask if you’re still watching</div>
                        <div class="sub">After two episodes play on their own with no one touching anything, asks, and pauses after 15 seconds without an answer.</div>
                    </div>
                    <Toggle label="Ask if you’re still watching" checked={playerPrefs.askStillWatching} onchange={(v) => (playerPrefs.askStillWatching = v)} />
                </div>
                {#if !isTV}<!-- the TV's own player always decodes in hardware -->
                <div class="row">
                    <div>
                        <div class="title">Hardware-accelerated decoding</div>
                        <div class="sub">Uses your graphics card to decode video. Turn off if playback shows artifacts.</div>
                    </div>
                    <Toggle label="Hardware-accelerated decoding" checked={settings.hardwareDecoding} onchange={(v) => update({ hardwareDecoding: v })} />
                </div>
                {/if}
            </div>
        </section>

        <section>
            <h2>Subtitle Style</h2>
            <div class="group">
                <div class="sub-preview" bind:clientHeight={previewHeight} aria-hidden="true">
                    <div class="sub-line" style:bottom={subtitleBottom(subStyle)}>
                        <span style={subtitleCss(subStyle, previewHeight || 200)}>I’ll meet you at the lighthouse at dawn.</span>
                    </div>
                </div>
                <div class="row">
                    <div>
                        <div class="title">Style</div>
                        <div class="sub">On every device. Anime’s styled subtitles keep their own look, for their signs and songs.</div>
                    </div>
                    <PopupButton
                        label="Subtitle style"
                        value={subPreset}
                        options={presetOptions}
                        onchange={(v) => v !== 'custom' && (playerPrefs.subStyle = SUB_PRESETS[v].style)}
                    />
                </div>
                <div class="row compact">
                    <div class="title">Size</div>
                    <PopupButton label="Subtitle size" value={subStyle.size} options={optionsOf(SUB_SIZES)} onchange={(v) => setSub({ size: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Font</div>
                    <PopupButton label="Subtitle font" value={subStyle.font} options={optionsOf(SUB_FONTS)} onchange={(v) => setSub({ font: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Color</div>
                    <PopupButton label="Subtitle color" value={subStyle.color} options={optionsOf(SUB_COLORS)} onchange={(v) => setSub({ color: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Background</div>
                    <Toggle label="Subtitle background" checked={subStyle.background} onchange={(v) => setSub({ background: v })} />
                </div>
                {#if !subStyle.background}
                    <div class="row compact">
                        <div class="title">Edges</div>
                        <PopupButton label="Subtitle edges" value={subStyle.edge} options={optionsOf(SUB_EDGES)} onchange={(v) => setSub({ edge: v })} />
                    </div>
                {/if}
                <div class="row compact">
                    <label class="title" for="sub-position">Position</label>
                    <input
                        id="sub-position"
                        class="sub-position"
                        type="range"
                        min="0"
                        max={SUB_POSITION_MAX}
                        step="1"
                        value={subStyle.position}
                        oninput={(e) => setSub({ position: Number(e.currentTarget.value) })}
                        aria-valuetext={subStyle.position === 0 ? 'At the bottom' : `${subStyle.position}% up`}
                    />
                </div>
            </div>
        </section>

        {#if player.features.upscaling || player.features.hdrPassthrough || player.features.audioPassthrough}
        <section>
            <h2>Video</h2>
            <div class="group">
                {#if player.features.upscaling}
                <div class="row">
                    <div>
                        <div class="title">Upscaling</div>
                        <div class="sub">
                            Sharpens video that’s smaller than your screen. RTX Video Super Resolution needs an
                            NVIDIA RTX card and uses its AI upscaler.
                        </div>
                    </div>
                    <PopupButton
                        label="Upscaling"
                        value={playerPrefs.upscaler}
                        options={(Object.keys(upscalerLabels) as Upscaler[]).map((u) => ({ value: u, label: upscalerLabels[u] }))}
                        onchange={(v) => (playerPrefs.upscaler = v)}
                    />
                </div>
                {/if}
                {#if player.features.hdrPassthrough}
                <div class="row">
                    <div>
                        <div class="title">HDR passthrough</div>
                        <div class="sub">Sends HDR to your display when Windows HDR is on. Otherwise HDR is tone-mapped to look right on SDR.</div>
                    </div>
                    <Toggle label="HDR passthrough" checked={playerPrefs.hdrPassthrough} onchange={(v) => (playerPrefs.hdrPassthrough = v)} />
                </div>
                {/if}
                {#if player.features.audioPassthrough}
                <div class="row">
                    <div>
                        <div class="title">Audio passthrough (Dolby Atmos, DTS)</div>
                        <div class="sub">For a receiver or soundbar over HDMI. Leave off for headphones and PC speakers.</div>
                    </div>
                    <Toggle label="Audio passthrough" checked={playerPrefs.audioPassthrough} onchange={(v) => (playerPrefs.audioPassthrough = v)} />
                </div>
                {/if}
            </div>
        </section>
        {/if}

        <section>
            <h2>Easy Mode</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Pick sources automatically</div>
                        <div class="sub">
                            Press Play and the best source starts on its own, preferring cached debrid streams. If one
                            doesn’t work, the next best is tried. You’ll only see the source list if nothing works.
                        </div>
                    </div>
                    <Toggle label="Pick sources automatically" checked={playerPrefs.easyMode} onchange={(v) => (playerPrefs.easyMode = v)} />
                </div>
                {#if playerPrefs.easyMode}
                    <div class="row">
                        <div>
                            <div class="title">Maximum quality</div>
                            <div class="sub">The highest resolution to pick. Lower saves data and starts faster.</div>
                        </div>
                        <PopupButton
                            label="Maximum quality"
                            value={playerPrefs.maxResolution}
                            options={[
                                { value: 2160, label: 'Up to 4K' },
                                { value: 1080, label: 'Up to 1080p' },
                                { value: 720, label: 'Up to 720p' },
                            ]}
                            onchange={(v) => (playerPrefs.maxResolution = v)}
                        />
                    </div>
                    {#if isDesktop}
                    <div class="row">
                        <div>
                            <div class="title">Fall back to non-debrid torrents</div>
                            <div class="sub">
                                Only used as a backup, when none of the debrid sources work (e.g. Torrentio without
                                debrid).
                            </div>
                        </div>
                        <Toggle label="Fall back to non-debrid torrents" checked={playerPrefs.allowTorrents} onchange={(v) => (playerPrefs.allowTorrents = v)} />
                    </div>
                    {/if}
                {/if}
            </div>
        </section>

        {#if isDesktop}
            <section>
                <h2>Integrations</h2>
                <div class="group">
                    <div class="row">
                        <div>
                            <div class="title">Open addon install links in this app</div>
                            <div class="sub">
                                Makes “Install” buttons on addon websites open here. Windows lets only one app handle
                                these links, so this takes them over from the official Stremio app.
                            </div>
                        </div>
                        <Toggle label="Open addon install links in this app" checked={handlesLinks} onchange={setLinkHandling} />
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">Show what you’re watching on Discord</div>
                            <div class="sub">Your Discord profile shows the title, episode and time left while something plays. Needs the Discord app running.</div>
                        </div>
                        <Toggle label="Show what you’re watching on Discord" checked={playerPrefs.discordPresence} onchange={(v) => (playerPrefs.discordPresence = v)} />
                    </div>
                </div>
            </section>
        {/if}

        <section>
            <h2>Spoilers</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Blur Spoilers in Reviews</div>
                        <div class="sub">Reviews their writers marked as spoilers stay blurred until you tap them.</div>
                    </div>
                    <Toggle label="Blur Spoilers in Reviews" checked={playerPrefs.blurSpoilers} onchange={(v) => (playerPrefs.blurSpoilers = v)} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Blur Episodes You Haven’t Watched</div>
                        <div class="sub">An episode’s picture can give things away.</div>
                    </div>
                    <Toggle label="Blur Episodes You Haven’t Watched" checked={playerPrefs.blurUnwatchedStills} onchange={(v) => (playerPrefs.blurUnwatchedStills = v)} />
                </div>
            </div>
        </section>

        {#if app.user && tracker.ready && animeTrack}
            <section>
                <h2>Anime</h2>
                <div class="group">
                    <div class="row">
                        <div>
                            <div class="title">New Episodes</div>
                            <div class="sub" class:sync-error={animeTrackFailed} role={animeTrackFailed ? 'status' : undefined}>
                                {animeTrackFailed
                                    ? 'Couldn’t save. Try again in a moment.'
                                    : 'Count an episode as out once it’s subtitled, or wait for the dub. Used by the calendar, new-episode counts and notifications.'}
                            </div>
                        </div>
                        <PopupButton label="New anime episodes" value={animeTrack} options={animeTrackOptions} onchange={setAnimeTrack} />
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">Related Titles</div>
                            <div class="sub" class:sync-error={relatedFailed} role={relatedFailed ? 'status' : undefined}>
                                {relatedFailed ? 'Couldn’t save. Try again in a moment.' : 'What a show’s Related tab lists besides its seasons and films.'}
                            </div>
                        </div>
                        <PopupButton label="Related titles" value={relatedScope} options={relatedOptions} onchange={setRelatedScope} />
                    </div>
                </div>
            </section>
        {/if}

        {#if app.user && tracker.ready && isAdmin && apiKeys}
            <section>
                <h2>API Keys &amp; Integrations</h2>
                <form class="group" onsubmit={saveKeys}>
                    <div class="row">
                        <div>
                            <div class="title">For Everyone on the Server</div>
                            <div class="sub" class:sync-error={keysError} role={keysNote ? 'status' : undefined}>
                                {keysNote ?? 'The services the server looks shows and movies up with, for everyone on it. Only admins see this.'}
                            </div>
                        </div>
                    </div>
                    {#each [{ id: 'tmdb', title: 'TMDb', sub: 'Show and movie details, posters and episodes.' }, { id: 'omdb', title: 'OMDb', sub: 'IMDb, Rotten Tomatoes and Metacritic ratings.' }, { id: 'animeschedule', title: 'AnimeSchedule', sub: 'When anime episodes come out, subbed and dubbed.' }, { id: 'animeschedule_id', title: 'AnimeSchedule Client ID', sub: 'Goes with the AnimeSchedule key.' }] as k (k.id)}
                        {@const key = k.id as keyof ApiKeys}
                        <div class="row">
                            <div>
                                <label class="title" for={`key-${k.id}`}>{k.title}</label>
                                <div class="sub">{k.sub}{apiKeys[key] ? '' : ' Not set up yet.'}</div>
                            </div>
                            <div class="url">
                                <input id={`key-${k.id}`} type={key === 'animeschedule_id' ? 'text' : 'password'} autocomplete="off" spellcheck="false" placeholder={apiKeys[key] ? 'Saved · paste to replace' : key === 'animeschedule_id' ? 'Paste ID' : 'Paste key'} bind:value={keyEdits[key]} />
                            </div>
                        </div>
                    {/each}
                    {#if Object.values(keyEdits).some((v) => v.trim())}
                        <div class="row">
                            <div></div>
                            <button class="btn primary" type="submit" disabled={keysBusy}>{keysBusy ? 'Checking…' : 'Save'}</button>
                        </div>
                    {/if}
                </form>
            </section>
        {/if}

        {#if app.user && !isTV}
            <section id="notifications">
                <h2>Notifications</h2>
                <div class="group">
                    <div class="row">
                        <div>
                            <div class="title">Show Notifications</div>
                            <div class="sub">
                                {#if notify.systemAvailable === false}
                                    New episodes show under the bell. Notifications on this device need the latest version of the app.
                                {:else if notify.permission === 'denied'}
                                    Notifications are turned off for this app in {isIOS ? 'the iPhone’s Settings' : 'Windows Settings'}. Turn them on there to get them.
                                {:else if isIOS}
                                    When something you track airs, even with the app closed.
                                {:else}
                                    When something you track comes out, while the app is open.
                                {/if}
                            </div>
                        </div>
                        {#if notify.systemAvailable}
                            <Toggle label="Show Notifications" checked={notify.prefs.system && notify.permission !== 'denied'} onchange={(v) => notify.setPrefs({ system: v })} />
                        {/if}
                    </div>
                    <div class="row">
                        <div class="title">New Episodes and Movies</div>
                        <Toggle label="New Episodes and Movies" checked={notify.prefs.episodes} onchange={(v) => notify.setPrefs({ episodes: v })} />
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">New Seasons</div>
                            <div class="sub">When a show you track gets a new season, or a date for one.</div>
                        </div>
                        <Toggle label="New Seasons" checked={notify.prefs.seasons} onchange={(v) => notify.setPrefs({ seasons: v })} />
                    </div>
                    <div class="row">
                        <div class="title">Replies to Your Reviews</div>
                        <Toggle label="Replies to Your Reviews" checked={notify.prefs.replies} onchange={(v) => notify.setPrefs({ replies: v })} />
                    </div>
                    <div class="row">
                        <div class="title">Friend Requests</div>
                        <Toggle label="Friend Requests" checked={notify.prefs.friends !== false} onchange={(v) => notify.setPrefs({ friends: v })} />
                    </div>
                </div>
            </section>
        {/if}

        {#if app.user && !isTV}<!-- a file to keep, where saving and opening files makes sense -->
            <section>
                <h2>Data</h2>
                <div class="group">
                    <div class="row">
                        <div>
                            <div class="title">Download a Full Backup</div>
                            <div class="sub">Everything: your profile, picture, banner, favorites, friends and settings, with your watches, scores and lists.</div>
                        </div>
                        <button class="btn" onclick={() => downloadBackup(true)} disabled={!!dataBusy || !tracker.ready}>
                            {dataBusy === 'download-full' ? 'Preparing…' : 'Download'}
                        </button>
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">Download Watch History</div>
                            <div class="sub">Just your watchlist, watches, scores, reviews and lists.</div>
                        </div>
                        <button class="btn" onclick={() => downloadBackup(false)} disabled={!!dataBusy || !tracker.ready}>
                            {dataBusy === 'download' ? 'Preparing…' : 'Download'}
                        </button>
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">Import a Backup</div>
                            <div class="sub">Adds what’s in a backup file; a full one brings back your profile and friends too. Nothing here is removed.</div>
                        </div>
                        <button class="btn" onclick={() => importInput?.click()} disabled={!!dataBusy || !tracker.ready}>
                            {dataBusy === 'import' ? 'Importing…' : 'Import…'}
                        </button>
                        <input bind:this={importInput} type="file" accept="application/json,.json" onchange={importBackup} hidden />
                    </div>
                    {#if pendingConflicts}
                        {@const n = pendingConflicts.length}
                        <div class="row">
                            <div>
                                <div class="title">{n} {n === 1 ? 'title is' : 'titles are'} different here</div>
                                <div class="sub">Their status or progress here isn’t the backup’s.</div>
                            </div>
                            <div class="account-actions">
                                <button class="btn" disabled={!!dataBusy} onclick={() => resolveConflicts('keep_local')}>Keep What’s Here</button>
                                <button class="btn primary" disabled={!!dataBusy} onclick={() => resolveConflicts('use_imported')}>Use the Backup</button>
                            </div>
                        </div>
                    {/if}
                    {#if dataNote || !tracker.ready}
                        <div class="row">
                            <div class="sub" class:sync-error={dataError || !tracker.ready} role="status">
                                {dataNote ?? 'Couldn’t connect. Try again in a moment.'}
                            </div>
                        </div>
                    {/if}
                </div>
            </section>
        {/if}

        {#if !isIOS && !isTV}<!-- iOS and TVs have no streaming server -->
        <section>
            <h2>Streaming Server</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Status</div>
                        <div class="sub" class:sync-error={!!serverSetupError}>
                            {serverSetupError ??
                                (canSetUpServer
                                    ? 'Torrents need Stremio’s streaming server. Set Up downloads it from Stremio (about 30 MB) and starts it.'
                                    : 'Plays torrents and converts formats. This app starts it automatically.')}
                        </div>
                    </div>
                    <div class="status"><ServerStatus status={app.server} /></div>
                    {#if canSetUpServer}<button class="btn primary" onclick={setUpServer}>Set Up</button>{/if}
                </div>
                <form class="row" onsubmit={saveServerUrl}>
                    <div>
                        <label class="title" for="server-url">Server address</label>
                        <div class="sub">Change only if you run the server on another device.</div>
                    </div>
                    <div class="url">
                        <input id="server-url" type="url" bind:value={serverUrl} spellcheck="false" />
                        {#if serverUrlChanged}<button class="btn primary" type="submit">Save</button>{/if}
                    </div>
                </form>
            </div>
        </section>
        {/if}
    {/if}

    {#if isTV}
        <section>
            <h2>Display</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Screen Size</div>
                        <div class="sub">How big text, posters and controls are. Small is the desktop app’s size.</div>
                    </div>
                    <PopupButton
                        label="Screen Size"
                        value={tvSize}
                        options={(Object.keys(tvSizes) as TvSize[]).map((s) => ({ value: s, label: tvSizes[s].label }))}
                        onchange={(v) => {
                            tvSize = v;
                            setTvSize(v);
                        }}
                    />
                </div>
            </div>
        </section>
    {/if}

    <section>
        <h2>Home</h2>
        <div class="group">
            <a class="row link" href="/customize">
                <div>
                    <div class="title">Customize Home</div>
                    <div class="sub">Reorder, rename, combine or hide Home’s rows, and choose the banner.</div>
                </div>
                <Icon name="chevronRight" size={16} />
            </a>
        </div>
    </section>

        {#if !isIOS && !isTV}<!-- no keyboard on a phone or TV -->
    <section>
        <h2>Keyboard Shortcuts</h2>
        <h3 class="subhead">While Watching</h3>
        <div class="group">
            {#each ACTIONS as { action } (action)}
                {@const chord = hotkeys.chordFor(action)}
                <div class="row compact hotkey">
                    <span>
                        {labelOf(action, seekStep, fineStep)}
                        {#if hotkeyError?.action === action}<span class="hotkey-error" role="alert">{hotkeyError.text}</span>{/if}
                    </span>
                    <span class="keys">
                        {#if !hotkeys.isDefault(action)}
                            <button class="text-link" onclick={() => resetHotkey(action)} title="Back to the original key">Reset</button>
                        {/if}
                        <button
                            class="key-button"
                            class:capturing={capturing === action}
                            onclick={() => captureKey(action)}
                            aria-label={`${labelOf(action, seekStep, fineStep)}: ${chord ? formatChord(chord) : 'no key'}. Change`}
                        >
                            {#if capturing === action}Press a key…{:else if chord}<kbd>{formatChord(chord)}</kbd>{/if}
                        </button>
                    </span>
                </div>
            {/each}
            <div class="row compact">
                <span class="sub">Click a key, then press the new one (Esc cancels). Tab still skips while the Skip button shows.</span>
                <button class="btn" onclick={() => resetHotkey()}>Reset All</button>
            </div>
        </div>
        {#if hotkeyError && !hotkeyError.action}<p class="hotkey-error" role="alert">{hotkeyError.text}</p>{/if}
        {#each shortcutGroups as g (g.title)}
            <h3 class="subhead">{g.title}</h3>
            <div class="group">
                {#each g.items as [label, keys] (label)}
                    <div class="row compact">
                        <span>{label}</span>
                        <span class="keys">
                            {#each keys as key, i (key)}{#if i}<span class="or">or</span>{/if}<kbd>{key}</kbd>{/each}
                        </span>
                    </div>
                {/each}
            </div>
        {/each}
    </section>
        {/if}

    {#if updates.supported}
        <section>
            <h2>Updates</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">
                            {#if updates.phase === 'ready'}Version {updates.version} is ready
                            {:else if updates.phase === 'downloading'}Downloading version {updates.version}…{#if updates.progress != null} {Math.round(updates.progress * 100)}%{/if}
                            {:else if updates.phase === 'checking'}Checking for updates…
                            {:else if updates.phase === 'up-to-date'}You’re up to date
                            {:else if updates.phase === 'error'}Couldn’t check for updates
                            {:else}Automatic updates{/if}
                        </div>
                        <div class="sub">
                            {#if updates.phase === 'error'}Check your connection and try again.
                            {:else if updates.reloads}Updates download in the background and install when you reload.
                            {:else}Updates download in the background and install when you restart.{/if}
                        </div>
                    </div>
                    {#if updates.phase === 'ready'}
                        <button class="btn primary" onclick={() => updates.restartToUpdate()}>{updates.reloads ? 'Reload to Update' : 'Restart to Update'}</button>
                    {:else}
                        <button class="btn" disabled={updates.phase === 'checking' || updates.phase === 'downloading'} onclick={() => updates.check()}>
                            Check for Updates
                        </button>
                    {/if}
                </div>
                {#if whatsNew.available}
                    <div class="row">
                        <div>
                            <div class="title">What’s New</div>
                            <div class="sub">The latest changes to this app.</div>
                        </div>
                        <button class="btn" onclick={() => whatsNew.showRecent()}>Show</button>
                    </div>
                {/if}
            </div>
        </section>
    {/if}

    <section>
        <h2>Privacy</h2>
        <div class="group">
            <div class="row">
                <div>
                    <div class="title">Send Error Reports</div>
                    <div class="sub">When something breaks, what broke is sent so it can be fixed. Nothing about your account or what you watch.</div>
                </div>
                <Toggle label="Send Error Reports" checked={sendErrors} onchange={(v) => (setErrorReports(v), (sendErrors = v))} />
            </div>
            <a class="row link compact" href="/privacy">
                <div class="title">Privacy Policy</div>
                <Icon name="chevronRight" size={16} />
            </a>
            <a class="row link compact" href="/terms">
                <div class="title">Terms of Use</div>
                <Icon name="chevronRight" size={16} />
            </a>
        </div>
    </section>

    {#if !searching}<p class="about">Stremio {updates.current ?? '0.1.0'} · stremio-core-web {import.meta.env.CORE_VERSION}</p>{/if}
    </div>
</div>

<style>
    .page {
        max-width: 760px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 28px) var(--gutter) 64px;
    }
    /* PC and TV: the sidebar beside the section it shows. The page stays put
       (title and sidebar); only the section scrolls, in its own column. */
    .page.two-pane {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
        column-gap: 48px;
        max-width: 1180px;
        height: 100vh;
        height: 100dvh;
        padding-bottom: 0;
        overflow: hidden;
    }
    .two-pane h1 {
        grid-column: 1 / -1;
    }
    .two-pane .panes {
        grid-column: 2;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        /* Room under the last setting, and for focus rings at the edges. */
        padding: 2px 4px 64px;
        margin: -2px -4px 0;
    }
    .sidebar {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        overflow-y: auto;
        padding-bottom: 32px;
    }
    /* Search: a field over the sections (phones: under the title). */
    .search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        margin-bottom: 12px;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label-2);
        flex: none;
    }
    .search:focus-within {
        border-color: var(--accent);
    }
    .search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
        font: inherit;
    }
    .search input::placeholder {
        color: var(--label-3);
    }
    .page:not(.two-pane) .search {
        margin-bottom: 24px;
    }
    /* What a search leaves out. */
    .panes :global([data-search-hide]) {
        display: none !important;
    }
    .panes :global(.row[data-first-shown]) {
        border-top: 0;
    }
    .no-results {
        margin: 8px 2px;
        color: var(--label-2);
    }
    .side-item {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        color: var(--label-2);
        font: inherit;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
        transition:
            background var(--fast),
            color var(--fast);
    }
    .side-item:hover {
        background: var(--fill);
        color: var(--label);
    }
    /* The section showing: as the top bar's chosen tab. */
    .side-item.on {
        background: var(--label);
        color: var(--bg);
    }
    .side-item:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: 2px;
    }
    /* The section's name heads its page. */
    .two-pane section h2 {
        margin: 0 0 16px 2px;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 700;
        color: var(--label);
    }
    :global(html.tv) .side-item {
        min-height: 52px;
        font-size: 18px;
    }
    h1 {
        margin: 0 0 28px;
        font-family: var(--font-display);
        font-size: clamp(28px, 3vw, 36px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    section {
        margin-bottom: 28px;
    }
    h2 {
        margin: 0 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    /* Grouped rows, like a native settings window. */
    .group {
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        overflow: hidden;
    }
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        min-height: 64px;
        padding: 12px 18px;
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .row.compact {
        min-height: 44px;
    }
    /* A whole row that opens another page, with a chevron, as in native settings. */
    a.row.link {
        color: inherit;
        text-decoration: none;
        cursor: pointer;
        transition: background var(--fast);
    }
    a.row.link:hover {
        background: var(--fill);
    }
    a.row.link:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: -2px;
    }
    a.row.link > :global(svg) {
        flex: none;
        color: var(--label-3);
    }
    /* A whole row that's a single action (Log Out), like native settings lists. */
    .row.action {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 48px;
        border-top: 1px solid var(--separator);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--fast);
    }
    .row.action:hover {
        background: var(--fill);
    }
    .row.action:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: -2px;
    }
    .row.action.destructive {
        color: var(--bad-text);
    }
    .title {
        font-weight: 500;
    }
    /* Subtitle Style's preview: a frame with a bright bottom, where subtitles
       are hardest to read. Drawn the way the TV draws them (subtitleStyle.ts). */
    .sub-preview {
        position: relative;
        aspect-ratio: 16 / 9;
        max-height: 260px;
        width: 100%;
        overflow: hidden;
        border-bottom: 1px solid var(--separator);
        background:
            radial-gradient(ellipse 60% 40% at 70% 78%, rgb(255 236 200 / 0.9), transparent 70%),
            linear-gradient(180deg, #0f1d2e 0%, #2b4563 38%, #8a7f78 66%, #d8c7ae 84%, #efe4d1 100%);
    }
    .sub-line {
        position: absolute;
        left: 6%;
        right: 6%;
        text-align: center;
        line-height: 1.3;
    }
    .sub-line span {
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
    }
    .sub-position {
        width: min(240px, 50%);
        accent-color: var(--accent);
    }
    .sub {
        margin-top: 2px;
        font-size: 13px;
        color: var(--label-2);
    }
    .account {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
    }
    .name-input {
        width: 220px;
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
    }
    .name-input:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .sync-error {
        color: var(--bad);
    }
    .account-actions {
        display: flex;
        gap: 8px;
        flex: none;
    }
    .btn {
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 8px;
        background: var(--fill);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .btn:hover {
        background: var(--fill-hover);
    }
    .btn.primary {
        background: var(--accent);
        border-color: transparent;
        color: white;
    }
    .status {
        flex: none;
        min-width: 220px;
    }
    .url {
        display: flex;
        gap: 8px;
        flex: none;
    }
    .url input {
        width: 240px;
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
    }
    .url input:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .subhead {
        margin: 14px 0 8px 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--label-2);
    }
    h2 + .subhead {
        margin-top: 0;
    }
    .keys {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }
    .or {
        font-size: 12px;
        color: var(--label-3);
    }
    .key-button {
        all: unset;
        box-sizing: border-box;
        min-width: 64px;
        padding: 2px;
        border-radius: 8px;
        text-align: center;
        font-size: 12px;
        color: var(--label-2);
        cursor: pointer;
    }
    .key-button:hover kbd,
    .key-button:focus-visible kbd {
        border-color: var(--label-3);
        color: var(--label);
    }
    .key-button:focus-visible {
        outline: 2px solid var(--accent);
    }
    .key-button.capturing {
        padding: 3px 10px;
        border: 1px dashed var(--accent);
        color: var(--label);
    }
    .text-link {
        all: unset;
        font-size: 12px;
        color: var(--label-3);
        cursor: pointer;
    }
    .text-link:hover {
        color: var(--label);
    }
    .hotkey-error {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: var(--bad);
    }
    p.hotkey-error {
        margin: 8px 4px 0;
    }
    kbd {
        font-family: var(--font);
        font-size: 12px;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label-2);
        white-space: nowrap;
    }
    .about {
        text-align: center;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
    /* Phones: like iOS Settings, the control stays on the right of its title
       and the explanation reads as a footnote under the title. */
    @media (max-width: 700px) {
        .row {
            gap: 14px;
            padding: 12px 16px;
        }
        .row > div:first-child {
            flex: 1;
            min-width: 0;
        }
    }
    /* Phones: the account (picture, name, email) gets the full width with
       its button underneath; the name field sits under its label. */
    @media (max-width: 700px) {
        .account-row {
            flex-wrap: wrap;
        }
        .account {
            flex: 1 1 100%;
        }
        .account > div {
            min-width: 0;
        }
        .account .sub {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .account-row .btn {
            flex: 1 1 100%;
            height: 40px;
        }
        .row.stack {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
        }
        .row.stack .name-input {
            width: 100%;
            height: 40px;
            box-sizing: border-box;
        }
        .account-actions .btn {
            height: 44px;
        }
    }
</style>
