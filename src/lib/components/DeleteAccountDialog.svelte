<script lang="ts">
    // Delete Account's confirmation: what goes, what stays (the Stremio account),
    // and a red button that says what it does. A modal <dialog>, centred as an
    // alert on every screen; Escape (the TV remote's Back) cancels.
    let {
        busy = false,
        error = null,
        ondelete,
        onclose,
    }: { busy?: boolean; error?: string | null; ondelete: () => void; onclose: () => void } = $props();

    let dialog = $state<HTMLDialogElement>();
    let cancel = $state<HTMLButtonElement>();
    $effect(() => {
        dialog?.showModal();
        // Cancel has focus, so Enter never deletes by accident.
        cancel?.focus();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (!busy) onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="delete-heading" aria-describedby="delete-body" {onkeydown}>
    <div class="body">
        <h2 id="delete-heading">Delete your account?</h2>
        <div id="delete-body">
            <p>
                Your watch history, scores, reviews, lists, friends and profile are deleted from every device. This can’t be
                undone, so download a backup first if you want a copy.
            </p>
            <p>
                Your Stremio account isn’t affected: your Stremio library and what’s saved with it stay. To remove those too,
                delete your Stremio account at stremio.com.
            </p>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <footer>
            <button bind:this={cancel} type="button" class="btn" onclick={onclose} disabled={busy}>Cancel</button>
            <button type="button" class="btn destructive" onclick={ondelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete Account'}
            </button>
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
    p {
        margin: 0 0 8px;
        color: var(--label-2);
        line-height: 1.45;
    }
    .error {
        margin: 0;
        font-size: 13px;
        color: var(--bad-text);
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
    .btn.destructive {
        color: var(--bad-text);
    }
    .btn:disabled {
        opacity: 0.5;
        cursor: default;
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
