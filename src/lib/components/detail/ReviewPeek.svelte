<script lang="ts">
    // Last in the Details column (Cast, Details, Reviews): your friends'
    // reviews, then the ones the tracker gathers, filling the column's remaining
    // height: as many as fit, fading out at the bottom. See All opens the
    // Reviews tab. Not shown until there's at least one.
    import { day, score, type Reviews } from '$lib/tracker/api';

    let { reviews, onseeall }: { reviews: Reviews; onseeall: () => void } = $props();

    const SOURCES: Record<string, string> = { tmdb: 'TMDb', trakt: 'Trakt', anilist: 'AniList' };
    const items = $derived([
        ...reviews.friends
            .filter((f) => f.review)
            .map((f) => ({ key: `f${f.handle}`, name: f.name, score: f.rating, date: day(f.date), body: f.review! })),
        ...reviews.aggregate.slice(0, 8).map((r, i) => ({
            key: `a${i}`,
            name: r.author,
            score: r.rating,
            date: [SOURCES[r.source?.toLowerCase()] ?? r.source, day(r.date)].filter(Boolean).join(' · '),
            body: r.body,
        })),
    ]);
</script>

{#if items.length}
    <section class="card" aria-labelledby="peek-title">
        <div class="top">
            <h3 id="peek-title">Reviews</h3>
            <button class="all" onclick={onseeall}>See All</button>
        </div>
        <ul>
            {#each items as f (f.key)}
                <li>
                    <p class="head">
                        <span class="avatar" aria-hidden="true">{(f.name.trim()[0] ?? '?').toUpperCase()}</span>
                        <span class="name">{f.name}</span>
                        {#if f.score != null}<span class="score">{score(f.score)}</span>{/if}
                        {#if f.date}<span class="date">{f.date}</span>{/if}
                    </p>
                    <p class="body">{f.body}</p>
                </li>
            {/each}
        </ul>
    </section>
{/if}

<style>
    .card {
        flex: 1 0 200px;
        display: flex;
        flex-direction: column;
        min-height: 200px;
        margin-top: 12px;
        padding: 12px 16px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
    }
    .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
    }
    h3 {
        margin: 0;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .all {
        min-height: 28px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--label);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
    }
    .all:hover {
        color: var(--label-2);
    }
    @media (pointer: coarse) {
        .all {
            min-height: 44px;
        }
    }
    ul {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        list-style: none;
        margin: 0;
        padding: 0;
        -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 56px), transparent);
        mask-image: linear-gradient(to bottom, black calc(100% - 56px), transparent);
    }
    li + li {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--separator);
    }
    p {
        margin: 0;
    }
    .head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
    }
    .avatar {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--elevated-2);
        border: 1px solid var(--separator);
        font-size: 11px;
        font-weight: 600;
        color: var(--label-2);
    }
    .name,
    .score {
        font-weight: 600;
    }
    .score {
        font-variant-numeric: tabular-nums;
    }
    .date {
        margin-left: auto;
        font-size: 12px;
        color: var(--label-2);
    }
    .body {
        margin-top: 6px;
        font-size: 13px;
        line-height: 1.45;
        color: var(--label-2);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
</style>
