<script lang="ts">
    // Choose a Username: asked once, when your username is still the
    // user_a1b2c3 a Stremio sign-in was given (the tracker says handle_needed).
    // Whether one's free shows as you type; Not Now asks again next time the
    // app opens. A modal <dialog>, as New List (a sheet on iPhone). Not on TV:
    // typing there is slow; it can wait for the phone or PC.
    import { tracker } from '$lib/tracker.svelte';
    import { app } from '$lib/app.svelte';
    import { isTV } from '$lib/platform';
    import { lb } from '$lib/tracker/api';

    const SKIP = 'handle-prompt-skipped';
    let open = $state(false);
    let asked = false;
    $effect(() => {
        const uid = app.user?._id;
        if (isTV || asked || !uid || !tracker.ready) return;
        asked = true;
        try {
            if (sessionStorage.getItem(`${SKIP}:${uid}`)) return;
        } catch {}
        lb.profile().then((p) => {
            if (p?.handle_needed && app.user?._id === uid) open = true;
        });
    });

    let handle = $state('');
    let dialog = $state<HTMLDialogElement>();
    let field = $state<HTMLInputElement>();
    let busy = $state(false);
    let error = $state<string | null>(null);
    /** For what's typed: null while checking or too short to ask. */
    let check = $state<{ handle: string; available: boolean; reason: string | null } | null>(null);

    $effect(() => {
        if (!open) return;
        dialog?.showModal();
        field?.focus();
    });

    const wellFormed = $derived(/^[a-z0-9_]{3,24}$/.test(handle));
    let timer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        const h = handle;
        clearTimeout(timer);
        check = null;
        error = null;
        if (!/^[a-z0-9_]{3,24}$/.test(h)) return;
        timer = setTimeout(async () => {
            const res = await lb.handleAvailable(h);
            if (res && h === handle) check = { handle: h, ...res };
        }, 350);
        return () => clearTimeout(timer);
    });
    const status = $derived(
        handle && !wellFormed
            ? { ok: false, text: '3 to 24 letters, numbers or underscores.' }
            : check
              ? check.available
                  ? { ok: true, text: 'Available' }
                  : { ok: false, text: check.reason ?? 'Not available.' }
              : null
    );

    function later() {
        try {
            const uid = app.user?._id;
            if (uid) sessionStorage.setItem(`${SKIP}:${uid}`, '1');
        } catch {}
        dialog?.close();
        open = false;
    }
    async function save() {
        if (!wellFormed || busy || check?.available === false) return;
        busy = true;
        const res = await lb.updateProfile({ handle });
        busy = false;
        if ('data' in res) {
            dialog?.close();
            open = false;
            return;
        }
        error = res.detail ?? 'Couldn’t save it. Try again in a moment.';
    }
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            later();
        }
    }
</script>

{#if open}
    <dialog bind:this={dialog} aria-labelledby="handle-heading" {onkeydown}>
        <form
            class="body"
            onsubmit={(e) => {
                e.preventDefault();
                save();
            }}
        >
            <div class="toolbar">
                <button type="button" class="bar-btn" onclick={later}>Not Now</button>
                <span class="bar-title" aria-hidden="true">Username</span>
                <button type="submit" class="bar-btn strong" disabled={!wellFormed || busy || check?.available === false}>Save</button>
            </div>
            <h2 id="handle-heading">Choose a Username</h2>
            <p class="lede">It’s how friends find you, and your profile’s link.</p>
            <label class="field">
                <span aria-hidden="true">@</span>
                <input
                    bind:this={field}
                    bind:value={handle}
                    maxlength="24"
                    placeholder="username"
                    aria-label="Username"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    oninput={() => (handle = handle.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                />
            </label>
            {#if error}
                <p class="status bad" role="alert">{error}</p>
            {:else if status}
                <p class="status" class:bad={!status.ok} class:good={status.ok} aria-live="polite">{status.text}</p>
            {/if}
            <footer>
                <button type="button" class="btn" onclick={later}>Not Now</button>
                <button type="submit" class="btn primary" disabled={!wellFormed || busy || check?.available === false}>{busy ? 'Saving…' : 'Save'}</button>
            </footer>
        </form>
    </dialog>
{/if}

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
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .lede {
        margin: 0 0 4px;
        color: var(--label-2);
        font-size: var(--text-callout);
    }
    .field {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label-2);
    }
    .field:focus-within {
        border-color: var(--accent);
    }
    .field input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
        font: inherit;
    }
    .status {
        margin: 0 2px;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
    .status.good {
        color: var(--ok);
    }
    .status.bad {
        color: var(--bad-text);
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
    @media (pointer: coarse) {
        .btn,
        .field {
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
