<script lang="ts">
    import type { ServerStatus } from '$lib/core/types';

    let { status, compact = false }: { status: ServerStatus; compact?: boolean } = $props();

    const label = $derived(
        status.state === 'ready'
            ? 'Streaming ready'
            : status.state === 'starting'
              ? 'Starting server'
              : status.state === 'installing'
                ? 'Setting up'
                : 'Server offline'
    );
    const detail = $derived(
        status.state === 'ready'
            ? status.source === 'managed'
                ? 'Started by this app'
                : 'Using the running Stremio server'
            : status.state === 'starting'
              ? 'Torrents will play in a moment'
              : status.state === 'installing'
                ? status.percent == null
                    ? 'Downloading…'
                    : status.percent >= 100
                      ? 'Unpacking…'
                      : `Downloading… ${status.percent}%`
                : status.message
    );
</script>

<div class="status {status.state}" class:compact title={compact ? `${label}. ${detail}` : detail} role="status">
    <span class="dot" aria-hidden="true"></span>
    {#if compact}
        <span class="sr-only">{label}. {detail}</span>
    {:else}
        <div class="text">
            <span class="label">{label}</span>
            <span class="detail">{detail}</span>
        </div>
    {/if}
</div>

<style>
    .status {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .compact {
        justify-content: center;
        padding: 12px 0;
    }
    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--label-3);
    }
    .ready .dot {
        background: var(--ok);
    }
    .starting .dot,
    .installing .dot {
        background: var(--warn);
    }
    .missing .dot,
    .failed .dot {
        background: var(--bad);
    }
    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .label {
        font-size: var(--text-caption);
        font-weight: 600;
    }
    .detail {
        font-size: var(--text-caption);
        color: var(--label-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
