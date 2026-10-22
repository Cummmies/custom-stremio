<script lang="ts">
    // The Privacy Policy's and Terms of Use's page: a readable column, a way back
    // to Settings, when it took effect, numbered sections, and who runs the app
    // and how to reach them (lib/legal.ts) at the end.
    import type { Snippet } from 'svelte';
    import Icon from './Icon.svelte';
    import { APP_NAME, CONTACT, EFFECTIVE, OPERATOR } from '$lib/legal';

    let { title, children }: { title: string; children: Snippet } = $props();
</script>

<svelte:head><title>{title} · Stremio</title></svelte:head>

<article class="page">
    <a class="back" href="/settings"><Icon name="back" size={16} />Settings</a>
    <h1>{title}</h1>
    <p class="effective">{APP_NAME} · Effective and last updated {EFFECTIVE}</p>
    <div class="body">{@render children()}</div>
    <footer class="operator">
        <p><strong>{OPERATOR}</strong></p>
        <p>Contact: <a href="mailto:{CONTACT}">{CONTACT}</a></p>
        <p class="note">
            {APP_NAME} is an independent app. It isn’t made by, endorsed by or affiliated with Stremio or Smart Code. Stremio is a trademark of
            its owners.
        </p>
    </footer>
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
    /* Numbered sections, as legal pages are. */
    .body {
        counter-reset: section;
    }
    .body :global(h2)::before {
        counter-increment: section;
        content: counter(section) '. ';
        color: var(--label-2);
    }
    .operator {
        margin-top: 36px;
        padding: 16px 18px;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated);
    }
    .operator p {
        margin: 0 0 4px;
    }
    .operator a {
        color: var(--accent-text);
    }
    .operator .note {
        margin-top: 10px;
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
