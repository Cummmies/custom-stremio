<script lang="ts">
    // "Change Photo… / Remove Photo" for a profile. The picture is cropped to a
    // square and shrunk before it's saved, so it stays small.
    import { imageToAvatar, profiles } from '$lib/profiles.svelte';

    let { uid }: { uid: string } = $props();

    let input = $state<HTMLInputElement>();
    let error = $state<string | null>(null);
    const hasPhoto = $derived(!!profiles.get(uid)?.avatar);

    async function onchange() {
        const file = input?.files?.[0];
        if (input) input.value = '';
        if (!file) return;
        error = null;
        try {
            profiles.update(uid, { avatar: await imageToAvatar(file) });
        } catch {
            error = 'That file couldn’t be used as a picture. Try a JPG or PNG.';
        }
    }
</script>

<div class="photo">
    <input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" {onchange} hidden />
    <button class="btn" onclick={() => input?.click()}>{hasPhoto ? 'Change Photo…' : 'Upload Photo…'}</button>
    {#if hasPhoto}
        <button class="btn quiet" onclick={() => profiles.update(uid, { avatar: undefined })}>Remove Photo</button>
    {/if}
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
    .photo {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .btn {
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
    .quiet {
        background: transparent;
        color: var(--label-2);
    }
    .error {
        margin: 6px 0 0;
        font-size: 12px;
        color: var(--bad);
    }
</style>
