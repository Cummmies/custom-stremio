<script lang="ts">
    import '$lib/styles/tokens.css';
    import { onMount } from 'svelte';
    import { app } from '$lib/app.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';
    import Toolbar from '$lib/components/Toolbar.svelte';
    import LoginDialog from '$lib/components/LoginDialog.svelte';

    let { children } = $props();

    let toolbar = $state<Toolbar>();
    let narrow = $state(false);
    let expandedWhileNarrow = $state(false);

    // Collapse the sidebar automatically in small windows (HIG sidebars › Desktop),
    // but still let people open it there on demand.
    const collapsed = $derived(narrow ? !expandedWhileNarrow : app.sidebarCollapsed);

    function toggleSidebar() {
        if (narrow) expandedWhileNarrow = !expandedWhileNarrow;
        else app.toggleSidebar();
    }

    onMount(() => {
        app.start();
        const mq = matchMedia('(max-width: 1080px)');
        narrow = mq.matches;
        const onChange = () => {
            narrow = mq.matches;
            expandedWhileNarrow = false;
        };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    });

    function onkeydown(e: KeyboardEvent) {
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
            e.preventDefault();
            toolbar?.focusSearch();
        } else if (e.key === '/' && !typing) {
            e.preventDefault();
            toolbar?.focusSearch();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
    }
</script>

<svelte:window {onkeydown} />

<div class="shell">
    <Sidebar {collapsed} ontoggle={toggleSidebar} />
    <div class="main" id="scroller">
        <Toolbar bind:this={toolbar} />
        {@render children()}
    </div>
</div>

{#if app.loginOpen}
    <LoginDialog onclose={() => (app.loginOpen = false)} />
{/if}

<style>
    .shell {
        display: flex;
        height: 100vh;
        overflow: hidden;
    }
    .main {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
    }
</style>
