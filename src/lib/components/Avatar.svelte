<script lang="ts">
    // A profile picture: the uploaded photo, or the name's initial on the profile color.
    import type { SavedProfile } from '$lib/profiles.svelte';

    let {
        profile,
        fallbackName = '?',
        size = 36,
        rounded = false,
    }: {
        profile: Pick<SavedProfile, 'name' | 'color' | 'avatar'> | null | undefined;
        /** Used when there's no saved profile yet (e.g. just signed in). */
        fallbackName?: string;
        size?: number;
        /** Rounded square (picker tiles) instead of a circle. */
        rounded?: boolean;
    } = $props();

    const name = $derived(profile?.name || fallbackName);
</script>

<span
    class="avatar"
    class:rounded
    style:--size="{size}px"
    style:--c={profile?.color ?? 'var(--accent)'}
    aria-hidden="true"
>
    {#if profile?.avatar}
        <img src={profile.avatar} alt="" draggable="false" />
    {:else}
        <span class="initial">{name.charAt(0).toUpperCase()}</span>
    {/if}
</span>

<style>
    .avatar {
        display: grid;
        place-items: center;
        flex: none;
        width: var(--size);
        height: var(--size);
        border-radius: 50%;
        overflow: hidden;
        /* Older engines (the TV's) have no color-mix: plain color. */
        background: var(--c);
        background: linear-gradient(145deg, color-mix(in srgb, var(--c) 100%, white 18%), color-mix(in srgb, var(--c) 100%, black 32%));
    }
    .rounded {
        border-radius: calc(var(--size) * 0.23);
    }
    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .initial {
        font-family: var(--font-display);
        font-size: calc(var(--size) * 0.44);
        font-weight: 700;
        line-height: 1;
        color: white;
        /* Center the letter's capital height, not the font's line box (whose
           extra space above/below differs between Windows' and Apple's fonts). */
        text-box: trim-both cap alphabetic;
    }
</style>
