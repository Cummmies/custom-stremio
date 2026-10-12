<script lang="ts">
    // Recommend to Friends: tick friends, add a line if you like, Send. They get
    // a notification and the title shows in their "Recommended by Friends" row.
    // A modal <dialog> (docs/design.md); on iPhone a sheet.
    import { lb, type FriendCard } from '$lib/tracker/api';
    import Avatar from './Avatar.svelte';
    import Icon from './Icon.svelte';

    let {
        title,
        onsend,
        onclose,
    }: { title: { id: string; type: string; name: string }; onsend: (count: number) => void; onclose: () => void } = $props();

    let friends = $state<FriendCard[] | null>(null);
    let failed = $state(false);
    lb.friends().then((res) => {
        if (res) friends = res.friends;
        else failed = true;
    });
    let chosen = $state<number[]>([]);
    let note = $state('');
    let busy = $state(false);
    let error = $state<string | null>(null);
    const toggle = (id: number) => (chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

    async function send() {
        if (!chosen.length || busy) return;
        busy = true;
        error = null;
        const res = await lb.recommend(chosen, title.id, title.type, title.name, note.trim());
        busy = false;
        if ('data' in res) onsend(res.data.sent);
        else error = 'Couldn’t send it. Try again in a moment.';
    }

    let dialog = $state<HTMLDialogElement>();
    $effect(() => {
        dialog?.showModal();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="recommend-heading" {onkeydown} onclick={(e) => e.target === dialog && onclose()}>
    <div class="body">
        <header>
            <h2 id="recommend-heading">Recommend {title.name}</h2>
            <button class="close" onclick={onclose} aria-label="Cancel"><Icon name="close" size={16} /></button>
        </header>

        {#if friends === null}
            <p class="note" role="status">{failed ? 'Couldn’t load your friends. Try again in a moment.' : 'Loading…'}</p>
        {:else if !friends.length}
            <p class="note">Add friends from their profiles to recommend things to them.</p>
        {:else}
            <ul class="people">
                {#each friends as f (f.user_id)}
                    <li>
                        <button class="person" class:on={chosen.includes(f.user_id)} aria-pressed={chosen.includes(f.user_id)} onclick={() => toggle(f.user_id)}>
                            <Avatar profile={{ name: f.name, color: '#6d4af0', avatar: f.avatar ?? undefined }} fallbackName={f.name || f.handle} size={36} />
                            <span class="who"><span class="name">{f.name || f.handle}</span><span class="handle">{f.handle}</span></span>
                            <span class="tick" aria-hidden="true">{#if chosen.includes(f.user_id)}<Icon name="check" size={14} />{/if}</span>
                        </button>
                    </li>
                {/each}
            </ul>
            <input class="line" bind:value={note} maxlength="280" placeholder="Add a note (optional)" aria-label="Note" />
        {/if}

        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <footer>
            <button class="btn" onclick={onclose}>Cancel</button>
            <button class="btn primary" disabled={!chosen.length || busy} onclick={send}>
                {busy ? 'Sending…' : chosen.length > 1 ? `Send to ${chosen.length}` : 'Send'}
            </button>
        </footer>
    </div>
</dialog>

<style>
    dialog {
        width: min(460px, calc(100vw - 32px));
        max-width: none;
        max-height: min(640px, calc(100vh - 32px));
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
    .body {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: inherit;
        padding: 20px;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    h2 {
        margin: 0;
        overflow: hidden;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .close {
        display: grid;
        flex: none;
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
    .people {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin: 0;
        padding: 0;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        list-style: none;
    }
    li + li {
        border-top: 1px solid var(--separator);
    }
    .person {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 52px;
        padding: 8px 14px;
        border: 0;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .person:hover {
        background: var(--fill-hover);
    }
    .who {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .name {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .handle {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .tick {
        display: grid;
        flex: none;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1.5px solid var(--label-3);
        border-radius: 50%;
    }
    .on .tick {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--on-accent);
    }
    .line {
        height: 40px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 999px;
        outline: none;
        background: var(--fill);
        color: var(--label);
        font: inherit;
    }
    .line:focus {
        border-color: var(--accent);
    }
    .note {
        margin: 0;
        color: var(--label-2);
    }
    .error {
        margin: 0;
        font-size: 13px;
        color: var(--bad-text);
    }
    footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .btn {
        height: 36px;
        padding: 0 18px;
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
    .btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (pointer: coarse) {
        .btn,
        .line {
            height: 44px;
        }
    }
    @media (max-width: 600px) {
        dialog {
            width: 100%;
            margin: auto 0 0;
            border-radius: var(--radius-l) var(--radius-l) 0 0;
            border-bottom: 0;
        }
        .body {
            padding-bottom: calc(20px + var(--safe-bottom, 0px));
        }
    }
</style>
