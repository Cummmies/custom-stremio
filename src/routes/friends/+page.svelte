<script lang="ts">
    import { undo } from '$lib/undo.svelte';
    // Friends: add someone by username, answer the requests you got (and
    // cancel the ones you sent), your friends (each opens their profile; its
    // ⋯ has Close Friend, Unfriend and Block), and who you've blocked. Grouped
    // rows, as Settings. Actions are lib/friendActions.ts, as on profiles.
    import { tracker } from '$lib/tracker.svelte';
    import { app } from '$lib/app.svelte';
    import { lb, type FoundPerson, type FriendCard, type FriendsOverview } from '$lib/tracker/api';
    import * as friendship from '$lib/friendActions';
    import Avatar from '$lib/components/Avatar.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import QrDialog from '$lib/components/QrDialog.svelte';
    import PhoneTypeButton from '$lib/components/PhoneTypeButton.svelte';

    let data = $state<FriendsOverview | null>(null);
    /** Your username, for your code (someone scans it to add you). */
    let myHandle = $state<string | null>(null);
    let showingCode = $state(false);
    $effect(() => {
        if (tracker.ready && !myHandle) lb.profile().then((p) => p && (myHandle = p.handle.replace(/^@/, '')));
    });
    const myCodeUrl = $derived(myHandle && tracker.saved?.server ? `${tracker.saved.server.replace(/\/$/, '')}/f/${myHandle}` : null);
    let failed = $state(false);
    function load() {
        lb.friends().then((res) => {
            if (res) data = res;
            else failed = true;
        });
    }
    $effect(() => {
        if (tracker.ready && !data) load();
    });

    const done: friendship.Done = (text) => {
        busy = false;
        if (text) undo.note(text);
        load();
    };
    let busy = $state(false);
    const act = (run: () => unknown) => {
        busy = true;
        run();
    };

    let handle = $state('');
    function add(e: SubmitEvent) {
        e.preventDefault();
        const h = handle.trim();
        if (!h || busy) return;
        act(() =>
            friendship.addFriend(h, (text) => {
                if (text === 'Friend request sent.' || text === 'You’re now friends.') handle = '';
                done(text);
            })
        );
    }

    // Search as you type (3+ characters): people by username or name, each
    // with what you can do (Add, Accept), as their profile has it.
    let found = $state<FoundPerson[] | null>(null);
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        const q = handle.trim().replace(/^@/, '');
        clearTimeout(searchTimer);
        if (q.length < 3 || !tracker.ready) {
            found = null;
            return;
        }
        searchTimer = setTimeout(async () => {
            const res = await lb.searchUsers(q);
            if (handle.trim().replace(/^@/, '') === q) found = res?.results ?? [];
        }, 300);
        return () => clearTimeout(searchTimer);
    });
    /** After acting on a search result: the list and the search say what changed. */
    const refresh: friendship.Done = (text) => {
        done(text);
        const q = handle.trim().replace(/^@/, '');
        if (q.length >= 3) lb.searchUsers(q).then((res) => res && (found = res.results));
    };

    const person = (f: FriendCard) => ({ user_id: f.user_id, name: f.name || f.handle, handle: f.handle });
    const href = (f: FriendCard) => `/u/${f.handle.replace(/^@/, '')}`;
    const anchor = (e: MouseEvent) => e.currentTarget as HTMLElement;
</script>

<svelte:head><title>Friends · Stremio</title></svelte:head>

