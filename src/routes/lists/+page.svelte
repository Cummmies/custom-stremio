<script lang="ts">
    // Lists: your tracker lists (docs/tracker.md), each a ListCard (as on
    // profiles); one opens in place (?id=, so Back returns to them all).
    // New List makes one. An open list has Add (a title from your library),
    // Share (a link anyone can open; Stop Sharing turns it off) and Edit,
    // which works in place as Edit Profile does: the name and note become
    // fields, each title gets a remove button, and Delete List sits at the
    // end. Without the tracker connected, says so.
    import { page } from '$app/state';
    import { goto, appUrl } from '$lib/nav';
    import { tracker } from '$lib/tracker.svelte';
    import { app } from '$lib/app.svelte';
    import { lb, STATUS_SHORT, score, type LibraryItem, type ListDetail, type ListInfo } from '$lib/tracker/api';
    import PosterCard from '$lib/components/PosterCard.svelte';
    import ListCard from '$lib/components/ListCard.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import NewListDialog from '$lib/components/NewListDialog.svelte';
    import FavoritePicker from '$lib/components/profile/FavoritePicker.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { undo } from '$lib/undo.svelte';
    import { isIOS, isTV } from '$lib/platform';

    const openId = $derived(Number(appUrl(page.url).searchParams.get('id')) || null);

    let lists = $state<ListInfo[] | null>(null);
    let detail = $state<ListDetail | null | undefined>(undefined);
    let failed = $state(false);

    $effect(() => {
        if (!tracker.ready || lists !== null) return;
        lb.lists().then((res) => {
            if (res) lists = res.lists;
            else failed = true;
        });
    });

    $effect(() => {
        const listId = openId;
        detail = undefined;
        editing = false;
        if (!listId || !tracker.ready) return;
        lb.list(listId).then((res) => {
            if (openId === listId) detail = res;
        });
    });

    /** After a change: the open list again, and the lists' cards (posters, counts) fresh. */
    async function reload() {
        if (openId) {
            const res = await lb.list(openId);
            if (res) detail = res;
        }
        lists = null;
    }

    let creating = $state(false);
    let busy = $state(false);
    let error = $state<string | null>(null);
    async function create(name: string) {
        busy = true;
        error = null;
        const made = await lb.newList(name);
        busy = false;
        if (!made) {
            error = 'Couldn’t make the list.';
            return;
        }
        lists = [made, ...(lists ?? [])];
        creating = false;
    }

    // --- Notes at the bottom of the screen ---
    let shareNote = $state<string | null>(null);
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    function note(text: string) {
        shareNote = text;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => (shareNote = null), 3000);
    }

    // --- Add: a title from your library ---
    let adding = $state(false);
    async function add(item: LibraryItem) {
        const list = detail;
        adding = false;
        if (!list) return;
        const res = await lb.addToList(list.id, item.id, item.type, item.name);
        if (!res) return note('Couldn’t add it. Try again in a moment.');
        await reload();
    }

    // --- Edit: in place ---
    const canEdit = !isTV;
    let editing = $state(false);
    let name = $state('');
    let description = $state('');
    let saving = $state(false);
    function beginEdit() {
        if (!detail) return;
        name = detail.name;
        description = detail.description ?? '';
        editing = true;
    }
    async function finishEdit() {
        const list = detail;
        if (!list || saving) return;
        const fields: { name?: string; description?: string } = {};
        if (name.trim() && name.trim() !== list.name) fields.name = name.trim();
        if (description.trim() !== (list.description ?? '')) fields.description = description.trim();
        if (Object.keys(fields).length) {
            saving = true;
            const res = await lb.editList(list.id, fields);
            saving = false;
            if (!res) return note('Couldn’t save. Try again in a moment.');
            detail = res;
            lists = null;
        }
        editing = false;
    }
    async function removeTitle(item: ListDetail['items'][number]) {
        const list = detail;
        if (!list) return;
        detail = { ...list, items: list.items.filter((i) => i.title_id !== item.title_id) };
        const res = await lb.removeFromList(list.id, item.title_id);
        if (!res) {
            note('Couldn’t remove it. Try again in a moment.');
            await reload();
        } else {
            lists = null;
            undo.show(`Removed ${item.name}`, async () => {
                await lb.addToList(list.id, item.id, item.type, item.name);
                await reload();
            });
        }
    }
    function deleteMenu(e: MouseEvent) {
        const list = detail;
        if (!list) return;
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { header: `Delete “${list.name}”?`, detail: 'The list goes; its titles stay in your library.' },
                {
                    label: 'Delete List',
                    icon: 'trash',
                    destructive: true,
                    onselect: async () => {
                        const res = await lb.deleteList(list.id);
                        if (!res) return note('Couldn’t delete it. Try again in a moment.');
                        lists = (lists ?? []).filter((l) => l.id !== list.id);
                        goto('/lists', { replaceState: true });
                    },
                },
            ],
            'start'
        );
    }
    function onkeydown(e: KeyboardEvent) {
        if (editing && !adding && e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            editing = false;
        }
    }

    // --- Share: a link anyone can open (a page of the list's titles) ---
    /** iPhone: the system's share sheet; elsewhere the link is copied. */
    const canShareSheet = isIOS && typeof navigator !== 'undefined' && 'share' in navigator;
    async function copyLink(url: string) {
        try {
            await navigator.clipboard.writeText(url);
            note('Link copied.');
        } catch {
            note('Couldn’t copy the link.');
        }
    }
    async function shareSheet(url: string, name: string) {
        try {
            await navigator.share({ title: name, url });
        } catch {
            /* closed without sharing */
        }
    }
    async function startSharing(list: ListDetail) {
        const res = await lb.shareList(list.id);
        if (!res) return note('Couldn’t make a link. Try again in a moment.');
        if (detail?.id === list.id) detail = { ...detail, share_url: res.share_url };
        if (canShareSheet) await shareSheet(res.share_url, list.name);
        else await copyLink(res.share_url);
    }
    async function stopSharing(list: ListDetail) {
        const res = await lb.unshareList(list.id);
        if (!res) return note('Couldn’t stop sharing. Try again in a moment.');
        if (detail?.id === list.id) detail = { ...detail, share_url: null };
        note('The link no longer works.');
    }
    function shareMenu(e: MouseEvent) {
        const list = detail;
        if (!list) return;
        const url = list.share_url;
        const entries: MenuEntry[] = url
            ? [
                  { header: 'Shared', detail: 'Anyone with the link can see this list.' },
                  { label: 'Copy Link', icon: 'link', onselect: () => copyLink(url) },
                  ...(canShareSheet ? [{ label: 'Share…', icon: 'share', onselect: () => shareSheet(url, list.name) } as MenuEntry] : []),
                  { separator: true },
                  { label: 'Stop Sharing', icon: 'close', destructive: true, onselect: () => stopSharing(list) },
              ]
            : [
                  { header: 'Share This List', detail: 'Anyone with the link can see its titles. Your scores and history stay private.' },
                  { label: canShareSheet ? 'Share Link…' : 'Copy Link', icon: canShareSheet ? 'share' : 'link', onselect: () => startSharing(list) },
              ];
        menu.toggleFor(e.currentTarget as HTMLElement, entries, 'end');
    }

    const open = (id: number) => goto(`/lists?id=${id}`);
    const below = (i: ListDetail['items'][number]) =>
        [i.year, i.status ? STATUS_SHORT[i.status] : null, i.rating != null ? score(i.rating) : null].filter(Boolean).join(' · ') || null;
