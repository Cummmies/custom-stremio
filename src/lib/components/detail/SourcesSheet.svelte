<script lang="ts">
    // Side sheet listing every addon's streams for one movie or episode.
    // A focused, dismissible task: Esc, the close button or the backdrop all close it.
    import type { MetaDetails, Stream } from '$lib/core/types';
    import { openExternal } from '$lib/links';
    import Icon from '../Icon.svelte';

    let {
        title,
        subtitle,
        streams,
        onclose,
    }: { title: string; subtitle: string | null; streams: MetaDetails['streams']; onclose: () => void } = $props();

    let dialog = $state<HTMLDialogElement>();
    let copied = $state<string | null>(null);

    $effect(() => {
        dialog?.showModal();
    });

    const groups = $derived(
        streams
            .filter((g) => g.content.type !== 'Err')
            .map((g) => ({
                addon: g.addon.manifest.name,
                loading: g.content.type === 'Loading',
                items: g.content.type === 'Ready' ? g.content.content : [],
            }))
    );
    const loading = $derived(groups.some((g) => g.loading));
    const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));

    // Addons put quality in `name` ("Torrentio\n4k") and file details in `title`/`description`.
    const label = (s: Stream) => (s.name ?? '').split('\n').filter(Boolean);
    const details = (s: Stream) => s.description ?? s.title ?? '';
    const linkOf = (s: Stream) => s.deepLinks?.externalPlayer?.streaming ?? s.url ?? null;

    async function copy(s: Stream, key: string) {
        const link = linkOf(s);
        if (!link) return;
        await navigator.clipboard.writeText(link);
        copied = key;
        setTimeout(() => copied === key && (copied = null), 2000);
    }
</script>

<dialog bind:this={dialog} class="sheet" aria-labelledby="sources-title" {onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
    <div class="inner">
        <header>
            <div>
                <h2 id="sources-title">{title}</h2>
                {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
            </div>
            <button class="close" onclick={() => dialog?.close()} aria-label="Close">
                <Icon name="close" size={16} />
            </button>
        </header>

        <div class="body">
            {#each groups as group (group.addon)}
                {#if group.loading || group.items.length}
                    <section>
                        <h3>{group.addon}</h3>
                        {#if group.loading}
                            {#each Array(3) as _}<div class="skeleton"></div>{/each}
                        {:else}
                            <ul>
                                {#each group.items as stream, i (i)}
                                    {@const key = `${group.addon}-${i}`}
                                    {@const [quality, ...rest] = label(stream)}
                                    <li>
                                        <div class="quality">
                                            <span>{quality ?? group.addon}</span>
                                            {#if rest.length}<span class="sub">{rest.join(' ')}</span>{/if}
                                        </div>
                                        <p class="details">{details(stream)}</p>
                                        {#if stream.externalUrl}
                                            <button class="action" onclick={() => openExternal(stream.externalUrl!)}>
                                                <Icon name="external" size={15} />
                                                Open
                                            </button>
                                        {:else if linkOf(stream)}
                                            <button class="action" onclick={() => copy(stream, key)} aria-live="polite">
                                                <Icon name={copied === key ? 'check' : 'link'} size={15} />
                                                {copied === key ? 'Copied' : 'Copy Link'}
                                            </button>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>
                {/if}
            {/each}

            {#if !loading && total === 0}
                <div class="empty">
                    <p class="empty-title">No sources found</p>
                    <p>None of your addons have streams for this title. Install a streaming addon from the Stremio addon catalog to see sources here.</p>
                </div>
            {/if}
        </div>

        <footer>
            Built-in playback is coming next. Until then, copy a link into VLC or mpv, or open it in its service.
        </footer>
    </div>
</dialog>

<style>
    .sheet {
        margin: 0 0 0 auto;
        height: 100vh;
        max-height: 100vh;
        width: min(460px, 100vw);
        padding: 0;
        border: 0;
        border-left: 1px solid var(--separator);
        background: var(--elevated);
        color: var(--label);
        box-shadow: -24px 0 64px rgb(0 0 0 / 0.5);
    }
    .sheet[open] {
        animation: slide var(--slow) var(--ease);
    }
    .sheet::backdrop {
        background: rgb(0 0 0 / 0.45);
    }
    @keyframes slide {
        from {
            transform: translateX(32px);
            opacity: 0;
        }
    }
    .inner {
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 24px 24px 16px;
        border-bottom: 1px solid var(--separator);
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .subtitle {
        margin: 4px 0 0;
        color: var(--label-2);
    }
    .close {
        flex: none;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 50%;
        background: var(--fill);
        color: var(--label-2);
        cursor: pointer;
    }
    .close:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    .body {
        flex: 1;
        overflow-y: auto;
        padding: 8px 16px 24px;
    }
    section {
        margin-top: 16px;
    }
    h3 {
        margin: 0 8px 8px;
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    li {
        display: grid;
        grid-template-columns: 88px 1fr auto;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: var(--radius);
        background: var(--elevated-2);
    }
    .quality {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-weight: 700;
        font-size: 13px;
        overflow-wrap: anywhere;
    }
    .quality .sub {
        font-weight: 500;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
    .details {
        margin: 0;
        font-size: var(--text-caption);
        line-height: 1.45;
        color: var(--label-2);
        white-space: pre-line;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .action {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        font-size: var(--text-caption);
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }
    .action:hover {
        background: var(--label);
        color: var(--bg);
    }
    .skeleton {
        height: 64px;
        margin-bottom: 6px;
        border-radius: var(--radius);
        background: var(--elevated-2);
        animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
        50% {
            opacity: 0.55;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .skeleton {
            animation: none;
        }
    }
    .empty {
        padding: 48px 12px;
        text-align: center;
        color: var(--label-2);
    }
    .empty-title {
        color: var(--label);
        font-weight: 600;
        font-size: var(--text-title3);
        margin-bottom: 6px;
    }
    footer {
        padding: 14px 24px;
        border-top: 1px solid var(--separator);
        font-size: var(--text-caption);
        color: var(--label-2);
    }
</style>
