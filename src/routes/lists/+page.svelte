<script lang="ts">
    // Lists: your Lightboxd lists (docs/lightboxd.md), each as a stack of its
    // first posters; one opens in place (?id=, so Back returns to them all).
    // New List makes one. Without Lightboxd connected, says where to connect.
    import { page } from '$app/state';
    import { goto, appUrl } from '$lib/nav';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { app } from '$lib/app.svelte';
    import { lb, STATUS_SHORT, score, type ListDetail, type ListInfo } from '$lib/lightboxd/api';
    import PosterCard from '$lib/components/PosterCard.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import NewListDialog from '$lib/components/NewListDialog.svelte';
    import Icon from '$lib/components/Icon.svelte';

    const openId = $derived(Number(appUrl(page.url).searchParams.get('id')) || null);

    let lists = $state<ListInfo[] | null>(null);
    let detail = $state<ListDetail | null | undefined>(undefined);
    let failed = $state(false);

    $effect(() => {
        if (!lightboxd.ready || lists !== null) return;
        lb.lists().then((res) => {
            if (res) lists = res.lists;
            else failed = true;
        });
    });

    $effect(() => {
        const listId = openId;
        detail = undefined;
        if (!listId || !lightboxd.ready) return;
        lb.list(listId).then((res) => {
            if (openId === listId) detail = res;
        });
    });

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

    const open = (id: number) => goto(`/lists?id=${id}`);
    const below = (i: ListDetail['items'][number]) =>
        [i.year, i.status ? STATUS_SHORT[i.status] : null, i.rating != null ? score(i.rating) : null].filter(Boolean).join(' · ') || null;
</script>

<svelte:head><title>{detail?.name ?? 'Lists'} · Stremio</title></svelte:head>

<div class="page">
    {#if !lightboxd.ready}
        <header><h1>Lists</h1></header>
        {#if !app.user}
            <EmptyState icon="list" title="Keep lists of what to watch">
                <p>Log in to make lists and see them here.</p>
                <button onclick={() => app.openLogin()}>Log In</button>
            </EmptyState>
        {:else}
            <EmptyState icon="list" title="Lists aren’t available right now">
                <p>Can’t reach the server. Your lists come back when it’s reachable.</p>
            </EmptyState>
        {/if}
    {:else if openId}
        <header class="detail">
            <button class="back" onclick={() => history.back()} aria-label="All Lists" title="All Lists"><Icon name="back" size={20} /></button>
            <div>
                <h1>{detail?.name ?? lists?.find((l) => l.id === openId)?.name ?? 'List'}</h1>
                {#if detail}
                    <p class="sub">{detail.items.length} {detail.items.length === 1 ? 'title' : 'titles'}{detail.description ? ` · ${detail.description}` : ''}</p>
                {/if}
            </div>
        </header>
        {#if detail === undefined}
            <p class="loading" role="status">Loading…</p>
        {:else if detail === null}
            <EmptyState icon="list" title="Couldn’t open this list">
                <p>It may have been deleted, or the server can’t be reached right now.</p>
            </EmptyState>
        {:else if detail.items.length === 0}
            <EmptyState icon="list" title="Nothing on this list yet">
                <p>Use the + button on any title to add it here.</p>
            </EmptyState>
        {:else}
            <div class="grid">
                {#each detail.items as item (item.title_id)}
                    <PosterCard item={{ id: item.id, type: item.type, name: item.name, poster: item.poster, releaseInfo: below(item) }} />
                {/each}
            </div>
        {/if}
    {:else}
        <header>
            <h1>Lists</h1>
            <button class="new" onclick={() => (creating = true)}><Icon name="plus" size={16} /> New List</button>
        </header>
        {#if lists === null}
            <p class="loading" role="status">{failed ? 'Couldn’t reach the server.' : 'Loading…'}</p>
        {:else if lists.length === 0}
            <EmptyState icon="list" title="No lists yet">
                <p>Make one here, or from the + button on any title.</p>
                <button onclick={() => (creating = true)}>New List</button>
            </EmptyState>
        {:else}
            <div class="lists">
                {#each lists as list (list.id)}
                    <button class="list" onclick={() => open(list.id)} aria-label="{list.name}, {list.count} {list.count === 1 ? 'title' : 'titles'}">
                        <div class="stack" aria-hidden="true">
                            {#each list.posters as src, i (i)}
                                <img {src} alt="" loading="lazy" style="--i: {i}" />
                            {:else}
                                <span class="blank"><Icon name="list" size={28} /></span>
                            {/each}
                        </div>
                        <span class="name">{list.name}</span>
                        <span class="meta">{list.count} {list.count === 1 ? 'title' : 'titles'}</span>
                    </button>
                {/each}
            </div>
        {/if}
    {/if}
</div>

{#if creating}
    <NewListDialog {busy} {error} oncreate={create} onclose={() => ((creating = false), (error = null))} />
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
    .new {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .back:hover,
    .new:hover {
        background: var(--fill-hover);
    }
    .lists {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 32px 24px;
    }
    .list {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        border-radius: var(--radius);
    }
    .list:focus-visible {
        outline: 2px solid var(--label);
        outline-offset: 4px;
    }
    .stack {
        position: relative;
        aspect-ratio: 16 / 10;
        margin-bottom: 10px;
    }
    .stack img {
        position: absolute;
        top: calc(var(--i) * 6px);
        left: calc(var(--i) * 26%);
        height: calc(100% - 12px);
        aspect-ratio: 2 / 3;
        object-fit: cover;
        border-radius: var(--radius);
        background: var(--elevated-2);
        box-shadow: 0 6px 16px rgb(0 0 0 / 0.5);
        z-index: calc(3 - var(--i));
        transition: transform var(--fast) var(--ease);
    }
    .blank {
        position: absolute;
        inset: 0 auto 12px 0;
        aspect-ratio: 2 / 3;
        display: grid;
        place-items: center;
        border-radius: var(--radius);
        border: 1px dashed var(--separator);
        color: var(--label-2);
    }
    .list:hover .stack img,
    .list:focus-visible .stack img {
        transform: translateY(-4px);
    }
    .name {
        font-weight: 600;
    }
    .meta {
        color: var(--label-2);
        font-size: var(--text-callout);
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr));
        gap: 24px 16px;
        padding-top: 8px;
    }
    @media (pointer: coarse) {
        .new {
            height: 44px;
        }
        .back {
            width: 44px;
            height: 44px;
        }
    }
    @media (max-width: 600px) {
        .lists {
            grid-template-columns: 1fr 1fr;
            gap: 24px 16px;
        }
    }
    :global(html.tv) .list:focus .stack img {
        transform: translateY(-6px) scale(1.03);
    }
</style>
