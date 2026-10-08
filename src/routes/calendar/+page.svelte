<script lang="ts">
    // Calendar: a month at a time, with the selected day's releases beside it.
    // From Lightboxd while it's connected and reachable (new episodes of what
    // you're watching, premieres from your watchlist, in your sub/dub
    // preference, with air times); otherwise Stremio's own calendar (new
    // episodes of the shows in your library, by date). Same view either way.
    import { onMount, untrack } from 'svelte';
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { titleHref } from '$lib/links';
    import Icon from '$lib/components/Icon.svelte';

    /** One release, whichever source it came from. */
    type CalEvent = {
        key: string;
        /** Local calendar day, YYYY-MM-DD. */
        day: string;
        /** When it airs (ms), only when the source knows a time of day. */
        at: number | null;
        name: string;
        poster: string | null;
        /** "S2 E5" or "Movie". */
        label: string | null;
        episodeName: string | null;
        tags: string[];
        href: string | null;
    };

    // --- the month and day on show ---------------------------------------------

    const pad = (n: number) => String(n).padStart(2, '0');
    const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayKey = dayKey(new Date());

    let year = $state(new Date().getFullYear());
    let month = $state(new Date().getMonth() + 1); // 1-12
    let selected = $state(todayKey);
    /** Beside the grid: the selected day, or every release this month. */
    let view = $state<'day' | 'month'>('day');

    const monthTitle = $derived(new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }));
    const isThisMonth = $derived(todayKey.startsWith(`${year}-${pad(month)}`));

    function goMonth(delta: number) {
        const d = new Date(year, month - 1 + delta, 1);
        year = d.getFullYear();
        month = d.getMonth() + 1;
        selected = isThisMonth ? todayKey : `${year}-${pad(month)}-01`;
    }

    function goToday() {
        const d = new Date();
        year = d.getFullYear();
        month = d.getMonth() + 1;
        selected = todayKey;
        view = 'day';
    }

    // Weeks start on Sunday; days outside the month are blank.
    const cells = $derived.by(() => {
        const lead = new Date(year, month - 1, 1).getDay();
        const days = new Date(year, month, 0).getDate();
        const out: (string | null)[] = Array(lead).fill(null);
        for (let d = 1; d <= days; d++) out.push(`${year}-${pad(month)}-${pad(d)}`);
        while (out.length % 7) out.push(null);
        return out;
    });
    const weekdays = Array.from({ length: 7 }, (_, i) =>
        new Date(2026, 0, 4 + i).toLocaleDateString([], { weekday: 'short' })
    ); // Jan 4 2026 is a Sunday

    // --- where the releases come from ---------------------------------------------

    // 'pending': Lightboxd is set up and being checked, so neither source shows yet
    // (no flash of Stremio's calendar on the way to Lightboxd's).
    const source = $derived<'lightboxd' | 'stremio' | 'pending'>(
        lightboxd.ready ? 'lightboxd' : lightboxd.saved?.token && lightboxd.status === 'checking' ? 'pending' : 'stremio'
    );
    /** Lightboxd is set up for this profile but can't be reached right now. */
    const lightboxdDown = $derived(!!lightboxd.saved?.token && !lightboxd.ready && lightboxd.status !== 'checking');

    // Lightboxd: a day either side of the month, since a release with a time
    // can land on another day in this time zone.
    type LbEvent = {
        date: string;
        datetime: string | null;
        name: string;
        id: string | null;
        type: 'movie' | 'series';
        poster: string | null;
        season: number | null;
        episode: number | null;
        episode_name: string | null;
        kind: string | null;
        track: 'sub' | 'dub' | null;
    };
    let lbEvents = $state<LbEvent[] | null>(null);
    let lbFailed = $state(false);
    let lbLoadedFor = '';

    async function loadLightboxd(force = false) {
        const key = `${year}-${month}`;
        if (!force && lbLoadedFor === key) return;
        lbLoadedFor = key;
        lbFailed = false;
        const first = new Date(year, month - 1, 0);
        const last = new Date(year, month, 1);
        const res = await lightboxd.request<{ events: LbEvent[] }>(`/calendar?start=${dayKey(first)}&end=${dayKey(last)}`);
        if (lbLoadedFor !== key) return;
        if (res) lbEvents = res.events;
        else lbFailed = true;
    }

    $effect(() => {
        if (source !== 'lightboxd') return;
        void year;
        void month;
        untrack(() => loadLightboxd());
    });

    // Stremio: core's Calendar model, a month at a time.
    type StremioItem = {
        id: string;
        name: string;
        poster?: string | null;
        title?: string | null;
        season?: number | null;
        episode?: number | null;
        deepLinks?: { metaDetailsStreams?: string | null };
    };
    type StremioCalendar = {
        selected: { year: number; month: number } | null;
        items: { date: { day: number; month: number; year: number }; items: StremioItem[] }[];
    };
    let stremio = $state<StremioCalendar | null>(null);

    // Watch, then load, as Home does: the month's state can't arrive unseen.
    $effect(() => {
        if (source !== 'stremio') return;
        const args = { year, month };
        return untrack(() => {
            const off = core.watch<StremioCalendar>('calendar', (s) => (stremio = s));
            core.dispatch({ action: 'Load', args: { model: 'Calendar', args } }, 'calendar');
            return off;
        });
    });
    onMount(() => () => core.dispatch({ action: 'Unload' }, 'calendar'));

    function refresh() {
        if (source === 'pending') return;
        if (source === 'lightboxd') loadLightboxd(true);
        else core.dispatch({ action: 'Load', args: { model: 'Calendar', args: { year, month } } }, 'calendar');
    }

    // --- one list of releases by day -------------------------------------------------

    /** A series episode's video id, for opening the title page on that episode. */
    function episodeVideo(id: string, season: number | null, episode: number | null) {
        if (episode == null) return null;
        return id.startsWith('kitsu:') ? `${id}:${episode}` : season != null ? `${id}:${season}:${episode}` : null;
    }

    function fromLightboxd(e: LbEvent, i: number): CalEvent {
        const moment = e.datetime ? new Date(e.datetime) : null;
        const timed = moment && !isNaN(moment.getTime()) ? moment : null;
        const tags: string[] = [];
        if (e.kind === 'series_premiere') tags.push('Series Premiere');
        else if (e.kind === 'season_premiere') tags.push('Season Premiere');
        else if (e.kind === 'movie_premiere') tags.push('Premiere');
        if (e.track) tags.push(e.track === 'dub' ? 'Dub' : 'Sub');
        const video = e.id && e.type === 'series' ? episodeVideo(e.id, e.season, e.episode) : null;
        return {
            key: `lb:${i}`,
            day: timed ? dayKey(timed) : e.date,
            at: timed ? timed.getTime() : null,
            name: e.name,
            poster: e.poster,
            label: e.kind === 'movie_premiere' ? 'Movie' : e.season != null && e.episode != null ? `S${e.season} E${e.episode}` : null,
            episodeName: e.episode_name,
            tags,
            href: e.id ? titleHref(e.type, e.id, video ? { video } : undefined) : null,
        };
    }

    function fromStremio(day: { day: number; month: number; year: number }, item: StremioItem, i: number): CalEvent {
        // The episode's id is the last part of its streams link (…/tt123:1:2).
        const link = item.deepLinks?.metaDetailsStreams ?? '';
        const last = decodeURIComponent(link.split('/').pop() ?? '');
        const video = last.includes(':') ? last : episodeVideo(item.id, item.season ?? null, item.episode ?? null);
        return {
            key: `st:${day.day}:${i}:${item.id}`,
            day: `${day.year}-${pad(day.month)}-${pad(day.day)}`,
            at: null,
            name: item.name,
            poster: item.poster ?? null,
            label: item.season != null && item.episode != null ? `S${item.season} E${item.episode}` : null,
            episodeName: item.title && item.title !== item.name ? item.title : null,
            tags: [],
            href: titleHref('series', item.id, video ? { video } : undefined),
        };
    }

    const byDay = $derived.by(() => {
        const map = new Map<string, CalEvent[]>();
        let list: CalEvent[] = [];
        if (source === 'lightboxd') list = (lbEvents ?? []).map(fromLightboxd);
        else if (stremio?.selected?.year === year && stremio.selected.month === month)
            list = stremio.items.flatMap((d) => d.items.map((it, i) => fromStremio(d.date, it, i)));
        for (const e of list) {
            if (!e.day.startsWith(`${year}-${pad(month)}`)) continue;
            if (!map.has(e.day)) map.set(e.day, []);
            map.get(e.day)!.push(e);
        }
        // Date-only releases first (out all day), then by time.
        for (const events of map.values()) events.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.name.localeCompare(b.name));
        return map;
    });

    const loading = $derived(
        source === 'pending'
            ? true
            : source === 'lightboxd'
              ? lbEvents === null && !lbFailed
              : !(stremio?.selected?.year === year && stremio.selected.month === month)
    );
    const monthCount = $derived([...byDay.values()].reduce((n, l) => n + l.length, 0));
    const selectedEvents = $derived(byDay.get(selected) ?? []);
    const monthDays = $derived([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)));

    // --- labels ---------------------------------------------------------------------

    const timeOf = (e: CalEvent) => (e.at != null ? new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null);
    const dateOf = (key: string, opts: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00`).toLocaleDateString([], opts);
    function dayHeading(key: string) {
        if (key === todayKey) return `Today, ${dateOf(key, { month: 'short', day: 'numeric' })}`;
        return dateOf(key, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    const countLabel = (n: number) => (n === 1 ? '1 release' : `${n} releases`);
    const sourceNote = $derived(
        source === 'pending'
            ? 'Updating…'
            : source === 'lightboxd'
            ? 'Shows you’re watching or plan to watch'
            : lightboxdDown
              ? 'Can’t reach the server right now. Showing shows in your library.'
              : 'Shows in your library'
    );
    const MAX_CHIPS = 3;
</script>

<svelte:head><title>Calendar · Stremio</title></svelte:head>

<div class="page">
        <!-- As in Calendar on the Mac and iPhone: the month's name leads; going
             back, to today and forward sit together at the end. -->
        <header class="toolbar">
            <div class="heading">
                <h1 aria-live="polite">{monthTitle}</h1>
                <p class="note" class:warn={lightboxdDown && source === 'stremio'}>{sourceNote}</p>
            </div>
            <div class="controls">
                <div class="stepper" role="group" aria-label="Month">
                    <button class="icon-btn" onclick={() => goMonth(-1)} aria-label="Previous month" title="Previous month">
                        <Icon name="chevronLeft" size={18} />
                    </button>
                    <button class="today-btn" onclick={goToday} disabled={isThisMonth && selected === todayKey}>Today</button>
                    <button class="icon-btn" onclick={() => goMonth(1)} aria-label="Next month" title="Next month">
                        <Icon name="chevronRight" size={18} />
                    </button>
                </div>
                <button class="icon-btn" onclick={refresh} aria-label="Refresh" title="Refresh">
                    <Icon name="replay" size={17} />
                </button>
            </div>
        </header>

        <div class="layout">
            <div class="month" role="grid" aria-label={monthTitle} aria-busy={loading}>
                <div class="weekdays" role="row">
                    {#each weekdays as w (w)}<div role="columnheader">{w}</div>{/each}
                </div>
                <div class="cells">
                    {#each cells as key, i (key ?? `blank-${i}`)}
                        {#if key}
                            {@const events = byDay.get(key) ?? []}
                            <button
                                class="cell"
                                class:selected={key === selected}
                                class:today={key === todayKey}
                                class:past={key < todayKey}
                                role="gridcell"
                                aria-selected={key === selected}
                                aria-label={`${dateOf(key, { weekday: 'long', month: 'long', day: 'numeric' })}${events.length ? `, ${countLabel(events.length)}` : ''}`}
                                onclick={() => {
                                    selected = key;
                                    view = 'day';
                                }}
                            >
                                <span class="num">{Number(key.slice(8))}</span>
                                {#if events.length}
                                    <span class="chips" aria-hidden="true">
                                        {#each events.slice(0, events.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS) as e (e.key)}
                                            <span class="chip">
                                                <span class="chip-name">{e.name}</span>
                                                {#if timeOf(e)}<span class="chip-time">{timeOf(e)}</span>{/if}
                                            </span>
                                        {/each}
                                        {#if events.length > MAX_CHIPS}<span class="more">+{events.length - (MAX_CHIPS - 1)} more</span>{/if}
                                    </span>
                                    <!-- Phones: dots, as in iOS Calendar's month view. -->
                                    <span class="dots" aria-hidden="true">
                                        {#each events.slice(0, 3) as e (e.key)}<span class="dot"></span>{/each}
                                    </span>
                                {/if}
                            </button>
                        {:else}
                            <div class="cell blank" aria-hidden="true"></div>
                        {/if}
                    {/each}
                </div>
            </div>

            <aside class="side" aria-label="Releases">
                <div class="side-head">
                    <div>
                        <h2>{view === 'day' ? dayHeading(selected) : monthTitle}</h2>
                        <p class="count">{loading ? 'Loading…' : countLabel(view === 'day' ? selectedEvents.length : monthCount)}</p>
                    </div>
                    <div class="segmented" role="radiogroup" aria-label="Show">
                        <button role="radio" aria-checked={view === 'day'} class:on={view === 'day'} onclick={() => (view = 'day')}>Day</button>
                        <button role="radio" aria-checked={view === 'month'} class:on={view === 'month'} onclick={() => (view = 'month')}>Month</button>
                    </div>
                </div>

                {#if source === 'stremio' && !app.user}
                    <p class="empty">Log in to see new episodes of the shows in your library.</p>
                {:else if source === 'lightboxd' && lbFailed}
                    <p class="empty">Couldn’t load the calendar. <button class="link" onclick={refresh}>Try again</button></p>
                {:else if !loading && view === 'day' && !selectedEvents.length}
                    <p class="empty">Nothing comes out on this day.</p>
                {:else if !loading && view === 'month' && !monthCount}
                    <p class="empty">Nothing comes out this month.</p>
                {:else if view === 'day'}
                    <ul class="list">
                        {#each selectedEvents as e (e.key)}{@render release(e)}{/each}
                    </ul>
                {:else}
                    {#each monthDays as [key, events] (key)}
                        <h3 class="list-day" class:today={key === todayKey}>{dayHeading(key)}</h3>
                        <ul class="list">
                            {#each events as e (e.key)}{@render release(e)}{/each}
                        </ul>
                    {/each}
                {/if}
            </aside>
        </div>
</div>

{#snippet release(e: CalEvent)}
    {@const time = timeOf(e)}
    <li>
        <svelte:element this={e.href ? 'a' : 'div'} class="release" href={e.href ?? undefined}>
            <span class="poster">{#if e.poster}<img src={e.poster} alt="" loading="lazy" />{/if}</span>
            <span class="release-text">
                <span class="release-name">{e.name}</span>
                {#if e.label || e.episodeName}<span class="release-sub">{[e.label, e.episodeName].filter(Boolean).join(' · ')}</span>{/if}
                {#if e.tags.length}<span class="release-tags">{e.tags.join(' · ')}</span>{/if}
            </span>
            {#if time}<span class="release-time">{time}</span>{/if}
        </svelte:element>
    </li>
{/snippet}

<style>
    /* The whole window below the nav: the month fills it, the day's list
       beside it scrolls on its own (PC and TV; vh is TV-safe, vite.config.js). */
    .page {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        height: 100vh;
        padding: calc(var(--nav-h) + 12px) var(--gutter) 24px;
    }

    /* --- toolbar --- */
    .toolbar {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-large);
        font-weight: 700;
        line-height: 1.1;
    }
    .note {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--label-2);
    }
    .note.warn {
        color: var(--warn);
    }
    .controls {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .stepper {
        display: flex;
        align-items: center;
        padding: 2px;
        border-radius: 999px;
        background: var(--fill);
    }
    .today-btn {
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .today-btn:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .today-btn:disabled {
        color: var(--label-2);
        cursor: default;
    }
    .icon-btn {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--label-2);
        cursor: pointer;
    }
    .icon-btn:hover {
        background: var(--fill-hover);
        color: var(--label);
    }

    /* --- month grid and the side panel --- */
    .layout {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) clamp(320px, 24vw, 420px);
        gap: 24px;
    }
    .month {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .weekdays,
    .cells {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 6px;
    }
    .cells {
        flex: 1;
        grid-auto-rows: minmax(96px, 1fr);
    }
    .weekdays {
        margin-bottom: 6px;
    }
    .weekdays div {
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .cell {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background var(--fast);
    }
    .cell:hover {
        background: var(--fill-hover);
    }
    .cell.blank {
        background: transparent;
        cursor: default;
    }
    .cell.selected {
        background: var(--elevated-2);
        border-color: rgb(255 255 255 / 0.18);
    }
    .num {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        margin: -3px 0 4px -3px;
        border-radius: 50%;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .past .num {
        color: var(--label-2);
    }
    .today .num {
        background: var(--accent);
        color: white;
    }
    .chips {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
    }
    .chip {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        padding: 3px 6px;
        border-radius: var(--radius-s);
        background: rgb(255 255 255 / 0.07);
        font-size: 11px;
    }
    .selected .chip {
        background: rgb(255 255 255 / 0.1);
    }
    .chip-name {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-weight: 600;
    }
    .chip-time {
        flex: none;
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
    }
    .more {
        padding: 0 6px;
        font-size: 11px;
        color: var(--label-2);
    }
    .dots {
        display: none;
    }

    /* --- side panel --- */
    .side {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .side-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }
    h2 {
        margin: 0;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .count {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--label-2);
    }
    .segmented {
        flex: none;
        display: flex;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .segmented button {
        height: 26px;
        padding: 0 12px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--label-2);
        font-weight: 500;
        cursor: pointer;
    }
    .segmented button.on {
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    }
    .empty {
        margin: 24px 0;
        text-align: center;
        font-size: 13px;
        color: var(--label-2);
    }
    .link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent-text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .list-day {
        margin: 14px 0 6px 2px;
        font-size: 12px;
        font-weight: 600;
        color: var(--label-2);
    }
    .list-day.today {
        color: var(--accent-text);
    }
    .list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .release {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 10px;
        border-radius: var(--radius);
        background: var(--fill);
        color: inherit;
        text-decoration: none;
    }
    a.release {
        transition: background var(--fast);
    }
    a.release:hover {
        background: var(--fill-hover);
    }
    .poster {
        flex: none;
        width: 56px;
        aspect-ratio: 2 / 3;
        border-radius: var(--radius-s);
        overflow: hidden;
        background: var(--elevated-2);
    }
    .poster img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .release-text {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
    }
    .release-name {
        font-weight: 600;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
    }
    .release-sub {
        font-size: 13px;
        color: var(--label-2);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .release-tags {
        font-size: 12px;
        font-weight: 600;
        color: var(--label);
    }
    .release-time {
        flex: none;
        margin-left: auto;
        align-self: flex-start;
        padding-top: 2px;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--label-2);
    }
    /* TV: the page scrolls as a whole (the remote moves through the days and
       the list), inside the TV's safe area. */
    :global(html.tv) .page {
        padding-left: 60px;
        padding-right: 60px;
    }


    /* Narrower windows: the list goes under the month. */
    @media (max-width: 1100px) {
        .page {
            height: auto;
        }
        .layout {
            grid-template-columns: minmax(0, 1fr);
        }
        .cells {
            grid-auto-rows: minmax(92px, auto);
        }
        .side {
            overflow: visible;
        }
    }

    /* Phones: iOS Calendar's month view. Day numbers with dots under them;
       the selected day's releases below. */
    @media (max-width: 700px) {
        .page {
            padding-top: calc(var(--nav-h) + 8px);
            padding-bottom: calc(var(--tabbar-h) + 24px);
        }
        .toolbar {
            align-items: center;
        }
        h1 {
            font-size: var(--text-title2);
        }
        .icon-btn,
        .today-btn {
            min-width: 44px;
            height: 44px;
        }
        .cells {
            grid-auto-rows: auto;
        }
        .weekdays,
        .cells {
            gap: 2px;
        }
        .cell {
            align-items: center;
            min-height: 48px;
            padding: 4px 0;
            background: transparent;
        }
        .cell.selected {
            border-color: transparent;
            background: var(--fill);
        }
        .num {
            margin: 0;
        }
        .chips {
            display: none;
        }
        .dots {
            display: flex;
            gap: 3px;
            margin-top: 3px;
        }
        .dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: var(--label-2);
        }
        .today .dot {
            background: var(--accent-text);
        }
    }
</style>
