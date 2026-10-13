<script lang="ts">
    // Reports (admins only; Settings > Account > Reports): reviews and
    // profiles people reported, oldest first. Each: what was reported, by whom
    // and why. Hide Review takes a review's text down (its score stays; the
    // writer still sees it); Dismiss when nothing's wrong. Grouped cards, as
    // Friends and Settings.
    import { tracker } from '$lib/tracker.svelte';
    import { lb, score, type Report } from '$lib/tracker/api';
    import EmptyState from '$lib/components/EmptyState.svelte';

    let reports = $state<Report[] | null>(null);
    let failed = $state(false);
    let busy = $state<number | null>(null);
    // Staff: mods and admins.
    const admin = $derived(!!(tracker.saved?.user?.is_staff ?? tracker.saved?.user?.is_admin));

    $effect(() => {
        if (tracker.ready && admin && reports === null)
            lb.adminReports().then((res) => {
                if (res) reports = res.reports;
                else failed = true;
            });
    });

    async function resolve(r: Report, action: 'dismiss' | 'hide_review') {
        busy = r.id;
        const res = await lb.resolveReport(r.id, action);
        busy = null;
        if (res) reports = res.reports;
        else failed = true;
    }
    const when = (s: string) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
</script>

<svelte:head><title>Reports · Stremio</title></svelte:head>

<div class="page">
    <h1>Reports</h1>

    {#if !tracker.ready}
        <EmptyState icon="info" title="Couldn’t connect"><p>Reports come back as soon as it does.</p></EmptyState>
    {:else if !admin}
        <EmptyState icon="info" title="Reports"><p>Only admins see reports.</p></EmptyState>
    {:else if reports === null}
        <p class="loading" role="status">{failed ? 'Couldn’t load reports. Try again in a moment.' : 'Loading…'}</p>
    {:else if !reports.length}
        <EmptyState icon="check" title="Nothing to look at"><p>Reported reviews and profiles show here.</p></EmptyState>
    {:else}
        {#if failed}<p class="loading" role="alert">That didn’t work. Try again in a moment.</p>{/if}
        <div class="list">
            {#each reports as r (r.id)}
                <article class="group">
                    <header class="row head">
                        <div>
                            <div class="title">
                                {r.kind === 'review' ? `Review of ${r.review?.title ?? 'a title'}` : 'Profile'}
                                by <a href={`/u/${(r.user.handle ?? '').replace(/^@/, '')}`}>{r.user.name || r.user.handle}</a>
                                <span class="handle">{r.user.handle}</span>
                            </div>
                            <div class="sub">Reported by {r.reporter} · {when(r.created_at)}{r.reason ? ` · “${r.reason}”` : ''}</div>
                        </div>
                    </header>
                    <div class="row body">
                        {#if r.review}
                            <p>
                                {#if r.review.rating != null}<strong>{score(r.review.rating)}/10</strong>{/if}
                                {r.review.text || 'No text.'}
                            </p>
                        {:else}
                            <p>{r.user.bio || 'No bio.'}</p>
                        {/if}
                    </div>
                    <footer class="row actions">
                        <button class="btn" disabled={busy === r.id} onclick={() => resolve(r, 'dismiss')}>Dismiss</button>
                        {#if r.review}
                            <button class="btn destructive" disabled={busy === r.id} onclick={() => resolve(r, 'hide_review')}>Hide Review</button>
                        {/if}
                    </footer>
                </article>
            {/each}
        </div>
    {/if}
</div>

<style>
    .page {
        max-width: 760px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 28px) var(--gutter) 64px;
    }
    h1 {
        margin: 0 0 24px;
        font-family: var(--font-display);
        font-size: clamp(28px, 3vw, 36px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .group {
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated);
        overflow: hidden;
    }
    .row {
        padding: 12px 16px;
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .title {
        font-weight: 600;
    }
    .title a {
        color: inherit;
    }
    .handle,
    .sub {
        color: var(--label-2);
        font-size: var(--text-caption);
        font-weight: 400;
    }
    .handle {
        margin-left: 4px;
    }
    .sub {
        margin-top: 2px;
    }
    .body p {
        margin: 0;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .body strong {
        margin-right: 6px;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .btn {
        height: 34px;
        padding: 0 16px;
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        background: var(--glass);
        color: var(--label);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .btn:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .btn.destructive {
        color: var(--bad-text);
    }
    .btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .loading {
        margin: 8px 4px 0;
        color: var(--label-2);
    }
    @media (pointer: coarse) {
        .btn {
            height: 44px;
        }
    }
</style>
