<script lang="ts">
    import { page } from '$app/state';
    import { app } from '$lib/app.svelte';
    import Icon, { type IconName } from './Icon.svelte';
    import ServerStatus from './ServerStatus.svelte';

    let { collapsed, ontoggle }: { collapsed: boolean; ontoggle: () => void } = $props();

    const items: { href: string; label: string; icon: IconName }[] = [
        { href: '/', label: 'Home', icon: 'home' },
        { href: '/search', label: 'Search', icon: 'search' },
        { href: '/library', label: 'Library', icon: 'library' },
    ];

    const isActive = (href: string) =>
        href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<nav class="sidebar" class:collapsed aria-label="Main">
    <div class="head">
        {#if !collapsed}<span class="brand">Stremio</span>{/if}
        <button class="icon-btn" onclick={ontoggle} aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} title="Toggle sidebar (Ctrl+B)">
            <Icon name="sidebar" />
        </button>
    </div>

    <ul>
        {#each items as item (item.href)}
            {@const active = isActive(item.href)}
            <li>
                <a href={item.href} class:active aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}>
                    <Icon name={item.icon} size={20} filled={active && item.icon !== 'search'} />
                    <span class="label">{item.label}</span>
                </a>
            </li>
        {/each}
    </ul>

    <div class="foot">
        <ServerStatus status={app.server} compact={collapsed} />
    </div>
</nav>

<style>
    .sidebar {
        width: var(--sidebar-w);
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 10px;
        background: var(--elevated);
        border-right: 1px solid var(--separator);
        transition: width var(--slow) var(--ease);
        overflow: hidden;
    }
    .sidebar.collapsed {
        width: 68px;
    }
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 40px;
        padding-left: 10px;
    }
    .collapsed .head {
        justify-content: center;
        padding-left: 0;
    }
    .brand {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: var(--text-title3);
        letter-spacing: -0.01em;
    }
    ul {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    a {
        display: flex;
        align-items: center;
        gap: 12px;
        height: 40px;
        padding: 0 12px;
        border-radius: var(--radius);
        color: var(--label-2);
        text-decoration: none;
        font-weight: 500;
        white-space: nowrap;
        transition: background var(--fast), color var(--fast);
    }
    .collapsed a {
        justify-content: center;
        padding: 0;
    }
    .collapsed .label {
        display: none;
    }
    a:hover {
        background: var(--fill);
        color: var(--label);
    }
    a.active {
        background: var(--fill-hover);
        color: var(--label);
    }
    a.active :global(svg) {
        color: var(--accent-text);
    }
    .foot {
        margin-top: auto;
    }
    .icon-btn {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: var(--radius-s);
        background: transparent;
        color: var(--label-2);
        cursor: pointer;
    }
    .icon-btn:hover {
        background: var(--fill);
        color: var(--label);
    }
</style>
