<script lang="ts">
    import type { ServerStatus } from '$lib/core/types';

    let { status }: { status: ServerStatus } = $props();

    const label = $derived(
        status.state === 'ready'
            ? status.source === 'managed'
                ? 'Server running'
                : 'Using Stremio Service'
            : status.state === 'starting'
              ? 'Starting server…'
              : 'Server offline'
    );
    const tip = $derived('message' in status ? status.message : 'url' in status ? status.url : '');
</script>

<span class="pill {status.state}" title={tip}>
    <span class="dot"></span>{label}
</span>

<style>
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--surface);
        font-size: 0.8rem;
        color: var(--text-dim);
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-dim);
    }
    .ready .dot {
        background: #3ddc84;
    }
    .starting .dot {
        background: #f5c542;
    }
    .missing .dot,
    .failed .dot {
        background: #ff5d5d;
    }
</style>
