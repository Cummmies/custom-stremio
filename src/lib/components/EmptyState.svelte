<script lang="ts">
    import type { Snippet } from 'svelte';
    import Icon, { type IconName } from './Icon.svelte';

    let { icon, title, children }: { icon: IconName; title: string; children?: Snippet } = $props();
</script>

<div class="empty">
    <div class="icon"><Icon name={icon} size={28} /></div>
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
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label-2);
        margin-bottom: 6px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
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
