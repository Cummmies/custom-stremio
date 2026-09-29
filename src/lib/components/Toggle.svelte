<script lang="ts">
    let {
        checked = $bindable(false),
        label,
        onchange,
    }: { checked: boolean; label: string; onchange?: (checked: boolean) => void } = $props();
</script>

<button
    class="toggle"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onclick={() => {
        checked = !checked;
        onchange?.(checked);
    }}
>
    <span class="knob"></span>
</button>

<style>
    .toggle {
        position: relative;
        flex: none;
        width: 42px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.18);
        cursor: pointer;
        transition: background var(--fast);
    }
    .toggle[aria-checked='true'] {
        background: var(--ok);
    }
    .knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
        transition: transform var(--fast) var(--ease);
    }
    .toggle[aria-checked='true'] .knob {
        transform: translateX(18px);
    }
</style>
