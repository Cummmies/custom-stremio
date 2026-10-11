<script lang="ts">
    // A profile (docs/design.md): the banner as artwork in the website's shape
    // (a wide strip, 1120 by 220) with the picture across its edge. Under it,
    // who you are (name, @handle, bio, four plain numbers) beside Favorites;
    // then Lists (yours) and Recently Watched, each one row of as many as fit.
    // Edit Profile works as the website's does: in place. Who you are becomes
    // grouped fields (as Settings) with who can see what under them, the banner
    // and picture say how to change them, and Favorites shows its five slots
    // (tap one to choose, drag or arrow keys to reorder). Cancel and Save take
    // Edit Profile's place.
    import { tick, untrack } from 'svelte';
    import type { Profile, ProfileFields, Visibility } from '$lib/tracker/api';
    import { day, score, type LibraryItem } from '$lib/tracker/api';
    import { imageToAvatar } from '$lib/profiles.svelte';
    import PosterCard from '$lib/components/PosterCard.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import Segmented from '$lib/components/Segmented.svelte';
    import Toggle from '$lib/components/Toggle.svelte';
    import ProfileMedia from './ProfileMedia.svelte';
    import FavoritePicker from './FavoritePicker.svelte';
    import { isTV } from '$lib/platform';

    let {
        profile,
        busy = false,
        error = null,
        onsave,
    }: { profile: Profile; busy?: boolean; error?: string | null; onsave?: (fields: ProfileFields) => Promise<boolean> } = $props();

    const SLOTS = 5;
    const NAME_MAX = 40;
    const BIO_MAX = 300;
    const canEdit = $derived(profile.is_owner && !isTV && !!onsave);

    /** No banner: the first favorite's (or recent watch's) backdrop, so the top is never a blank band. */
    function fallbackCover(p: Profile) {
        const first = [...(p.favorites ?? []), ...(p.recent ?? [])].find((i) => i.id.startsWith('tt'));
        return first ? `https://images.metahub.space/background/medium/${first.id}/img` : null;
    }

    // ---- Editing: a draft of everything, saved together. ----
    let editing = $state(false);
    let name = $state('');
    let handle = $state('');
    let bio = $state('');
    let visibility = $state<Visibility>('public');
    let shareScores = $state(true);
    let shareReviews = $state(true);
    let shareDates = $state(true);
    /** A new picture/banner (data URL), "" to remove, undefined: unchanged. */
    let avatar = $state<string | undefined>(undefined);
    let banner = $state<string | undefined>(undefined);
    /** The favorites in order; the empty slots always come last. */
    let slots = $state<LibraryItem[]>([]);

    function begin() {
        const p = untrack(() => profile);
        name = p.name;
        handle = p.handle.replace(/^@/, '');
        bio = p.bio;
        visibility = p.visibility ?? 'public';
        shareScores = p.share_scores ?? true;
        shareReviews = p.share_reviews ?? true;
        shareDates = p.share_dates ?? true;
        avatar = banner = undefined;
        slots = [...(p.favorites ?? [])].slice(0, SLOTS);
        editing = true;
    }
    function cancel() {
        editing = false;
        picking = null;
    }

    const shownBanner = $derived(editing && banner !== undefined ? banner || null : profile.banner);
    const shownAvatar = $derived(editing && avatar !== undefined ? avatar || null : profile.avatar);
    const cover = $derived(shownBanner ?? fallbackCover(profile));
    const shownName = $derived(editing ? name : profile.name);
    const initial = $derived((shownName || profile.handle.replace(/^@/, '') || '?').charAt(0).toUpperCase());

    const handleValid = $derived(/^[a-z0-9_]{3,24}$/.test(handle));
    const valid = $derived(name.trim().length > 0 && name.trim().length <= NAME_MAX && handleValid && bio.length <= BIO_MAX);

    async function save() {
        if (!valid || busy || !onsave) return;
        const p = profile;
        const fields: ProfileFields = {};
        if (name.trim() !== p.name) fields.name = name.trim();
        if (`@${handle}` !== p.handle) fields.handle = handle;
        if (bio.trim() !== p.bio) fields.bio = bio.trim();
        if (visibility !== (p.visibility ?? 'public')) fields.visibility = visibility;
        if (shareScores !== (p.share_scores ?? true)) fields.share_scores = shareScores;
        if (shareReviews !== (p.share_reviews ?? true)) fields.share_reviews = shareReviews;
        if (shareDates !== (p.share_dates ?? true)) fields.share_dates = shareDates;
        if (avatar !== undefined) fields.avatar = avatar;
        if (banner !== undefined) fields.banner = banner;
        const ids = slots.map((s) => s.id);
        if (ids.join() !== (p.favorites ?? []).map((f) => f.id).join()) fields.favorites = ids;
        if (!Object.keys(fields).length || (await onsave(fields))) editing = false;
    }

    // ---- Picture and banner ----
    /** A banner as the website keeps one: the whole picture, at most 2560 wide. */
    async function imageToBanner(file: File): Promise<string> {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2560 / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return canvas.toDataURL('image/jpeg', 0.86);
    }
    async function pickImage(e: Event, kind: 'avatar' | 'banner') {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (kind === 'avatar') avatar = await imageToAvatar(file, 400);
        else banner = await imageToBanner(file);
    }
    let avatarInput = $state<HTMLInputElement>();
    let bannerInput = $state<HTMLInputElement>();

    // ---- Favorites: tap a slot to choose, drag (or arrow keys) to reorder ----
    let picking = $state<number | null>(null);
    function chose(item: LibraryItem) {
        if (picking === null) return;
        const next = [...slots];
        next[Math.min(picking, next.length)] = item;
        slots = next;
        picking = null;
    }
    function removeSlot(i: number) {
        slots = slots.filter((_, n) => n !== i);
    }
    async function moveSlot(from: number, to: number, focus = false) {
        if (to < 0 || to >= slots.length || to === from) return;
        const next = [...slots];
        next.splice(to, 0, ...next.splice(from, 1));
        slots = next;
        if (focus) {
            await tick();
            (document.querySelector(`[data-slot="${to}"] .slot-card`) as HTMLElement | null)?.focus();
        }
    }
    let drag: { from: number; x: number; y: number; moved: boolean } | null = null;
    let dragging = $state<number | null>(null);
    let justDragged = false;
    function slotDown(e: PointerEvent, i: number) {
        if (e.button !== 0) return;
        drag = { from: i, x: e.clientX, y: e.clientY, moved: false };
    }
    function slotMove(e: PointerEvent) {
        if (!drag) return;
        if (!drag.moved) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
            drag.moved = true;
            dragging = drag.from;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]');
        const to = over ? Number(over.dataset.slot) : -1;
        if (to >= 0 && to < slots.length && to !== drag.from) {
            moveSlot(drag.from, to);
            drag.from = dragging = to;
        }
    }
    function slotUp() {
        justDragged = !!drag?.moved;
        drag = null;
        dragging = null;
    }
    function slotClick(i: number) {
        if (justDragged) return void (justDragged = false);
        picking = i;
    }
    function slotKey(e: KeyboardEvent, i: number) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            moveSlot(i, i + (e.key === 'ArrowLeft' ? -1 : 1), true);
        }
    }

    function onkeydown(e: KeyboardEvent) {
        if (editing && picking === null && e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            cancel();
        }
    }

    // ---- What's shown ----
    const stats = $derived(
        profile.stats
            ? [
                  { value: profile.stats.watched.toLocaleString(), label: 'Watched' },
                  { value: profile.stats.hours.toLocaleString(), label: 'Hours' },
                  ...(profile.stats.average != null ? [{ value: score(profile.stats.average), label: 'Average' }] : []),
                  { value: profile.stats.this_year.toLocaleString(), label: 'This Year' },
              ]
            : []
    );

    /** The rows' width and a poster's (--poster-w, measured): how many fit in one row. */
    let rowW = $state(0);
    let posterW = $state(0);
    const GAP = 16;
    const LIST_W = 220;
    const cols = $derived(rowW && posterW ? Math.max(2, Math.floor((rowW + GAP) / (posterW + GAP))) : 6);
    const listCols = $derived(rowW ? Math.max(1, Math.floor((rowW + 24) / (LIST_W + 24))) : 4);

    const thisYear = String(new Date().getFullYear());
    function recentLine(i: LibraryItem) {
        const when = i.date ? day(i.date, { month: 'short', day: 'numeric', year: i.date.startsWith(thisYear) ? undefined : 'numeric' }) : null;
        return [when, i.rating != null ? score(i.rating) : null].filter(Boolean).join(' · ') || i.year;
    }
    const poster = (i: LibraryItem, below: string | null) => ({ id: i.id, type: i.type, name: i.name, poster: i.poster, releaseInfo: below, progress: null });
