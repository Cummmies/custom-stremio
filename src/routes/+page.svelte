<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { core } from '$lib/core';
    import { watchServer } from '$lib/core/server';
    import type { Board, Ctx, ServerStatus } from '$lib/core/types';
    import CatalogRow from '$lib/components/CatalogRow.svelte';
    import ServerPill from '$lib/components/ServerPill.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';

    const PRELOAD_ROWS = 2;

    let board = $state<Board | null>(null);
    let ctx = $state<Ctx | null>(null);
    let server = $state<ServerStatus>({ state: 'starting' });
    let showLogin = $state(false);

    const user = $derived(ctx?.profile.auth?.user ?? null);
    const catalogs = $derived(board?.catalogs ?? []);

    onMount(() => {
        const unwatch = [
            core.watch<Board>('board', (s) => (board = s)),
            core.watch<Ctx>('ctx', (s) => (ctx = s)),
            watchServer((s) => (server = s)),
        ];

        core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
        // Same startup sync the official app does.
        for (const action of ['PullAddonsFromAPI', 'SyncLibraryWithAPI']) {
            core.dispatch({ action: 'Ctx', args: { action } });
        }

        return () => {
            unwatch.forEach((fn) => fn());
            core.dispatch({ action: 'Unload' }, 'board');
        };
    });

    // Only ask addons for the catalogs that are on (or near) the screen.
    const visible = new Set<number>();
    let rangeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer =
        typeof IntersectionObserver !== 'undefined'
            ? new IntersectionObserver(
                  (entries) => {
                      for (const e of entries) {
                          const i = Number((e.target as HTMLElement).dataset.index);
                          e.isIntersecting ? visible.add(i) : visible.delete(i);
                      }
                      clearTimeout(rangeTimer);
                      rangeTimer = setTimeout(loadVisibleRange, 150);
                  },
                  { rootMargin: '200px 0px' }
              )
            : null;

    function loadVisibleRange() {
        if (visible.size === 0) return;
        const start = Math.max(0, Math.min(...visible) - PRELOAD_ROWS);
        const end = Math.min(catalogs.length - 1, Math.max(...visible) + PRELOAD_ROWS);
        core.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start, end } } }, 'board');
    }

    function observe(node: HTMLElement) {
        observer?.observe(node);
        return { destroy: () => observer?.unobserve(node) };
    }

    function logout() {
        core.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
    }

    $effect(() => {
        // Re-run the range check when the catalog list itself changes (e.g. after login).
        catalogs.length;
        tick().then(loadVisibleRange);
    });
</script>

<header class="topbar">
    <div class="brand">custom<span>stremio</span></div>
    <div class="actions">
        <ServerPill status={server} />
        {#if user}
            <span class="user" title={user.email}>{user.email}</span>
            <button class="ghost" onclick={logout}>Log out</button>
        {:else}
            <button class="primary" onclick={() => (showLogin = true)}>Log in</button>
        {/if}
    </div>
</header>

<main>
    {#if !board}
        <p class="status">Starting core…</p>
    {:else if catalogs.length === 0}
        <p class="status">No catalogs yet. Install some addons.</p>
    {:else}
        {#each catalogs as catalog, index (index)}
            {#if !(catalog.content?.type === 'Err' && catalog.content.content === 'EmptyContent')}
                <div data-index={index} use:observe>
                    <CatalogRow {catalog} />
                </div>
            {/if}
        {/each}
    {/if}
</main>

{#if showLogin}
    <LoginDialog onclose={() => (showLogin = false)} />
{/if}

<style>
    :global(:root) {
        --bg: #0b0b10;
        --surface: #16161f;
        --surface-2: #1d1d29;
        --text: #f2f2f7;
        --text-dim: #9a9aab;
        --accent: #7b5cff;
        --radius: 10px;
        --gutter: 32px;
        --poster-w: 150px;
        color-scheme: dark;
    }
    :global(body) {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
        -webkit-font-smoothing: antialiased;
    }
    .topbar {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px var(--gutter);
        /* Solid background instead of backdrop-filter blur: blur is expensive on scroll. */
        background: rgb(11 11 16 / 0.96);
        border-bottom: 1px solid var(--surface);
    }
    .brand {
        font-weight: 700;
        font-size: 1.2rem;
        letter-spacing: -0.02em;
    }
    .brand span {
        color: var(--accent);
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .user {
        color: var(--text-dim);
        font-size: 0.85rem;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    button {
        font: inherit;
        font-size: 0.85rem;
        border-radius: 999px;
        padding: 7px 16px;
        cursor: pointer;
        border: 0;
    }
    .primary {
        background: var(--accent);
        color: white;
        font-weight: 600;
    }
    .ghost {
        background: var(--surface);
        color: var(--text);
    }
    main {
        display: flex;
        flex-direction: column;
        gap: 32px;
        padding: 28px 0 48px;
    }
    .status {
        padding: 0 var(--gutter);
        color: var(--text-dim);
    }
</style>
