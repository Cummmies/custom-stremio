<script lang="ts">
    import '$lib/styles/tokens.css';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { app } from '$lib/app.svelte';
    import { installContextMenu } from '$lib/contextmenu';
    import TopNav from '$lib/components/TopNav.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';
    import MenuHost from '$lib/components/menu/MenuHost.svelte';

    let { children } = $props();

    let nav = $state<TopNav>();
    let scrolled = $state(false);

    onMount(() => {
        app.start();
        return installContextMenu();
    });

    function onkeydown(e: KeyboardEvent) {
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        const mod = e.ctrlKey || e.metaKey;
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

<TopNav bind:this={nav} {scrolled} />

<main>
    {@render children()}
</main>

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
