<script lang="ts">
    // Move and Scale (as iOS has it after choosing a photo): the picture fills
    // a frame, a circle for a profile picture, the banner's own shape for a
    // banner. Drag to move it; pinch, scroll or the slider to scale it; arrow
    // keys move and + / - scale. Choose saves exactly what's in the frame; a
    // moving GIF or WebP stays moving (lib/movingImage.ts).
    import Icon from './Icon.svelte';
    import { canCropMoving, cropMoving, fitsUpload, isMoving, toDataUrl } from '$lib/movingImage';

    let {
        file,
        shape,
        onchoose,
        oncancel,
    }: { file: File; shape: 'circle' | 'banner'; onchoose: (dataUrl: string) => void; oncancel: () => void } = $props();

    /** The website's banner, 1120 by 220. */
    const ASPECT = $derived(shape === 'circle' ? 1 : 1120 / 220);
    const MAX_ZOOM = 4;

    let bitmap = $state<ImageBitmap | null>(null);
    let src = $state<string | null>(null);
    let failed = $state(false);
    $effect(() => {
        const url = URL.createObjectURL(file);
        src = url;
        createImageBitmap(file).then(
            (b) => (bitmap = b),
            () => (failed = true)
        );
        return () => {
            URL.revokeObjectURL(url);
            bitmap?.close();
        };
    });

    // The frame (measured) and where the picture sits in it.
    let fw = $state(0);
    const fh = $derived(fw / ASPECT);
    let zoom = $state(1);
    let ox = $state(0);
    let oy = $state(0);
    /** The scale at which the picture just covers the frame. */
    const base = $derived(bitmap && fw ? Math.max(fw / bitmap.width, fh / bitmap.height) : 1);
    const w = $derived((bitmap?.width ?? 0) * base * zoom);
    const h = $derived((bitmap?.height ?? 0) * base * zoom);

    const clampX = (x: number) => Math.min(0, Math.max(fw - w, x));
    const clampY = (y: number) => Math.min(0, Math.max(fh - h, y));
    // Centred to start, and again whenever the frame changes size.
    let placed = '';
    $effect(() => {
        const key = `${fw}|${bitmap?.width}`;
        if (!bitmap || !fw || key === placed) return;
        placed = key;
        ox = (fw - w) / 2;
        oy = (fh - h) / 2;
    });

    /** Scale about a point in the frame (its centre unless given), keeping that point still. */
    function scaleTo(next: number, px = fw / 2, py = fh / 2) {
        next = Math.min(MAX_ZOOM, Math.max(1, next));
        const rx = (px - ox) / w;
        const ry = (py - oy) / h;
        zoom = next;
        const nw = (bitmap?.width ?? 0) * base * next;
        const nh = (bitmap?.height ?? 0) * base * next;
        ox = Math.min(0, Math.max(fw - nw, px - rx * nw));
        oy = Math.min(0, Math.max(fh - nh, py - ry * nh));
    }

    // Drag with one pointer, pinch with two.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number } | null = null;
    let frame = $state<HTMLDivElement>();
    function down(e: PointerEvent) {
        frame?.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
        }
    }
    function move(e: PointerEvent) {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const r = frame!.getBoundingClientRect();
            scaleTo((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        } else if (pointers.size === 1) {
            ox = clampX(ox + e.clientX - last.x);
            oy = clampY(oy + e.clientY - last.y);
        }
    }
    function up(e: PointerEvent) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
    }
    function wheel(e: WheelEvent) {
        e.preventDefault();
        const r = frame!.getBoundingClientRect();
        scaleTo(zoom * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top);
    }
    function frameKey(e: KeyboardEvent) {
        const step = e.shiftKey ? 40 : 10;
        const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (moves[e.key]) {
            e.preventDefault();
            ox = clampX(ox + moves[e.key][0]);
            oy = clampY(oy + moves[e.key][1]);
        } else if (e.key === '+' || e.key === '=') scaleTo(zoom * 1.1);
        else if (e.key === '-') scaleTo(zoom / 1.1);
    }

    let working = $state(false);
    let tooBig = $state(false);
    async function choose() {
        if (!bitmap || working) return;
        const k = base * zoom;
        const sx = -ox / k;
        const sy = -oy / k;
        const sw = fw / k;
        const sh = fh / k;
        const outW = shape === 'circle' ? 400 : Math.round(Math.min(2560, Math.max(1120, sw)));
        const outH = Math.round(outW / ASPECT);
        if (await isMoving(file).catch(() => false)) {
            working = true;
            try {
                const moving = (await canCropMoving(file)) ? await cropMoving(file, { sx, sy, sw, sh, outW, outH }).catch(() => null) : null;
                if (moving) return onchoose(moving);
                // Can't cut its frames here: the whole file, uncropped but moving, if it fits.
                if (fitsUpload(file)) return onchoose(await toDataUrl(file));
                tooBig = true;
            } finally {
                working = false;
            }
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
        onchoose(canvas.toDataURL('image/jpeg', 0.88));
    }

    let dialog = $state<HTMLDialogElement>();
    $effect(() => {
        dialog?.showModal();
    });
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            // Handled here, so the page behind doesn't also cancel its editing.
            e.preventDefault();
            oncancel();
        }
    }
