<script lang="ts">
    // A tracker score: 0 to 10 in tenths, as the tracker itself takes it. The
    // number reads large above a slider; arrow keys (the remote's Left/Right
    // on TV) move a tenth, Page Up/Down a whole point, and Enter saves.
    import type { HTMLInputAttributes } from 'svelte/elements';

    let {
        value = $bindable(5),
        disabled = false,
        onsubmit,
        ...rest
    }: { value?: number; disabled?: boolean; onsubmit?: () => void } & Omit<HTMLInputAttributes, 'value' | 'type'> = $props();

    const shown = $derived(value.toFixed(1));

    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && onsubmit && !disabled) {
            e.preventDefault();
            onsubmit();
        }
    }
</script>

<div class="score">
    <p class="value" aria-hidden="true">{shown}<span class="of">/ 10</span></p>
    <input
        {...rest}
        type="range"
        min="0"
        max="10"
        step="0.1"
        {disabled}
        bind:value
        oninput={() => (value = Math.round(value * 10) / 10)}
        {onkeydown}
        style="--pct: {value * 10}%"
        aria-label="Score out of 10"
        aria-valuetext={`${shown} out of 10`}
    />
</div>

<style>
    .score {
        display: flex;
        flex-direction: column;
    }
    .value {
        margin: 0;
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 600;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
    }
    .of {
        margin-left: 4px;
        font-size: 15px;
        font-weight: 500;
        color: var(--score-muted, var(--label-2));
    }
    /* The track is thin; the input around it is a full-height target. */
    input {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        height: 28px;
        margin: 2px 0 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
    }
    input:focus-visible {
        outline: none;
    }
    input::-webkit-slider-runnable-track {
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(to right, var(--score-fill, white) var(--pct), rgb(255 255 255 / 0.18) var(--pct));
    }
    input::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 22px;
        height: 22px;
        margin-top: -8px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 4px rgb(0 0 0 / 0.45);
        transition: box-shadow var(--fast);
    }
    input:focus-visible::-webkit-slider-thumb {
        box-shadow:
            0 1px 4px rgb(0 0 0 / 0.45),
            0 0 0 4px rgb(255 255 255 / 0.35);
    }
    input:disabled {
        opacity: 0.5;
        cursor: default;
    }
    /* Touch: a 44 pt target and a larger thumb to hold. */
    @media (pointer: coarse) {
        input {
            height: 44px;
        }
        input::-webkit-slider-thumb {
            width: 28px;
            height: 28px;
            margin-top: -11px;
        }
    }
    /* TV: read from the couch. */
    :global(html.tv) .value {
        font-size: 40px;
    }
    :global(html.tv) .of {
        font-size: 20px;
    }
    :global(html.tv) input {
        height: 44px;
    }
    :global(html.tv) input::-webkit-slider-runnable-track {
        height: 8px;
    }
    :global(html.tv) input::-webkit-slider-thumb {
        width: 32px;
        height: 32px;
        margin-top: -12px;
    }
    :global(html.tv) input:focus-visible::-webkit-slider-thumb {
        box-shadow:
            0 1px 4px rgb(0 0 0 / 0.45),
            0 0 0 6px rgb(255 255 255 / 0.4);
    }
</style>
