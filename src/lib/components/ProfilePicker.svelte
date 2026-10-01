<script lang="ts">
    // Full-screen profiles: "Who's watching?", Add Profile and Edit Profile.
    // A profile is a Stremio account saved on this PC, so adding one is a log-in.
    // A modal task with an obvious way out: Esc, the close button, Back or Cancel.
    import { goto } from '$app/navigation';
    import { app } from '$lib/app.svelte';
    import { core } from '$lib/core';
    import { imageToAvatar, profiles, PROFILE_COLORS, type SavedProfile } from '$lib/profiles.svelte';
    import { menu } from '$lib/menu.svelte';
    import Icon from './Icon.svelte';
    import Avatar from './Avatar.svelte';
    import Toggle from './Toggle.svelte';
    import logo from '$lib/assets/logo.png';

    let dialog = $state<HTMLDialogElement>();
    let view = $state<'pick' | 'add' | 'edit'>(profiles.pickerView);
    let managing = $state(false);

    const currentUid = $derived(app.user?._id ?? null);
    const sorted = $derived([...profiles.list].sort((a, b) => a.name.localeCompare(b.name)));

    $effect(() => {
        dialog?.showModal();
    });

    function close() {
        dialog?.close();
    }

    function onclose() {
        profiles.pickerOpen = false;
        profiles.pickerView = 'pick';
    }

    // --- Who's watching --------------------------------------------------------

    async function pick(p: SavedProfile) {
        if (managing) return startEdit(p);
        if (profiles.switching) return;
        if (p.uid === currentUid) return close();
        if (await profiles.switchTo(p.uid, currentUid)) {
            close();
            goto('/');
        }
    }

    // --- Add / Edit --------------------------------------------------------------

    let editingUid = $state<string | null>(null);
    let draftName = $state('');
    let draftColor = $state(PROFILE_COLORS[0]);
    let draftAvatar = $state<string | undefined>(undefined);
    let email = $state('');
    let password = $state('');
    let error = $state('');
    let busy = $state(false);
    let confirmRemove = $state(false);
    let fileInput = $state<HTMLInputElement>();
    let nameInput = $state<HTMLInputElement>();

    const editing = $derived(profiles.list.find((p) => p.uid === editingUid) ?? null);
    const draft = $derived({ name: draftName || email || '?', color: draftColor, avatar: draftAvatar });

    function startAdd() {
        view = 'add';
        editingUid = null;
        draftName = '';
        draftColor = PROFILE_COLORS[profiles.list.length % PROFILE_COLORS.length];
        draftAvatar = undefined;
        email = password = error = '';
        busy = false;
        focusName();
    }

    function startEdit(p: SavedProfile) {
        view = 'edit';
        editingUid = p.uid;
        draftName = p.name;
        draftColor = p.color;
        draftAvatar = p.avatar;
        error = '';
        confirmRemove = false;
        focusName();
    }

    function focusName() {
        queueMicrotask(() => nameInput?.focus());
    }

    function back() {
        view = 'pick';
        busy = false;
    }

    // Opened straight into Add Profile (e.g. from a menu).
    $effect(() => {
        if (profiles.pickerView === 'add' && view === 'add' && !email && !draftName) startAdd();
    });

    function pictureMenu(e: MouseEvent) {
        if (!draftAvatar) return fileInput?.click();
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { label: 'Upload New Photo…', onselect: () => fileInput?.click() },
                { label: 'Remove Photo', destructive: true, onselect: () => (draftAvatar = undefined) },
            ],
            'end'
        );
    }

    async function onfile() {
        const file = fileInput?.files?.[0];
        if (fileInput) fileInput.value = '';
        if (!file) return;
        try {
            draftAvatar = await imageToAvatar(file);
            error = '';
        } catch {
            error = 'That picture couldn’t be used. Try a JPG or PNG.';
        }
    }

    // Adding logs in to the account; once Stremio answers and the profile is saved,
    // it gets the name, color and picture chosen here.
    let pendingDraft: { name: string; color: string; avatar?: string } | null = null;
    $effect(() =>
        core.onEvent((event, args) => {
            if (!busy || view !== 'add') return;
            if (event === 'Error' && args?.source?.event === 'UserAuthenticated') {
                error = args.error?.message ?? 'Couldn’t log in. Check the email and password.';
                busy = false;
                pendingDraft = null;
            }
        })
    );
    $effect(() => {
        const uid = app.user?._id;
        if (!pendingDraft || !uid || !profiles.get(uid) || app.user?.email?.toLowerCase() !== email.trim().toLowerCase()) return;
        const { name, color, avatar } = pendingDraft;
        pendingDraft = null;
        profiles.update(uid, { ...(name ? { name } : {}), color, ...(avatar ? { avatar } : {}) });
        busy = false;
        close();
        goto('/');
    });

    function submit(e: SubmitEvent) {
        e.preventDefault();
        if (view === 'edit') {
            if (editing) profiles.update(editing.uid, { name: draftName.trim() || editing.name, color: draftColor, avatar: draftAvatar });
            return back();
        }
        error = '';
        busy = true;
        pendingDraft = { name: draftName.trim(), color: draftColor, avatar: draftAvatar };
        core.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email: email.trim(), password } } });
    }

    function remove() {
        if (!editing) return;
        if (!confirmRemove) return (confirmRemove = true);
        if (editing.uid === currentUid) app.logout();
        else profiles.remove(editing.uid);
        confirmRemove = false;
        back();
    }
