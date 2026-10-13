<script lang="ts">
    // "12 left" under a field with a limit, shown only near it (so the field
    // stopping doesn't come as a surprise), and how much over when it is.
    let { value, max, lines, maxLines }: { value: string; max: number; lines?: number; maxLines?: number } = $props();

    const left = $derived(max - (value?.length ?? 0));
    const near = $derived(left <= Math.max(10, Math.round(max * 0.15)));
    const overLines = $derived(maxLines != null && (lines ?? 0) > maxLines);
</script>

{#if overLines}
    <p class="count over" aria-live="polite">Up to {maxLines} line breaks</p>
{:else if near}
    <p class="count" class:over={left < 0} aria-live="polite">{left < 0 ? `${-left} too many` : `${left} left`}</p>
{/if}

<style>
    .count {
        margin: 4px 2px 0;
        color: var(--label-2);
        font-size: var(--text-caption);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .count.over {
        color: var(--bad-text);
    }
</style>
