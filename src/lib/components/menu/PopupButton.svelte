<script lang="ts" generics="T extends string | number | null">
    // A pop-up button: shows the current choice and opens the app menu to change it.
    // Replaces native <select>, whose dropdown can't be styled to match the app.
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import Icon from '../Icon.svelte';
    import { isTV } from '$lib/platform';

    let {
        value = $bindable(),
        options,
        label,
        onchange,
        heading,
        extra,
        display,
    }: {
        value: T;
        options: { value: T; label: string }[];
        /** Accessible name, e.g. "Season". */
        label: string;
        onchange?: (value: T) => void;
        /** A heading over the options, when the menu has more than them. */
        heading?: string;
        /** More of the menu, after a separator (another choice, e.g. a sort). */
        extra?: MenuEntry[];
        /** What the button says, instead of the chosen option alone. */
        display?: string;
    } = $props();

    const current = $derived(display ?? options.find((o) => o.value === value)?.label ?? 'Choose…');

    function open(el: HTMLElement) {
        menu.toggleFor(el, [
            ...(heading ? [{ header: heading }] : []),
            ...options.map((o) => ({
                label: o.label,
                checked: o.value === value,
                onselect: () => {
                    value = o.value;
                    onchange?.(o.value);
                },
            })),
            ...(extra?.length ? [{ separator: true } as const, ...extra] : []),
        ]);
    }

    function onkeydown(e: KeyboardEvent) {
        // TV: the arrows move between items (OK opens the menu); opening it
        // here too left you stuck reopening it.
        if (isTV || e.defaultPrevented) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            open(e.currentTarget as HTMLElement);
        }
    }
</script>

<button
    class="popup"
    aria-haspopup="menu"
    aria-expanded="false"
    aria-label={`${label}: ${current}`}
    onclick={(e) => open(e.currentTarget)}
    {onkeydown}
>
    <span>{current}</span>
    <Icon name="chevronDown" size={14} />
</button>

<style>
    .popup {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        height: 34px;
        padding: 0 12px 0 14px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--fast);
    }
    .popup:hover,
    .popup:global([aria-expanded='true']) {
        background: var(--fill-hover);
    }
    .popup :global(svg) {
        color: var(--label-2);
        flex: none;
    }
</style>
