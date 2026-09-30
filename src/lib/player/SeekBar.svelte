<script lang="ts">
    import type { Snippet } from 'svelte';
    import { fmtTime } from './format';
    import type { Chapter } from './skips';

    let {
        time,
        duration,
        buffered,
        onseek,
        preview,
        chapters = [],
    }: {
        time: number;
        duration: number | null;
        buffered: number | null;
        onseek: (seconds: number) => void;
        /** Rendered above the hover position (e.g. a thumbnail). */
        preview?: Snippet<[number]>;
        /** Chapter starts: drawn as gaps in the bar, named in the hover tip. */
        chapters?: Chapter[];
    } = $props();

    let bar = $state<HTMLElement>();
    let hoverX = $state<number | null>(null);
    let dragging = $state<number | null>(null);

    const d = $derived(duration && duration > 0 ? duration : null);
    const shown = $derived(dragging ?? time);
    const pct = (s: number) => (d ? Math.min(100, Math.max(0, (s / d) * 100)) : 0);
    const hoverTime = $derived(hoverX != null && d && bar ? (hoverX / bar.clientWidth) * d : null);

    const fmt = fmtTime;

    // One rounded bar per chapter, with a small gap between them (a single bar
    // without chapters). Each sits at its true position, the gap taken from its end.
    const GAP_PX = 3;
    const parts = $derived.by(() => {
        if (!d) return [{ start: 0, end: 1, last: true }];
        const cuts = chapters.map((c) => c.time).filter((t) => t > 1 && t < d - 1);
        const edges = [0, ...new Set(cuts), d];
        return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1], last: i === edges.length - 2 }));
    });
    const within = (t: number, p: { start: number; end: number }) => Math.min(1, Math.max(0, (t - p.start) / (p.end - p.start)));
    const hoverChapter = $derived.by(() => {
        if (hoverTime == null || !chapters.length) return null;
        let title: string | null = null;
        for (const c of chapters) if (c.time <= hoverTime) title = c.title || null;
        return title;
    });

    function timeAt(clientX: number) {
        if (!bar || !d) return 0;
        const r = bar.getBoundingClientRect();
        return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * d;
    }

    function onpointerdown(e: PointerEvent) {
        if (!d) return;
        bar!.setPointerCapture(e.pointerId);
        dragging = timeAt(e.clientX);
        // Touch has no hover: show the time (and thumbnail) from the first touch.
        onpointermove(e);
    }
    function onpointermove(e: PointerEvent) {
        const r = bar!.getBoundingClientRect();
        hoverX = Math.min(r.width, Math.max(0, e.clientX - r.left));
        if (dragging != null) dragging = timeAt(e.clientX);
    }
    function onpointerup(e: PointerEvent) {
        if (dragging != null) onseek(dragging);
        dragging = null;
        // A finger lifting ends the preview; a mouse keeps hovering.
        if (e.pointerType !== 'mouse') hoverX = null;
    }

    function onkeydown(e: KeyboardEvent) {
        if (!d) return;
        const step = e.shiftKey ? 30 : 5;
        if (e.key === 'ArrowRight') onseek(Math.min(d, time + step));
        else if (e.key === 'ArrowLeft') onseek(Math.max(0, time - step));
        else if (e.key === 'Home') onseek(0);
        else return;
        e.preventDefault();
        e.stopPropagation();
    }
</script>

<div
    class="seek"
    bind:this={bar}
    class:active={dragging != null}
    role="slider"
    tabindex="0"
    aria-label="Seek"
    aria-valuemin={0}
    aria-valuemax={d ?? 0}
    aria-valuenow={Math.round(shown)}
    aria-valuetext={d ? `${fmt(shown)} of ${fmt(d)}` : 'Live'}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointerleave={() => dragging == null && (hoverX = null)}
    {onkeydown}
>
    <div class="track">
        {#each parts as part (part.start)}
            <div
                class="part"
                style:left="{d ? pct(part.start) : 0}%"
                style:width="calc({d ? pct(part.end) - pct(part.start) : 100}% - {part.last ? 0 : GAP_PX}px)"
            >
                {#if buffered != null && d && buffered > shown && buffered > part.start && shown < part.end}
                    <div
                        class="buffered"
                        style:left="{within(shown, part) * 100}%"
                        style:width="{(within(buffered, part) - within(shown, part)) * 100}%"
                    ></div>
                {/if}
                {#if d}<div class="played" style:width="{within(shown, part) * 100}%"></div>{/if}
            </div>
        {/each}
        {#if hoverX != null && d}<div class="hover-line" style:left="{hoverX}px"></div>{/if}
    </div>
    <div class="thumb" style:left="{pct(shown)}%"></div>

    {#if hoverTime != null}
        <div class="tip" style:left="{hoverX}px">
            {#if preview}{@render preview(hoverTime)}{/if}
            <span class="tip-time">{#if hoverChapter}<span class="tip-chapter">{hoverChapter}</span>{/if}{fmt(hoverTime)}</span>
        </div>
    {/if}
</div>

<style>
    .seek {
        position: relative;
        height: 20px;
        display: flex;
        align-items: center;
        cursor: pointer;
        touch-action: none;
        outline: none;
    }
    .track {
        position: relative;
        width: 100%;
        height: 4px;
        transition: height var(--fast) var(--ease);
    }
    /* One per chapter: each its own rounded bar. */
    .part {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.22);
        overflow: hidden;
    }
    .seek:hover .track,
    .seek.active .track,
    .seek:focus-visible .track {
        height: 6px;
    }
    .buffered {
        position: absolute;
        top: 0;
        bottom: 0;
        background: rgb(255 255 255 / 0.3);
    }
    .played {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--label);
    }
    .hover-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        margin-left: -1px;
        background: rgb(255 255 255 / 0.5);
    }
    .thumb {
        position: absolute;
        width: 14px;
        height: 14px;
        margin-left: -7px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 6px rgb(0 0 0 / 0.5);
        transform: scale(0);
        transition: transform var(--fast) var(--ease);
    }
    .seek:hover .thumb,
    .seek.active .thumb,
    .seek:focus-visible .thumb {
        transform: scale(1);
    }
    .seek:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: 4px;
        border-radius: 4px;
    }
    .tip {
        position: absolute;
        bottom: 24px;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        pointer-events: none;
    }
    .tip-chapter {
        margin-right: 6px;
        color: rgb(255 255 255 / 0.7);
        font-weight: 500;
    }
    .tip-time {
        white-space: nowrap;
        padding: 3px 8px;
        border-radius: 6px;
        background: rgb(20 20 26 / 0.9);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
</style>
