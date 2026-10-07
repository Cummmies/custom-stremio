<script lang="ts">
    // Your Lightboxd on a title page (docs/lightboxd.md): status, episode count,
    // your score, and friends' reviews (as each friend shares them), with Add to
    // Watchlist and Rate. Shown only while Lightboxd is connected and reachable;
    // an anime whose seasons are separate titles in Lightboxd gets one each.
    import { lightboxd } from '$lib/lightboxd.svelte';
    import ScoreSlider from '$lib/components/ScoreSlider.svelte';
    import ReviewField from '$lib/components/ReviewField.svelte';

    let { id, type, name }: { id: string; type: string; name: string } = $props();

    type Friend = {
        friend_name: string;
        friend_handle: string;
        friend_avatar: string;
        rating: number | null;
        review: string | null;
        watch_date: string | null;
    };
    type Summary = {
        title_id: number;
        name: string;
        kind: 'movie' | 'show';
        status: 'watching' | 'plan_to_watch' | 'dropped' | 'completed' | null;
        progress: number | null;
        episodes: number | null;
        rating: number | null;
        review: string | null;
        /** A rewatch: your score from an earlier watch (Lightboxd scores each watch). */
        earlier_rating?: number | null;
        watches: number;
        last_watched: string | null;
        can_rate: boolean;
        friends: Friend[];
    };

    const supported = $derived(/^(tt\d+|kitsu:\d+)$/.test(id) && (type === 'movie' || type === 'series'));
    let titles = $state<Summary[] | null>(null);
    let loadedFor = '';
    let busy = $state(false);
    let error = $state<string | null>(null);
    /** The title whose score row is open. */
    let rating = $state<number | null>(null);
    /** The score on its slider: your current one, the last watch's, or Lightboxd's starting 5. */
    let draft = $state(5);
    let draftReview = $state('');

    function toggleRating(t: Summary) {
        draft = t.rating ?? t.earlier_rating ?? 5;
        draftReview = t.review ?? '';
        rating = rating === t.title_id ? null : t.title_id;
    }

    // Load for this title once Lightboxd is reachable (again after switching titles).
    $effect(() => {
        const key = `${id}`;
        if (!lightboxd.ready || !supported || loadedFor === key) return;
        loadedFor = key;
        titles = null;
        error = null;
        rating = null;
        lightboxd.request<{ titles: Summary[] }>(`/titles/${encodeURIComponent(id)}`).then((res) => {
            if (loadedFor === key && res) titles = res.titles;
        });
    });

    // Rated or logged in Lightboxd meanwhile (on the web, your phone): pick it
    // up when you come back to the app, and every minute while it's open (the
    // TV never loses focus). Not while you're editing, or mid-save.
    const REFRESH_MS = 60_000;
    function refresh() {
        const key = loadedFor;
        if (!key || !titles || busy || rating !== null || document.visibilityState !== 'visible') return;
        lightboxd.request<{ titles: Summary[] }>(`/titles/${encodeURIComponent(key)}`).then((res) => {
            if (loadedFor === key && res && rating === null && !busy) titles = res.titles;
        });
    }
    $effect(() => {
        if (!lightboxd.ready || !supported) return;
        const timer = setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    });

    async function addToWatchlist() {
        busy = true;
        error = null;
        const res = await lightboxd.request<{ titles: Summary[] }>('/watchlist', { method: 'POST', body: { id, type, name }, timeout: 30_000 });
        busy = false;
        if (res) titles = res.titles;
        else error = 'Couldn’t add it. Lightboxd may not know this title.';
    }

    async function rate(title: Summary, score: number, review: string) {
        busy = true;
        error = null;
        const res = await lightboxd.request<{ title: Summary }>(`/titles/${title.title_id}/rating`, {
            method: 'POST',
            body: { rating: score, review: review.trim() },
        });
        busy = false;
        if (res && titles) {
            titles = titles.map((t) => (t.title_id === title.title_id ? res.title : t));
            rating = null;
        } else error = 'Couldn’t save the score.';
    }

    function statusLine(t: Summary) {
        switch (t.status) {
            case 'watching':
                return t.episodes ? `Watching · ${t.progress ?? 0} of ${t.episodes} episodes` : `Watching${t.progress ? ` · ${t.progress} episodes` : ''}`;
            case 'plan_to_watch':
                return 'On your watchlist';
            case 'dropped':
                return 'Dropped';
            case 'completed':
                return t.watches > 1 ? `Watched ${t.watches} times` : 'Watched';
            default:
                return 'Not on your list';
        }
    }

    const fmtDate = (d: string | null) =>
        d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : null;
    const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
    const score = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
</script>

