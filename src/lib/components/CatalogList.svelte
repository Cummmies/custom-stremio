<script lang="ts" module>
    import type { Catalog } from '$lib/core/types';

    export const isEmptyCatalog = (c: Catalog) => c.content?.type === 'Err';
    export const catalogTitle = (c: Catalog) =>
        [c.name, c.type].filter(Boolean).map((s) => s!.charAt(0).toUpperCase() + s!.slice(1)).join(' · ');
    export const catalogAnchor = (index: number) => `row-${index}`;
    /** Anchor for a customized Home row (for the category tiles to jump to). */
    export const rowAnchor = (key: string) => `row-${key.replace(/[^a-z0-9]+/gi, '-')}`;

    /** A row in a customized order: built in (Continue Watching, Top 10) or drawn from catalogs. */
    export type ListRow = { key: string; title: string; special?: boolean; indices: number[] };
</script>

<script lang="ts">
    // Renders a CatalogsWithExtra model (board or search) and only asks addons
    // for the catalogs that are on, or close to, the screen.
    import { tick, type Snippet } from 'svelte';
    import { interleave } from '$lib/homeLayout.svelte';
    import { core } from '$lib/core';
    import CatalogRow from './CatalogRow.svelte';

    let {
        model,
        catalogs,
        type = null,
        continueFrom = null,
        rows = null,
        special,
    }: {
        model: string;
        catalogs: Catalog[];
        type?: string | null;
        /** Start one catalog's row after its first `skip` items (they're shown elsewhere). */
        continueFrom?: { index: number; skip: number } | null;
        /** A customized order (Customize Home). Without it: every catalog, in addon order. */
        rows?: ListRow[] | null;
        /** Draws a built-in row (Continue Watching, Top 10) where it sits in `rows`. */
        special?: Snippet<[string]>;
    } = $props();

    /** Titles for a row drawn from one or more catalogs (null while none has loaded). */
    function mergedItems(indices: number[]) {
        const lists = indices.map((i) => rowItems(catalogs[i], i));
        if (lists.every((l) => l == null)) return null;
        return interleave(lists.map((l) => l ?? []));
    }

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
    const rowIndices = $derived(rows ? rows.flatMap((r) => r.indices) : shown.map((s) => s.index));

    const observer = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                const ids = ((e.target as HTMLElement).dataset.index ?? '').split(',').filter(Boolean).map(Number);
                for (const i of ids) {
                    if (e.isIntersecting) visible.add(i);
                    else visible.delete(i);
                }
            }
            clearTimeout(timer);
            timer = setTimeout(loadVisibleRange, 120);
        },
        { rootMargin: '300px 0px' }
    );

    function loadVisibleRange() {
        const indices = visible.size ? [...visible] : rowIndices.slice(0, 4);
        if (!indices.length) return;
        // With a type filter or a custom order the visible rows aren't contiguous; load the span that covers them.
        const pad = type || rows ? 0 : PRELOAD_ROWS;
        const start = Math.max(0, Math.min(...indices) - pad);
        const end = Math.min(catalogs.length - 1, Math.max(...indices) + pad);
        core.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start, end } } }, model);
    }

    function observe(node: HTMLElement) {
        observer.observe(node);
        return { destroy: () => observer.unobserve(node) };
    }

    $effect(() => {
        rowIndices.length;
        tick().then(loadVisibleRange);
    });
    $effect(() => () => {
        observer.disconnect();
        clearTimeout(timer);
    });
</script>

{#if rows}
    {#each rows as row (row.key)}
        {#if row.special}
            {@render special?.(row.key)}
        {:else}
            {@const items = mergedItems(row.indices)}
            {@const allFailed = row.indices.every((i) => isEmptyCatalog(catalogs[i]))}
            {#if !allFailed && !(items && items.length === 0 && row.indices.every((i) => catalogs[i]?.content?.type === 'Ready'))}
                <div data-index={row.indices.join(',')} use:observe>
                    <CatalogRow
                        id={rowAnchor(row.key)}
                        title={row.indices.length === 1 && continueFrom?.index === row.indices[0] ? `More ${row.title}` : row.title}
                        {items}
                        loading={!items || items.length === 0}
                    />
                </div>
            {/if}
        {/if}
    {/each}
{:else}
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
{/if}
