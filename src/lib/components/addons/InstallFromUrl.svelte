<script lang="ts">
    // Install an addon by pasting its manifest URL (how most configured addons are shared).
    import { core } from '$lib/core';
    import Icon from '../Icon.svelte';
    import type { AddonDescriptor } from './AddonCard.svelte';

    let { onclose, initialUrl = '' }: { onclose: () => void; initialUrl?: string } = $props();

    let dialog = $state<HTMLDialogElement>();
    // svelte-ignore state_referenced_locally
    let url = $state(initialUrl);
    let error = $state('');
    let busy = $state(false);
    let found = $state<AddonDescriptor | null>(null);

    $effect(() => {
        dialog?.showModal();
    });

    // Opened from a link on an addon's website: look it up right away.
    $effect(() => {
        if (initialUrl) check();
    });

    function normalize(raw: string) {
        // stremio:// links are just https manifest URLs with another scheme.
        let u = raw.trim().replace(/^stremio:\/\//, 'https://');
        if (!/manifest\.json(\?.*)?$/.test(u)) u = u.replace(/\/?$/, '/manifest.json');
        return u;
    }

    function lookUp(e: SubmitEvent) {
        e.preventDefault();
        if (found) install();
        else check();
    }

    async function check() {
        error = '';
        busy = true;
        try {
            const transportUrl = normalize(url);
            const res = await fetch(transportUrl);
            if (!res.ok) throw new Error(`The server answered ${res.status}.`);
            const manifest = await res.json();
            if (!manifest?.id || !manifest?.name) throw new Error('That link isn’t a Stremio addon manifest.');
            found = { transportUrl, manifest, flags: { official: false, protected: false } };
        } catch (err) {
            error =
                err instanceof TypeError
                    ? 'Couldn’t reach that address. Check the link and your connection.'
                    : (err as Error).message;
        } finally {
            busy = false;
        }
    }

    function install() {
        if (!found) return;
        core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: found } });
        dialog?.close();
    }
</script>

<dialog bind:this={dialog} aria-labelledby="install-title" {onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
    <form onsubmit={lookUp}>
        <button type="button" class="close" onclick={() => dialog?.close()} aria-label="Close">
            <Icon name="close" size={16} />
        </button>
        <h2 id="install-title">Install from URL</h2>
        <p class="hint">Paste an addon’s manifest link, like the one a configure page gives you.</p>

        <label>
            <span>Manifest URL</span>
            <input
                type="url"
                bind:value={url}
                oninput={() => (found = null)}
                placeholder="https://example.com/manifest.json"
                required
                disabled={busy}
                spellcheck="false"
            />
        </label>

        {#if found}
            <div class="preview">
                {#if found.manifest.logo}<img src={found.manifest.logo} alt="" />{/if}
                <div>
                    <strong>{found.manifest.name}</strong> <span class="ver">v{found.manifest.version}</span>
                    {#if found.manifest.description}<p>{found.manifest.description}</p>{/if}
                </div>
            </div>
        {/if}

        {#if error}<p class="error" role="alert">{error}</p>{/if}

        <div class="actions">
            <button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
            <button type="submit" class="primary" disabled={busy || !url.trim()}>
                {busy ? 'Checking…' : found ? `Install ${found.manifest.name}` : 'Continue'}
            </button>
        </div>
    </form>
</dialog>

<style>
    dialog {
        width: min(460px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
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
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .hint {
        margin: -4px 0 4px;
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
    }
    input:focus {
        outline: none;
        border-color: var(--accent-hover);
        box-shadow: 0 0 0 3px rgb(109 74 240 / 0.35);
    }
    .preview {
        display: flex;
        gap: 12px;
        padding: 12px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .preview img {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        object-fit: contain;
    }
    .preview p {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--label-2);
    }
    .ver {
        color: var(--label-2);
        font-size: var(--text-caption);
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
        margin-top: 4px;
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
    .primary {
        background: var(--accent);
        color: white;
    }
    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
