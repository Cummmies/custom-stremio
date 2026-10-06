<script lang="ts">
    // Phones: the sections live in a bottom tab bar, where thumbs are (iOS HIG,
    // Tab bars). Hidden on wider screens, which use the top pill instead.
    import { page } from '$app/state';
    import { appUrl } from '$lib/nav';
    import Icon, { type IconName } from './Icon.svelte';

    const tabs: { href: string; label: string; icon: IconName }[] = [
        { href: '/', label: 'Home', icon: 'home' },
        { href: '/library', label: 'Library', icon: 'library' },
        { href: '/calendar', label: 'Calendar', icon: 'calendar' },
        { href: '/search', label: 'Search', icon: 'search' },
    ];
    const path = $derived(appUrl(page.url).pathname);
    const isActive = (href: string) => (href === '/' ? path === '/' || path === '/customize' : path.startsWith(href));

    /** Tapping the tab you're on scrolls back to the top, as in iOS apps. */
    function onclick(e: MouseEvent, href: string) {
        if (!isActive(href)) return;
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
</script>

<nav class="tabbar" aria-label="Sections">
    {#each tabs as t (t.href)}
        <a href={t.href} class:active={isActive(t.href)} aria-current={isActive(t.href) ? 'page' : undefined} onclick={(e) => onclick(e, t.href)}>
            <Icon name={t.icon} size={24} filled={isActive(t.href) && t.icon !== 'search' && t.icon !== 'calendar'} />
            <span>{t.label}</span>
        </a>
    {/each}
</nav>

<style>
    .tabbar {
        display: none;
    }
    @media (max-width: 700px) {
        .tabbar {
            position: fixed;
            inset: auto 0 0 0;
            z-index: 30;
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: 1fr;
            height: var(--tabbar-h);
            padding-bottom: var(--safe-bottom);
            background: rgb(18 18 24 / 0.82);
            backdrop-filter: saturate(1.6) blur(24px);
            -webkit-backdrop-filter: saturate(1.6) blur(24px);
            border-top: 0.5px solid var(--separator);
        }
    }
    a {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: var(--label-3);
        font-size: 10px;
        font-weight: 600;
        text-decoration: none;
        -webkit-tap-highlight-color: transparent;
        transition: color var(--fast);
    }
    a.active {
        color: var(--label);
    }
    a:active :global(svg) {
        transform: scale(0.9);
    }
    a :global(svg) {
        transition: transform var(--fast);
    }
    @media (prefers-reduced-transparency: reduce) {
        .tabbar {
            background: var(--elevated);
        }
    }
</style>
