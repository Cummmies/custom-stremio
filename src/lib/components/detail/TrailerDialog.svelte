<script lang="ts">
    import Icon from '../Icon.svelte';

    let { ytId, title, onclose }: { ytId: string; title: string; onclose: () => void } = $props();
    let dialog = $state<HTMLDialogElement>();

    // YouTube refuses an embed that doesn't say which website it's on (Error
    // 153). The iOS app (tauri://) and the TV (a local file) aren't on one: they
    // show our page on GitHub Pages (pages/youtube), which embeds it instead.
    const src = $derived(
        location.protocol === 'http:' || location.protocol === 'https:'
            ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
            : `https://cummmies.github.io/custom-stremio/youtube/?v=${encodeURIComponent(ytId)}`
    );

    $effect(() => {
        dialog?.showModal();
    });
</script>

<dialog bind:this={dialog} aria-label={`${title} trailer`} {onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
    <button class="close" onclick={() => dialog?.close()} aria-label="Close trailer">
        <Icon name="close" size={16} />
    </button>
    <iframe
        {src}
        title={`${title} trailer`}
        referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
    ></iframe>
</dialog>

<style>
    dialog {
        width: min(1100px, calc(100vw - 64px));
        aspect-ratio: 16 / 9;
        padding: 0;
        border: 0;
        border-radius: var(--radius-l);
        background: black;
        overflow: visible;
        box-shadow: 0 32px 80px rgb(0 0 0 / 0.7);
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.8);
    }
    dialog[open] {
        animation: zoom var(--slow) var(--ease);
    }
    @keyframes zoom {
        from {
            opacity: 0;
            transform: scale(0.97);
        }
    }
    iframe {
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: var(--radius-l);
    }
    .close {
        position: absolute;
        top: -44px;
        right: 0;
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 50%;
        background: rgb(255 255 255 / 0.15);
        color: white;
        cursor: pointer;
    }
    .close:hover {
        background: rgb(255 255 255 / 0.3);
    }
</style>
