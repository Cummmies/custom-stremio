<script lang="ts">
    // A profile (docs/design.md): the banner as artwork in the website's shape
    // (a wide strip, 1120 by 220) with the picture across its edge and four
    // numbers in its bottom-right corner, as a title's scores; Edit Profile
    // right under them. Then the name, @username and bio; Favorites, a centred
    // row of five (yours keeps empty places to add to); then Lists (yours) and
    // Recently Watched, each one row of as many as fit; then Friends.
    // Someone else's has, where Edit Profile is on yours, what you can do
    // about them (lib/friendActions.ts): Add Friend, Requested, Accept and
    // Decline, Friends (Close Friend, Unfriend, Block), Unblock.
    // Edit Profile works as the website's does: in place. The name, username
    // and bio become grouped fields (as Settings) beside who can see what, the
    // banner and picture say how to change them (moved and scaled first, in
    // ImageCropper), and Favorites shows its five slots (tap one to choose,
    // drag or arrow keys to reorder). Cancel and Save take Edit Profile's place.
    import { tick, untrack } from 'svelte';
    import type { MediaCrop, Profile, ProfileFields, Visibility } from '$lib/tracker/api';
    import { day, score, type LibraryItem } from '$lib/tracker/api';
    import PosterCard from '$lib/components/PosterCard.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import Segmented from '$lib/components/Segmented.svelte';
    import Toggle from '$lib/components/Toggle.svelte';
    import ProfileMedia from './ProfileMedia.svelte';
    import ListCard from '$lib/components/ListCard.svelte';
    import FavoritePicker from './FavoritePicker.svelte';
    import ImageCropper from '$lib/components/ImageCropper.svelte';
    import { PICTURE_TYPES } from '$lib/movingImage';
    import { isTV } from '$lib/platform';
    import Avatar from '$lib/components/Avatar.svelte';
    import * as friendship from '$lib/friendActions';

    let {
        profile,
        busy = false,
        error = null,
        onsave,
        onchanged,
    }: {
        profile: Profile;
        busy?: boolean;
        error?: string | null;
        onsave?: (fields: ProfileFields) => Promise<boolean>;
        /** After a friend action: load the profile again. */
        onchanged?: () => void;
    } = $props();

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
    let realName = $state('');
    let handle = $state('');
    let bio = $state('');
    let visibility = $state<Visibility>('public');
    let shareScores = $state(true);
    let shareReviews = $state(true);
    let shareDates = $state(true);
    /** A new picture/banner (data URL), "" to remove, undefined: unchanged. */
    let avatar = $state<string | undefined>(undefined);
    let banner = $state<string | undefined>(undefined);
    /** For a new moving picture: the part of it to show (it goes up uncropped). */
    let avatarCrop = $state<MediaCrop | null>(null);
    let bannerCrop = $state<MediaCrop | null>(null);
    /** The favorites in order; the empty slots always come last. */
    let slots = $state<LibraryItem[]>([]);

    function begin() {
        const p = untrack(() => profile);
        name = p.name;
        realName = p.real_name ?? '';
        handle = p.handle.replace(/^@/, '');
        bio = p.bio;
        visibility = p.visibility ?? 'public';
        shareScores = p.share_scores ?? true;
        shareReviews = p.share_reviews ?? true;
        shareDates = p.share_dates ?? true;
        avatar = banner = undefined;
        avatarCrop = bannerCrop = null;
        slots = [...(p.favorites ?? [])].slice(0, SLOTS);
        editing = true;
    }
    function cancel() {
        editing = false;
        picking = null;
        cropping = null;
    }
    /** An empty favorite slot outside editing: start editing, choosing for it. */
    function addFavorite() {
        begin();
        picking = slots.length;
    }

    const shownBanner = $derived(editing && banner !== undefined ? banner || null : profile.banner);
    const shownAvatar = $derived(editing && avatar !== undefined ? avatar || null : profile.avatar);
    const cover = $derived(shownBanner ?? fallbackCover(profile));
    const shownAvatarCrop = $derived(editing && avatar !== undefined ? avatarCrop : (profile.avatar_crop ?? null));
    const shownBannerCrop = $derived(shownBanner ? (editing && banner !== undefined ? bannerCrop : (profile.banner_crop ?? null)) : null);
    const shownName = $derived(editing ? name : profile.name);
    const initial = $derived((shownName || profile.handle.replace(/^@/, '') || '?').charAt(0).toUpperCase());

    const handleValid = $derived(/^[a-z0-9_]{3,24}$/.test(handle));
    const valid = $derived(name.trim().length > 0 && name.trim().length <= NAME_MAX && handleValid && bio.length <= BIO_MAX);

    async function save() {
        if (!valid || busy || !onsave) return;
        const p = profile;
        const fields: ProfileFields = {};
        if (name.trim() !== p.name) fields.name = name.trim();
        if (realName.trim() !== (p.real_name ?? '')) fields.real_name = realName.trim();
        if (`@${handle}` !== p.handle) fields.handle = handle;
        if (bio.trim() !== p.bio) fields.bio = bio.trim();
        if (visibility !== (p.visibility ?? 'public')) fields.visibility = visibility;
        if (shareScores !== (p.share_scores ?? true)) fields.share_scores = shareScores;
        if (shareReviews !== (p.share_reviews ?? true)) fields.share_reviews = shareReviews;
        if (shareDates !== (p.share_dates ?? true)) fields.share_dates = shareDates;
        if (avatar !== undefined) fields.avatar = avatar;
        if (banner !== undefined) fields.banner = banner;
        if (avatar && avatarCrop) fields.avatar_crop = avatarCrop;
        if (banner && bannerCrop) fields.banner_crop = bannerCrop;
        const ids = slots.map((s) => s.id);
        if (ids.join() !== (p.favorites ?? []).map((f) => f.id).join()) fields.favorites = ids;
        if (!Object.keys(fields).length || (await onsave(fields))) editing = false;
    }

    // ---- Picture and banner: chosen, then moved and scaled (ImageCropper). A
    // still one comes back cut to the frame; a moving one whole, with the frame. ----
    let cropping = $state<{ file: File; kind: 'avatar' | 'banner' } | null>(null);
    function pickImage(e: Event, kind: 'avatar' | 'banner') {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (file) cropping = { file, kind };
    }
    function cropped({ url, crop }: { url: string; crop: MediaCrop | null }) {
        if (cropping?.kind === 'avatar') [avatar, avatarCrop] = [url, crop];
        else [banner, bannerCrop] = [url, crop];
        cropping = null;
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
        if (editing && picking === null && !cropping && e.key === 'Escape' && !e.defaultPrevented) {
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
    const cols = $derived(rowW && posterW ? Math.max(2, Math.floor((rowW + GAP) / (posterW + GAP))) : 6);
    /** A list is three posters fanned out, the front one poster-sized: about one and a half posters wide. */
    const listCols = $derived(rowW && posterW ? Math.max(1, Math.floor((rowW + 24) / (posterW * 1.45 + 24))) : 4);

    // ---- Friends: what you can do about someone else, and a row of friends ----
    const person = $derived({ user_id: profile.user_id, name: profile.name || profile.handle, handle: profile.handle });
    let note = $state<string | null>(null);
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    let acting = $state(false);
    /** After an action: say what happened (if anything to say) and show the new state. */
    const done: friendship.Done = (text) => {
        acting = false;
        if (text) {
            note = text;
            clearTimeout(noteTimer);
            noteTimer = setTimeout(() => (note = null), 3500);
        }
        onchanged?.();
    };
    const act = (run: () => unknown) => {
        acting = true;
        run();
    };
    const anchor = (e: MouseEvent) => e.currentTarget as HTMLElement;
    const FRIEND_W = 96;
    const friendCols = $derived(rowW ? Math.max(2, Math.floor((rowW + GAP) / (FRIEND_W + GAP))) : 8);

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
        {#if cover}<ProfileMedia src={cover} crop={shownBannerCrop} />{/if}
    </div>

    {#if editing}
        <!-- PC: hover the banner to change it, as on the website. Touch: the buttons on it. -->
        <button class="cover-hover" onclick={() => bannerInput?.click()} aria-label={shownBanner ? 'Change Banner' : 'Add Banner'}>
            <span class="hover-label" aria-hidden="true"><Icon name="camera" size={24} />{shownBanner ? 'Change Banner' : 'Add Banner'}</span>
        </button>
        <div class="cover-edit">
            <button class="glass-pill change" onclick={() => bannerInput?.click()}><Icon name="camera" size={15} /> {shownBanner ? 'Change Banner' : 'Add Banner'}</button>
        </div>
        <input bind:this={avatarInput} type="file" accept={PICTURE_TYPES} hidden onchange={(e) => pickImage(e, 'avatar')} />
        <input bind:this={bannerInput} type="file" accept={PICTURE_TYPES} hidden onchange={(e) => pickImage(e, 'banner')} />
    {/if}

    <div class="content">
    <div class="top">
        <!-- The picture across the banner's edge; on the right, under the numbers, Edit Profile (or Cancel and Save). -->
        <div class="avatar-row">
            <div class="avatar-wrap">
                {#if editing}
                    <button class="avatar" onclick={() => avatarInput?.click()} aria-label={shownAvatar ? 'Change Picture' : 'Add Picture'}>
                        {#if shownAvatar}<ProfileMedia src={shownAvatar} crop={shownAvatarCrop} />{:else}<span>{initial}</span>{/if}
                    </button>
                    <!-- Over the picture (outside it, so its own edge can't show through), not the ring. -->
                    <span class="avatar-edit" aria-hidden="true"><Icon name="camera" size={22} /><span class="avatar-edit-label">Change</span></span>
                {:else}
                    <div class="avatar" aria-hidden="true">
                        {#if shownAvatar}<ProfileMedia src={shownAvatar} crop={shownAvatarCrop} />{:else}<span>{initial}</span>{/if}
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
            {:else if !profile.is_owner && profile.relationship}
                <!-- Someone else: where Edit Profile is on yours. -->
                <div class="actions">
                    {#if profile.blocked}
                        <button class="glass-pill" disabled={acting} onclick={() => act(() => friendship.unblock(person, done))}>Unblock</button>
                    {:else if profile.relationship === 'friends'}
                        <button class="glass-pill" aria-haspopup="menu" aria-expanded="false" onclick={(e) => friendship.friendMenu(anchor(e), { ...person, close: profile.is_close }, done)}>
                            <Icon name={profile.is_close ? 'star' : 'check'} size={14} /> {profile.is_close ? 'Close Friend' : 'Friends'} <Icon name="chevronDown" size={14} />
                        </button>
                    {:else if profile.relationship === 'incoming' && profile.friendship_id}
                        {@const id = profile.friendship_id}
                        <button class="glass-pill" disabled={acting} onclick={() => act(() => friendship.decline(id, done))}>Decline</button>
                        <button class="primary-pill" disabled={acting} onclick={() => act(() => friendship.accept(id, () => done('You’re now friends.')))}>Accept</button>
                    {:else if profile.relationship === 'outgoing' && profile.friendship_id}
                        {@const id = profile.friendship_id}
                        <button class="glass-pill" aria-haspopup="menu" aria-expanded="false" onclick={(e) => friendship.requestedMenu(anchor(e), id, done)}>
                            <Icon name="check" size={14} /> Requested
                        </button>
                    {:else}
                        <button class="primary-pill" disabled={acting} onclick={() => act(() => friendship.addFriend(profile.handle, done))}>
                            <Icon name="plus" size={14} /> Add Friend
                        </button>
                    {/if}
                    {#if !profile.blocked && profile.relationship !== 'friends'}
                        <button class="glass-pill icon-only" aria-label="More" aria-haspopup="menu" aria-expanded="false" onclick={(e) => friendship.strangerMenu(anchor(e), person, done)}>
                            <Icon name="more" size={16} />
                        </button>
                    {/if}
                </div>
            {/if}
        </div>

        <!-- Four numbers in the banner's corner, as a title's scores sit (phones: under the bio). -->
        {#if stats.length && !profile.is_private}
            <dl class="stats" aria-label="Stats">
                {#each stats as s (s.label)}
                    <div><dd>{s.value}</dd><dt>{s.label}</dt></div>
                {/each}
            </dl>
        {/if}

        {#if editing}
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <div class="edit-grid">
                <div class="edit-col">
                    <h3>Profile</h3>
                    <div class="group">
                        <label class="row">
                            <span class="label">Name</span>
                            <input bind:value={name} maxlength={NAME_MAX} placeholder="Your name" autocomplete="nickname" />
                        </label>
                        <label class="row">
                            <span class="label">Real Name</span>
                            <input bind:value={realName} maxlength="80" placeholder="Optional" autocomplete="name" />
                        </label>
                        <label class="row">
                            <span class="label">Username</span>
                            <span class="handle-input">
                                <span aria-hidden="true">@</span>
                                <input
                                    bind:value={handle}
                                    maxlength="24"
                                    placeholder="username"
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
                        <p class="note bad">A username is 3 to 24 letters, numbers or underscores.</p>
                    {:else}
                        <p class="note">Your name shows here and in the app. Only friends see your real name, and it’s the one shown when switching profiles (empty: your name). Your username is how friends find you, and your profile’s link.</p>
                    {/if}
                </div>
                <div class="edit-col">
                    <h3>Who Can See Your Profile</h3>
                    <div class="privacy">
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
                    </div>
                    <p class="note">To people who can see your profile, and on titles your friends look at.</p>
                </div>
            </div>
        {:else}
            <div class="who">
                <h1>{profile.name || profile.handle}</h1>
                {#if profile.handle || profile.real_name}
                    <p class="handle">{[profile.handle, profile.real_name].filter(Boolean).join(' · ')}</p>
                {/if}
                {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
            </div>
        {/if}
    </div>

    {#if profile.is_private}
        <EmptyState icon="eyeOff" title="This profile is private">
            <p>{profile.name || 'They'} chose who can see it.</p>
        </EmptyState>
    {:else}
        <!-- Favorites: a row of their own, centred, five across. -->
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
            {:else if profile.favorites?.length || canEdit}
                <!-- Yours keeps room for five: an empty place adds one. -->
                <ol class="favorites">
                    {#each profile.favorites ?? [] as f (f.id)}<li><PosterCard item={poster(f, f.year)} /></li>{/each}
                    {#if canEdit}
                        {#each Array.from({ length: SLOTS - (profile.favorites?.length ?? 0) }, (_, i) => i) as i (i)}
                            <li class="slot-wrap">
                                <button class="slot-empty" class:quiet={i > 0} onclick={addFavorite} aria-label="Add a favorite">
                                    <Icon name="plus" size={22} />
                                </button>
                            </li>
                        {/each}
                    {/if}
                </ol>
            {:else}
                <p class="prompt">No favorites yet.</p>
            {/if}
        </section>

        {#if !editing}
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
                            {#each profile.lists.slice(0, listCols) as l (l.id)}<ListCard list={l} href={`/lists?id=${l.id}`} />{/each}
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

                {#if profile.friends?.length || profile.is_owner}
                    <section>
                        <div class="head">
                            <h2>Friends{#if profile.friend_count}<span class="count">{profile.friend_count}</span>{/if}</h2>
                            {#if profile.is_owner}
                                <a class="see-all" href="/friends">
                                    {profile.friend_requests ? `${profile.friend_requests} ${profile.friend_requests === 1 ? 'Request' : 'Requests'} · ` : ''}See All
                                </a>
                            {/if}
                        </div>
                        {#if profile.friends?.length}
                            <div class="friends" style="--cols: {friendCols}">
                                {#each profile.friends.slice(0, friendCols) as f (f.user_id)}
                                    <a class="friend" href={`/u/${f.handle.replace(/^@/, '')}`}>
                                        <Avatar profile={{ name: f.name, color: '#6d4af0', avatar: f.avatar ?? undefined }} fallbackName={f.name} size={FRIEND_W - 8} />
                                        <span class="friend-name">{f.name}</span>
                                    </a>
                                {/each}
                            </div>
                        {:else}
                            <p class="prompt">Friends you add show here. <a class="see-all" href="/friends">Add Friends</a></p>
                        {/if}
                    </section>
                {/if}
            </div>
        {/if}
    {/if}
    </div>
</div>

{#if note}<p class="note-toast" role="status">{note}</p>{/if}
{#if picking !== null}
    <FavoritePicker slot={picking} taken={slots.map((s) => s.id)} onpick={chose} onclose={() => (picking = null)} />
{/if}
{#if cropping}
    <ImageCropper file={cropping.file} shape={cropping.kind === 'avatar' ? 'circle' : 'banner'} onchoose={cropped} oncancel={() => (cropping = null)} />
{/if}

<style>
    .profile {
        /* The website's banner: 1120 wide by 220 tall, full width here. On a
           phone it keeps a usable height under the bar. */
        --cover-h: clamp(calc(var(--nav-h) + 100px), 19.643vw, 440px);
        --avatar: 120px;
        /* Everything under the banner sits in one centred column on wide screens. */
        --content-w: 1240px;
        position: relative;
        padding: 0 var(--gutter) 64px;
    }
    .cover {
        position: absolute;
        inset: 0 0 auto;
        height: var(--cover-h);
        overflow: hidden;
        /* The picture itself fades into whatever is behind it, ending at the edge. */
        -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 62%, rgb(0 0 0 / 0.4) 84%, transparent 100%);
        mask-image: linear-gradient(to bottom, #000 0, #000 62%, rgb(0 0 0 / 0.4) 84%, transparent 100%);
    }
    /* Light at the top, for the bar. */
    .cover::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(to bottom, var(--scrim) 0, transparent calc(var(--cover-h) * 0.4));
        pointer-events: none;
    }
    .cover-edit {
        position: absolute;
        z-index: 3;
        top: calc(var(--nav-h) + 12px);
        right: max(var(--gutter), calc((100% - var(--content-w)) / 2));
        display: flex;
        gap: 8px;
    }
    /* The banner as a button while editing: on PC, a frosted scrim says what a click does. */
    .cover-hover {
        position: absolute;
        z-index: 2;
        inset: 0 0 auto;
        height: var(--cover-h);
        display: none;
        place-items: center;
        padding: var(--nav-h) 0 0;
        border: 0;
        background: transparent;
        color: var(--on-media);
        cursor: pointer;
    }
    .hover-label {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        opacity: 0;
        transition: opacity var(--fast);
    }
    .cover-hover::before {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--scrim-strong);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        opacity: 0;
        transition: opacity var(--fast);
    }
    .hover-label {
        position: relative;
    }
    .cover-hover:hover::before,
    .cover-hover:hover .hover-label,
    .cover-hover:focus-visible::before,
    .cover-hover:focus-visible .hover-label {
        opacity: 1;
    }
    .content {
        position: relative;
        max-width: var(--content-w);
        margin-inline: auto;
    }

    .top {
        position: relative;
        z-index: 3;
        /* Over the banner, only its controls take clicks (the banner itself can be one). */
        pointer-events: none;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: calc(var(--cover-h) - var(--avatar) / 2);
        margin-bottom: 40px;
    }
    .top > :not(.avatar-row),
    .avatar-row > * {
        pointer-events: auto;
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
    /* A ring only where the picture meets the page: its lower half, a U under the banner. */
    .avatar-wrap::before {
        content: '';
        position: absolute;
        z-index: 1;
        inset: -6px;
        border: 2px solid var(--label-3);
        border-radius: 50%;
        clip-path: inset(50% 0 0 0);
        pointer-events: none;
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
        box-shadow: var(--shadow-m);
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
        z-index: 2;
        inset: -1px;
        border-radius: 50%;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        background: var(--scrim);
        color: var(--on-media);
        transition: background var(--fast);
    }
    .avatar-wrap:hover .avatar-edit {
        background: var(--scrim-strong);
    }
    .avatar-edit-label {
        display: none;
        font-size: 12px;
        font-weight: 600;
    }
    /* PC (a pointer that hovers): as on the website, the picture and banner say
       "Change" when you point at them, in place of the banner's button. */
    @media (hover: hover) and (pointer: fine) {
        .cover-hover {
            display: grid;
        }
        .cover-edit {
            display: none;
        }
        .avatar-edit {
            opacity: 0;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            transition: opacity var(--fast);
        }
        .avatar-edit-label {
            display: block;
        }
        .avatar-wrap:hover .avatar-edit,
        button.avatar:focus-visible + .avatar-edit {
            opacity: 1;
        }
    }
    /* Remove: a small glass button on a favorite's corner. */
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
    /* In the banner's bottom-right corner, right above Edit Profile: as a title's scores. */
    .stats {
        position: absolute;
        right: 0;
        top: calc(var(--cover-h) - 96px);
        display: flex;
        gap: 40px;
        margin: 0;
        text-align: center;
        text-shadow: 0 1px 10px rgb(0 0 0 / 0.7);
    }
    .stats dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title1);
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
    }
    .stats dt {
        margin-top: 2px;
        font-size: var(--text-caption);
        color: var(--label-2);
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
        max-width: 60ch;
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

    /* Editing: two groups side by side, as Settings' rows. */
    /* Two equal halves across the column, lined up with the favorites under
       them, on shared rows (heading, groups, note): the groups end level. */
    .edit-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-rows: auto auto auto;
        grid-auto-flow: column;
        gap: 10px clamp(24px, 3vw, 48px);
        margin-top: 8px;
    }
    .edit-col {
        display: contents;
    }
    .privacy {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
    }
    /* The profile group fills its row; the bio takes the extra room. */
    .edit-col > .group {
        display: flex;
        flex-direction: column;
    }
    .edit-col > .group .bio-row {
        flex: 1;
    }
    /* …and the privacy side matches it: its rows share the same height. */
    .privacy .group {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
    .privacy .group .row {
        flex: 1;
    }
    .bio-row textarea {
        align-self: stretch;
    }
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
        width: 80px;
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
        margin: 0;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .note {
        margin: 0;
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

    section {
        margin-bottom: 40px;
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
    .prompt {
        margin: 0;
        color: var(--label-2);
    }
    /* Five across the column, with room between. */
    .favorites {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: clamp(12px, 2.2vw, 28px);
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .slots li,
    .slot-wrap {
        position: relative;
    }
    .slots li {
        aspect-ratio: 2 / 3;
        transition:
            transform var(--fast) var(--ease),
            opacity var(--fast);
    }
    /* An empty place beside real posters: poster-shaped, the title line's room under it. */
    .slot-wrap .slot-empty {
        height: auto;
        aspect-ratio: 2 / 3;
    }
    .slots li.dragging {
        z-index: 1;
        transform: scale(1.04);
        opacity: 0.9;
    }
    .slots .remove {
        z-index: 2;
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
    .slot-empty.quiet {
        background: transparent;
        color: var(--label-3);
    }
    .slot-empty:hover:not(:disabled) {
        background: var(--fill-hover);
        color: var(--label);
    }
    .slot-empty:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .icon-only {
        width: 36px;
        padding: 0;
        justify-content: center;
    }
    .count {
        margin-left: 8px;
        color: var(--label-2);
        font-weight: 500;
    }
    /* Friends: one row of pictures and names, as many as fit. */
    .friends {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 16px;
    }
    .friend {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: inherit;
        text-decoration: none;
    }
    .friend-name {
        max-width: 100%;
        overflow: hidden;
        font-size: var(--text-callout);
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .friend:hover .friend-name {
        text-decoration: underline;
    }
    .note-toast {
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
    /* One row, as many as fit (the count comes from the width). */
    .probe {
        display: block;
        width: var(--poster-w);
        height: 0;
    }
    .shelf {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 16px;
    }
    /* Lists (ListCard) keep their size: as many as fit, from the left. */
    .lists {
        display: flex;
        gap: 24px;
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
    @media (max-width: 800px) {
        .edit-grid {
            display: flex;
            flex-direction: column;
        }
        .edit-col + .edit-col h3 {
            margin-top: 14px;
        }
    }
    /* Phones: the numbers under the bio, spread across; five favorites fill the width. */
    @media (max-width: 600px) {
        .profile {
            --avatar: 88px;
        }
        .top {
            margin-bottom: 32px;
        }
        .stats {
            position: static;
            order: 3;
            justify-content: space-between;
            gap: 12px;
            margin-top: 8px;
            text-align: left;
            text-shadow: none;
        }
        .stats dd {
            font-size: var(--text-title2);
        }
        .stats dt {
            font-size: var(--text-caption);
        }
        .favorites {
            gap: 8px;
        }
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
