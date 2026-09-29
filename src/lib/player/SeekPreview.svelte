<script lang="ts">
    import type { Thumbnails } from './thumbnails';

    let { thumbs, time }: { thumbs: Thumbnails; time: number } = $props();

    let canvas = $state<HTMLCanvasElement>();
    let version = $state(0);
    let drawn = $state(false);

    $effect(() => thumbs.onChange(() => version++));
    $effect(() => thumbs.request(time));

    // Draw the closest frame we have; the exact one replaces it when it arrives.
    $effect(() => {
        version;
        const frame = thumbs.nearest(time);
        if (!canvas || !frame) return;
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
        drawn = true;
    });
</script>

{#if thumbs.available}
    <div class="frame" class:loading={!drawn}>
        <canvas bind:this={canvas} width="224" height="126"></canvas>
    </div>
{/if}

<style>
    .frame {
        width: 224px;
        border-radius: 8px;
        overflow: hidden;
        background: rgb(20 20 26 / 0.9);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
        border: 1px solid rgb(255 255 255 / 0.15);
    }
    canvas {
        display: block;
        width: 100%;
        height: auto;
    }
    /* Nothing cached yet: a quiet shimmer instead of a flat grey box. */
    .loading {
        background: linear-gradient(100deg, rgb(40 40 50 / 0.9) 30%, rgb(70 70 84 / 0.9) 50%, rgb(40 40 50 / 0.9) 70%);
        background-size: 300% 100%;
        animation: shimmer 1.4s linear infinite;
    }
    .loading canvas {
        opacity: 0;
    }
    @keyframes shimmer {
        from {
            background-position: 100% 0;
        }
        to {
            background-position: 0 0;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .loading {
            animation: none;
        }
    }
</style>