</script>

<dialog bind:this={dialog} class:banner={shape === 'banner'} aria-labelledby="crop-heading" {onkeydown}>
    <div class="body">
        <h2 id="crop-heading">Move and Scale</h2>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
            class="frame"
            class:circle={shape === 'circle'}
            bind:this={frame}
            bind:clientWidth={fw}
            style="height: {fh}px"
            tabindex="0"
            role="application"
            aria-label="Picture. Drag or use the arrow keys to move it; plus and minus scale it."
            onpointerdown={down}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            onwheel={wheel}
            onkeydown={frameKey}
        >
            {#if src && bitmap}
                <img {src} alt="" draggable="false" style="width: {w}px; height: {h}px; transform: translate({ox}px, {oy}px)" />
            {:else}
                <p class="state" role="status">{failed ? 'That file couldn’t be used. Try a JPG or PNG.' : 'Loading…'}</p>
            {/if}
            {#if shape === 'circle'}<span class="mask" aria-hidden="true"></span>{/if}
        </div>

        <div class="zoom">
            <button class="icon" onclick={() => scaleTo(zoom / 1.25)} aria-label="Smaller" disabled={zoom <= 1}><Icon name="minus" size={16} /></button>
            <input
                type="range"
                min="1"
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                oninput={(e) => scaleTo(Number(e.currentTarget.value))}
                style="--pct: {((zoom - 1) / (MAX_ZOOM - 1)) * 100}%"
                aria-label="Scale"
            />
            <button class="icon" onclick={() => scaleTo(zoom * 1.25)} aria-label="Larger" disabled={zoom >= MAX_ZOOM}><Icon name="plus" size={16} /></button>
        </div>

        {#if tooBig}<p class="note" role="alert">That moving picture is too big to keep moving. Try a shorter or smaller one.</p>{/if}
        <footer>
            <button class="btn" onclick={oncancel}>Cancel</button>
            <button class="btn primary" onclick={choose} disabled={!bitmap || working}>{working ? 'Preparing…' : 'Choose'}</button>
        </footer>
    </div>
</dialog>

<style>
    dialog {
        width: min(440px, calc(100vw - 32px));
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
    dialog.banner {
        width: min(760px, calc(100vw - 32px));
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
    @media (prefers-reduced-transparency: reduce) {
        dialog {
            background: var(--elevated-2);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    .body {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
        text-align: center;
    }
    .frame {
        position: relative;
        width: 100%;
        overflow: hidden;
        border-radius: var(--radius);
        background: var(--elevated);
        cursor: grab;
        touch-action: none;
        user-select: none;
    }
    .frame:active {
        cursor: grabbing;
    }
    .frame:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .frame img {
        position: absolute;
        top: 0;
        left: 0;
        max-width: none;
        transform-origin: 0 0;
        pointer-events: none;
    }
    /* The circle: everything outside it dimmed, as the picture will be cut. */
    .mask {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        box-shadow: 0 0 0 999px var(--scrim-strong);
        outline: 1px solid rgb(255 255 255 / 0.5);
        pointer-events: none;
    }
    .state {
        display: grid;
        place-items: center;
        height: 100%;
        margin: 0;
        padding: 16px;
        color: var(--label-2);
        text-align: center;
    }
    .zoom {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .icon {
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
    .icon:hover:not(:disabled) {
        background: var(--fill);
        color: var(--label);
    }
    .icon:disabled {
        opacity: 0.4;
        cursor: default;
    }
    /* The track is thin; the input around it is a full-height target. */
    input[type='range'] {
        flex: 1;
        appearance: none;
        -webkit-appearance: none;
        height: 28px;
        margin: 0;
        background: transparent;
        cursor: pointer;
    }
    input[type='range']::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(to right, var(--label) var(--pct), var(--fill-hover) var(--pct));
    }
    input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 22px;
        height: 22px;
        margin-top: -9px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 4px rgb(0 0 0 / 0.45);
    }
    input[type='range']:focus-visible {
        outline: none;
    }
    input[type='range']:focus-visible::-webkit-slider-thumb {
        box-shadow:
            0 1px 4px rgb(0 0 0 / 0.45),
            0 0 0 4px rgb(255 255 255 / 0.35);
    }
    .note {
        margin: 0;
        font-size: 13px;
        color: var(--bad-text);
    }
    footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .btn {
        height: 36px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .btn.primary {
        background: var(--label);
        color: var(--bg);
    }
    .btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (pointer: coarse) {
        .btn,
        .icon {
            height: 44px;
        }
        .icon {
            width: 44px;
        }
        input[type='range'] {
            height: 44px;
        }
    }
    /* iPhone: Cancel and Choose spread across the bottom, as Photos does. */
    @media (max-width: 600px) {
        footer {
            justify-content: space-between;
        }
    }
</style>
