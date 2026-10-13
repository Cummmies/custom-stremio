<script lang="ts">
    // One line under the top bar: that this account is suspended (until when,
    // and why), or else the message the team posted for everyone. Not in the
    // player. The message closes with ✕; the suspension stays until it ends.
    import { page } from '$app/state';
    import { announcements } from '$lib/announcement.svelte';
    import { tracker } from '$lib/tracker.svelte';
    import Icon from './Icon.svelte';

    $effect(() => {
        if (tracker.ready) announcements.start();
    });

    const hidden = $derived(page.url.pathname.includes('/player'));
    const suspension = $derived(tracker.status === 'suspended' || tracker.status === 'checking' ? tracker.suspension : null);
    const message = $derived(suspension ? null : announcements.showing);

    function until(s: { until: string | null; permanent: boolean }) {
        if (s.permanent || !s.until) return 'Your account is suspended.';
        const d = new Date(s.until.replace(' ', 'T') + 'Z');
        const when = isNaN(d.getTime()) ? s.until : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `Your account is suspended until ${when}.`;
    }
</script>

{#if !hidden && (suspension || message)}
    <div class="notice" class:bad={!!suspension} class:warn={message?.level === 'warning'} role="status">
        <span class="mark"><Icon name="info" size={16} /></span>
        {#if suspension}
            <span class="text">
                <span class="title">{until(suspension)}</span>
                <span class="sub">
                    {suspension.reason ? `Reason: ${suspension.reason}. ` : ''}Your library, ratings and friends are kept, and come back when it ends.
                </span>
            </span>
        {:else if message}
            <span class="text"><span class="title plain">{message.message}</span></span>
            <button class="close" onclick={() => announcements.close()} aria-label="Close"><Icon name="close" size={14} /></button>
        {/if}
    </div>
{/if}

<style>
    .notice {
        position: fixed;
        top: calc(var(--nav-h) + 8px);
        left: 50%;
        z-index: 54;
        display: flex;
        align-items: center;
        gap: 12px;
        width: min(640px, calc(100vw - 32px));
        padding: 10px 10px 10px 14px;
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-l);
        background: var(--glass-strong);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        box-shadow: var(--shadow-l);
        color: var(--label);
        transform: translateX(-50%);
        animation: drop var(--slow) var(--ease);
    }
    @keyframes drop {
        from {
            opacity: 0;
            transform: translate(-50%, -8px);
        }
    }
    .mark {
        display: grid;
        flex: none;
        place-items: center;
        color: var(--accent-text);
    }
    .warn .mark {
        color: var(--warn);
    }
    .bad .mark {
        color: var(--bad-text);
    }
    .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        padding: 2px 0;
    }
    .title {
        font-weight: 600;
    }
    .title.plain {
        font-weight: 500;
    }
    .sub {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .close {
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
    .close:hover {
        background: var(--fill);
        color: var(--label);
    }
    @media (pointer: coarse) {
        .close {
            width: 44px;
            height: 44px;
        }
    }
</style>
