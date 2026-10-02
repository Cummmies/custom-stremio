<script lang="ts">
    import logo from '$lib/assets/logo.svg';
    // Floating navigation over the hero: brand, a pill of sections, search and account.
    // Transparent at rest; picks up a glass backing once content scrolls under it.
    import { goto, appUrl } from '$lib/nav';
    import { page } from '$app/state';
    import { app } from '$lib/app.svelte';
    import { isTV } from '$lib/platform';
    import Icon from './Icon.svelte';
    import ServerStatus from './ServerStatus.svelte';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { profiles } from '$lib/profiles.svelte';
    import Avatar from './Avatar.svelte';

    let { scrolled }: { scrolled: boolean } = $props();

    const sections = [
        { href: '/', label: 'Home' },
        { href: '/movies', label: 'Movies' },
        { href: '/series', label: 'Series' },
        { href: '/library', label: 'Library' },
    ];
    const isActive = (href: string) => (href === '/' ? appUrl(page.url).pathname === '/' || appUrl(page.url).pathname === '/customize' : appUrl(page.url).pathname.startsWith(href));

    let input = $state<HTMLInputElement>();
    let query = $state('');
    let searchOpen = $state(false);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onSearchPage = $derived(appUrl(page.url).pathname === '/search');
    const expanded = $derived(searchOpen || onSearchPage);
    // TVs never have a server; nothing to warn about.
    const serverTrouble = $derived(!isTV && (app.server.state === 'missing' || app.server.state === 'failed'));

    $effect(() => {
        if (onSearchPage) query = appUrl(page.url).searchParams.get('q') ?? '';
    });

    function search(q: string) {
        const trimmed = q.trim();
        goto(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search', {
            replaceState: onSearchPage,
            keepFocus: true,
            noScroll: true,
        });
    }

    function oninput() {
        clearTimeout(timer);
        timer = setTimeout(() => search(query), 350);
    }

    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            clearTimeout(timer);
            search(query);
        } else if (e.key === 'Escape') {
            input?.blur();
        }
    }

    function onblur() {
        if (!query) searchOpen = false;
    }

    function accountMenu(): MenuEntry[] {
        const user = app.user;
        const name = user ? profiles.list.find((p) => p.uid === user._id)?.name || user.email : null;
        const account: MenuEntry[] = name
            ? [{ header: name }]
            : [
                  { header: 'Not logged in' },
                  { label: 'Log In…', icon: 'user', onselect: () => app.openLogin() },
                  // Profiles saved on this device: pick one instead of logging in.
                  ...(profiles.list.length ? [{ label: 'Switch Profile…', icon: 'users', onselect: () => app.openProfiles() } as MenuEntry] : []),
              ];
        return [
            ...account,
            { separator: true },
            { label: 'Addons', icon: 'puzzle', onselect: () => goto('/addons') },
            { label: 'Settings', icon: 'gear', shortcut: 'Ctrl+,', onselect: () => goto('/settings') },
            ...(app.user
                ? ([
                      { label: 'Switch Profile…', icon: 'users', onselect: () => app.openProfiles() },
                      { separator: true },
                      { label: 'Log Out', icon: 'logout', destructive: true, onselect: () => app.logout() },
                  ] as MenuEntry[])
                : []),
        ];
    }

    export async function focusSearch() {
        searchOpen = true;
        await Promise.resolve();
        input?.focus();
        input?.select();
    }
</script>

