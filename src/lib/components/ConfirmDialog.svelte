<script lang="ts">
    // A question before something that matters: a title, what it means, and two
    // buttons that say what they do. A modal <dialog>, centred as an alert on
    // every screen; Cancel has the focus, and Escape (the TV remote's Back)
    // cancels.
    import type { Snippet } from 'svelte';

    let {
        title,
        confirmLabel,
        destructive = false,
        onconfirm,
        onclose,
        children,
    }: {
        title: string;
        confirmLabel: string;
        destructive?: boolean;
        onconfirm: () => void;
        onclose: () => void;
        children?: Snippet;
    } = $props();

    let dialog = $state<HTMLDialogElement>();
    let cancel = $state<HTMLButtonElement>();
    $effect(() => {
        dialog?.showModal();
        cancel?.focus();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="confirm-heading" aria-describedby="confirm-body" {onkeydown}>
    <div class="body">
        <h2 id="confirm-heading">{title}</h2>
        <div id="confirm-body">{@render children?.()}</div>
        <footer>
            <button bind:this={cancel} type="button" class="btn" onclick={onclose}>Cancel</button>
            <button type="button" class="btn" class:destructive class:primary={!destructive} onclick={onconfirm}>{confirmLabel}</button>
        </footer>
    </div>
</dialog>

<style>
    dialog {
        width: min(420px, calc(100vw - 32px));
        max-width: none;
        margin: auto;
        padding: 0;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--glass-strong);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.55);
        color: var(--label);
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.5);
    }
    @media (prefers-reduced-transparency: reduce) {
        dialog {
            background: var(--elevated-2);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    .body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    #confirm-body :global(p) {
        margin: 0 0 8px;
        color: var(--label-2);
        line-height: 1.45;
    }
    #confirm-body :global(ul) {
        margin: 0 0 8px;
        padding-left: 18px;
        color: var(--label-2);
        line-height: 1.45;
    }
    footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 6px;
    }
    .btn {
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .btn.primary {
        background: var(--accent);
        color: var(--on-accent);
    }
    .btn.destructive {
        color: var(--bad-text);
    }
    @media (pointer: coarse) {
        .btn {
            height: 44px;
        }
    }
    @media (max-width: 480px) {
        footer {
            flex-direction: column-reverse;
        }
        .btn {
            width: 100%;
        }
    }
</style>