{#snippet who(f: FriendCard)}
    <a class="who" href={href(f)}>
        <Avatar profile={{ name: f.name, color: '#6d4af0', avatar: f.avatar ?? undefined }} fallbackName={f.name || f.handle} size={40} />
        <span class="text">
            <span class="title">{f.name || f.handle}{#if f.close}<span class="close" title="Close friend"><Icon name="star" size={12} /></span>{/if}</span>
            <span class="sub">{f.handle}</span>
        </span>
    </a>
{/snippet}

<div class="page">
    <h1>Friends</h1>

    {#if !tracker.ready}
        <EmptyState icon="users" title={app.user ? 'Couldn’t connect' : 'Friends'}>
            <p>{app.user ? 'Your friends come back as soon as it does.' : 'Log in to add friends and see what they watch.'}</p>
            {#if !app.user}<button onclick={() => app.openLogin()}>Log In</button>{/if}
        </EmptyState>
    {:else}
        <form class="add" onsubmit={add}>
            <label class="field">
                <span aria-hidden="true">@</span>
                <input bind:value={handle} placeholder="username or name" aria-label="Their username or name" autocomplete="off" spellcheck="false" />
            </label>
            <button class="pill primary" type="submit" disabled={busy || !handle.trim()}><Icon name="plus" size={14} /> Add Friend</button>
        </form>
        <div class="phone-row"><PhoneTypeButton label="Their username" value={handle} max={30} onresult={(text) => (handle = text.replace(/^@/, '').trim())} /></div>
        {#if found}
            <section class="results" aria-label="People found">
                {#if found.length}
                    <div class="group">
                        {#each found as f (f.user_id)}
                            <div class="row">
                                {@render who(f)}
                                <span class="buttons">
                                    {#if f.relationship === 'friends'}
                                        <span class="state">Friends</span>
                                    {:else if f.relationship === 'outgoing'}
                                        <span class="state">Requested</span>
                                    {:else if f.relationship === 'incoming' && f.friendship_id}
                                        {@const id = f.friendship_id}
                                        <button class="pill primary" disabled={busy} onclick={() => act(() => friendship.accept(id, refresh))}>Accept</button>
                                    {:else}
                                        <button class="pill primary" disabled={busy} onclick={() => act(() => friendship.addFriend(f.handle, refresh))}><Icon name="plus" size={14} /> Add</button>
                                    {/if}
                                </span>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <p class="empty">No one by that name or username.</p>
                {/if}
            </section>
        {/if}
        {#if myCodeUrl}
            <p class="code-line">Or have them scan your code with their phone. <button class="text-link" onclick={() => (showingCode = true)}>Show My Code</button></p>
        {/if}

        {#if data === null}
            <p class="loading" role="status">{failed ? 'Couldn’t load your friends. Try again in a moment.' : 'Loading…'}</p>
        {:else}
            {#if data.incoming.length || data.outgoing.length}
                <section>
                    <h2>Requests</h2>
                    <div class="group">
                        {#each data.incoming as f (f.user_id)}
                            <div class="row">
                                {@render who(f)}
                                {#if f.friendship_id}
                                    {@const id = f.friendship_id}
                                    <span class="buttons">
                                        <button class="pill" disabled={busy} onclick={() => act(() => friendship.decline(id, done))}>Decline</button>
                                        <button class="pill primary" disabled={busy} onclick={() => act(() => friendship.accept(id, done))}>Accept</button>
                                    </span>
                                {/if}
                            </div>
                        {/each}
                        {#each data.outgoing as f (f.user_id)}
                            <div class="row">
                                {@render who(f)}
                                {#if f.friendship_id}
                                    {@const id = f.friendship_id}
                                    <span class="buttons">
                                        <span class="state">Requested</span>
                                        <button class="pill" disabled={busy} onclick={() => act(() => friendship.cancelRequest(id, done))}>Cancel</button>
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}

            <section>
                <h2>Your Friends{#if data.friends.length}<span class="count">{data.friends.length}</span>{/if}</h2>
                {#if data.friends.length}
                    <div class="group">
                        {#each data.friends as f (f.user_id)}
                            <div class="row">
                                {@render who(f)}
                                <button class="icon" aria-label={`More for ${f.name}`} aria-haspopup="menu" aria-expanded="false" onclick={(e) => friendship.friendMenu(anchor(e), { ...person(f), close: f.close }, done)}>
                                    <Icon name="more" size={18} />
                                </button>
                            </div>
                        {/each}
                    </div>
                    <p class="note">Only close friends see your real name.</p>
                {:else}
                    <p class="empty">Add someone by their username above. They’ll show here once they accept.</p>
                {/if}
            </section>

            {#if data.blocked.length}
                <section>
                    <h2>Blocked</h2>
                    <div class="group">
                        {#each data.blocked as f (f.user_id)}
                            <div class="row">
                                {@render who(f)}
                                <button class="pill" disabled={busy} onclick={() => act(() => friendship.unblock(person(f), done))}>Unblock</button>
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}
        {/if}
    {/if}
</div>

{#if showingCode && myCodeUrl}
    <QrDialog title="Add Me as a Friend" caption="Scan with a phone’s camera to open your profile and add you." url={myCodeUrl} onclose={() => (showingCode = false)} />
{/if}

<style>
    .page {
        max-width: 760px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 28px) var(--gutter) 64px;
    }
    h1 {
        margin: 0 0 24px;
        font-family: var(--font-display);
        font-size: clamp(28px, 3vw, 36px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    section {
        margin-top: 28px;
    }
    h2 {
        margin: 0 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    .count {
        margin-left: 6px;
        color: var(--label-3);
    }
    /* Add a friend: a username field and its button, on one line. */
    .add {
        display: flex;
        gap: 10px;
    }
    .field {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        height: 40px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 999px;
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
    /* Grouped rows, as Settings. */
    .group {
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated);
        overflow: hidden;
    }
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 60px;
        padding: 8px 14px 8px 16px;
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .who {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        color: inherit;
        text-decoration: none;
    }
    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .who:hover .title {
        text-decoration: underline;
    }
    .close {
        display: inline-flex;
        color: var(--accent-text);
    }
    .sub {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .buttons {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
    }
    .state {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 14px;
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        background: var(--glass);
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
    .add .pill {
        height: 40px;
    }
    .pill:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .pill:not(.primary):hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .icon {
        display: grid;
        flex: none;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--label-2);
        cursor: pointer;
    }
    .icon:hover {
        background: var(--fill);
        color: var(--label);
    }
    .note,
    .empty,
    .loading {
        margin: 8px 4px 0;
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .empty,
    .loading {
        font-size: var(--text-callout);
    }
    .phone-row:empty {
        display: none;
    }
    .phone-row {
        margin-top: 10px;
    }
    .results {
        margin-top: 12px;
    }
    .code-line {
        margin: 10px 4px 0;
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .text-link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent-text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    @media (pointer: coarse) {
        .pill,
        .icon,
        .field,
        .add .pill {
            height: 44px;
        }
        .icon {
            width: 44px;
        }
    }
</style>
