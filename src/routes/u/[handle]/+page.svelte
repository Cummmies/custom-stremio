<script lang="ts">
    // Someone's profile (from a friend's name on a title's Reviews), as much
    // as they let you see; your own handle shows yours, with editing at /profile.
    import { page } from '$app/state';
    import { tracker } from '$lib/tracker.svelte';
    import { lb, type Profile } from '$lib/tracker/api';
    import { goto } from '$lib/nav';
    import ProfileView from '$lib/components/profile/ProfileView.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';

    const handle = $derived(page.params.handle ?? '');
    let profile = $state<Profile | null>(null);
    let missing = $state(false);
    $effect(() => {
        const h = handle;
        profile = null;
        missing = false;
        if (!tracker.ready || !h) return;
        lb.userProfile(h).then((res) => {
            if (h !== handle) return;
            if (!res) missing = true;
            else if (res.is_owner) void goto('/profile', { replaceState: true });
            else profile = res;
        });
    });
</script>

<svelte:head><title>{profile?.name ?? 'Profile'} · Stremio</title></svelte:head>

{#if profile}
    <ProfileView {profile} />
{:else}
    <div class="page">
        {#if missing || (!tracker.ready && tracker.status !== 'checking')}
            <EmptyState icon="user" title="Couldn’t find this profile">
                <p>It may have changed its handle, or the connection dropped.</p>
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
