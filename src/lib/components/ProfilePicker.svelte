<script lang="ts">
    import { goto } from '$app/navigation';
    import { app } from '$lib/app.svelte';
    import { profiles, PROFILE_COLORS, type SavedProfile } from '$lib/profiles.svelte';
    import Icon from './Icon.svelte';
    import Toggle from './Toggle.svelte';

    let dialog = $state<HTMLDialogElement>();
    let managing = $state(false);
    let editing = $state<string | null>(null);
    let confirmRemove = $state(false);
    let draftName = $state('');

    const currentUid = $derived(app.user?._id ?? null);
    const sorted = $derived([...profiles.list].sort((a, b) => a.name.localeCompare(b.name)));
    const editingProfile = $derived(profiles.list.find((p) => p.uid === editing) ?? null);

    $effect(() => {
        dialog?.showModal();
    });

    function close() {
        dialog?.close();
    }

    async function pick(p: SavedProfile) {
        if (managing) return startEdit(p);
        if (profiles.switching) return;
        if (p.uid === currentUid) return close();
        if (await profiles.switchTo(p.uid, currentUid)) {
            close();
            goto('/');
        }
    }

    function startEdit(p: SavedProfile) {
        editing = p.uid;
        draftName = p.name;
        confirmRemove = false;
    }

    function saveName() {
        const name = draftName.trim();
        if (editing && name) profiles.update(editing, { name });
    }

    function remove(p: SavedProfile) {
        if (!confirmRemove) return (confirmRemove = true);
        if (p.uid === currentUid) app.logout();
        else profiles.remove(p.uid);
        editing = null;
        confirmRemove = false;
    }

    function add() {
        close();
        app.addProfile();
    }
</script>

