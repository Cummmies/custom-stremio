<script lang="ts">
    import { core } from '$lib/core';

    let { onclose }: { onclose: () => void } = $props();

    let email = $state('');
    let password = $state('');
    let error = $state('');
    let busy = $state(false);

    $effect(() =>
        core.onEvent((event, args) => {
            if (event === 'UserAuthenticated') onclose();
            if (event === 'Error' && args?.source?.event === 'UserAuthenticated') {
                error = args.error?.message ?? 'Login failed';
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

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
    <form class="dialog" onsubmit={submit}>
        <h2>Log in to Stremio</h2>
        <p class="hint">Your library, addons and watch progress sync with the official apps.</p>
        <input type="email" placeholder="Email" autocomplete="email" bind:value={email} required />
        <input type="password" placeholder="Password" autocomplete="current-password" bind:value={password} required />
        {#if error}<p class="error">{error}</p>{/if}
        <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
    </form>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        background: rgb(0 0 0 / 0.6);
        display: grid;
        place-items: center;
        z-index: 10;
    }
    .dialog {
        width: min(380px, calc(100vw - 32px));
        background: var(--surface-2);
        border-radius: 16px;
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    h2 {
        margin: 0;
    }
    .hint {
        margin: 0 0 8px;
        color: var(--text-dim);
        font-size: 0.9rem;
    }
    input {
        background: var(--surface);
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 12px 14px;
        color: var(--text);
        font: inherit;
    }
    input:focus {
        outline: none;
        border-color: var(--accent);
    }
    button {
        margin-top: 4px;
        padding: 12px;
        border: 0;
        border-radius: 10px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    button:disabled {
        opacity: 0.6;
    }
    .error {
        color: #ff7a7a;
        margin: 0;
        font-size: 0.9rem;
    }
</style>
