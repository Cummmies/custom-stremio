<script lang="ts">
    // A title's Cast and Details. With Lightboxd, your status and lists are
    // rows like any other. IMDb is in the scores above, genres and runtime in
    // the tags under the title: nothing here repeats them.
    import type { MetaItem } from '$lib/core/types';

    let { meta, status = null, lists = [] }: { meta: MetaItem; status?: string | null; lists?: string[] } = $props();

    const byCategory = (cat: string) => meta.links.filter((l) => l.category === cat).map((l) => l.name);

    const directors = $derived(byCategory('Directors'));
    const writers = $derived(byCategory('Writers'));
    const cast = $derived(byCategory('Cast'));
    const released = $derived(
        meta.released ? new Date(meta.released).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null
    );

    const seasonsLine = $derived.by(() => {
        const regular = meta.videos.filter((v) => (v.season ?? 0) > 0 && !v.upcoming);
        const seasons = new Set(regular.map((v) => v.season)).size;
        if (!seasons) return null;
        return `${seasons} ${seasons === 1 ? 'season' : 'seasons'} · ${regular.length} ${regular.length === 1 ? 'episode' : 'episodes'}`;
    });

    const rows = $derived(
        [
            ['Status', status],
            ['Lists', lists.join(', ')],
            [directors.length > 1 ? 'Directors' : 'Director', directors.join(', ')],
            [writers.length > 1 ? 'Writers' : 'Writer', writers.join(', ')],
            ['Released', released ?? meta.releaseInfo],
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

    {#if rows.length}
        <section class="card">
            <dl>
                {#each rows as [k, v] (k)}
                    <div>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                    </div>
                {/each}
            </dl>
        </section>
    {/if}
</aside>

<style>
    .panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
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
    dl {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
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
    /* Desktop: the cast is one row that scrolls sideways, so Details and Cast both
       fit beside the episodes without the column scrolling. (Phones scroll the
       page; the TV's remote moves through a grid.) */
    @media (min-width: 701px) {
        :global(html:not(.tv)) .cast {
            display: flex;
            overflow-x: auto;
            overscroll-behavior-x: contain;
            scrollbar-width: thin;
            padding-bottom: 4px;
        }
        :global(html:not(.tv)) .cast li {
            flex: none;
            width: 76px;
        }
        /* Spaced with margins, not gap: the TV build rewrites gap for old TVs,
           which a :global() selector breaks (scripts/tv-legacy-css.mjs). */
        :global(html:not(.tv)) .cast li + li {
            margin-left: 6px;
        }
        :global(html:not(.tv)) .avatar {
            width: 46px;
            height: 46px;
        }
        :global(html:not(.tv)) .name {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
    }
</style>
