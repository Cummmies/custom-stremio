<script lang="ts">
    // Your profile (lib/components/profile/ProfileView.svelte), edited in
    // place. It's one profile: its name and picture are also
    // this account's in the app (the account menu, the profile picker), so
    // changing them here changes them there.
    import { app } from '$lib/app.svelte';
    import { tracker } from '$lib/tracker.svelte';
    import { profiles } from '$lib/profiles.svelte';
    import { lb, type MediaCrop, type Profile, type ProfileFields } from '$lib/tracker/api';
    import ProfileView from '$lib/components/profile/ProfileView.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';

    let profile = $state<Profile | null>(null);
    let failed = $state(false);
    $effect(() => {
        if (!tracker.ready || !app.user) return;
        lb.profile().then((res) => {
            if (!res) return (failed = true);
            profile = res;
            adoptPicture(res);
        });
    });

    /** One name and picture: the app takes the profile's name, and its picture when it has none. */
    function adoptPicture(p: Profile) {
        const uid = app.user?._id;
        const saved = profiles.get(uid);
        if (!uid || !saved) return;
        const patch: { name?: string; avatar?: string; avatarCrop?: MediaCrop; realName?: string } = {};
        if (p.name && p.name !== saved.name) patch.name = p.name;
        if ((p.real_name || undefined) !== saved.realName) patch.realName = p.real_name || undefined;
        // (A video picture stays on the profile; the app's small picture is a still.)
        if (!saved.avatar && p.avatar && !/\.(mp4|webm|mov)$/i.test(p.avatar)) patch.avatar = p.avatar;
        // The same picture: its crop as the profile has it (set on another device, or the website).
        if ((patch.avatar ?? saved.avatar) === p.avatar && JSON.stringify(saved.avatarCrop ?? null) !== JSON.stringify(p.avatar_crop ?? null))
            patch.avatarCrop = p.avatar_crop ?? undefined;
        if (Object.keys(patch).length) profiles.update(uid, patch);
    }

    let busy = $state(false);
    let error = $state<string | null>(null);

    async function save(fields: ProfileFields) {
        busy = true;
        error = null;
        const res = await lb.updateProfile(fields);
        busy = false;
        if (!('data' in res)) {
            // The tracker says what's wrong ("That username is taken.", "A bio can
            // have up to 4 line breaks.", once a week...); a picture too big says 413.
            error =
                res.status === 413
                    ? 'That picture is too big (up to 10 MB).'
                    : res.status !== null && res.status < 500 && res.detail
                      ? res.detail
                      : 'Couldn’t save. Try again in a moment.';
            return false;
        }
        profile = res.data;
        // The app's own copy of the name and picture follows.
        const uid = app.user?._id;
        if (uid && profiles.get(uid)) {
            const patch: { name?: string; avatar?: string; avatarCrop?: MediaCrop; realName?: string } = {};
            if (fields.name !== undefined) patch.name = res.data.name;
            if (fields.real_name !== undefined) patch.realName = res.data.real_name || undefined;
            // The saved picture's link, not the file: a moving one can be megabytes.
            if (fields.avatar !== undefined) {
                patch.avatar = (fields.avatar && res.data.avatar) || undefined;
                patch.avatarCrop = (fields.avatar && res.data.avatar_crop) || undefined;
            }
            if (Object.keys(patch).length) profiles.update(uid, patch);
        }
        return true;
    }
</script>

<svelte:head><title>{profile?.name ?? 'Profile'} · Stremio</title></svelte:head>

{#if !app.user}
    <div class="page">
        <EmptyState icon="user" title="Your profile">
            <p>Log in to see your profile: what you’ve watched, your favorites and your lists.</p>
            <button onclick={() => app.openLogin()}>Log In</button>
        </EmptyState>
    </div>
{:else if profile}
    <ProfileView {profile} {busy} {error} onsave={save} />
{:else}
    <div class="page">
        {#if failed || (!tracker.ready && tracker.status !== 'checking')}
            <EmptyState icon="user" title="Couldn’t load your profile">
                <p>It comes back as soon as the connection does.</p>
            </EmptyState>
        {:else}
            <p class="loading" role="status">Loading…</p>
        {/if}
    </div>
{/if}

<style>
    .page {
        padding: calc(var(--nav-h) + 24px) var(--gutter) 56px;
    }
    .loading {
        color: var(--label-2);
    }
</style>