</script>

<dialog bind:this={dialog} class="picker" aria-labelledby="picker-title" {onclose}>
    <!-- Brand backdrop: never a profile's own shows. -->
    <div class="art" aria-hidden="true"><span></span><span></span><span></span></div>

    {#if view === 'pick'}
        <header class="bar">
            <span class="brand"><img src={logo} alt="" width="28" height="28" />Stremio</span>
            <div class="bar-actions">
                <button class="pill" onclick={() => (managing = !managing)} aria-pressed={managing}>
                    {#if managing}Done{:else}<span class="long">Manage Profiles</span><span class="short">Edit</span>{/if}
                </button>
                <button class="icon-btn" onclick={close} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
        </header>

        <div class="content">
            <h1 id="picker-title">{managing ? 'Manage Profiles' : 'Who’s watching?'}</h1>

            <ul class="grid">
                {#each sorted as p, i (p.uid)}
                    {@const current = p.uid === currentUid}
                    {@const busyTile = profiles.switching === p.uid}
                    <li>
                        <!-- Opening puts focus on your profile (or the first), not the toolbar. -->
                        <!-- svelte-ignore a11y_autofocus -->
                        <button
                            autofocus={current || (!currentUid && i === 0)}
                            class="tile"
                            class:current
                            onclick={() => pick(p)}
                            disabled={!!profiles.switching && !busyTile}
                            aria-label={managing ? `Edit ${p.name}` : current ? `${p.name}, current profile` : `Switch to ${p.name}`}
                            aria-busy={busyTile}
                            title={p.email}
                        >
                            <span class="face">
                                <Avatar profile={p} size={current && !managing ? 132 : 120} />
                                {#if busyTile}<span class="spinner" aria-hidden="true"></span>{/if}
                                {#if managing}<span class="badge" aria-hidden="true"><Icon name="pencil" size={15} /></span>{/if}
                            </span>
                            <span class="name">{p.name}</span>
                        </button>
                    </li>
                {/each}
                {#if !managing}
                    <li>
                        <button class="tile" onclick={startAdd} disabled={!!profiles.switching}>
                            <span class="face add"><Icon name="plus" size={30} /></span>
                            <span class="name">Add Profile</span>
                        </button>
                    </li>
                {/if}
            </ul>

            {#if profiles.error}
                <div class="error" role="alert">
                    <span>{profiles.error}</span>
                    <button onclick={startAdd}>Log In Again</button>
                </div>
            {/if}

            {#if managing}
                <p class="note">Choose a profile to change its name, picture or color, or to remove it from this PC.</p>
            {:else}
                <div class="launch">
                    <Toggle label="Ask who’s watching when the app opens" checked={profiles.askOnLaunch} onchange={(v) => profiles.setAskOnLaunch(v)} />
                    <span aria-hidden="true">Ask who’s watching when the app opens</span>
                </div>
            {/if}
        </div>
    {:else}
        <header class="bar">
            <button class="icon-btn" onclick={back} aria-label="Back" disabled={busy}><Icon name="back" size={20} /></button>
        </header>

        <form class="content form" onsubmit={submit}>
            {#if view === 'add'}
                <p class="eyebrow">Another Stremio account</p>
            {:else}
                <p class="eyebrow email">{editing?.email}</p>
            {/if}
            <h1 id="picker-title">{view === 'add' ? 'Add Profile' : 'Edit Profile'}</h1>

            <div class="portrait">
                {#if !draftAvatar && !draftName.trim()}
                    <!-- No name or picture yet: a person silhouette on the chosen color. -->
                    <span class="blank" style:--c={draftColor} aria-hidden="true"><Icon name="user" size={84} /></span>
                {:else}
                    <Avatar profile={draft} size={168} />
                {/if}
                <button
                    type="button"
                    class="pencil"
                    onclick={pictureMenu}
                    aria-label={draftAvatar ? 'Change or remove picture' : 'Choose a picture'}
                    aria-haspopup={draftAvatar ? 'menu' : undefined}
                    title="Picture"
                >
                    <Icon name="pencil" size={17} />
                </button>
                <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={onfile} hidden />
            </div>

            {#if !draftAvatar}
                <div class="swatches" role="radiogroup" aria-label="Color">
                    {#each PROFILE_COLORS as c (c)}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={draftColor === c}
                            aria-label={`Color ${PROFILE_COLORS.indexOf(c) + 1}`}
                            class="swatch"
                            class:on={draftColor === c}
                            style:--c={c}
                            onclick={() => (draftColor = c)}
                        ></button>
                    {/each}
                </div>
            {/if}

            <div class="fields">
                <input bind:this={nameInput} class="field" bind:value={draftName} placeholder="Name" aria-label="Name" maxlength="24" disabled={busy} />
                {#if view === 'add'}
                    <input class="field" type="email" bind:value={email} placeholder="Stremio email" aria-label="Stremio email" autocomplete="email" required disabled={busy} />
                    <input class="field" type="password" bind:value={password} placeholder="Password" aria-label="Password" autocomplete="current-password" required disabled={busy} />
                    <p class="hint">Saved on this PC, so you can switch to it later without logging in again.</p>
                {/if}
            </div>

            {#if error}<p class="form-error" role="alert">{error}</p>{/if}

            <div class="actions">
                <button type="button" class="pill" onclick={back} disabled={busy}>Cancel</button>
                {#if view === 'add'}
                    <button type="submit" class="pill primary" disabled={busy || !email.trim() || !password}>{busy ? 'Adding…' : 'Add Profile'}</button>
                {:else}
                    <button type="submit" class="pill primary">Save</button>
                {/if}
            </div>

            {#if view === 'edit' && editing}
                <button type="button" class="remove" onclick={remove}>
                    {#if confirmRemove}
                        {editing.uid === currentUid ? 'Log Out and Remove' : 'Remove from This PC'}
                    {:else}
                        Remove Profile…
                    {/if}
                </button>
                {#if confirmRemove}
                    <p class="hint">
                        {editing.uid === currentUid
                            ? 'This is the profile you’re using, so removing it also logs you out.'
                            : 'The Stremio account and its library stay as they are.'}
                    </p>
                {/if}
            {/if}
        </form>
    {/if}
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
        background: var(--bg);
        overflow: auto;
    }
    .picker::backdrop {
        background: rgb(0 0 0 / 0.6);
    }
    .picker[open] {
        animation: fade var(--slow) var(--ease);
    }
    @keyframes fade {
        from {
            opacity: 0;
        }
    }
    /* Soft brand-colored shapes behind everything. */
    .art {
        position: fixed;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
    }
    .art span {
        position: absolute;
        border-radius: 50%;
        filter: blur(90px);
        opacity: 0.35;
    }
    .art span:nth-child(1) {
        width: 60vw;
        height: 50vh;
        left: 10vw;
        top: -20vh;
        background: #6d4af0;
    }
    .art span:nth-child(2) {
        width: 40vw;
        height: 40vh;
        right: -10vw;
        top: 5vh;
        background: #2d8cf0;
        opacity: 0.2;
    }
    .art span:nth-child(3) {
        width: 50vw;
        height: 40vh;
        left: -15vw;
        bottom: -20vh;
        background: #c04ae0;
        opacity: 0.15;
    }

    .bar {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 28px;
    }
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--font-display);
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.01em;
    }
    .brand img {
        display: block;
        border-radius: 7px;
    }
    .bar-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .icon-btn {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label);
        cursor: pointer;
        transition: background var(--fast);
    }
    .icon-btn:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .pill {
        height: 44px;
        padding: 0 22px;
        border: 1px solid rgb(255 255 255 / 0.2);
        border-radius: 999px;
        background: rgb(255 255 255 / 0.08);
        color: var(--label);
        font-size: var(--text-callout);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--fast);
    }
    .pill:hover:not(:disabled) {
        background: rgb(255 255 255 / 0.16);
    }
    .pill.primary {
        border-color: transparent;
        background: var(--label);
        color: var(--bg);
    }
    .pill.primary:hover:not(:disabled) {
        background: white;
    }
    .pill:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .content {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 36px;
        padding: 4vh 24px 64px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(32px, 4vw, 48px);
        font-weight: 700;
        letter-spacing: -0.02em;
        text-align: center;
    }

    /* Who's watching */
    .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: flex-start;
        gap: 36px;
        max-width: 960px;
    }
    .tile {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 140px;
        border-radius: 16px;
    }
    .tile:disabled {
        cursor: default;
        opacity: 0.5;
    }
    .face {
        position: relative;
        display: grid;
        place-items: center;
        width: 132px;
        height: 132px;
    }
    .face :global(.avatar) {
        box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    .tile:hover:not(:disabled) .face :global(.avatar),
    .tile:focus-visible .face :global(.avatar),
    .tile:hover:not(:disabled) .face.add,
    .tile:focus-visible .face.add {
        transform: scale(1.05);
        box-shadow:
            0 0 0 3px var(--label),
            0 16px 36px rgb(0 0 0 / 0.5);
    }
    .tile:focus-visible {
        outline: none;
    }
    .face.add {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: rgb(255 255 255 / 0.1);
        color: var(--label);
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    .badge {
        position: absolute;
        right: 8px;
        bottom: 8px;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--label);
        color: var(--bg);
        box-shadow: 0 0 0 3px var(--bg);
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
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--text-callout);
        font-weight: 500;
        color: var(--label-2);
    }
    .tile.current .name {
        font-weight: 700;
        color: var(--label);
    }
    .launch {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        color: var(--label-2);
    }
    .note {
        margin: 0;
        max-width: 420px;
        text-align: center;
        font-size: 14px;
        color: var(--label-2);
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
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }

    /* Add / Edit */
    .form {
        gap: 20px;
        padding-top: 0;
    }
    .eyebrow {
        margin: 0 0 -12px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .portrait {
        position: relative;
        margin: 8px 0 4px;
    }
    .eyebrow.email {
        text-transform: none;
        letter-spacing: 0;
        font-size: 13px;
    }
    .blank {
        display: grid;
        place-items: center;
        width: 168px;
        height: 168px;
        border-radius: 50%;
        color: rgb(255 255 255 / 0.85);
        background: linear-gradient(145deg, color-mix(in srgb, var(--c) 100%, white 18%), color-mix(in srgb, var(--c) 100%, black 32%));
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
    }
    .portrait :global(.avatar) {
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
    }
    .pencil {
        position: absolute;
        right: 4px;
        bottom: 4px;
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 50%;
        background: var(--label);
        color: var(--bg);
        box-shadow: 0 0 0 4px var(--bg);
        cursor: pointer;
    }
    .pencil:hover {
        background: white;
    }
    .swatches {
        display: flex;
        gap: 10px;
    }
    .swatch {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--c);
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
    }
    .swatch.on {
        box-shadow:
            0 0 0 2px var(--bg),
            0 0 0 4px var(--label);
    }
    .fields {
        width: min(420px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .field {
        height: 52px;
        padding: 0 22px;
        border-radius: 999px;
        border: 1px solid rgb(255 255 255 / 0.12);
        background: rgb(255 255 255 / 0.06);
        color: var(--label);
        font-size: var(--text-body);
    }
    .field::placeholder {
        color: var(--label-2);
    }
    .field:focus {
        outline: none;
        border-color: var(--accent-hover);
        background: rgb(255 255 255 / 0.09);
    }
    .hint {
        margin: 0;
        text-align: center;
        font-size: 13px;
        color: var(--label-2);
    }
    .form-error {
        margin: 0;
        max-width: 420px;
        text-align: center;
        font-size: 13px;
        color: #ff6961;
    }
    .actions {
        display: flex;
        gap: 12px;
        margin-top: 4px;
    }
    .actions .pill {
        min-width: 120px;
    }
    .remove {
        margin-top: 8px;
        height: 40px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #ff6961;
        font-weight: 600;
        cursor: pointer;
    }
    .remove:hover {
        background: rgb(255 69 58 / 0.12);
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 2s;
        }
        .face :global(.avatar),
        .face.add {
            transition: none;
        }
    }
    .short {
        display: none;
    }
    /* Phones: a compact bar below the status bar (iOS style: Edit, close),
       smaller faces two or three across, room for the home indicator. */
    @media (max-width: 700px) {
        .picker {
            height: 100dvh;
        }
        .bar {
            padding: calc(var(--safe-top) + 8px) 16px 8px;
        }
        .brand,
        .long {
            display: none;
        }
        .short {
            display: inline;
        }
        .pill {
            height: 36px;
            padding: 0 16px;
        }
        .content {
            gap: 28px;
            padding: 3vh 16px calc(var(--safe-bottom) + 32px);
        }
        h1 {
            font-size: 28px;
        }
        .grid {
            gap: 24px 20px;
        }
        .tile {
            width: 104px;
        }
        .face {
            width: 100px;
            height: 100px;
        }
        .face :global(.avatar) {
            --size: 92px !important;
        }
        .face.add {
            width: 92px;
            height: 92px;
        }
        .launch {
            max-width: 340px;
            font-size: 15px;
        }
    }
</style>