<header class="nav" class:scrolled>
    <!-- TV: not a stop for the remote (Home is the first tab). -->
    <a class="brand" href="/" aria-label="Stremio home" tabindex={isTV ? -1 : undefined}><img src={logo} alt="" width="28" height="28" />Stremio</a>

    <nav class="pill" aria-label="Sections">
        {#each sections as s (s.href)}
            <a href={s.href} class:active={isActive(s.href)} aria-current={isActive(s.href) ? 'page' : undefined}>{s.label}</a>
        {/each}
    </nav>

    <div class="actions">
        {#if serverTrouble}
            <div class="server-note"><ServerStatus status={app.server} compact /></div>
        {/if}

        <div class="search" class:expanded>
            <button class="circle" onclick={focusSearch} aria-label="Search (Ctrl K)" title="Search (Ctrl K)" tabindex={expanded ? -1 : 0}>
                <Icon name="search" size={17} />
            </button>
            <input
                bind:this={input}
                bind:value={query}
                {oninput}
                {onkeydown}
                {onblur}
                type="search"
                placeholder="Movies, series…"
                aria-label="Search movies and series"
                spellcheck="false"
                autocomplete="off"
                tabindex={expanded ? 0 : -1}
            />
        </div>

        <button
            class="circle"
            class:avatar={app.user}
            aria-haspopup="menu"
            aria-expanded="false"
            aria-label="Account"
            title={app.user?.email ?? 'Account'}
            onclick={(e) => menu.toggleFor(e.currentTarget, accountMenu(), 'end')}
        >
            {#if app.user}
                <Avatar profile={profiles.get(app.user._id)} fallbackName={app.user.email} size={36} />
            {:else}
                <Icon name="user" size={17} />
            {/if}
        </button>
    </div>
</header>

<style>
    .nav {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 30;
        height: var(--nav-h);
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 16px;
        padding: 0 var(--gutter);
        transition:
            background var(--slow) var(--ease),
            border-color var(--slow) var(--ease);
        border-bottom: 1px solid transparent;
    }
    /* Scroll edge effect: glass appears only once content slides underneath. */
    .nav.scrolled {
        background: rgb(13 13 18 / 0.72);
        backdrop-filter: blur(24px) saturate(1.4);
        -webkit-backdrop-filter: blur(24px) saturate(1.4);
        border-bottom-color: var(--separator);
    }
    @media (prefers-reduced-transparency: reduce) {
        .nav.scrolled {
            background: var(--bg);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    .brand {
        justify-self: start;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 20px;
        letter-spacing: -0.02em;
        color: var(--label);
        text-decoration: none;
        border-radius: 4px;
    }
    .brand img {
        display: block;
        border-radius: 7px;
    }
    .pill {
        display: flex;
        gap: 2px;
        padding: 4px;
        border-radius: 999px;
        background: rgb(30 30 38 / 0.55);
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
        border: 1px solid rgb(255 255 255 / 0.1);
    }
    .scrolled .pill {
        background: var(--fill);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }
    .pill a {
        height: 32px;
        display: grid;
        place-items: center;
        padding: 0 16px;
        border-radius: 999px;
        font-weight: 500;
        color: var(--label-2);
        text-decoration: none;
        white-space: nowrap;
        transition:
            background var(--fast),
            color var(--fast);
    }
    .pill a:hover {
        color: var(--label);
    }
    .pill a.active {
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
    }
    .actions {
        justify-self: end;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .circle {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        flex: none;
        border: 1px solid rgb(255 255 255 / 0.1);
        border-radius: 50%;
        background: rgb(30 30 38 / 0.55);
        color: var(--label);
        cursor: pointer;
        transition: background var(--fast);
    }
    .circle:hover {
        background: rgb(60 60 72 / 0.7);
    }
    /* The picture fills the button; hover adds a ring instead of a tint. */
    .avatar {
        padding: 0;
        overflow: hidden;
        background: transparent;
        border-color: transparent;
        transition: box-shadow var(--fast);
    }
    .avatar:hover {
        background: transparent;
        box-shadow: 0 0 0 2px var(--label);
    }
    .search {
        display: flex;
        align-items: center;
        height: 36px;
        width: 36px;
        border-radius: 999px;
        transition: width var(--slow) var(--ease), background var(--fast);
        overflow: hidden;
    }
    .search.expanded {
        width: min(280px, 28vw);
        background: rgb(30 30 38 / 0.8);
        border: 1px solid rgb(255 255 255 / 0.14);
    }
    .search.expanded .circle {
        border: 0;
        background: transparent;
        pointer-events: none;
    }
    .search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
        padding-right: 12px;
    }
    .search input::placeholder {
        color: var(--label-2);
    }
    .search:focus-within {
        border-color: var(--accent-hover);
    }
    /* TV: animating the width re-lays out the whole bar every frame, which
       stutters on a TV. There the button keeps its place and the field is a
       fixed-width pill on top of the bar, uncovered from the button leftwards
       (clip-path: repaints that area only). */
    :global(html.tv) .search,
    :global(html.tv) .search.expanded {
        position: relative;
        width: 36px;
        overflow: visible;
        background: none;
        border: 0;
        transition: none;
    }
    :global(html.tv) .search .circle {
        position: relative;
        z-index: 1;
    }
    :global(html.tv) .search input {
        position: absolute;
        top: 0;
        right: 0;
        width: 300px;
        height: 36px;
        box-sizing: border-box;
        padding: 0 44px 0 16px;
        border-radius: 999px;
        background: rgb(30 30 38 / 0.96);
        border: 1px solid rgb(255 255 255 / 0.14);
        clip-path: inset(0 0 0 264px round 18px);
        opacity: 0;
        transition:
            clip-path var(--slow) var(--ease),
            opacity var(--fast);
    }
    :global(html.tv) .search.expanded input {
        clip-path: inset(0 0 0 0 round 18px);
        opacity: 1;
    }
    .server-note :global(.status) {
        background: rgb(30 30 38 / 0.8);
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 50%;
    }
    @media (min-width: 701px) and (max-width: 760px) {
        .brand {
            display: none;
        }
        .nav {
            grid-template-columns: auto 1fr;
        }
        .pill a {
            padding: 0 12px;
        }
    }
    /* Phones: sections and search move to the tab bar; keep the brand and account. */
    @media (max-width: 700px) {
        .nav {
            grid-template-columns: 1fr auto;
            padding-top: var(--safe-top);
        }
        .pill,
        .search,
        .server-note {
            display: none;
        }
        .brand {
            font-size: 20px;
        }
    }
</style>
