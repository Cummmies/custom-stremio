<script lang="ts">
    // Choose a title from your library with one tap: a favorite for one slot of
    // the profile's row (the website's slot picker), or (with `title`) a title
    // to add to a list. A modal <dialog> (docs/design.md); on iPhone a sheet
    // with Cancel in its top bar.
    import { lb, type LibraryItem } from '$lib/tracker/api';
    import Icon from '$lib/components/Icon.svelte';

    let {
        slot = 0,
        title,
        taken,
        onpick,
        onclose,
    }: { slot?: number; title?: string; taken: string[]; onpick: (item: LibraryItem) => void; onclose: () => void } = $props();
    const heading = $derived(title ?? `Choose Favorite ${slot + 1}`);
    const short = $derived(title ?? `Favorite ${slot + 1}`);

    let all = $state<LibraryItem[] | null>(null);
    let failed = $state(false);
    let query = $state('');
    lb.library('titles').then((res) => {
        if (res) all = res.items;
        else failed = true;
    });
    const shown = $derived.by(() => {
        const q = query.trim().toLowerCase();
        const list = (all ?? []).filter((i) => !taken.includes(i.id));
        return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
    });

    let dialog = $state<HTMLDialogElement>();
    $effect(() => {
        dialog?.showModal();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            // Handled here, so the TV remote's Back doesn't also leave the page.
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="favorite-heading" {onkeydown} onclick={(e) => e.target === dialog && onclose()}>
    <div class="body">
        <div class="toolbar">
            <button class="bar-btn" onclick={onclose}>Cancel</button>
            <span class="bar-title" aria-hidden="true">{short}</span>
            <span></span>
        </div>
        <header>
            <h2 id="favorite-heading">{heading}</h2>
            <button class="close" onclick={onclose} aria-label="Cancel"><Icon name="close" size={16} /></button>
        </header>
        <label class="search">
            <Icon name="search" size={15} />
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={query} placeholder="Search your library" aria-label="Search your library" spellcheck="false" autofocus />
        </label>

        {#if all === null}
            <p class="note" role="status">{failed ? 'Couldn’t load your library. Try again in a moment.' : 'Loading…'}</p>
        {:else if !shown.length}
            <p class="note">{query ? 'Nothing in your library matches.' : 'Titles you track show up here.'}</p>
        {:else}
            <ul class="grid">
                {#each shown as item (item.title_id)}
                    <li>
                        <button class="pick" onclick={() => onpick(item)}>
                            <span class="art">
                                {#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<span class="fallback">{item.name}</span>{/if}
                            </span>
                            <span class="name">{item.name}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</dialog>

<style>
    dialog {
        width: min(640px, calc(100vw - 32px));
        max-width: none;
        height: min(720px, calc(100vh - 32px));
        margin: auto;
        padding: 0;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-l);
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        box-shadow: var(--shadow-l);
        color: var(--label);
        animation: rise var(--fast) var(--ease);
    }
    dialog::backdrop {
        background: var(--scrim);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
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
        gap: 14px;
        height: 100%;
        padding: 20px;
    }
    .toolbar {
        display: none;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .close {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
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
    .search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 12px;
        border: 1px solid var(--separator);
        border-radius: 999px;
        background: var(--fill);
        color: var(--label-2);
    }
    .search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
    }
    .grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        align-content: start;
        gap: 16px 12px;
        margin: 0;
        padding: 3px;
        list-style: none;
    }
    .pick {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .art {
        aspect-ratio: 2 / 3;
        border-radius: var(--radius-s);
        overflow: hidden;
        background: var(--elevated-2);
        transition: box-shadow var(--fast);
    }
    .pick:hover .art,
    .pick:focus-visible .art {
        box-shadow: 0 0 0 3px var(--accent);
    }
    .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .fallback {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 6px;
        text-align: center;
        font-size: 12px;
        color: var(--label-2);
    }
    .name {
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .note {
        margin: 0;
        color: var(--label-2);
    }
    @media (pointer: coarse) {
        .search {
            height: 44px;
        }
    }
    /* iPhone: a sheet from the bottom, Cancel in its top bar. */
    @media (max-width: 700px) {
        dialog {
            width: 100%;
            height: calc(100vh - var(--safe-top, 0px) - 24px);
            margin: auto 0 0;
            border-radius: var(--radius-l) var(--radius-l) 0 0;
            border-bottom: 0;
            animation: slide var(--slow) var(--ease);
        }
        @keyframes slide {
            from {
                transform: translateY(100%);
            }
        }
        .body {
            padding: 8px 16px calc(16px + var(--safe-bottom, 0px));
        }
        .toolbar {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            margin: 0 -8px;
        }
        .bar-btn {
            justify-self: start;
            min-height: 44px;
            padding: 0 8px;
            border: 0;
            background: none;
            color: var(--label);
            font-size: 17px;
            cursor: pointer;
        }
        .bar-title {
            font-size: 17px;
            font-weight: 600;
        }
        header {
            display: none;
        }
    }
</style>
