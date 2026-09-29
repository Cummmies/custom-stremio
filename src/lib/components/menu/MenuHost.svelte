<script lang="ts">
    // Renders whichever menu is open and closes it on outside clicks, scrolls,
    // resizes, window blur and navigation.
    import { afterNavigate } from '$app/navigation';
    import { menu } from '$lib/menu.svelte';
    import MenuList from './MenuList.svelte';

    afterNavigate(() => menu.close(false));

    // The control that opened the menu handles its own click (to toggle it closed).
    const outside = (t: EventTarget | null) =>
        !(t instanceof Element && (t.closest('[data-menu]') || t.closest('[aria-expanded="true"][aria-haspopup]')));
</script>

<svelte:window
    onpointerdown={(e) => menu.open && outside(e.target) && menu.close(false)}
    onblur={() => menu.close(false)}
    onresize={() => menu.close(false)}
/>
<svelte:document onscrollcapture={(e) => menu.open && outside(e.target) && menu.close(false)} />

{#if menu.open}
    {#key menu.generation}
        <MenuList
            entries={menu.entries}
            x={menu.x}
            y={menu.y}
            anchorRect={menu.anchorRect}
            align={menu.align}
            minWidth={menu.minWidth}
            onclose={(restore) => menu.close(restore)}
        />
    {/key}
{/if}
