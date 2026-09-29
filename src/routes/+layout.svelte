<script lang="ts">
    import '$lib/styles/tokens.css';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { invoke } from '@tauri-apps/api/core';
    import { inTauri } from '$lib/player/mpv.svelte';
    import { app } from '$lib/app.svelte';
    import { installContextMenu } from '$lib/contextmenu';
    import TopNav from '$lib/components/TopNav.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';
    import MenuHost from '$lib/components/menu/MenuHost.svelte';
    import InstallFromUrl from '$lib/components/addons/InstallFromUrl.svelte';

    let { children } = $props();

    let nav = $state<TopNav>();
    let scrolled = $state(false);
    const inPlayer = $derived(page.url.pathname === '/player');

    onMount(() => {
        app.start();
        // A reload skips the player's cleanup; make sure no video keeps playing unseen.
        if (!inPlayer && inTauri) invoke('mpv_stop').catch(() => {});
        return installContextMenu();
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

{#if app.loginOpen}
    <LoginDialog onclose={() => (app.loginOpen = false)} />
{/if}

<MenuHost />

<style>
    main {
        position: relative;
        min-height: 100vh;
    }
</style>
