<script lang="ts">
    import '$lib/styles/tokens.css';
    import { onMount } from 'svelte';
    import { app } from '$lib/app.svelte';
    import TopNav from '$lib/components/TopNav.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';

    let { children } = $props();

    let nav = $state<TopNav>();
    let scrolled = $state(false);

    onMount(() => app.start());

    function onkeydown(e: KeyboardEvent) {
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
            e.preventDefault();
            nav?.focusSearch();
        } else if (e.key === '/' && !typing) {
            e.preventDefault();
            nav?.focusSearch();
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

<style>
    main {
        position: relative;
        min-height: 100vh;
    }
</style>
