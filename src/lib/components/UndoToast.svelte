<script lang="ts">
    // The Undo bar (lib/undo.svelte.ts): what just happened, and Undo. Glass,
    // at the bottom above the tab bar; Ctrl+Z / ⌘Z takes it back on a computer
    // (but not while typing, where it undoes the typing).
    import { undo } from '$lib/undo.svelte';

    function onkeydown(e: KeyboardEvent) {
        if (!undo.current || e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
        e.preventDefault();
        undo.undo();
    }
</script>

<svelte:window {onkeydown} />

{#if undo.current}
    {#key undo.current.id}
        <div class="undo" role="status">
            <span>{undo.current.text}</span>
            <button onclick={() => undo.undo()}>Undo</button>
        </div>
    {/key}
{/if}

<style>
    .undo {
        position: fixed;
        left: 50%;
        bottom: calc(24px + var(--tabbar-h, 0px));
        z-index: 60;
        display: flex;
        align-items: center;
        gap: 16px;
        max-width: calc(100vw - 32px);
        padding: 8px 8px 8px 18px;
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        box-shadow: var(--shadow-l);
        color: var(--label);
        transform: translateX(-50%);
        animation: rise var(--fast) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translate(-50%, 8px);
        }
    }
    span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    button {
        flex: none;
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
        cursor: pointer;
    }
    @media (pointer: coarse) {
        button {
            height: 40px;
        }
    }
    @media (prefers-reduced-transparency: reduce) {
        .undo {
            background: var(--elevated-2);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
</style>
