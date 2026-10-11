<script lang="ts">
    // The notifications (lib/notify.svelte.ts): Today, Yesterday and Earlier,
    // newest first, each with the title's poster. Tapping one opens the title
    // and marks it read. In the bell's popover on PC, and its own page on
    // iPhone. Offers to turn system notifications on where the system asks
    // (iPhone), once, until it's answered or put off.
    import { notify, type AppNotification } from '$lib/notify.svelte';
    import { tracker } from '$lib/tracker.svelte';
    import { menu } from '$lib/menu.svelte';
    import { goto } from '$lib/nav';
    import Icon from './Icon.svelte';

    let { onnavigate }: { onnavigate?: () => void } = $props();

    /** Server times without a zone are UTC (SQLite's CURRENT_TIMESTAMP). */
    function parse(iso: string | null) {
        if (!iso) return null;
        const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
        const d = new Date(zoned);
        return isNaN(d.getTime()) ? null : d;
    }
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    function daysAgo(d: Date) {
        return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
    }
    /** "Now", "5m", "3h" today; then "Yesterday", a weekday, a date. */
    function when(iso: string | null, dayOnly = false) {
        const d = parse(iso);
        if (!d) return '';
        const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
        const ago = daysAgo(d);
        if (ago <= 0 && dayOnly) return 'Today';
        if (ago <= 0) return mins < 1 ? 'Now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
        if (ago === 1) return 'Yesterday';
        if (ago < 7) return d.toLocaleDateString([], { weekday: 'long' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    const groups = $derived.by(() => {
        const out: { title: string; items: AppNotification[] }[] = [];
        for (const n of notify.items) {
            const d = parse(n.date);
            const ago = d ? daysAgo(d) : 99;
            const title = ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : 'Earlier';
            let g = out.find((x) => x.title === title);
            if (!g) out.push((g = { title, items: [] }));
            g.items.push(n);
        }
        return out;
    });

    // Turning system notifications on, offered here (iPhone asks once).
    const ASK_KEY = 'notify-ask-later';
    let putOff = $state(readPutOff());
    function readPutOff() {
        try {
            return !!localStorage.getItem(ASK_KEY);
        } catch {
            return false;
        }
    }
    const offer = $derived(notify.systemAvailable === true && notify.prefs.system && notify.permission === 'default' && !putOff);
    function later() {
        putOff = true;
        try {
            localStorage.setItem(ASK_KEY, '1');
        } catch {
            /* it'll offer again next time */
        }
    }

    function open(n: AppNotification) {
        notify.open(n);
        if (n.stremio_id) onnavigate?.();
    }
    function more(e: MouseEvent) {
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { label: 'Mark All as Read', icon: 'check', disabled: !notify.unread, onselect: () => notify.markAllRead() },
                { label: 'Notification Settings', icon: 'gear', onselect: () => (onnavigate?.(), goto('/settings#notifications')) },
                { separator: true },
                { label: 'Clear All', icon: 'trash', destructive: true, disabled: !notify.items.length, onselect: () => notify.clear() },
            ],
            'end'
        );
    }
</script>

<div class="list">
    <header>
        <h2 id="notifications-heading">Notifications</h2>
        <button class="more" aria-label="More" aria-haspopup="menu" aria-expanded="false" onclick={more}><Icon name="more" size={18} /></button>
    </header>

    {#if offer}
        <!-- One quiet line, not a card: what it does, Turn On, and ✕ for not now. -->
        <div class="offer">
            <span>Get notified when new episodes air.</span>
            <button class="turn-on" onclick={() => notify.askPermission()}>Turn On</button>
            <button class="later" aria-label="Not now" title="Not Now" onclick={later}><Icon name="close" size={12} /></button>
        </div>
    {/if}

    {#if !notify.loaded}
        <p class="note" role="status">{tracker.ready || tracker.status === 'checking' ? 'Loading…' : 'Couldn’t connect. Try again in a moment.'}</p>
    {:else if !notify.items.length}
        <div class="empty">
            <span class="empty-icon"><Icon name="bell" size={34} /></span>
            <strong>No Notifications</strong>
            <span>{notify.source === 'stremio' ? 'New episodes of shows in your library show up here.' : 'New episodes and seasons of what you track show up here.'}</span>
        </div>
    {:else}
        {#each groups as g (g.title)}
            <h3>{g.title}</h3>
            <ul>
                {#each g.items as n (n.id)}
                    <li class:unread={n.unread}>
                        <button class="row" onclick={() => open(n)}>
                            <span class="dot" aria-hidden="true"></span>
                            <span class="art">
                                {#if n.poster}<img src={n.poster} alt="" loading="lazy" width="40" height="60" />{:else}<Icon name="film" size={18} />{/if}
                            </span>
                            <span class="body">
                                <span class="top">
                                    <span class="name">{n.title}</span>
                                    <time datetime={parse(n.date)?.toISOString()}>{when(n.date, n.dayOnly)}</time>
                                </span>
                                <span class="text">{n.text}</span>
                            </span>
                            <span class="sr-only">{n.unread ? ', unread' : ''}</span>
                        </button>
                        <button class="dismiss" aria-label="Remove {n.title}" onclick={() => notify.dismiss(n)}><Icon name="close" size={13} /></button>
                    </li>
                {/each}
            </ul>
        {/each}
    {/if}
    {#if notify.loaded && notify.source === 'stremio'}
        <p class="note" role="status">Couldn’t connect. Using backup.</p>
    {:else if notify.loaded && notify.failed}
        <p class="note">Couldn’t update. Showing what was here.</p>
    {/if}
</div>

<style>
    .list {
        display: flex;
        flex-direction: column;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 4px 8px 8px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    h3 {
        margin: 10px 8px 4px;
        font-size: var(--text-caption);
        font-weight: 600;
        color: var(--label-2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .more {
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
    .more:hover,
    .more:global([aria-expanded='true']) {
        background: var(--fill);
        color: var(--label);
    }
    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }
    li {
        position: relative;
        border-radius: var(--radius);
    }
    li:hover {
        background: var(--fill);
    }
    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 8px 36px 8px 8px;
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .row:focus-visible {
        outline: 2px solid var(--label);
        outline-offset: -2px;
    }
    /* Unread: a dot at the left, as Mail's. */
    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        margin-right: -4px;
        border-radius: 50%;
        background: transparent;
    }
    .unread .dot {
        background: var(--accent-text);
    }
    .art {
        flex: none;
        display: grid;
        place-items: center;
        width: 40px;
        height: 60px;
        border-radius: 6px;
        overflow: hidden;
        background: var(--elevated-2);
        color: var(--label-3);
    }
    .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1;
    }
    .top {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }
    .unread .name {
        color: var(--label);
    }
    time {
        flex: none;
        font-size: var(--text-caption);
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
    }
    .text {
        color: var(--label-2);
        font-size: 13px;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .unread .text {
        color: var(--label);
    }
    /* Remove: shown on hover (PC), always there with touch. */
    .dismiss {
        position: absolute;
        top: 50%;
        right: 8px;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        margin-top: -12px;
        border: 0;
        border-radius: 50%;
        background: var(--fill-hover);
        color: var(--label-2);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--fast);
    }
    li:hover .dismiss,
    .dismiss:focus-visible {
        opacity: 1;
    }
    .dismiss:hover {
        color: var(--label);
    }
    @media (pointer: coarse) {
        .dismiss {
            opacity: 1;
            width: 32px;
            height: 32px;
            margin-top: -16px;
            background: transparent;
        }
        li:hover {
            background: transparent;
        }
    }
    .offer {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 0 4px 6px 8px;
        color: var(--label-2);
        font-size: 13px;
    }
    .offer span {
        flex: 1;
        min-width: 0;
    }
    .offer button {
        height: 30px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        cursor: pointer;
    }
    .turn-on {
        padding: 0 10px;
        color: var(--accent-text);
        font-weight: 600;
    }
    .turn-on:hover {
        background: var(--fill);
    }
    .later {
        display: grid;
        place-items: center;
        width: 30px;
        color: var(--label-3);
    }
    .later:hover {
        background: var(--fill);
        color: var(--label);
    }
    .note {
        margin: 8px;
        color: var(--label-2);
        font-size: 13px;
    }
    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 36px 16px;
        text-align: center;
    }
    .empty span:last-child {
        color: var(--label-2);
        font-size: 13px;
    }
    .empty-icon {
        margin-bottom: 2px;
        color: var(--label-3);
    }
    @media (pointer: coarse) {
        .offer button {
            height: 44px;
        }
        .later {
            width: 44px;
        }
    }
</style>
