<script lang="ts">
    // Side sheet listing every addon's streams for one movie or episode.
    // A focused, dismissible task: Esc, the close button or the backdrop all close it.
    import type { MetaDetails, Stream } from '$lib/core/types';
    import { goto } from '$lib/nav';
    import { openExternal } from '$lib/links';
    import { canPlay, isTV } from '$lib/platform';
    import { parsePlayerDeepLink, playerHref } from '$lib/player/deeplink';
    import { easyQueue } from '$lib/player/easy';
    import { parseStream } from '$lib/player/ranking';
    import { langKey } from '$lib/player/lang';
    import { app } from '$lib/app.svelte';
    import { titleTracks } from '$lib/player/titleTracks.svelte';
    import { HIDDEN_LABELS, hideSources, loadSort, saveSort, sortSources, SORTS, type SourceEntry, type SourceSort } from '$lib/player/sourceSort';
    import { hidesHdr } from '$lib/player/hdr.svelte';
    import Icon from '../Icon.svelte';

    let {
        title,
        subtitle,
        streams,
        notice = null,
        anime = false,
        videoId = null,
        titleId = null,
        onclose,
    }: {
        title: string;
        subtitle: string | null;
        streams: MetaDetails['streams'];
        /** Shown at the top, e.g. why Easy Mode handed the choice back to you. */
        notice?: string | null;
        /** Anime reads "Dubbed" / "Dual Audio" as an English dub. */
        anime?: boolean;
        /** The episode (for Smart: sources for another one go last) and the show (its audio choice). */
        videoId?: string | null;
        titleId?: string | null;
        onclose: () => void;
    } = $props();

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

    // --- order: by addon (grouped), or one list sorted (sourceSort.ts) ---
    let sort = $state<SourceSort>(loadSort());
    function setSort(value: SourceSort) {
        sort = value;
        saveSort(value);
    }
    const entries = $derived(
        groups.flatMap((g, addonIndex) =>
            g.items.map((stream, i): SourceEntry => ({ stream, addon: g.addon, addonIndex, key: `${g.addon}-${i}` }))
        )
    );
    // Sources Easy Mode would never pick: out of the list, behind "Show hidden".
    const split = $derived(hideSources(entries, { anime, videoId, hideHdr: hidesHdr() }));
    const shownKeys = $derived(new Set(split.shown.map((e) => e.key)));
    let showHidden = $state(false);
    const sorted = $derived(
        sort === 'addon'
            ? split.shown
            : sortSources(split.shown, sort, {
                  anime,
                  language: titleTracks.get(titleId)?.audio ?? ((app.ctx?.profile.settings.audioLanguage as string | null | undefined) ?? null),
                  videoId,
                  tv: isTV,
              })
    );
    const stillLoading = $derived(groups.filter((g) => g.loading).length);

    // Addons put quality in `name` ("Torrentio\n4k") and file details in `title`/`description`.
    const label = (s: Stream) => (s.name ?? '').split('\n').filter(Boolean);
    const details = (s: Stream) => s.description ?? s.title ?? '';
    const linkOf = (s: Stream) => s.deepLinks?.externalPlayer?.streaming ?? s.url ?? null;

    // Which anime sources are in your audio language (dubs, dual audio), read from the release name.
    const audioPref = $derived((app.ctx?.profile.settings.audioLanguage as string | null | undefined) ?? null);
    const audioPrefName = $derived.by(() => {
        const code = langKey(audioPref);
        if (!code) return null;
        try {
            return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? null;
        } catch {
            return null;
        }
    });
    // Only for anime, where it's the difference between a dub and the Japanese original.
    // Elsewhere sources are already in the original language, so a badge is just noise.
    function audioBadge(s: Stream): string | null {
        if (!anime) return null;
        const p = parseStream(s, { anime });
        if (audioPref && audioPrefName && p.languages.some((l) => langKey(l) === langKey(audioPref))) {
            return p.multiAudio ? `Dual audio · ${audioPrefName}` : `${audioPrefName} audio`;
        }
        return p.multiAudio ? 'Multi audio' : null;
    }

    const playable = (s: Stream) => canPlay && !!s.deepLinks?.player && !s.ytId && !!linkOf(s);

    function play(s: Stream) {
        const link = parsePlayerDeepLink(s.deepLinks!.player!);
        const url = linkOf(s);
        // A hand-picked source: don't auto-switch away from it.
        easyQueue.clear();
        easyQueue.handPicked = link?.videoId ?? null;
        if (!link || !url) return;
        // The player takes this sheet's place in history: Back from it returns
        // to what was under the sheet, the title page if you opened it, or
        // wherever you pressed Play (Home, Continue Watching), without the
        // sheet reopening on the way.
        goto(playerHref(link, url), { replaceState: true });
    }

    async function copy(s: Stream, key: string) {
        const link = linkOf(s);
        if (!link) return;
        await navigator.clipboard.writeText(link);
        copied = key;
        setTimeout(() => copied === key && (copied = null), 2000);
    }
    const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 700px)') : ({ matches: false } as MediaQueryList);
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
            {#if notice}<p class="notice" role="status">{notice}</p>{/if}
            {#if total > 1}
                <div class="sorts" role="radiogroup" aria-label="Sort sources">
                    {#each SORTS as s (s.value)}
                        <button
                            class="sort"
                            class:on={sort === s.value}
                            role="radio"
                            aria-checked={sort === s.value}
                            onclick={() => setSort(s.value)}>{s.label}</button
                        >
                    {/each}
                </div>
            {/if}
            {#if sort === 'addon'}
                {#each groups as group (group.addon)}
                    {#if group.loading || group.items.some((_, i) => shownKeys.has(`${group.addon}-${i}`))}
                        <section>
                            <h3>{group.addon}</h3>
                            {#if group.loading}
                                {#each Array(3) as _}<div class="skeleton"></div>{/each}
                            {:else}
                                <ul>
                                    {#each group.items as stream, i (i)}
                                        {#if shownKeys.has(`${group.addon}-${i}`)}
                                            {@render row({ stream, addon: group.addon, addonIndex: 0, key: `${group.addon}-${i}` }, false)}
                                        {/if}
                                    {/each}
                                </ul>
                            {/if}
                        </section>
                    {/if}
                {/each}
            {:else}
                <section>
                    <ul>
                        {#each sorted as entry (entry.key)}
                            {@render row(entry, true)}
                        {/each}
                    </ul>
                    {#if stillLoading}
                        <div class="skeleton" aria-label={`${stillLoading} more ${stillLoading === 1 ? 'addon' : 'addons'} loading`}></div>
                    {/if}
                </section>
            {/if}

            {#if split.hidden.length}
                <button class="show-hidden" aria-expanded={showHidden} onclick={() => (showHidden = !showHidden)}>
                    <Icon name="eye" size={14} />
                    {showHidden ? 'Hide' : 'Show'} {split.hidden.length} hidden {split.hidden.length === 1 ? 'source' : 'sources'}
                </button>
                {#if showHidden}
                    <section class="hidden-list">
                        <ul>
                            {#each split.hidden as { entry, reason } (entry.key)}
                                {@render row(entry, true, HIDDEN_LABELS[reason])}
                            {/each}
                        </ul>
                    </section>
                {/if}
            {/if}

            {#snippet row({ stream, addon, key }: SourceEntry, showAddon: boolean, why: string | null = null)}
                                    {@const [quality, ...rest] = label(stream)}
                                    {@const badge = audioBadge(stream)}
                                    <!-- Phones: the whole row plays, a touch shortcut for its Play button (which keyboards use). -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
                                    <li
                                        class:tappable={playable(stream) && !stream.externalUrl && !!linkOf(stream)}
                                        onclick={(e) => {
                                            if (!phone.matches || (e.target as Element).closest('button')) return;
                                            if (playable(stream) && !stream.externalUrl && linkOf(stream)) play(stream);
                                        }}
                                    >
                                        <div class="quality">
                                            {#if showAddon}<span class="addon">{addon}</span>{/if}
                                            <span>{quality ?? addon}</span>
                                            {#if rest.length}<span class="sub">{rest.join(' ')}</span>{/if}
                                            {#if badge}<span class="badge">{badge}</span>{/if}
                                        </div>
                                        <p class="details" title={details(stream)}>{#if why}<span class="why">{why}</span>{/if}{details(stream)}</p>
                                        {#if stream.externalUrl}
                                            <button class="action" onclick={() => openExternal(stream.externalUrl!)}>
                                                <Icon name="external" size={15} />
                                                Open
                                            </button>
                                        {:else if linkOf(stream)}
                                            <div class="buttons">
                                                <!-- A TV has nowhere to paste a link. -->
                                                {#if !isTV}
                                                    <button
                                                        class="icon-action"
                                                        onclick={() => copy(stream, key)}
                                                        aria-label={copied === key ? 'Link copied' : 'Copy stream link'}
                                                        title={copied === key ? 'Copied' : 'Copy Link'}
                                                    >
                                                        <Icon name={copied === key ? 'check' : 'link'} size={15} />
                                                    </button>
                                                {/if}
                                                {#if playable(stream)}
                                                    <!-- On a TV the sheet opens on the first Play. -->
                                                    <button class="action play" data-tv-focus onclick={() => play(stream)}>
                                                        <Icon name="play" size={13} filled />
                                                        Play
                                                    </button>
                                                {/if}
                                            </div>
                                        {/if}
                                    </li>
            {/snippet}

            {#if !loading && total === 0}
                <div class="empty">
                    <p class="empty-title">No sources found</p>
                    <p>None of your addons have streams for this title. Install a streaming addon from the Stremio addon catalog to see sources here.</p>
                </div>
            {/if}
        </div>

        {#if !canPlay}
            <footer>Playback runs in the desktop app. Here you can copy a link into VLC or mpv.</footer>
        {/if}
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
    .notice {
        margin: 16px 0 0;
        padding: 12px 14px;
        border-radius: var(--radius);
        background: rgb(255 159 10 / 0.12);
        border: 1px solid rgb(255 159 10 / 0.35);
        font-size: 13px;
        line-height: 1.45;
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
        /* minmax(0, …) lets long file names wrap instead of pushing the buttons out. */
        grid-template-columns: 88px minmax(0, 1fr) auto;
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
    .quality .badge {
        align-self: flex-start;
        margin-top: 4px;
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--fill-hover);
        font-size: 11px;
        font-weight: 600;
        color: var(--label);
        white-space: nowrap;
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
    .action.play {
        background: var(--label);
        color: var(--bg);
    }
    .action.play:hover {
        background: white;
    }
    .buttons {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .icon-action {
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
    .icon-action:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    /* Stays at the top while the list scrolls under it. */
    .sorts {
        position: sticky;
        top: -8px; /* the list's own top padding */
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px -16px 0;
        padding: 12px 16px 10px;
        background: var(--elevated);
    }
    .sort {
        height: 28px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: var(--fill);
        color: var(--label-2);
        font-size: var(--text-caption);
        font-weight: 600;
        cursor: pointer;
    }
    .sort:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    .sort.on {
        background: var(--label);
        color: var(--bg);
    }
    .sort:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: 2px;
    }
    .show-hidden {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 20px auto 0;
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: var(--fill);
        color: var(--label-2);
        font-size: var(--text-caption);
        font-weight: 600;
        cursor: pointer;
    }
    .show-hidden:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    .show-hidden:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: 2px;
    }
    .hidden-list li {
        opacity: 0.75;
    }
    .why {
        display: block;
        margin-bottom: 2px;
        font-weight: 600;
        color: var(--label);
    }
    .quality .addon {
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--label-3, var(--label-2));
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

    /* Phones: a full-screen sheet from the bottom; each source is one tappable
       row with its name on top and the description across the full width. */
    @media (max-width: 700px) {
        .sheet {
            margin: 0;
            width: 100vw;
            max-width: 100vw;
            height: 100dvh;
            max-height: 100dvh;
            border-left: 0;
            box-shadow: none;
        }
        .sheet[open] {
            animation: rise var(--slow) var(--ease);
        }
        @keyframes rise {
            from {
                transform: translateY(40px);
                opacity: 0;
            }
        }
        header {
            padding: calc(var(--safe-top) + 14px) 16px 12px;
        }
        h2 {
            font-size: 20px;
        }
        .close {
            width: 34px;
            height: 34px;
        }
        .body {
            padding: 4px 12px calc(var(--safe-bottom) + 24px);
        }
        li {
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
                'quality buttons'
                'details details';
            gap: 6px 12px;
            padding: 12px 12px 12px 14px;
        }
        .sorts {
            top: -4px;
            margin: 4px -12px 0;
            padding: 10px 12px 8px;
        }
        li.tappable:active {
            background: var(--fill-hover);
        }
        .quality {
            grid-area: quality;
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            font-size: 15px;
        }
        .quality .sub {
            font-size: 13px;
        }
        .quality .badge {
            margin-top: 0;
            align-self: center;
        }
        .details {
            grid-area: details;
            font-size: 13px;
            -webkit-line-clamp: 3;
            line-clamp: 3;
        }
        .buttons,
        li > .action {
            grid-area: buttons;
        }
        .action.play {
            width: 36px;
            height: 36px;
            padding: 0;
            justify-content: center;
            font-size: 0;
            gap: 0;
        }
        .icon-action {
            width: 36px;
            height: 36px;
        }
    }
</style>
