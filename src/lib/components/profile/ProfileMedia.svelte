<script lang="ts">
    // A profile picture or banner: a still image, or (as the website allows) a
    // short video, played muted and looping, held still with Reduce Motion.
    let { src }: { src: string } = $props();

    const isVideo = $derived(/\.(mp4|webm|mov)(\?|$)/i.test(src));
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

{#if isVideo}
    <video {src} autoplay={!still} muted loop playsinline preload="metadata" aria-hidden="true"></video>
{:else}
    <img {src} alt="" />
{/if}

<style>
    img,
    video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
</style>
