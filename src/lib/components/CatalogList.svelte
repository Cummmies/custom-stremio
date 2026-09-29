<script lang="ts">
    // Renders a CatalogsWithExtra model (board or search) and only asks addons
    // for the catalogs that are on, or close to, the screen.
    import { tick } from 'svelte';
    import { core } from '$lib/core';
    import type { Catalog } from '$lib/core/types';
    import CatalogRow from './CatalogRow.svelte';
    import type { PosterItem } from './PosterCard.svelte';

    let {
        model,
        catalogs,
        onspotlight,
    }: { model: string; catalogs: Catalog[]; onspotlight?: (item: PosterItem) => void } = $props();

    const PRELOAD_ROWS = 2;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const isEmpty = (c: Catalog) => c.content?.type === 'Err' && c.content.content === 'EmptyContent';
    const titleOf = (c: Catalog) =>
        [c.name, c.type].filter(Boolean).map((s) => s!.charAt(0).toUpperCase() + s!.slice(1)).join(' · ');

    const observer = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                const i = Number((e.target as HTMLElement).dataset.index);
                if (e.isIntersecting) visible.add(i);
                else visible.delete(i);
            }
            clearTimeout(timer);
            timer = setTimeout(loadVisibleRange, 120);
        },
        { rootMargin: '300px 0px' }
    );

    function loadVisibleRange() {
        // Before the observer reports anything, load the top rows right away.
        if (visible.size === 0) {
            if (catalogs.length) dispatchRange(0, Math.min(catalogs.length - 1, 3));
            return;
        }
        const start = Math.max(0, Math.min(...visible) - PRELOAD_ROWS);
        const end = Math.min(catalogs.length - 1, Math.max(...visible) + PRELOAD_ROWS);
        dispatchRange(start, end);
    }

    function dispatchRange(start: number, end: number) {
        core.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start, end } } }, model);
    }

    function observe(node: HTMLElement) {
        observer.observe(node);
        return { destroy: () => observer.unobserve(node) };
    }

    $effect(() => {
        catalogs.length;
        tick().then(loadVisibleRange);
    });
    $effect(() => () => {
        observer.disconnect();
        clearTimeout(timer);
    });
</script>

{#each catalogs as catalog, index (index)}
    {#if !isEmpty(catalog) && catalog.content?.type !== 'Err'}
        <div data-index={index} use:observe>
            <CatalogRow
                title={titleOf(catalog)}
                items={catalog.content?.type === 'Ready' ? catalog.content.content : null}
                loading={catalog.content?.type !== 'Ready'}
                {onspotlight}
            />
        </div>
    {/if}
{/each}