<dialog bind:this={dialog} class="picker" aria-labelledby="picker-title" onclose={() => (profiles.pickerOpen = false)}>
    <button class="close" onclick={close} aria-label="Close"><Icon name="close" size={18} /></button>

    <div class="content">
        <h1 id="picker-title">{managing ? 'Manage Profiles' : 'Who’s watching?'}</h1>

        <ul class="grid">
            {#each sorted as p (p.uid)}
                {@const current = p.uid === currentUid}
                {@const busy = profiles.switching === p.uid}
                <li>
                    <button
                        class="tile"
                        class:current
                        class:editing={editing === p.uid}
                        onclick={() => pick(p)}
                        disabled={!!profiles.switching && !busy}
                        aria-label={managing ? `Edit ${p.name}` : current ? `${p.name} (current profile)` : `Switch to ${p.name}`}
                        aria-busy={busy}
                    >
                        <span class="avatar" style:--c={p.color}>
                            {#if managing}
                                <span class="badge" aria-hidden="true"><Icon name="gear" size={40} /></span>
                            {:else}
                                <span class="initial" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                            {/if}
                            {#if busy}<span class="spinner" aria-hidden="true"></span>{/if}
                            {#if current && !managing}<span class="check" aria-hidden="true"><Icon name="check" size={14} /></span>{/if}
                        </span>
                        <span class="name">{p.name}</span>
                        <span class="email">{p.email}</span>
                    </button>
                </li>
            {/each}
            {#if !managing}
                <li>
                    <button class="tile" onclick={add} disabled={!!profiles.switching}>
                        <span class="avatar add"><Icon name="plus" size={36} /></span>
                        <span class="name">Add Profile</span>
                        <span class="email">Another Stremio account</span>
                    </button>
                </li>
            {/if}
        </ul>

        {#if profiles.error}
            <div class="error" role="alert">
                <span>{profiles.error}</span>
                <button onclick={add}>Log In Again</button>
            </div>
        {/if}

        {#if managing && editingProfile}
            <div class="editor">
                <label class="field">
                    <span>Name</span>
                    <input bind:value={draftName} onblur={saveName} onkeydown={(e) => e.key === 'Enter' && (saveName(), (e.currentTarget as HTMLInputElement).blur())} maxlength="24" />
                </label>
                <div class="field">
                    <span>Color</span>
                    <div class="swatches" role="radiogroup" aria-label="Profile color">
                        {#each PROFILE_COLORS as c (c)}
                            <button
                                class="swatch"
                                class:on={editingProfile.color === c}
                                style:--c={c}
                                role="radio"
                                aria-checked={editingProfile.color === c}
                                aria-label={c}
                                onclick={() => profiles.update(editingProfile.uid, { color: c })}
                            ></button>
                        {/each}
                    </div>
                </div>
                <button class="remove" onclick={() => remove(editingProfile)}>
                    {#if confirmRemove}
                        {editingProfile.uid === currentUid ? 'Log Out and Remove' : 'Remove from This PC'}
                    {:else}
                        <Icon name="trash" size={15} /> Remove Profile
                    {/if}
                </button>
                <p class="hint">
                    {#if editingProfile.uid === currentUid}
                        This is the profile you’re using, so removing it also logs you out.
                    {:else}
                        Removes it from this PC only. The Stremio account and its library stay as they are.
                    {/if}
                </p>
            </div>
        {/if}

        <div class="footer">
            <button
                class="secondary"
                onclick={() => {
                    managing = !managing;
                    editing = null;
                    confirmRemove = false;
                }}
            >
                {managing ? 'Done' : 'Manage Profiles'}
            </button>
            {#if !managing}
                <div class="launch">
                    <Toggle label="Ask who’s watching when the app opens" checked={profiles.askOnLaunch} onchange={(v) => profiles.setAskOnLaunch(v)} />
                    <span aria-hidden="true">Ask when the app opens</span>
                </div>
            {/if}
        </div>
    </div>
</dialog>

<style>
    .picker {
        width: 100vw;
        height: 100vh;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 0;
        border: 0;
        color: var(--label);
        background:
            radial-gradient(1200px 600px at 50% 0%, rgb(109 74 240 / 0.18), transparent 70%),
            rgb(10 10 14 / 0.96);
    }
    .picker::backdrop {
        background: rgb(0 0 0 / 0.6);
        backdrop-filter: blur(12px);
    }
    .picker[open] {
        animation: fade var(--slow) var(--ease);
    }
    @keyframes fade {
        from {
            opacity: 0;
        }
    }
    .close {
        position: absolute;
        top: 20px;
        right: 20px;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
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
    .content {
        min-height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 36px;
        padding: 64px 24px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(30px, 4vw, 44px);
        font-weight: 700;
        letter-spacing: -0.02em;
        animation: rise var(--slow) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
    }
    .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 28px;
        max-width: 900px;
    }
    .tile {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        width: 148px;
        border-radius: 20px;
        padding: 6px;
    }
    .tile:disabled {
        cursor: default;
        opacity: 0.5;
    }
    .avatar {
        position: relative;
        display: grid;
        place-items: center;
        width: 132px;
        height: 132px;
        margin-bottom: 8px;
        border-radius: 30px;
        background: linear-gradient(145deg, color-mix(in srgb, var(--c) 100%, white 18%), color-mix(in srgb, var(--c) 100%, black 32%));
        box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    .initial {
        font-family: var(--font-display);
        font-size: 56px;
        font-weight: 700;
        color: white;
        text-shadow: 0 2px 12px rgb(0 0 0 / 0.25);
    }
    .tile:hover:not(:disabled) .avatar,
    .tile:focus-visible .avatar,
    .tile.editing .avatar {
        transform: translateY(-4px) scale(1.03);
        box-shadow:
            0 0 0 3px var(--label),
            0 16px 36px rgb(0 0 0 / 0.45);
    }
    .tile.current .avatar {
        box-shadow:
            0 0 0 3px rgb(255 255 255 / 0.35),
            0 10px 30px rgb(0 0 0 / 0.35);
    }
    .avatar.add {
        background: transparent;
        border: 2px dashed rgb(255 255 255 / 0.25);
        box-shadow: none;
        color: var(--label-2);
    }
    .tile:hover .avatar.add {
        border-color: var(--label);
        color: var(--label);
    }
    .check {
        position: absolute;
        right: -6px;
        bottom: -6px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--label);
        color: var(--bg);
        box-shadow: 0 0 0 3px rgb(10 10 14);
    }
    .badge {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        border-radius: inherit;
        background: rgb(0 0 0 / 0.3);
        color: white;
    }
    .spinner {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 3px solid rgb(255 255 255 / 0.3);
        border-top-color: white;
        animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
        to {
            rotate: 360deg;
        }
    }
    .name {
        font-weight: 600;
        font-size: var(--text-callout);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .email {
        font-size: var(--text-caption);
        color: var(--label-2);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .error {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 12px 12px 16px;
        border-radius: var(--radius);
        background: rgb(255 69 58 / 0.12);
        border: 1px solid rgb(255 69 58 / 0.35);
        font-size: 13px;
    }
    .error button {
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .editor {
        width: min(420px, 100%);
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        animation: rise var(--slow) var(--ease);
    }
    .field {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--label-2);
    }
    .field input {
        height: 40px;
        padding: 0 12px;
        border-radius: var(--radius);
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
        font-size: var(--text-body);
    }
    .field input:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .swatches {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }
    .swatch {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--c);
        cursor: pointer;
        transition: transform var(--fast) var(--ease);
    }
    .swatch:hover {
        transform: scale(1.1);
    }
    .swatch.on {
        box-shadow:
            0 0 0 2px var(--elevated),
            0 0 0 4px var(--label);
    }
    .remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 36px;
        border: 0;
        border-radius: var(--radius);
        background: rgb(255 69 58 / 0.14);
        color: #ff6961;
        font-weight: 600;
        cursor: pointer;
    }
    .remove:hover {
        background: var(--bad);
        color: white;
    }
    .hint {
        margin: -6px 0 0;
        font-size: var(--text-caption);
        color: var(--label-2);
        text-align: center;
    }
    .footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
    }
    .secondary {
        height: 40px;
        padding: 0 22px;
        border: 1px solid rgb(255 255 255 / 0.25);
        border-radius: 999px;
        background: transparent;
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .secondary:hover {
        background: var(--fill-hover);
    }
    .launch {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: var(--label-2);
    }
    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 2s;
        }
    }
</style>
