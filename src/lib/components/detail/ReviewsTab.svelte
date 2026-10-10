<script lang="ts">
    // A title page's Reviews tab, from Lightboxd. Aggregate: the reviews it
    // gathers (TMDb, Trakt, AniList); Friends: your friends' (as each shares
    // them; rated-only ones on one line); You: your score and review, and each
    // watch (opens it to edit). The scores are in the tab bar on wide windows,
    // here on narrow ones.
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import { isTV } from '$lib/platform';
    import { day, score, type Reviews, type Watch } from '$lib/lightboxd/api';

    let {
        name,
        scores,
        reviews,
        myScore,
        myReview,
        watches,
        seasons = [],
        onrate,
        oneditwatch,
    }: {
        name: string;
        scores: { label: string; value: string }[];
        /** null while they load. */
        reviews: Reviews | null;
        myScore: number | null;
        myReview: string | null;
        watches: Watch[];
        /** An anime in seasons: each scored on its own (else empty). */
        seasons?: { titleId: number; name: string; score: number | null; review: string | null; watches: Watch[] }[];
        /** Rate this title, or (in seasons) the season with this id. */
        onrate: (titleId?: number) => void;
        oneditwatch: (id: number) => void;
    } = $props();

    type Card = { key: string; author: string; avatar: string | null; date: string | null; sort: string; score: number | null; body: string | null; source?: string };

    const SOURCES: Record<string, string> = { tmdb: 'TMDb', trakt: 'Trakt', anilist: 'AniList' };
    const aggregate = $derived<Card[]>(
        (reviews?.aggregate ?? []).map((r, i) => ({
            key: `a${i}`,
            author: r.author,
            avatar: null,
            date: day(r.date),
            sort: r.date ?? '',
            score: r.rating,
            body: r.body,
            source: SOURCES[r.source?.toLowerCase()] ?? r.source,
        }))
    );
    const friendCards = $derived<Card[]>(
        (reviews?.friends ?? []).map((f) => ({
            key: `f${f.handle}`,
            author: f.name,
            // A video avatar (Lightboxd allows them) shows as the initial.
            avatar: f.avatar && !/\.(webm|mov|mp4)$/i.test(f.avatar) ? f.avatar : null,
            date: day(f.date),
            sort: f.date ?? '',
            score: f.rating,
            body: f.review,
        }))
    );
    const written = $derived(friendCards.filter((f) => f.body));
    const ratedOnly = $derived(friendCards.filter((f) => !f.body && f.score != null));

    const tabs = ['Aggregate', 'Friends', 'You'] as const;
    let tab = $state<(typeof tabs)[number]>('Aggregate');
    const counts = $derived({
        Aggregate: aggregate.length,
        Friends: friendCards.length,
        You: seasons.length ? seasons.reduce((n, s) => n + s.watches.length, 0) : watches.length,
    });

    let sort = $state<'newest' | 'highest'>('newest');
    const sorted = $derived(
        sort === 'newest'
            ? [...aggregate].sort((a, b) => b.sort.localeCompare(a.sort))
            : [...aggregate].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    );

    let expanded = $state<Set<string>>(new Set());
    const toggle = (k: string) => {
        const next = new Set(expanded);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        expanded = next;
    };
</script>

