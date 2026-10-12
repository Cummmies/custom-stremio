<script lang="ts">
    // A QR code to scan with a phone's camera (drawn by the tracker, /qr.svg):
    // adding a friend, or carrying something from the TV to a phone. A modal <dialog> (docs/design.md).
    import { tracker } from '$lib/tracker.svelte';
    import Icon from './Icon.svelte';

    let {
        title,
        caption,
        url,
        onclose,
    }: { title: string; caption: string; url: string; onclose: () => void } = $props();

    const src = $derived(`${(tracker.saved?.server ?? '').replace(/\/$/, '')}/qr.svg?text=${encodeURIComponent(url)}`);

    let dialog = $state<HTMLDialogElement>();
    $effect(() => {
        dialog?.showModal();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} aria-labelledby="qr-heading" {onkeydown} onclick={(e) => e.target === dialog && onclose()}>
    <div class="body">
        <header>
            <h2 id="qr-heading">{title}</h2>
            <button class="close" onclick={onclose} aria-label="Done"><Icon name="close" size={16} /></button>
        </header>
        <div class="code"><img {src} alt="QR code" /></div>
        <p class="caption">{caption}</p>
    </div>
</dialog>

<style>
    dialog {
        width: min(400px, calc(100vw - 32px));
        max-width: none;
        margin: auto;
        padding: 0;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-l);
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        box-shadow: var(--shadow-l);
        color: var(--label);
        animation: rise var(--fast) var(--ease);
    }
    dialog::backdrop {
        background: var(--scrim);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
    }
    .body {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 20px 24px 24px;
        text-align: center;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .close {
        display: grid;
        flex: none;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label-2);
        cursor: pointer;
    }
    /* White behind the code, as cameras read best. */
    .code {
        width: min(240px, 70vw);
        aspect-ratio: 1;
        padding: 10px;
        border-radius: var(--radius);
        background: #fff;
    }
    .code img {
        display: block;
        width: 100%;
        height: 100%;
    }
    .caption {
        margin: 0;
        color: var(--label-2);
    }
    :global(html.tv) .code {
        width: 320px;
    }
</style>
