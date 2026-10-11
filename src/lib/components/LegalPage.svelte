<script lang="ts">
    // The Privacy Policy's and Terms of Use's page: a readable column, a way back
    // to Settings, and when it took effect.
    import type { Snippet } from 'svelte';
    import Icon from './Icon.svelte';
    import { EFFECTIVE } from '$lib/legal';

    let { title, children }: { title: string; children: Snippet } = $props();
</script>

<svelte:head><title>{title} · Stremio</title></svelte:head>

<article class="page">
    <a class="back" href="/settings"><Icon name="back" size={16} />Settings</a>
    <h1>{title}</h1>
    <p class="effective">In effect from {EFFECTIVE}</p>
    {@render children()}
</article>

<style>
    .page {
        max-width: 680px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 20px) var(--gutter) 80px;
        line-height: 1.55;
    }
    .back {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin: 0 0 10px -4px;
        padding: 4px 8px 4px 4px;
        border-radius: 8px;
        color: var(--label-2);
        font-size: var(--text-callout);
        font-weight: 500;
        text-decoration: none;
    }
    .back:hover {
        background: var(--fill);
        color: var(--label);
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .effective {
        margin: 4px 0 28px;
        color: var(--label-2);
        font-size: 13px;
    }
    .page :global(h2) {
        margin: 28px 0 8px;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .page :global(p),
    .page :global(li) {
        color: var(--label-2);
    }
    .page :global(p) {
        margin: 0 0 12px;
    }
    .page :global(ul) {
        margin: 0 0 12px;
        padding-left: 20px;
    }
    .page :global(li) {
        margin-bottom: 6px;
    }
    .page :global(strong) {
        color: var(--label);
        font-weight: 600;
    }
</style>
