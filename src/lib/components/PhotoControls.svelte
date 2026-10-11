<script lang="ts">
    // One button for a profile picture: "Upload…" when there's none, otherwise
    // "Change…" with Upload New Photo / Remove Photo in the app menu. A new
    // picture is moved and scaled into its circle first (ImageCropper). It's
    // one picture: your profile's too.
    import { profiles } from '$lib/profiles.svelte';
    import { menu } from '$lib/menu.svelte';
    import { tracker } from '$lib/tracker.svelte';
    import { lb } from '$lib/tracker/api';
    import Icon from './Icon.svelte';
    import ImageCropper from './ImageCropper.svelte';

    let { uid }: { uid: string } = $props();

    let input = $state<HTMLInputElement>();
    let error = $state<string | null>(null);
    const hasPhoto = $derived(!!profiles.get(uid)?.avatar);

    let cropping = $state<File | null>(null);
    function onchange() {
        const file = input?.files?.[0];
        if (input) input.value = '';
        error = null;
        if (file) cropping = file;
    }
    function setPicture(avatar: string | undefined) {
        profiles.update(uid, { avatar });
        if (tracker.ready) void lb.updateProfile({ avatar: avatar ?? '' });
    }

    function onclick(e: MouseEvent) {
        if (!hasPhoto) return input?.click();
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { label: 'Upload New Photo…', onselect: () => input?.click() },
                { label: 'Remove Photo', destructive: true, onselect: () => setPicture(undefined) },
            ],
            'end'
        );
    }
</script>

<div class="photo">
    <input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" {onchange} hidden />
    <button class="btn" aria-haspopup={hasPhoto ? 'menu' : undefined} aria-expanded="false" {onclick}>
        {hasPhoto ? 'Change' : 'Upload…'}
        {#if hasPhoto}<Icon name="chevronDown" size={14} />{/if}
    </button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>
{#if cropping}
    <ImageCropper
        file={cropping}
        shape="circle"
        onchoose={(url) => ((cropping = null), setPicture(url))}
        oncancel={() => (cropping = null)}
    />
{/if}

<style>
    .photo {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 8px;
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .btn:hover {
        background: var(--fill-hover);
    }
    .btn :global(svg) {
        color: var(--label-2);
    }
    .error {
        margin: 6px 0 0;
        font-size: 12px;
        color: var(--bad);
    }
</style>
