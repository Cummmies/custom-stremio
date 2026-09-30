<script lang="ts">
    import { updates } from '$lib/updates.svelte';
    import Icon from './Icon.svelte';
</script>

{#if updates.phase === 'ready' && !updates.dismissed}
    <aside class="toast" role="status" aria-live="polite">
        <div class="text">
            <strong>Update ready</strong>
            {#if updates.reloads}
                <span>{updates.version ? `The ${updates.version} update` : 'It'} is downloaded.</span>
            {:else}
                <span>Version {updates.version} installs when you restart.</span>
            {/if}
        </div>
        <button class="primary" onclick={() => updates.restartToUpdate()}>{updates.reloads ? 'Reload' : 'Restart'}</button>
        <button class="close" onclick={() => (updates.dismissed = true)} aria-label="Later"><Icon name="close" size={14} /></button>
    </aside>
{/if}

<style>
    .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 40;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 12px 12px 16px;
        border-radius: var(--radius-l);
        background: rgb(31 31 40 / 0.9);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid var(--separator);
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
        animation: rise var(--slow) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
    }
    .text {
        display: flex;
        flex-direction: column;
        font-size: 13px;
    }
    .text span {
        color: var(--label-2);
    }
    .primary {
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-weight: 600;
        cursor: pointer;
    }
    .close {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label-2);
        cursor: pointer;
    }
</style>
