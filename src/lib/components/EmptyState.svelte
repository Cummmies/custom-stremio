<script lang="ts">
    // Nothing to show yet: a plain symbol, a title and a line of what to do,
    // as Apple's "content unavailable" view (no badge or card around it).
    import type { Snippet } from 'svelte';
    import Icon, { type IconName } from './Icon.svelte';

    let { icon, title, children }: { icon: IconName; title: string; children?: Snippet } = $props();
</script>

<div class="empty">
    <div class="icon"><Icon name={icon} size={40} /></div>
    <h2>{title}</h2>
    {#if children}<div class="body">{@render children()}</div>{/if}
</div>

<style>
    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 10px;
        padding: 12vh var(--gutter);
    }
    .icon {
        color: var(--label-3);
        margin-bottom: 4px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .body {
        max-width: 380px;
        color: var(--label-2);
    }
    .body :global(p) {
        margin: 0 0 16px;
    }
    .body :global(button) {
        height: 36px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: var(--accent);
        color: white;
        font-weight: 600;
        cursor: pointer;
    }
    .body :global(button:hover) {
        background: var(--accent-hover);
    }
</style>