</script>

<svelte:window {onkeydown} />
<svelte:head><title>{detail?.name ?? 'Lists'} · Stremio</title></svelte:head>

<div class="page">
    {#if !tracker.ready}
        <header><h1>Lists</h1></header>
        {#if !app.user}
            <EmptyState icon="list" title="Keep lists of what to watch">
                <p>Log in to make lists and see them here.</p>
                <button onclick={() => app.openLogin()}>Log In</button>
            </EmptyState>
        {:else}
            <EmptyState icon="list" title="Couldn’t connect">
                <p>Your lists come back as soon as it does.</p>
            </EmptyState>
        {/if}
    {:else if openId}
        <header class="detail">
            <button class="back" onclick={() => history.back()} aria-label="All Lists" title="All Lists"><Icon name="back" size={20} /></button>
            {#if editing}
                <div class="fields">
                    <input class="name-field" bind:value={name} maxlength="100" placeholder="List name" aria-label="List name" />
                    <input class="note-field" bind:value={description} maxlength="300" placeholder="A note about this list (optional)" aria-label="Note" />
                </div>
                <div class="actions">
                    <button class="pill" onclick={() => (editing = false)}>Cancel</button>
                    <button class="pill primary" onclick={finishEdit} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Done'}</button>
                </div>
            {:else}
                <div class="title">
                    <h1>{detail?.name ?? lists?.find((l) => l.id === openId)?.name ?? 'List'}</h1>
                    {#if detail}
                        <p class="sub">
                            {detail.items.length} {detail.items.length === 1 ? 'title' : 'titles'}{detail.share_url ? ' · Shared' : ''}{detail.description ? ` · ${detail.description}` : ''}
                        </p>
                    {/if}
                </div>
                {#if detail}
                    <div class="actions">
                        <button class="pill" onclick={() => (adding = true)}><Icon name="plus" size={16} /> Add</button>
                        <button class="pill" aria-haspopup="menu" aria-expanded="false" onclick={shareMenu}><Icon name="share" size={16} /> Share</button>
                        {#if canEdit}<button class="pill" onclick={beginEdit}><Icon name="pencil" size={15} /> Edit</button>{/if}
                    </div>
                {/if}
            {/if}
        </header>
        {#if detail === undefined}
            <p class="loading" role="status">Loading…</p>
        {:else if detail === null}
            <EmptyState icon="list" title="Couldn’t open this list">
                <p>It may have been deleted, or the connection dropped. Try again in a moment.</p>
            </EmptyState>
        {:else if detail.items.length === 0 && !editing}
            <EmptyState icon="list" title="Nothing on this list yet">
                <p>Add titles from your library, or with the + button on any title.</p>
                <button onclick={() => (adding = true)}>Add a Title</button>
            </EmptyState>
        {:else}
            <div class="grid" class:editing>
                {#each detail.items as item (item.title_id)}
                    <div class="cell">
                        <PosterCard item={{ id: item.id, type: item.type, name: item.name, poster: item.poster, releaseInfo: below(item) }} />
                        {#if editing}
                            <button class="remove" onclick={() => removeTitle(item)} aria-label={`Remove ${item.name} from this list`}><Icon name="close" size={12} /></button>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
        {#if editing && detail}
            <div class="danger">
                <button class="delete" onclick={deleteMenu} aria-haspopup="menu" aria-expanded="false"><Icon name="trash" size={16} /> Delete List</button>
            </div>
        {/if}
    {:else}
        <header>
            <h1>Lists</h1>
            <button class="pill" onclick={() => (creating = true)}><Icon name="plus" size={16} /> New List</button>
        </header>
        {#if lists === null}
            <p class="loading" role="status">{failed ? 'Couldn’t connect. Try again in a moment.' : 'Loading…'}</p>
        {:else if lists.length === 0}
            <EmptyState icon="list" title="No lists yet">
                <p>Make one here, or from the + button on any title.</p>
                <button onclick={() => (creating = true)}>New List</button>
            </EmptyState>
        {:else}
            <div class="lists">
                {#each lists as list (list.id)}<ListCard {list} onclick={() => open(list.id)} />{/each}
            </div>
        {/if}
    {/if}
</div>

{#if shareNote}<p class="share-note" role="status">{shareNote}</p>{/if}
{#if creating}
    <NewListDialog {busy} {error} oncreate={create} onclose={() => ((creating = false), (error = null))} />
{/if}
{#if adding && detail}
    <FavoritePicker title={`Add to ${detail.name}`} taken={detail.items.map((i) => i.id)} onpick={add} onclose={() => (adding = false)} />
{/if}

<style>
    .page {
        padding: calc(var(--nav-h) + 24px) var(--gutter) 56px;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 24px;
    }
    header.detail {
        justify-content: flex-start;
    }
    .title,
    .fields {
        flex: 1;
        min-width: 0;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }
    .share-note {
        position: fixed;
        left: 50%;
        bottom: calc(24px + var(--tabbar-h));
        z-index: 20;
        transform: translateX(-50%);
        margin: 0;
        padding: 10px 16px;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated);
        box-shadow: var(--shadow-m);
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .sub {
        margin: 2px 0 0;
        color: var(--label-2);
        font-size: var(--text-callout);
    }
    .loading {
        color: var(--label-2);
    }
    .back {
        flex: none;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label);
        cursor: pointer;
    }
    /* Pills, as on the profile: glass, and the label colour for the one that finishes. */
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 16px;
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        background: var(--glass);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        color: var(--label);
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }
    .pill.primary {
        border: 0;
        background: var(--label);
        color: var(--bg);
    }
    .pill:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .back:hover,
    .pill:not(.primary):hover {
        background: var(--fill-hover);
    }
    /* Editing: the name and note where they were, in their sizes. */
    .fields {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 560px;
    }
    .fields input {
        width: 100%;
        min-width: 0;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: var(--radius-s);
        outline: none;
        background: var(--fill);
        color: var(--label);
        font: inherit;
    }
    .fields input:focus {
        border-color: var(--accent);
    }
    .name-field {
        height: 40px;
        font-family: var(--font-display) !important;
        font-size: var(--text-title3) !important;
        font-weight: 600 !important;
    }
    .note-field {
        height: 34px;
        font-size: var(--text-callout) !important;
    }
    /* All lists: cards the size they are everywhere, as many as fit. */
    .lists {
        display: flex;
        flex-wrap: wrap;
        gap: 32px 24px;
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr));
        gap: 24px 16px;
        padding-top: 8px;
    }
    .cell {
        position: relative;
        min-width: 0;
    }
    .remove {
        position: absolute;
        z-index: 2;
        top: -8px;
        right: -8px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--glass-border);
        border-radius: 50%;
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        color: var(--label);
        box-shadow: var(--shadow-s);
        cursor: pointer;
    }
    /* While editing, the posters don't open (a tap is easy to mean as "remove"). */
    .grid.editing :global(a) {
        pointer-events: none;
    }
    .danger {
        display: flex;
        justify-content: center;
        margin-top: 40px;
    }
    .delete {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 18px;
        border: 1px solid var(--separator);
        border-radius: 999px;
        background: var(--fill);
        color: var(--bad-text);
        font-weight: 600;
        cursor: pointer;
    }
    .delete:hover {
        background: var(--fill-hover);
    }
    @media (pointer: coarse) {
        .pill,
        .delete {
            height: 44px;
        }
        .back {
            width: 44px;
            height: 44px;
        }
        .remove {
            width: 32px;
            height: 32px;
        }
    }
    @media (max-width: 600px) {
        header.detail {
            flex-wrap: wrap;
        }
        .actions {
            width: 100%;
            justify-content: flex-start;
        }
        .lists {
            gap: 24px 16px;
        }
    }
</style>