</script>

<svelte:window {onkeydown} />

<div class="profile" class:editing>
    <div class="cover" aria-hidden={!editing}>
        {#if cover}<ProfileMedia src={cover} />{/if}
    </div>

    {#if editing}
        <!-- Over the banner's top corner, as on the website. -->
        <div class="cover-edit">
            <button class="glass-pill" onclick={() => bannerInput?.click()}><Icon name="camera" size={15} /> {shownBanner ? 'Change Banner' : 'Add Banner'}</button>
            {#if shownBanner}<button class="glass-pill" onclick={() => (banner = '')}>Remove</button>{/if}
        </div>
        <input bind:this={avatarInput} type="file" accept="image/*" hidden onchange={(e) => pickImage(e, 'avatar')} />
        <input bind:this={bannerInput} type="file" accept="image/*" hidden onchange={(e) => pickImage(e, 'banner')} />
    {/if}

    <div class="top" class:alone={profile.is_private}>
        <div class="identity">
            <!-- The picture across the banner's edge; beside it Edit Profile, or Cancel and Save, in one place. -->
            <div class="avatar-row">
                <div class="avatar-wrap">
                    {#if editing}
                        <button class="avatar" onclick={() => avatarInput?.click()} aria-label={shownAvatar ? 'Change Picture' : 'Add Picture'}>
                            {#if shownAvatar}<ProfileMedia src={shownAvatar} />{:else}<span>{initial}</span>{/if}
                            <span class="avatar-edit" aria-hidden="true"><Icon name="camera" size={22} /></span>
                        </button>
                        {#if shownAvatar}
                            <button class="remove" onclick={() => (avatar = '')} aria-label="Remove Picture"><Icon name="close" size={12} /></button>
                        {/if}
                    {:else}
                        <div class="avatar" aria-hidden="true">
                            {#if shownAvatar}<ProfileMedia src={shownAvatar} />{:else}<span>{initial}</span>{/if}
                        </div>
                    {/if}
                </div>
                {#if editing}
                    <div class="actions">
                        <button class="glass-pill" onclick={cancel}>Cancel</button>
                        <button class="primary-pill" disabled={busy || !valid} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
                    </div>
                {:else if canEdit}
                    <div class="actions">
                        <button class="glass-pill" onclick={begin}><Icon name="pencil" size={14} /> Edit Profile</button>
                    </div>
                {/if}
            </div>

            {#if editing}
                {#if error}<p class="error" role="alert">{error}</p>{/if}
                <div class="group">
                    <label class="row">
                        <span class="label">Name</span>
                        <input bind:value={name} maxlength={NAME_MAX} placeholder="Your name" autocomplete="nickname" />
                    </label>
                    <label class="row">
                        <span class="label">Handle</span>
                        <span class="handle-input">
                            <span aria-hidden="true">@</span>
                            <input
                                bind:value={handle}
                                maxlength="24"
                                placeholder="handle"
                                autocomplete="off"
                                spellcheck="false"
                                oninput={() => (handle = handle.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                            />
                        </span>
                    </label>
                    <label class="row bio-row">
                        <span class="label">Bio</span>
                        <textarea bind:value={bio} maxlength={BIO_MAX} rows="3" placeholder="A line about you"></textarea>
                    </label>
                </div>
                {#if handle && !handleValid}
                    <p class="note bad">A handle is 3 to 24 letters, numbers or underscores.</p>
                {:else if bio.length > BIO_MAX - 40}
                    <p class="note">{BIO_MAX - bio.length} characters left</p>
                {/if}

                <h3>Who Can See Your Profile</h3>
                <Segmented
                    label="Who can see your profile"
                    fill
                    options={[
                        { value: 'public', label: 'Everyone' },
                        { value: 'friends', label: 'Friends' },
                        { value: 'private', label: 'Only Me' },
                    ]}
                    bind:value={visibility}
                />
                <div class="group">
                    <div class="row"><span>Show Scores</span><Toggle label="Show scores" bind:checked={shareScores} /></div>
                    <div class="row"><span>Show Reviews</span><Toggle label="Show reviews" bind:checked={shareReviews} /></div>
                    <div class="row"><span>Show Watch Dates</span><Toggle label="Show watch dates" bind:checked={shareDates} /></div>
                </div>
                <p class="note">To people who can see your profile, and on titles your friends look at.</p>
            {:else}
                <div class="who">
                    <h1>{profile.name || profile.handle}</h1>
                    {#if profile.handle}<p class="handle">{profile.handle}</p>{/if}
                    {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
                </div>
                {#if stats.length && !profile.is_private}
                    <dl class="stats">
                        {#each stats as s (s.label)}
                            <div><dt>{s.label}</dt><dd>{s.value}</dd></div>
                        {/each}
                    </dl>
                {/if}
            {/if}
        </div>

        {#if !profile.is_private}
            <!-- Favorites: beside who you are, at a size five fill. -->
            <section class="showcase">
                <div class="head">
                    <h2>Favorites</h2>
                    {#if editing}<span class="hint">{slots.length > 1 ? 'Drag to reorder' : `Up to ${SLOTS}`}</span>{/if}
                </div>
                {#if editing}
                    <ol class="favorites slots">
                        {#each Array.from({ length: SLOTS }, (_, i) => i) as i (slots[i]?.id ?? `empty-${i}`)}
                            {@const item = slots[i]}
                            <li data-slot={i} class:dragging={dragging === i}>
                                {#if item}
                                    <button
                                        class="slot-card"
                                        aria-label={`${item.name}, favorite ${i + 1}. Choose another; arrow keys move it.`}
                                        onpointerdown={(e) => slotDown(e, i)}
                                        onpointermove={slotMove}
                                        onpointerup={slotUp}
                                        onpointercancel={slotUp}
                                        onclick={() => slotClick(i)}
                                        onkeydown={(e) => slotKey(e, i)}
                                    >
                                        {#if item.poster}<img src={item.poster} alt="" draggable="false" />{:else}<span class="slot-name">{item.name}</span>{/if}
                                    </button>
                                    <button class="remove" onclick={() => removeSlot(i)} aria-label={`Remove ${item.name}`}><Icon name="close" size={12} /></button>
                                {:else}
                                    <button class="slot-empty" onclick={() => (picking = slots.length)} disabled={i > slots.length} aria-label="Add a favorite">
                                        <Icon name="plus" size={22} />
                                    </button>
                                {/if}
                            </li>
                        {/each}
                    </ol>
                {:else if profile.favorites?.length}
                    <div class="favorites">
                        {#each profile.favorites as f (f.id)}<PosterCard item={poster(f, f.year)} />{/each}
                    </div>
                {:else if canEdit}
                    <p class="prompt">Show up to five titles you love. <button class="text" onclick={begin}>Choose</button></p>
                {:else}
                    <p class="prompt">No favorites yet.</p>
                {/if}
            </section>
        {/if}
    </div>

    {#if profile.is_private}
        <EmptyState icon="eyeOff" title="This profile is private">
            <p>{profile.name || 'They'} chose who can see it.</p>
        </EmptyState>
    {:else if !editing}
        <!-- One row each, as many as the width holds. -->
        <div class="rows" bind:clientWidth={rowW}>
            <span class="probe" aria-hidden="true" bind:clientWidth={posterW}></span>
            {#if profile.is_owner && profile.lists?.length}
                <section>
                    <div class="head">
                        <h2>Lists</h2>
                        {#if profile.lists.length > listCols}<a class="see-all" href="/lists">See All</a>{/if}
                    </div>
                    <div class="lists" style="--cols: {listCols}">
                        {#each profile.lists.slice(0, listCols) as l (l.id)}
                            <a class="list" href={`/lists?id=${l.id}`}>
                                <span class="stack" aria-hidden="true">
                                    {#each l.posters.slice(0, 3) as src, i (i)}<img {src} alt="" loading="lazy" style="--i: {i}" />{:else}<span class="blank"><Icon name="list" size={22} /></span>{/each}
                                </span>
                                <span class="name">{l.name}</span>
                                <span class="meta">{l.count} {l.count === 1 ? 'title' : 'titles'}</span>
                            </a>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if profile.recent?.length}
                <section>
                    <div class="head">
                        <h2>Recently Watched</h2>
                        {#if profile.is_owner && profile.recent.length > cols}<a class="see-all" href="/library">See All</a>{/if}
                    </div>
                    <div class="shelf" style="--cols: {cols}">
                        {#each profile.recent.slice(0, cols) as r (r.id)}<PosterCard item={poster(r, recentLine(r))} />{/each}
                    </div>
                </section>
            {/if}
        </div>
    {/if}
</div>

{#if picking !== null}
    <FavoritePicker slot={picking} taken={slots.map((s) => s.id)} onpick={chose} onclose={() => (picking = null)} />
{/if}

<style>
    .profile {
        /* The website's banner: 1120 wide by 220 tall, full width here. On a
           phone it keeps a usable height under the bar. */
        --cover-h: clamp(calc(var(--nav-h) + 100px), 19.643vw, 440px);
        --avatar: 120px;
        position: relative;
        padding: 0 var(--gutter) 64px;
    }
    .cover {
        position: absolute;
        inset: 0 0 auto;
        height: var(--cover-h);
        overflow: hidden;
        background: var(--elevated);
    }
    /* Light at the top for the bar, a short fade into the page at the bottom. */
    .cover::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(to bottom, var(--scrim) 0%, transparent 38%, transparent 72%, var(--bg) 100%);
        pointer-events: none;
    }
    .cover-edit {
        position: absolute;
        z-index: 2;
        top: calc(var(--nav-h) + 12px);
        right: var(--gutter);
        display: flex;
        gap: 8px;
    }

    /* Who you are on the left, Favorites on the right; one column when narrow. */
    .top {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
        gap: 28px 64px;
        align-items: start;
        padding-top: calc(var(--cover-h) - var(--avatar) / 2);
        margin-bottom: 44px;
    }
    .top.alone {
        grid-template-columns: minmax(0, 560px);
    }
    .identity {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
    }
    .avatar-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 4px;
    }
    .avatar-wrap {
        position: relative;
        flex: none;
    }
    .avatar {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--avatar);
        height: var(--avatar);
        padding: 0;
        border: 0;
        border-radius: 50%;
        overflow: hidden;
        background: var(--accent);
        box-shadow: 0 0 0 4px var(--bg), var(--shadow-m);
        color: var(--on-accent);
        font-family: var(--font-display);
        font-size: calc(var(--avatar) * 0.4);
        font-weight: 600;
    }
    button.avatar {
        cursor: pointer;
    }
    .avatar-edit {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: var(--scrim);
        color: var(--on-media);
        transition: background var(--fast);
    }
    button.avatar:hover .avatar-edit {
        background: var(--scrim-strong);
    }
    /* Remove: a small glass button on the picture's (or poster's) corner. */
    .remove {
        position: absolute;
        top: 0;
        right: 0;
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
    .actions {
        display: flex;
        gap: 8px;
        padding-bottom: 6px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-large);
        font-weight: 700;
        line-height: 1.1;
    }
    .handle {
        margin: 4px 0 0;
        color: var(--label-2);
    }
    .bio {
        margin: 10px 0 0;
        color: var(--label-2);
        white-space: pre-line;
    }
    .glass-pill,
    .primary-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 16px;
        border-radius: 999px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }
    .glass-pill {
        border: 1px solid var(--glass-border);
        background: var(--glass);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        color: var(--label);
    }
    .glass-pill:hover {
        background: var(--glass-strong);
    }
    .primary-pill {
        border: 0;
        background: var(--label);
        color: var(--bg);
    }
    .primary-pill:disabled {
        opacity: 0.5;
        cursor: default;
    }

    /* Editing: grouped rows, as Settings. */
    .group {
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        overflow: hidden;
    }
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
        padding: 6px 14px;
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .row.bio-row {
        align-items: flex-start;
        padding-top: 12px;
    }
    .label {
        flex: none;
        width: 64px;
        color: var(--label-2);
    }
    .row input,
    .row textarea {
        flex: 1;
        min-width: 0;
        padding: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--label);
        font: inherit;
        resize: none;
    }
    .handle-input {
        flex: 1;
        display: flex;
        min-width: 0;
        color: var(--label-2);
    }
    h3 {
        margin: 12px 0 0;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .note {
        margin: -4px 0 0;
        font-size: 12px;
        color: var(--label-2);
    }
    .note.bad,
    .error {
        color: var(--bad-text);
    }
    .error {
        margin: 0;
    }

    /* Four plain numbers. */
    .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 36px;
        margin: 8px 0 0;
    }
    .stats div {
        display: flex;
        flex-direction: column-reverse;
    }
    .stats dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .stats dt {
        color: var(--label-2);
        font-size: var(--text-caption);
    }

    section {
        margin-bottom: 40px;
    }
    /* Its title lines up with your name. */
    .showcase {
        margin: 0;
        padding-top: calc(var(--avatar) / 2 + 22px);
    }
    .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 12px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .hint {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .see-all {
        color: var(--accent-text);
        font-weight: 600;
        text-decoration: none;
    }
    .see-all:hover {
        text-decoration: underline;
    }
    .text {
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent-text);
        font-weight: 600;
        cursor: pointer;
    }
    .prompt {
        margin: 0;
        color: var(--label-2);
    }
    .favorites {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 16px;
        max-width: 960px;
    }
    .slots {
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .slots li {
        position: relative;
        aspect-ratio: 2 / 3;
        transition:
            transform var(--fast) var(--ease),
            opacity var(--fast);
    }
    .slots li.dragging {
        z-index: 1;
        transform: scale(1.04);
        opacity: 0.9;
    }
    .slots .remove {
        top: -8px;
        right: -8px;
    }
    .slot-card,
    .slot-empty {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        padding: 0;
        border-radius: var(--radius-s);
        overflow: hidden;
        cursor: pointer;
    }
    .slot-card {
        border: 0;
        background: var(--elevated-2);
        box-shadow: var(--shadow-s);
        touch-action: pan-y;
        cursor: grab;
    }
    .dragging .slot-card {
        cursor: grabbing;
        box-shadow: var(--shadow-l);
    }
    .slot-card img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        user-select: none;
    }
    .slot-name {
        padding: 8px;
        font-size: 12px;
        color: var(--label-2);
        text-align: center;
    }
    .slot-empty {
        border: 1.5px dashed var(--separator);
        background: var(--fill);
        color: var(--label-2);
        transition:
            background var(--fast),
            color var(--fast);
    }
    .slot-empty:hover:not(:disabled) {
        background: var(--fill-hover);
        color: var(--label);
    }
    .slot-empty:disabled {
        opacity: 0.45;
        cursor: default;
    }

    /* One row, as many as fit (the count comes from the width). */
    .probe {
        display: block;
        width: var(--poster-w);
        height: 0;
    }
    .shelf,
    .lists {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 16px;
    }
    .lists {
        gap: 24px;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        color: inherit;
        text-decoration: none;
    }
    .stack {
        position: relative;
        height: 120px;
        margin-bottom: 6px;
    }
    .stack img,
    .blank {
        position: absolute;
        left: calc(var(--i, 0) * 34px);
        width: 80px;
        height: 120px;
        border-radius: var(--radius-s);
        object-fit: cover;
        background: var(--elevated-2);
        box-shadow: var(--shadow-s);
    }
    .blank {
        display: grid;
        place-items: center;
        color: var(--label-3);
    }
    .list .name {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .list .meta {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .list:hover .name {
        text-decoration: underline;
    }

    @media (pointer: coarse) {
        .glass-pill,
        .primary-pill {
            height: 44px;
        }
        .remove {
            width: 32px;
            height: 32px;
        }
    }
    /* Narrower: one column, Favorites under who you are. */
    @media (max-width: 980px) {
        .top {
            grid-template-columns: minmax(0, 1fr);
        }
        .identity {
            max-width: 560px;
        }
        .showcase {
            padding-top: 4px;
        }
    }
    @media (max-width: 600px) {
        .profile {
            --avatar: 88px;
        }
        .top {
            margin-bottom: 32px;
        }
        .identity {
            max-width: none;
        }
        .stats {
            justify-content: space-between;
            gap: 12px;
        }
        .favorites {
            gap: 8px;
        }
        /* Small, so they stay clear of the picture. */
        .cover-edit {
            top: calc(var(--nav-h) + 8px);
            right: 16px;
        }
        .cover-edit .glass-pill {
            height: 32px;
            padding: 0 12px;
            font-size: 13px;
        }
    }
</style>
