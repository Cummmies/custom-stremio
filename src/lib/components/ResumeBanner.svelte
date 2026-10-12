<script lang="ts">
    // "Keep watching Iron Man 2 from 1:12:03 · where you stopped on your TV":
    // what you stopped on another device (lib/resume.svelte.ts), with Play
    // (here, from that second) and ✕. Glass, at the bottom; not in the player.
    import { page } from '$app/state';
    import { goto } from '$lib/nav';
    import { resumeOffers } from '$lib/resume.svelte';
    import { tracker } from '$lib/tracker.svelte';
    import Icon from './Icon.svelte';

    // Checking starts once the tracker is connected (it isn't yet at launch).
    $effect(() => {
        if (tracker.ready) resumeOffers.start();
    });

    const offer = $derived(resumeOffers.offer);
    const hidden = $derived(page.url.pathname.includes('/player'));

    function clock(seconds: number) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    function play() {
        const o = offer;
        if (!o) return;
        resumeOffers.take(o);
        const video = o.video_id ? `video=${encodeURIComponent(o.video_id)}&` : '';
        goto(`/title/${o.type === 'movie' ? 'movie' : 'series'}/${encodeURIComponent(o.id)}?${video}play=1`);
    }
</script>

{#if offer && !hidden}
    <div class="resume" role="status">
        <span class="text">
            <span class="title">Keep watching {offer.name}</span>
            <span class="sub">From {clock(offer.time)}, where you stopped on {offer.from}</span>
        </span>
        <button class="play" onclick={play}><Icon name="play" size={14} filled /> Play</button>
        <button class="close" onclick={() => resumeOffers.dismiss(offer)} aria-label="Not now"><Icon name="close" size={14} /></button>
    </div>
{/if}

<style>
    .resume {
        position: fixed;
        left: 50%;
        bottom: calc(24px + var(--tabbar-h, 0px));
        z-index: 55;
        display: flex;
        align-items: center;
        gap: 12px;
        width: min(520px, calc(100vw - 32px));
        padding: 10px 10px 10px 18px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-l);
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        box-shadow: var(--shadow-l);
        color: var(--label);
        transform: translateX(-50%);
        animation: rise var(--slow) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translate(-50%, 12px);
        }
    }
    .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .title {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .sub {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .play {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
        cursor: pointer;
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
        background: none;
        color: var(--label-2);
        cursor: pointer;
    }
    .close:hover {
        background: var(--fill);
        color: var(--label);
    }
    @media (pointer: coarse) {
        .play {
            height: 44px;
        }
        .close {
            width: 44px;
            height: 44px;
        }
    }
</style>
