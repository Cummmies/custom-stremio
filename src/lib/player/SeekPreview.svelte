<script lang="ts">
    import type { Thumbnails } from './thumbnails';

    let { thumbs, time }: { thumbs: Thumbnails; time: number } = $props();

    let canvas = $state<HTMLCanvasElement>();
    let version = $state(0);

    $effect(() => thumbs.onChange(() => version++));
    $effect(() => thumbs.request(time));

    $effect(() => {
        version;
        const frame = thumbs.get(time);
        if (!canvas || !frame) return;
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
    });

</script>

<!-- Until the exact frame arrives, the previous one stays up, which reads as "scrubbing". -->
{#if thumbs.available}
    <div class="frame">
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
</style>