{#if lightboxd.ready && supported && titles}
    <section class="card" aria-label="Lightboxd">
        <h3>Lightboxd</h3>
        {#if titles.length === 0}
            <p class="line">Not in your Lightboxd yet.</p>
            <button class="btn" disabled={busy} onclick={addToWatchlist}>{busy ? 'Adding…' : 'Add to Watchlist'}</button>
        {:else}
            {#each titles as t (t.title_id)}
                <div class="title">
                    {#if titles.length > 1}<p class="name">{t.name}</p>{/if}
                    <p class="line">
                        {statusLine(t)}{#if t.last_watched}{' · '}{fmtDate(t.last_watched)}{/if}
                    </p>
                    {#if t.rating != null}<p class="line">Your score: <strong>{score(t.rating)}</strong> / 10</p>
                    {:else if t.earlier_rating != null}<p class="line">Last time: <strong>{score(t.earlier_rating)}</strong> / 10</p>{/if}
                    {#if t.review && rating !== t.title_id}<p class="mine">{t.review}</p>{/if}
                    <div class="actions">
                        {#if t.status === null}
                            <button class="btn" disabled={busy} onclick={addToWatchlist}>Add to Watchlist</button>
                        {/if}
                        {#if t.can_rate}
                            <button class="btn" disabled={busy} onclick={() => toggleRating(t)}>
                                {t.rating != null ? 'Edit Rating' : 'Rate'}
                            </button>
                        {/if}
                    </div>
                    {#if rating === t.title_id}
                        <div class="scores">
                            <ScoreSlider bind:value={draft} disabled={busy} onsubmit={() => rate(t, draft, draftReview)} />
                            <ReviewField bind:value={draftReview} disabled={busy} onsubmit={() => rate(t, draft, draftReview)} />
                            <div class="actions">
                                <button class="btn" disabled={busy} onclick={() => (rating = null)}>Cancel</button>
                                <button class="btn primary" disabled={busy} onclick={() => rate(t, draft, draftReview)}>{busy ? 'Saving…' : 'Save'}</button>
                            </div>
                        </div>
                    {/if}
                    {#if t.friends.length}
                        <ul class="friends" aria-label="Friends">
                            {#each t.friends as f (f.friend_handle)}
                                <li>
                                    <span class="avatar" aria-hidden="true">
                                        {#if f.friend_avatar && !/\.(webm|mov|mp4)$/i.test(f.friend_avatar)}<img src={f.friend_avatar} alt="" />{:else}{initial(f.friend_name)}{/if}
                                    </span>
                                    <div class="friend">
                                        <p class="friend-head">
                                            <span class="friend-name">{f.friend_name}</span>
                                            {#if f.rating != null}<span class="friend-score">★ {score(f.rating)}</span>{/if}
                                            {#if f.watch_date}<span class="friend-date">{fmtDate(f.watch_date)}</span>{/if}
                                        </p>
                                        {#if f.review}<p class="review">{f.review}</p>{/if}
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/each}
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
    </section>
{/if}

<style>
    .card {
        padding: 12px 16px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
    }
    h3 {
        margin: 0 0 8px;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .title + .title {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--separator);
    }
    p {
        margin: 0;
    }
    .name {
        font-weight: 600;
        margin-bottom: 2px;
    }
    .line {
        font-size: 13px;
        color: var(--label-2);
    }
    .line strong {
        color: var(--label);
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }
    .actions:empty {
        display: none;
    }
    .btn {
        height: 30px;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: 8px;
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .card > .btn {
        margin-top: 8px;
    }
    .btn:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .btn.primary {
        border-color: transparent;
        background: var(--label);
        color: var(--bg);
    }
    .btn.primary:hover:not(:disabled) {
        background: var(--label-2);
    }
    .btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .scores {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        --score-fill: var(--label);
        --review-bg: var(--fill);
        --review-border: var(--separator);
        --review-placeholder: var(--label-3);
    }
    .scores .actions {
        margin-top: 0;
        justify-content: flex-end;
    }
    .mine {
        margin-top: 4px;
        font-size: 13px;
        color: var(--label);
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: pre-line;
    }
    .friends {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .friends li {
        display: flex;
        gap: 10px;
    }
    .avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        overflow: hidden;
        background: var(--elevated-2);
        border: 1px solid var(--separator);
        font-size: 12px;
        font-weight: 600;
        color: var(--label-2);
    }
    .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .friend {
        min-width: 0;
    }
    .friend-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 8px;
        font-size: 13px;
    }
    .friend-name {
        font-weight: 600;
    }
    .friend-score {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .friend-date {
        color: var(--label-2);
        font-size: 12px;
    }
    .review {
        margin-top: 2px;
        font-size: 13px;
        color: var(--label-2);
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: pre-line;
    }
    .error {
        margin-top: 8px;
        font-size: 13px;
        color: var(--bad);
    }
    /* Touch: 44 pt targets. */
    @media (pointer: coarse) {
        .btn {
            height: 44px;
            padding: 0 16px;
        }
    }
</style>
