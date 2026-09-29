<script lang="ts">
    import type { MetaItem } from '$lib/core/types';
    import { openExternal } from '$lib/links';

    let { meta }: { meta: MetaItem } = $props();

    const byCategory = (cat: string) => meta.links.filter((l) => l.category === cat).map((l) => l.name);

    const genres = $derived(byCategory('Genres'));
    const directors = $derived(byCategory('Directors'));
    const writers = $derived(byCategory('Writers'));
    const cast = $derived(byCategory('Cast'));
    const released = $derived(
        meta.released ? new Date(meta.released).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null
    );

    const imdb = $derived(meta.links.find((l) => l.category === 'imdb') ?? null);
    const seasonsLine = $derived.by(() => {
        const regular = meta.videos.filter((v) => (v.season ?? 0) > 0 && !v.upcoming);
        const seasons = new Set(regular.map((v) => v.season)).size;
        if (!seasons) return null;
        return `${seasons} ${seasons === 1 ? 'season' : 'seasons'} · ${regular.length} ${regular.length === 1 ? 'episode' : 'episodes'}`;
    });

    const rows = $derived(
        [
            ['Genres', genres.join(', ')],
            [directors.length > 1 ? 'Directors' : 'Director', directors.join(', ')],
            [writers.length > 1 ? 'Writers' : 'Writer', writers.join(', ')],
            ['Released', released ?? meta.releaseInfo],
            ['Runtime', meta.runtime],
            ['Seasons', seasonsLine],
        ].filter(([, v]) => v) as [string, string][]
    );

    const initials = (name: string) =>
        name
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0])
            .join('')
            .toUpperCase();
</script>

<aside class="panel" aria-label="Details">
    {#if rows.length || imdb}
        <section class="card">
            <dl>
                {#if imdb}
                    <div>
                        <dt>IMDb</dt>
                        <dd>
                            <button class="link" onclick={() => openExternal(imdb.url)} title="Open on IMDb">
                                ★ {imdb.name}<span class="out" aria-hidden="true">↗</span>
                            </button>
                        </dd>
                    </div>
                {/if}
                {#each rows as [k, v] (k)}
                    <div>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                    </div>
                {/each}
            </dl>
        </section>
    {/if}

    {#if cast.length}
        <section class="card">
            <h3>Cast</h3>
            <ul class="cast">
                {#each cast as name (name)}
                    <li>
                        <a href={`/search?q=${encodeURIComponent(name)}`} title={`Search for ${name}`}>
                            <span class="avatar" aria-hidden="true">{initials(name)}</span>
                            <span class="name">{name}</span>
                        </a>
                    </li>
                {/each}
            </ul>
        </section>
    {/if}
</aside>

<style>
    .panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .card {
        padding: 18px 20px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
    }
    h3 {
        margin: 0 0 12px;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    dl {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    dl div {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 12px;
    }
    dt {
        color: var(--label-2);
        font-size: 13px;
    }
    dd {
        margin: 0;
        font-size: 13px;
    }
    .link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--label);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        border-radius: 4px;
    }
    .link:hover {
        text-decoration: underline;
    }
    .out {
        margin-left: 4px;
        color: var(--label-2);
    }
    .cast {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
        gap: 14px 8px;
    }
    .cast a {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        color: var(--label);
        text-decoration: none;
        text-align: center;
        border-radius: var(--radius);
    }
    .avatar {
        display: grid;
        place-items: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--elevated-2);
        border: 1px solid var(--separator);
        font-weight: 600;
        color: var(--label-2);
        transition:
            background var(--fast),
            color var(--fast);
    }
    .cast a:hover .avatar {
        background: var(--label);
        color: var(--bg);
    }
    .name {
        font-size: var(--text-caption);
        line-height: 1.3;
    }
</style>