{#snippet avatar(c: { author: string; avatar: string | null }, small = false)}
    <span class="avatar" class:small aria-hidden="true">
        {#if c.avatar}<img src={c.avatar} alt="" />{:else}{(c.author.trim()[0] ?? '?').toUpperCase()}{/if}
    </span>
{/snippet}

{#snippet card(r: Card)}
    <!-- TV only: a stop for the remote, so the page scrolls to each card. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <article class="review" tabindex={isTV ? 0 : undefined}>
        <header>
            {@render avatar(r)}
            <div class="who">
                <p class="name">{r.author}</p>
                {#if r.date}<p class="meta">{r.date}</p>{/if}
            </div>
            {#if r.score != null}<p class="score">{score(r.score)}<span>/10</span></p>{/if}
        </header>
        <p class="body" class:open={expanded.has(r.key)}>{r.body}</p>
        {#if (r.body?.length ?? 0) > 180}
            <button class="more" onclick={() => toggle(r.key)}>{expanded.has(r.key) ? 'Less' : 'More'}</button>
        {/if}
        {#if r.source}<footer>{r.source}</footer>{/if}
    </article>
{/snippet}

<div class="reviews">
    {#if scores.length}
        <dl class="scores">
            {#each scores as s (s.label)}
                <div>
                    <dd>{s.value}</dd>
                    <dt>{s.label}</dt>
                </div>
            {/each}
        </dl>
    {/if}

    <div class="bar">
        <div class="segmented" role="radiogroup" aria-label="Reviews">
            {#each tabs as t (t)}
                <button role="radio" aria-checked={tab === t} class:on={tab === t} onclick={() => (tab = t)}>
                    {t}{#if counts[t]}<span class="count">{counts[t]}</span>{/if}
                </button>
            {/each}
        </div>
        {#if tab === 'Aggregate' && aggregate.length > 1}
            <PopupButton
                label="Sort"
                bind:value={sort}
                options={[
                    { value: 'newest', label: 'Newest' },
                    { value: 'highest', label: 'Highest Score' },
                ]}
            />
        {/if}
    </div>

    {#if tab === 'Aggregate'}
        {#if !reviews}
            <p class="empty-note" role="status">Loading reviews…</p>
        {:else if !aggregate.length}
            <p class="empty-note">No reviews for {name} yet.</p>
        {:else}
            <div class="grid">
                {#each sorted as r (r.key)}{@render card(r)}{/each}
            </div>
            <p class="note">From aggregated sources.</p>
        {/if}
    {:else if tab === 'Friends'}
        {#if !reviews}
            <p class="empty-note" role="status">Loading reviews…</p>
        {:else if !friendCards.length}
            <p class="empty-note">None of your friends have shared a score for {name}.</p>
        {:else}
            {#if written.length}
                <div class="grid">
                    {#each written as r (r.key)}{@render card(r)}{/each}
                </div>
            {/if}
            {#if ratedOnly.length}
                <div class="also">
                    <span class="also-label">Also Rated</span>
                    {#each ratedOnly as f (f.key)}
                        <span class="also-item">
                            {@render avatar(f, true)}
                            {f.author}
                            <strong>{score(f.score!)}</strong>
                        </span>
                    {/each}
                </div>
            {/if}
        {/if}
    {:else if seasons.length}
        <div class="you">
            {#each seasons as s (s.titleId)}
                <article class="review mine">
                    <header>
                        <div class="who">
                            <p class="name">{s.name}</p>
                            {#if s.watches[0]?.date}<p class="meta">{day(s.watches[0].date)}</p>{/if}
                        </div>
                        {#if s.score != null}<p class="score big">{score(s.score)}<span>/10</span></p>{/if}
                    </header>
                    {#if s.review}<p class="body open">{s.review}</p>{:else}<p class="body muted">{s.score != null ? 'Rated without a review.' : 'Not rated yet.'}</p>{/if}
                    {#if s.watches.length}
                        <ul class="season-watches">
                            {#each s.watches as w (w.id)}
                                <li>
                                    <button class="watch" onclick={() => oneditwatch(w.id)} title="Edit Watch">
                                        <span>{day(w.date) ?? 'Date unknown'}</span>
                                        <span class="kind">{w.rewatch ? 'Rewatch' : 'Watch'}</span>
                                        <strong>{w.rating != null ? score(w.rating) : '—'}</strong>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <div class="actions">
                        <button class="btn" class:primary={s.score == null} onclick={() => onrate(s.titleId)}>{s.score != null ? 'Edit' : 'Rate'}</button>
                    </div>
                </article>
            {/each}
        </div>
    {:else}
        <div class="you">
            <article class="review mine">
                {#if myScore != null}
                    <header>
                        <div class="who">
                            <p class="name">Your Review</p>
                            {#if watches[0]?.date}<p class="meta">{day(watches[0].date)}</p>{/if}
                        </div>
                        <p class="score big">{score(myScore)}<span>/10</span></p>
                    </header>
                    {#if myReview}<p class="body open">{myReview}</p>{:else}<p class="body muted">Rated without a review.</p>{/if}
                    <div class="actions"><button class="btn" onclick={() => onrate()}>Edit</button></div>
                {:else}
                    <p class="name">You haven’t rated {name} yet.</p>
                    <p class="body muted">Your friends see your score and review, as your sharing settings allow.</p>
                    <div class="actions"><button class="btn primary" onclick={() => onrate()}>Rate</button></div>
                {/if}
            </article>

            {#if watches.length}
                <section class="watches" aria-labelledby="your-watches">
                    <h3 id="your-watches">Your Watches</h3>
                    <ul>
                        {#each watches as w (w.id)}
                            <li>
                                <button class="watch" onclick={() => oneditwatch(w.id)} title="Edit Watch">
                                    <span>{day(w.date) ?? 'Date unknown'}</span>
                                    <span class="kind">{w.rewatch ? 'Rewatch' : 'Watch'}</span>
                                    <strong>{w.rating != null ? score(w.rating) : '—'}</strong>
                                </button>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/if}
        </div>
    {/if}
</div>

<style>
    /* Scrolls inside the column, like the episode list. */
    .reviews {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 24px;
    }
    .scores {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 36px;
        margin: 0 0 18px;
    }
    .scores dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .scores dt {
        font-size: 12px;
        color: var(--label-2);
    }
    /* Wide windows show the scores above the Details column instead. */
    @media (min-width: 1001px) {
        .scores {
            display: none;
        }
    }
    .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
    }
    .segmented {
        display: inline-flex;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .segmented button {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--label-2);
        font-weight: 500;
        cursor: pointer;
        transition: background var(--fast), color var(--fast);
    }
    .segmented button:hover {
        color: var(--label);
    }
    .segmented button.on {
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    }
    .count {
        font-size: 12px;
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
    }
    /* Cards in a row share a height, so the grid reads as rows, not a scatter. */
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr));
        gap: 16px;
    }
    .review {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
        padding: 16px 18px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
    }
    .review header {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .who {
        flex: 1;
        min-width: 0;
    }
    p {
        margin: 0;
    }
    .name {
        font-weight: 600;
    }
    .meta {
        font-size: 12px;
        color: var(--label-2);
    }
    .score {
        flex: none;
        align-self: flex-start;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 700;
        line-height: 1;
        font-variant-numeric: tabular-nums;
    }
    .score span {
        margin-left: 2px;
        font-size: 12px;
        font-weight: 500;
        color: var(--label-3);
    }
    .score.big {
        font-size: var(--text-title2);
    }
    .avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--elevated-2);
        border: 1px solid var(--separator);
        font-size: 14px;
        font-weight: 600;
        color: var(--label-2);
    }
    .avatar {
        overflow: hidden;
    }
    .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .empty-note {
        margin: 8px 0 0;
        color: var(--label-2);
    }
    .avatar.small {
        width: 22px;
        height: 22px;
        font-size: 11px;
    }
    .body {
        font-size: var(--text-callout);
        line-height: 1.5;
        color: rgb(244 244 246 / 0.85);
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .body.open {
        -webkit-line-clamp: unset;
        line-clamp: unset;
    }
    .muted {
        color: var(--label-2);
    }
    .more {
        align-self: flex-start;
        min-height: 28px;
        margin: -8px 0 -4px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .review footer {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--separator);
        font-size: 12px;
        color: var(--label-2);
    }
    .note {
        margin-top: 16px;
        font-size: 12px;
        color: var(--label-2);
    }
    .also {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 20px;
        margin-top: 16px;
        padding: 12px 18px;
        border-radius: var(--radius-l);
        border: 1px solid var(--separator);
        font-size: 13px;
    }
    .also-label {
        color: var(--label-2);
    }
    .also-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
    }
    .also-item strong {
        font-variant-numeric: tabular-nums;
    }
    .you {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr));
        gap: 16px;
        align-items: start;
    }
    .actions {
        display: flex;
        gap: 8px;
    }
    .btn {
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 8px;
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .btn:hover {
        background: var(--fill-hover);
    }
    .btn.primary {
        border-color: transparent;
        background: var(--label);
        color: var(--bg);
    }
    .watches {
        padding: 16px 18px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
    }
    .watches h3 {
        margin: 0 0 8px;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .season-watches {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--separator);
    }
    .season-watches li + li {
        border-top: 1px solid var(--separator);
    }
    .season-watches .kind {
        flex: 1;
        color: var(--label-2);
    }
    .season-watches strong {
        font-variant-numeric: tabular-nums;
    }
    .watches ul {
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .watch {
        all: unset;
        box-sizing: border-box;
        display: flex;
        gap: 12px;
        width: 100%;
        padding: 8px 0;
        font-size: 13px;
        cursor: pointer;
    }
    .watch:hover .kind {
        color: var(--label);
    }
    .watches li + li {
        border-top: 1px solid var(--separator);
    }
    .watches .kind {
        flex: 1;
        color: var(--label-2);
    }
    .watches strong {
        font-variant-numeric: tabular-nums;
    }
    @media (max-width: 700px) {
        .reviews {
            overflow: visible;
        }
        .bar {
            flex-wrap: wrap;
        }
        .segmented {
            display: flex;
            width: 100%;
        }
        .segmented button {
            flex: 1;
            justify-content: center;
        }
    }
    @media (pointer: coarse) {
        .btn,
        .segmented button {
            height: 44px;
            padding: 0 18px;
        }
        .more {
            min-height: 44px;
        }
    }
    :global(html.tv) .reviews {
        overflow: visible;
    }
    /* TV: the focused card lifts and rings, as poster cards do. */
    :global(html.tv) .review {
        transition: transform var(--fast) var(--ease), box-shadow var(--fast) var(--ease);
    }
    :global(html.tv) .review:focus {
        outline: none;
        transform: scale(1.03);
        box-shadow: 0 0 0 3px var(--label), 0 18px 40px rgb(0 0 0 / 0.5);
    }
</style>
