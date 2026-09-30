<script lang="ts">
    import '$lib/styles/tokens.css';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { canPlay, player } from '$lib/player/player';
    import { app } from '$lib/app.svelte';
    import { installContextMenu } from '$lib/contextmenu';
    import TopNav from '$lib/components/TopNav.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';
    import MenuHost from '$lib/components/menu/MenuHost.svelte';
    import InstallFromUrl from '$lib/components/addons/InstallFromUrl.svelte';
    import UpdateToast from '$lib/components/UpdateToast.svelte';
    import TabBar from '$lib/components/TabBar.svelte';
    import ProfilePicker from '$lib/components/ProfilePicker.svelte';
    import { profiles } from '$lib/profiles.svelte';
    import { confirmWebBundle, updates } from '$lib/updates.svelte';
    import { isIOS } from '$lib/platform';

    let { children } = $props();

    let nav = $state<TopNav>();
    let scrolled = $state(false);
    const inPlayer = $derived(page.url.pathname === '/player');

    onMount(() => {
        app.start();
        // A reload skips the player's cleanup; make sure no video keeps playing unseen.
        if (!inPlayer && canPlay) player.stop();
        // The page came up, so a freshly applied iOS web update is good to keep.
        setTimeout(confirmWebBundle, 3000);
        // Release builds look for updates shortly after launch.
        if (import.meta.env.PROD) setTimeout(() => updates.check({ quiet: true }), 8000);
        // Phones rarely relaunch apps: look again when it comes back to the front.
        let lastCheck = Date.now();
        const onVisible = () => {
            if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60_000) return;
            lastCheck = Date.now();
            updates.check({ quiet: true });
        };
        if (isIOS && import.meta.env.PROD) document.addEventListener('visibilitychange', onVisible);
        const offMenu = installContextMenu();
        return () => {
            offMenu?.();
            document.removeEventListener('visibilitychange', onVisible);
        };
    });

    function onkeydown(e: KeyboardEvent) {
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        const mod = e.ctrlKey || e.metaKey;
        if (inPlayer) return; // the player owns the keyboard
        if (mod && (e.key === 'k' || e.key === 'f')) {
            e.preventDefault();
            nav?.focusSearch();
        } else if (e.key === '/' && !typing) {
            e.preventDefault();
            nav?.focusSearch();
        } else if (mod && e.key === ',') {
            e.preventDefault();
            goto('/settings');
        }
    }
</script>

<svelte:window {onkeydown} onscroll={() => (scrolled = window.scrollY > 24)} />

{#if !inPlayer}
    <TopNav bind:this={nav} {scrolled} />
{/if}

<main>
    {@render children()}
</main>

{#if app.pendingAddonUrl}
    <InstallFromUrl initialUrl={app.pendingAddonUrl} onclose={() => (app.pendingAddonUrl = null)} />
{/if}

{#if profiles.pickerOpen && !inPlayer}
    <ProfilePicker />
{/if}

{#if app.loginOpen}
    <LoginDialog onclose={() => (app.loginOpen = false)} />
{/if}

{#if !inPlayer}
    <TabBar />
    <UpdateToast />
{/if}

<MenuHost />

<style>
    main {
        position: relative;
        min-height: 100vh;
        /* Room for the phone tab bar (0 on wider screens). */
        padding-bottom: var(--tabbar-h);
    }
</style>
