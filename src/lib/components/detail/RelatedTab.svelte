<script lang="ts">
    // A title page's Related tab, from Lightboxd: an anime's seasons in watch
    // order and its side stories, or a film's collection in release order,
    // with the title you're on among them. Under each poster, two lines: its
    // name without the franchise (the hero already says it), then its year and
    // your status ("Watching" also gets the progress bar Continue Watching
    // uses). Same cards and grid as Library.
    import PosterCard from '$lib/components/PosterCard.svelte';
    import { STATUS_SHORT, type RelatedGroup, type RelatedItem } from '$lib/lightboxd/api';

    let { groups }: { groups: RelatedGroup[] } = $props();

    /** "Attack on Titan Season 2" → "Season 2" in a group led by "Attack on Titan". */
    function short(name: string, roots: string[]) {
        for (const root of roots) {
            if (root && name.length > root.length && name.toLowerCase().startsWith(root.toLowerCase())) {
                const rest = name.slice(root.length).replace(/^[\s:–—-]+/, '');
                if (rest) return rest;
            }
        }
        return name;
    }
    const rootsOf = (g: RelatedGroup) => {
        const shortest = [...g.items].sort((a, b) => a.name.length - b.name.length)[0]?.name ?? '';
        return [g.title, shortest].filter((r) => r && r !== 'Watch Order' && r !== 'Side Stories');
    };
    const below = (r: RelatedItem) =>
        [r.kind, r.year, r.here ? 'You’re Here' : r.status ? STATUS_SHORT[r.status] : null].filter(Boolean).join(' · ');
</script>

<div class="related">
    {#each groups as g (g.title)}
        {@const roots = rootsOf(g)}
        <section aria-label={g.title}>
            <h3>{g.title}</h3>
            <ol class="grid">
                {#each g.items as r (r.id)}
                    <li class:here={r.here} aria-current={r.here ? 'page' : undefined}>
                        <PosterCard
                            item={{
                                id: r.id,
                                type: r.type,
                                name: short(r.name, roots),
                                poster: r.poster,
                                releaseInfo: below(r),
                                progress: r.status === 'watching' ? 0.45 : null,
                            }}
                        />
                    </li>
                {/each}
            </ol>
        </section>
    {/each}
</div>

<style>
    /* Scrolls inside the column, like the episode list. */
    .related {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 4px 4px 24px;
        margin: -4px -4px 0;
    }
    section + section {
        margin-top: 32px;
    }
    h3 {
        margin: 0 0 14px;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr));
        gap: 24px 16px;
    }
    li {
        min-width: 0;
    }
    /* The title you're on: a quiet ring, so the order reads around it. */
    .here :global(.poster) {
        box-shadow: 0 0 0 2px var(--label-2);
    }
    @media (max-width: 700px) {
        .related {
            overflow: visible;
        }
    }
    :global(html.tv) .related {
        overflow: visible;
    }
</style>
