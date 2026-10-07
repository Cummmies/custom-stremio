<script lang="ts">
    // What's New ($lib/whatsNew.svelte.ts): what changed in the update.
    import { whatsNew } from '$lib/whatsNew.svelte';

    let dialog = $state<HTMLDialogElement>();

    $effect(() => {
        if (whatsNew.open && dialog && !dialog.open) dialog.showModal();
    });
</script>

{#if whatsNew.open}
    <dialog bind:this={dialog} aria-labelledby="whats-new-title" onclose={() => (whatsNew.open = false)}>
        <h2 id="whats-new-title">What’s New</h2>
        <ul>
            {#each whatsNew.items as change (change.at + change.text)}
                <li>{change.text}</li>
            {/each}
        </ul>
        {#if whatsNew.more}<p class="more">And more.</p>{/if}
        <button class="continue" onclick={() => dialog?.close()}>Continue</button>
    </dialog>
{/if}

<style>
    dialog {
        width: min(460px, calc(100vw - 32px));
        max-height: min(640px, calc(100vh - 64px));
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 28px;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
    }
    dialog:not([open]) {
        display: none;
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.55);
    }
    dialog[open] {
        animation: rise var(--slow) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
        }
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    ul {
        margin: 0;
        padding: 0 0 0 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        line-height: 1.4;
    }
    li::marker {
        color: var(--label-3);
    }
    .more {
        margin: 0;
        color: var(--label-2);
        font-size: 13px;
    }
    .continue {
        align-self: stretch;
        height: 40px;
        margin-top: 4px;
        border: 0;
        border-radius: var(--radius);
        background: var(--accent);
        color: white;
        font-weight: 600;
        cursor: pointer;
    }
    @media (pointer: coarse) {
        .continue {
            height: 50px;
            font-size: 17px;
        }
    }
    :global(html.tv) dialog {
        width: 640px;
    }
    :global(html.tv) ul {
        font-size: 18px;
    }
</style>
