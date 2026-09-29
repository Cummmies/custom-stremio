<script lang="ts" module>
    import type { Catalog } from '$lib/core/types';

    export const isEmptyCatalog = (c: Catalog) => c.content?.type === 'Err';
    export const catalogTitle = (c: Catalog) =>
        [c.name, c.type].filter(Boolean).map((s) => s!.charAt(0).toUpperCase() + s!.slice(1)).join(' · ');
    export const catalogAnchor = (index: number) => `row-${index}`;
</script>

<script lang="ts">
    // Renders a CatalogsWithExtra model (board or search) and only asks addons
    // for the catalogs that are on, or close to, the screen.
    import { tick } from 'svelte';
    import { core } from '$lib/core';
    import CatalogRow from './CatalogRow.svelte';

    let {
        model,
        catalogs,
        type = null,
        continueFrom = null,
    }: {
        model: string;
        catalogs: Catalog[];
        type?: string | null;
        /** Start one catalog's row after its first `skip` items (they're shown elsewhere). */
        continueFrom?: { index: number; skip: number } | null;
    } = $props();

    function rowItems(catalog: Catalog, index: number) {
        if (catalog.content?.type !== 'Ready') return null;
        return continueFrom?.index === index ? catalog.content.content.slice(continueFrom.skip) : catalog.content.content;
    }

    function rowTitle(catalog: Catalog, index: number) {
        return continueFrom?.index === index ? `More ${catalogTitle(catalog)}` : catalogTitle(catalog);
    }

    const PRELOAD_ROWS = 2;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Keep each catalog's original index: that's what LoadRange refers to.
    const shown = $derived(
        catalogs.map((catalog, index) => ({ catalog, index })).filter(({ catalog }) => !type || catalog.type === type)
    );

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
        const indices = visible.size ? [...visible] : shown.slice(0, 4).map((s) => s.index);
        if (!indices.length) return;
        // With a type filter the visible rows aren't contiguous; load the span that covers them.
        const start = Math.max(0, Math.min(...indices) - (type ? 0 : PRELOAD_ROWS));
        const end = Math.min(catalogs.length - 1, Math.max(...indices) + (type ? 0 : PRELOAD_ROWS));
        core.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start, end } } }, model);
    }

    function observe(node: HTMLElement) {
        observer.observe(node);
        return { destroy: () => observer.unobserve(node) };
    }

    $effect(() => {
        shown.length;
        tick().then(loadVisibleRange);
    });
    $effect(() => () => {
        observer.disconnect();
        clearTimeout(timer);
    });
</script>

{#each shown as { catalog, index } (index)}
    {@const items = rowItems(catalog, index)}
    {#if !isEmptyCatalog(catalog) && !(items && items.length === 0)}
        <div data-index={index} use:observe>
            <CatalogRow
                id={catalogAnchor(index)}
                title={rowTitle(catalog, index)}
                {items}
                loading={catalog.content?.type !== 'Ready'}
            />
        </div>
    {/if}
{/each}
