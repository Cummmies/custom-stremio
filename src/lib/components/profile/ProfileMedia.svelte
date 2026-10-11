<script lang="ts">
    // A profile picture or banner: a still image, a moving one (GIF, animated
    // WebP) or a video from the website (muted, looping, held still with
    // Reduce Motion). A moving picture is kept uncropped, with the part to show
    // beside it (`crop`, fractions of its size): that part fills the space, as
    // a cropped picture would. Without one, the whole picture fills it, centred.
    import type { MediaCrop } from '$lib/tracker/api';

    let { src, crop = null }: { src: string; crop?: MediaCrop | null } = $props();

    const isVideo = $derived(/\.(mp4|webm|mov)(\?|$)/i.test(src));
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let boxW = $state(0);
    let boxH = $state(0);
    let natW = $state(0);
    let natH = $state(0);
    function measured(e: Event) {
        const el = e.currentTarget as HTMLImageElement | HTMLVideoElement;
        natW = 'naturalWidth' in el ? el.naturalWidth : el.videoWidth;
        natH = 'naturalHeight' in el ? el.naturalHeight : el.videoHeight;
    }

    /** The crop covering the space, centred on the crop, kept inside the picture. */
    const place = $derived.by(() => {
        if (!crop || !boxW || !boxH || !natW || !natH) return null;
        const scale = Math.max(boxW / (crop.w * natW), boxH / (crop.h * natH));
        const w = natW * scale;
        const h = natH * scale;
        const left = Math.min(0, Math.max(boxW - w, boxW / 2 - (crop.x + crop.w / 2) * w));
        const top = Math.min(0, Math.max(boxH - h, boxH / 2 - (crop.y + crop.h / 2) * h));
        return `width: ${w}px; height: ${h}px; left: ${left}px; top: ${top}px`;
    });
</script>

<span class="media" bind:clientWidth={boxW} bind:clientHeight={boxH}>
    {#if isVideo}
        <video {src} autoplay={!still} muted loop playsinline preload="metadata" aria-hidden="true" class:placed={!!place} style={place ?? ''} onloadedmetadata={measured}></video>
    {:else}
        <img {src} alt="" class:placed={!!place} style={place ?? ''} onload={measured} />
    {/if}
</span>

<style>
    .media {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }
    img,
    video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    /* With a crop: sized and placed so that part fills the space. */
    .placed {
        position: absolute;
        max-width: none;
        object-fit: fill;
    }
</style>
