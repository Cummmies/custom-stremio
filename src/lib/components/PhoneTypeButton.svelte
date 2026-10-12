<script lang="ts">
    // "Type on Phone", beside a text field on the TV: typing with a remote is
    // slow, so the phone does it (lib/handoff.svelte.ts). What's sent replaces
    // the field's text. Only on a TV, and only with the tracker connected.
    import { isTV } from '$lib/platform';
    import { tracker } from '$lib/tracker.svelte';
    import { phone } from '$lib/handoff.svelte';
    import Icon from './Icon.svelte';

    let {
        label,
        value = '',
        multiline = false,
        max,
        onresult,
    }: { label: string; value?: string; multiline?: boolean; max?: number; onresult: (text: string) => void } = $props();

    async function go() {
        const text = await phone.typeOnPhone({ label, value, multiline, max });
        if (text != null) onresult(text);
    }
</script>

{#if isTV && tracker.ready}
    <button type="button" class="phone" onclick={go}><Icon name="phone" size={16} /> Type on Phone</button>
{/if}

<style>
    .phone {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 18px;
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        background: var(--glass);
        color: var(--label);
        font: inherit;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }
    .phone:focus,
    .phone:hover {
        background: var(--glass-strong);
    }
</style>
