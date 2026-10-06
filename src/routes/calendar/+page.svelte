<script lang="ts">
    // Calendar: what's coming up, from your Lightboxd (docs/lightboxd.md). New
    // episodes of what you're watching and premieres of what's on your
    // watchlist, in your sub/dub preference, as a list by day: easy to read on
    // a phone and to move through with a TV remote. The tab only shows while
    // Lightboxd is connected and reachable.
    import { untrack } from 'svelte';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { titleHref } from '$lib/links';
    import EmptyState from '$lib/components/EmptyState.svelte';

    type CalendarEvent = {
        /** The release's calendar day, as Lightboxd has it. */
        date: string;
        /** The moment (UTC) when the release has a time of day; null for a date-only release. */
        datetime: string | null;
        name: string;
        /** tt… or kitsu:…, null when Stremio can't find the title. */
        id: string | null;
        type: 'movie' | 'series';
        poster: string | null;
        season: number | null;
        episode: number | null;
        episode_name: string | null;
        kind: 'episode_release' | 'series_premiere' | 'season_premiere' | 'movie_premiere' | string | null;
        track: 'sub' | 'dub' | null;
    };

    const DAYS = 14;
    let events = $state<CalendarEvent[] | null>(null);
    let failed = $state(false);
    let loading = false;

    async function load() {
        if (loading) return;
        loading = true;
        failed = false;
        const res = await lightboxd.request<{ events: CalendarEvent[] }>(`/calendar?days=${DAYS}`);
        loading = false;
        if (res) events = res.events;
        else failed = true;
    }

    // On opening, and again if Lightboxd comes back while this is open.
    // Otherwise a failure waits for Try Again (no retrying in a loop).
    $effect(() => {
        if (lightboxd.ready) untrack(() => events === null && load());
    });

    async function retry() {
        await lightboxd.check();
        if (lightboxd.ready) await load();
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    /** The day in this device's time zone: a release with a time is converted; a plain date stays as it is. */
    function localDay(e: CalendarEvent) {
        const d = e.datetime ? new Date(e.datetime) : null;
        return d && !isNaN(d.getTime()) ? dayKey(d) : e.date;
    }

    function localTime(e: CalendarEvent) {
        const d = e.datetime ? new Date(e.datetime) : null;
        return d && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    }

    function dayLabel(key: string, today: string, tomorrow: string) {
        if (key === today) return 'Today';
        if (key === tomorrow) return 'Tomorrow';
        return new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }

    const days = $derived.by(() => {
        if (!events) return [];
        const now = new Date();
        const today = dayKey(now);
        const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
        const last = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS - 1));
        const groups = new Map<string, CalendarEvent[]>();
        for (const e of events) {
            const key = localDay(e);
            if (key < today || key > last) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }
        return [...groups.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, list]) => ({
                key,
                label: dayLabel(key, today, tomorrow),
                // Date-only releases first (they're out all day), then by time.
                list: list.sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? '')),
            }));
    });

    function detail(e: CalendarEvent) {
        if (e.kind === 'movie_premiere') return 'Movie';
        const ep = e.season != null && e.episode != null ? `S${e.season} E${e.episode}` : null;
        return [ep, e.episode_name].filter(Boolean).join(' · ');
    }

    function tags(e: CalendarEvent) {
        const out: string[] = [];
        if (e.kind === 'series_premiere') out.push('Series Premiere');
        else if (e.kind === 'season_premiere') out.push('Season Premiere');
        else if (e.kind === 'movie_premiere') out.push('Premiere');
        if (e.track) out.push(e.track === 'dub' ? 'Dub' : 'Sub');
        return out;
    }
</script>

<svelte:head><title>Calendar · Stremio</title></svelte:head>

<div class="page">
    <header>
        <h1>Calendar</h1>
        <p class="lede">From Lightboxd: new episodes of what you’re watching and premieres from your watchlist, for the next two weeks.</p>
    </header>

    {#if !lightboxd.saved?.token}
        <EmptyState icon="calendar" title="Connect Lightboxd">
            <p>Your calendar comes from Lightboxd. Connect it in Settings.</p>
            <a class="action" href="/settings">Open Settings</a>
        </EmptyState>
    {:else if failed || (lightboxd.status !== 'ok' && lightboxd.status !== 'checking')}
        <EmptyState icon="calendar" title="Can’t reach Lightboxd">
            <p>Check that it’s running. The calendar shows up again once it’s back.</p>
            <button onclick={retry}>Try Again</button>
        </EmptyState>
    {:else if events === null}
        <p class="loading" role="status">Loading…</p>
    {:else if days.length === 0}
        <EmptyState icon="calendar" title="Nothing coming up">
            <p>Nothing you’re watching or have on your watchlist airs in the next two weeks.</p>
        </EmptyState>
    {:else}
        {#each days as day (day.key)}
            <section>
                <h2>{day.label}</h2>
                <ul class="group">
                    {#each day.list as e, i (`${e.id ?? e.name}:${e.season}:${e.episode}:${i}`)}
                        {@const time = localTime(e)}
                        <li>
                            <svelte:element this={e.id ? 'a' : 'div'} class="item" href={e.id ? titleHref(e.type, e.id) : undefined}>
                                <div class="poster">
                                    {#if e.poster}<img src={e.poster} alt="" loading="lazy" />{/if}
                                </div>
                                <div class="text">
                                    <span class="name">{e.name}</span>
                                    {#if detail(e)}<span class="detail">{detail(e)}</span>{/if}
                                </div>
                                <div class="meta">
                                    {#if time}<span class="time">{time}</span>{/if}
                                    {#each tags(e) as tag (tag)}<span class="tag">{tag}</span>{/each}
                                </div>
                            </svelte:element>
                        </li>
                    {/each}
                </ul>
            </section>
        {/each}
    {/if}
</div>

<style>
    .page {
        max-width: 880px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 24px) var(--gutter) 56px;
    }
    header {
        margin-bottom: 24px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .lede {
        margin: 6px 0 0;
        color: var(--label-2);
    }
    section + section {
        margin-top: 24px;
    }
    h2 {
        margin: 0 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    .group {
        margin: 0;
        padding: 0;
        list-style: none;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        overflow: hidden;
    }
    li + li {
        border-top: 1px solid var(--separator);
    }
    .item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 10px 16px;
        color: inherit;
        text-decoration: none;
    }
    a.item {
        transition: background var(--fast);
    }
    a.item:hover {
        background: var(--fill);
    }
    a.item:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: -2px;
    }
    .poster {
        flex: none;
        width: 40px;
        aspect-ratio: 2 / 3;
        border-radius: 6px;
        overflow: hidden;
        background: var(--fill);
    }
    .poster img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .name {
        font-weight: 600;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .detail {
        font-size: 13px;
        color: var(--label-2);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .meta {
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .time {
        font-size: 13px;
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
    }
    .tag {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--fill);
        font-size: 11px;
        font-weight: 600;
        color: var(--label-2);
    }
    .loading {
        color: var(--label-2);
    }
    .action {
        display: inline-block;
        margin-top: 4px;
        color: var(--accent-hover);
        font-weight: 600;
        text-decoration: none;
    }
    @media (max-width: 560px) {
        .meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
        }
    }
</style>
