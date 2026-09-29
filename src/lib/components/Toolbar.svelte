<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { app } from '$lib/app.svelte';
    import Icon from './Icon.svelte';

    let input = $state<HTMLInputElement>();
    let query = $state(page.url.searchParams.get('q') ?? '');
    let menuOpen = $state(false);
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Keep the field in sync when navigating back/forward.
    $effect(() => {
        if (page.url.pathname === '/search') query = page.url.searchParams.get('q') ?? '';
    });

    function search(q: string, replace: boolean) {
        const trimmed = q.trim();
        goto(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search', {
            replaceState: replace,
            keepFocus: true,
            noScroll: true,
        });
    }

    // Search as you type, but only after a short pause.
    function oninput() {
        clearTimeout(timer);
        timer = setTimeout(() => search(query, page.url.pathname === '/search'), 350);
    }

    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            clearTimeout(timer);
            search(query, page.url.pathname === '/search');
        } else if (e.key === 'Escape') {
            query = '';
            input?.blur();
        }
    }

    export function focusSearch() {
        input?.focus();
        input?.select();
    }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<header class="toolbar">
    <label class="search">
        <Icon name="search" size={16} />
        <span class="sr-only">Search movies and series</span>
        <input
            bind:this={input}
            bind:value={query}
            {oninput}
            {onkeydown}
            type="search"
            placeholder="Search movies & series"
            spellcheck="false"
            autocomplete="off"
        />
        <kbd>Ctrl K</kbd>
    </label>

    <div class="account">
        {#if app.user}
            <button
                class="avatar"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onclick={(e) => {
                    e.stopPropagation();
                    menuOpen = !menuOpen;
                }}
            >
                <span aria-hidden="true">{app.user.email[0]?.toUpperCase()}</span>
                <span class="sr-only">Account menu for {app.user.email}</span>
            </button>
            {#if menuOpen}
                <div class="menu" role="menu">
                    <p class="menu-email">{app.user.email}</p>
                    <button role="menuitem" onclick={() => app.logout()}>Log Out</button>
                </div>
            {/if}
        {:else}
            <button class="signin" onclick={() => (app.loginOpen = true)}>
                <Icon name="user" size={16} />
                Log In
            </button>
        {/if}
    </div>
</header>

<style>
    .toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        height: var(--toolbar-h);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 0 var(--gutter);
        /* The one glass surface: a small functional bar floating over content. */
        background: rgb(13 13 18 / 0.72);
        backdrop-filter: blur(24px) saturate(1.4);
        -webkit-backdrop-filter: blur(24px) saturate(1.4);
        border-bottom: 1px solid var(--separator);
    }
    @media (prefers-reduced-transparency: reduce) {
        .toolbar {
            background: var(--bg);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    .search {
        display: flex;
        align-items: center;
        gap: 10px;
        width: min(440px, 100%);
        height: 36px;
        padding: 0 8px 0 12px;
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label-2);
        border: 1px solid transparent;
        transition: border-color var(--fast), background var(--fast);
    }
    .search:focus-within {
        background: var(--elevated-2);
        border-color: var(--accent);
    }
    input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
    }
    input::placeholder {
        color: var(--label-2);
    }
    input::-webkit-search-cancel-button {
        filter: invert(0.7);
    }
    kbd {
        font-family: var(--font);
        font-size: 11px;
        color: var(--label-2);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid var(--separator);
    }
    .search:focus-within kbd {
        display: none;
    }
    .account {
        position: relative;
    }
    .signin {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: var(--fill);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--fast);
    }
    .signin:hover {
        background: var(--fill-hover);
    }
    .avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 0;
        background: var(--accent);
        color: white;
        font-weight: 700;
        cursor: pointer;
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        min-width: 220px;
        padding: 6px;
        border-radius: var(--radius);
        background: var(--elevated-2);
        border: 1px solid var(--separator);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
    }
    .menu-email {
        margin: 0;
        padding: 8px 10px;
        font-size: var(--text-caption);
        color: var(--label-2);
        border-bottom: 1px solid var(--separator);
        margin-bottom: 4px;
    }
    .menu button {
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        border: 0;
        border-radius: var(--radius-s);
        background: transparent;
        cursor: pointer;
    }
    .menu button:hover {
        background: var(--accent);
        color: white;
    }
</style>
