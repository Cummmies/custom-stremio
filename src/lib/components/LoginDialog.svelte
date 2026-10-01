<script lang="ts">
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import Icon from './Icon.svelte';
    import LinkLogin from './LinkLogin.svelte';
    import { isTV } from '$lib/platform';

    let { onclose }: { onclose: () => void } = $props();

    // Captured once so the heading doesn't change mid-login.
    const adding = app.loginMode === 'add' && !!app.user;

    let email = $state('');
    let password = $state('');
    let error = $state('');
    let busy = $state(false);
    // On a TV, typing with the remote is painful: log in with a code by default.
    let withCode = $state(isTV);
    let dialog = $state<HTMLDialogElement>();

    // Native <dialog> gives focus trapping, Escape to close and a top layer for free.
    $effect(() => {
        dialog?.showModal();
    });

    $effect(() =>
        core.onEvent((event, args) => {
            if (event === 'UserAuthenticated') onclose();
            if (event === 'Error' && args?.source?.event === 'UserAuthenticated') {
                error = args.error?.message ?? 'Couldn’t log in. Check your email and password.';
                busy = false;
            }
        })
    );

    function submit(e: SubmitEvent) {
        e.preventDefault();
        error = '';
        busy = true;
        core.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email, password } } });
    }
</script>

<dialog
    bind:this={dialog}
    aria-labelledby="login-title"
    onclose={onclose}
    onclick={(e) => e.target === dialog && dialog?.close()}
>
    <form onsubmit={submit}>
        <button type="button" class="close" onclick={() => dialog?.close()} aria-label="Close">
            <Icon name="close" size={16} />
        </button>
        {#if adding}
            <h2 id="login-title">Add a Profile</h2>
            <p class="hint">Log in with another Stremio account. It’s saved on this {isTV ? 'TV' : 'PC'}, so you can switch between profiles anytime without logging in again.</p>
        {:else}
            <h2 id="login-title">Log In to Stremio</h2>
            <p class="hint">Your library, addons and watch progress stay in sync with your other Stremio apps.</p>
        {/if}

        {#if withCode}
            <LinkLogin />
            <div class="actions">
                <button type="button" class="secondary" onclick={() => (withCode = false)}>Use Email Instead</button>
                <button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
            </div>
        {:else}
        <label>
            <span>Email</span>
            <input type="email" autocomplete="email" bind:value={email} required disabled={busy} />
        </label>
        <label>
            <span>Password</span>
            <input type="password" autocomplete="current-password" bind:value={password} required disabled={busy} />
        </label>

        {#if error}<p class="error" role="alert">{error}</p>{/if}

        <div class="actions">
            <button type="button" class="secondary link-btn" onclick={() => (withCode = true)}>Log In With a Code</button>
            <button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
            <button type="submit" class="primary" disabled={busy || !email || !password}>
                {busy ? 'Logging In…' : 'Log In'}
            </button>
        </div>
        {/if}
    </form>
</dialog>

<style>
    dialog {
        width: min(560px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
    }
    dialog[open] {
        animation: rise var(--slow) var(--ease);
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.55);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
        }
    }
    form {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 28px;
    }
    .close {
        position: absolute;
        top: 14px;
        right: 14px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label-2);
        cursor: pointer;
    }
    .close:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .hint {
        margin: -4px 0 6px;
        color: var(--label-2);
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--label-2);
    }
    input {
        height: 40px;
        padding: 0 12px;
        border-radius: var(--radius);
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
        font-size: var(--text-body);
    }
    input:focus {
        outline: none;
        border-color: var(--accent-hover);
        box-shadow: 0 0 0 3px rgb(109 74 240 / 0.35);
    }
    .error {
        margin: 0;
        color: var(--bad);
        font-size: 13px;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 6px;
    }
    .actions button {
        height: 36px;
        padding: 0 18px;
        border: 0;
        border-radius: var(--radius);
        font-weight: 600;
        cursor: pointer;
    }
    .secondary {
        background: var(--fill);
    }
    .link-btn {
        margin-right: auto;
    }
    .secondary:hover {
        background: var(--fill-hover);
    }
    .primary {
        background: var(--accent);
        color: white;
    }
    .primary:hover:not(:disabled) {
        background: var(--accent-hover);
    }
    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
