<script lang="ts" generics="T extends string">
    // The app's segmented control (docs/design.md): a few choices of one kind
    // (a view, a filter), side by side on a dark track, the chosen one on a
    // raised square highlight that slides between them and can be dragged
    // (lib/slider.ts); a label half under it reads half chosen.
    //
    // `scroll`: on a narrow screen it scrolls sideways instead of squeezing.
    // `fill`: as wide as its container, the choices sharing it.
    import { slider } from '$lib/slider';

    let {
        options,
        value = $bindable(),
        label,
        onchange,
        scroll = false,
        fill = false,
    }: {
        options: { value: T; label: string; count?: number | null }[];
        value: T;
        /** What it chooses, for screen readers ("Status", "Reviews"). */
        label: string;
        onchange?: (value: T) => void;
        scroll?: boolean;
        fill?: boolean;
    } = $props();

    const active = $derived(options.findIndex((o) => o.value === value));
    /** The choice the highlight is dragged over. */
    let over = $state<number | null>(null);

    function choose(next: T) {
        if (next === value) return;
        value = next;
        onchange?.(next);
    }
</script>

<div
    class="segmented"
    class:scroll
    class:fill
    role="radiogroup"
    aria-label={label}
    use:slider={{ active, onhover: (i) => (over = i), onpick: (i) => choose(options[i].value) }}
>
    {#each options as o, i (o.value)}
        <button type="button" role="radio" aria-checked={value === o.value} class:on={over != null ? over === i : value === o.value} onclick={() => choose(o.value)}>
            {o.label}{#if o.count}<span class="count">{o.count}</span>{/if}
        </button>
    {/each}
</div>

<style>
    .segmented {
        display: inline-flex;
        max-width: 100%;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .segmented.fill {
        display: flex;
        width: 100%;
    }
    .segmented.scroll {
        overflow-x: auto;
        scrollbar-width: none;
    }
    button {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        flex: none;
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-segment);
        background: transparent;
        color: var(--label-2);
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        transition:
            background var(--fast),
            color var(--fast);
    }
    .fill button {
        flex: 1;
        padding: 0 8px;
    }
    button:hover {
        color: var(--label);
    }
    /* Before the slider runs, and without it: the chosen one raised in place. */
    button.on {
        background: var(--highlight);
        color: var(--label);
        box-shadow: var(--shadow-s);
    }
    .segmented:global(.glides) button.on {
        background: transparent;
        box-shadow: none;
    }
    .segmented :global(.glider) {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 0;
        border-radius: var(--radius-segment);
        background: var(--highlight);
        box-shadow: var(--shadow-s);
        pointer-events: none;
        will-change: transform, width;
    }
    /* Labels under the highlight read as the chosen one's, even half under it. */
    .segmented :global(.glider-text button) {
        color: var(--label);
    }
    .segmented:global(.dragging),
    .segmented:global(.dragging) button {
        cursor: grabbing;
        user-select: none;
    }
    .count {
        font-size: var(--text-caption);
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
    }
    /* Touch: Apple's 44 pt targets. */
    @media (pointer: coarse) {
        button {
            height: 44px;
        }
    }
</style>
