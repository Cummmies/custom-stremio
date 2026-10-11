<script lang="ts">
    // Name a new Lightboxd list. A modal <dialog>: focus stays inside, Escape
    // (the TV remote's Back) closes it; on iPhone a sheet with Cancel and
    // Create in its top bar, as the rating sheet.
    let {
        busy = false,
        error = null,
        oncreate,
        onclose,
    }: { busy?: boolean; error?: string | null; oncreate: (name: string) => void; onclose: () => void } = $props();

    const MAX = 100;
    let name = $state('');
    let dialog = $state<HTMLDialogElement>();
    let field = $state<HTMLInputElement>();
    $effect(() => {
        dialog?.showModal();
        field?.focus();
    });
    const valid = $derived(name.trim().length > 0 && name.trim().length <= MAX);

    function create() {
        if (valid && !busy) oncreate(name.trim());
    }
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            // Handled here, so the TV remote's Back doesn't also leave the page.
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="new-list-heading" {onkeydown} onclick={(e) => e.target === dialog && onclose()}>
    <form
        class="body"
        onsubmit={(e) => {
            e.preventDefault();
            create();
        }}
    >
        <div class="toolbar">
            <button type="button" class="bar-btn" onclick={onclose}>Cancel</button>
            <span class="bar-title" aria-hidden="true">New List</span>
            <button type="submit" class="bar-btn strong" disabled={!valid || busy}>Create</button>
        </div>
        <h2 id="new-list-heading">New List</h2>
        <label class="label" for="new-list-name">Name</label>
        <input id="new-list-name" bind:this={field} bind:value={name} maxlength={MAX} placeholder="Comfort Rewatches" autocomplete="off" />
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <footer>
            <button type="button" class="btn" onclick={onclose}>Cancel</button>
            <button type="submit" class="btn primary" disabled={!valid || busy}>{busy ? 'Creating…' : 'Create'}</button>
        </footer>
    </form>
</dialog>

<style>
    dialog {
        width: min(400px, calc(100vw - 32px));
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
    .toolbar {
        display: none;
    }
    h2 {
        margin: 0 0 6px;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .label {
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    input {
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font: inherit;
    }
    input::placeholder {
        color: var(--label-2);
    }
    .error {
        margin: 0;
        font-size: 13px;
        color: var(--bad);
    }
    footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
    }
    .btn {
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .btn.primary {
        background: var(--label);
        color: var(--bg);
    }
    .btn:disabled,
    .bar-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    :global(html.tv) .btn.primary:not(:focus) {
        background: var(--fill-hover);
        color: var(--label);
    }
    @media (pointer: coarse) {
        .btn,
        input {
            height: 44px;
        }
    }
    @media (max-width: 700px) {
        dialog {
            width: 100%;
            margin: auto 0 0;
            border-radius: var(--radius-l) var(--radius-l) 0 0;
            border-bottom: 0;
        }
        .body {
            padding: 8px 16px calc(20px + var(--safe-bottom, 0px));
        }
        .toolbar {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            margin: 0 -8px 8px;
        }
        .bar-btn {
            min-height: 44px;
            padding: 0 8px;
            border: 0;
            background: none;
            color: var(--label);
            font-size: 17px;
            cursor: pointer;
            justify-self: start;
        }
        .bar-btn.strong {
            justify-self: end;
            font-weight: 600;
        }
        .bar-title {
            font-size: 17px;
            font-weight: 600;
        }
        h2,
        footer {
            display: none;
        }
    }
</style>
