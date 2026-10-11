<script lang="ts">
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import type { Loadable } from '$lib/core/types';
    import AddonCard, { type AddonDescriptor } from '$lib/components/addons/AddonCard.svelte';
    import InstallFromUrl from '$lib/components/addons/InstallFromUrl.svelte';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import { isInternalAddon } from '$lib/internalAddons';

    type Source = 'installed' | 'official' | 'community';
    const sources: { id: Source; label: string }[] = [
        { id: 'installed', label: 'Installed' },
        { id: 'official', label: 'Official' },
        { id: 'community', label: 'Community' },
    ];

    let source = $state<Source>('installed');
    let type = $state<string | null>(null);
    let query = $state('');
    let installOpen = $state(false);
    let remote = $state<{ catalog: { content: Loadable<AddonDescriptor[]> } | null } | null>(null);

    // Official and Community lists are addon catalogs served by Cinemeta.
    $effect(() => core.watch('remote_addons', (s) => (remote = s)));
    $effect(() => {
        if (source === 'installed') return;
        core.dispatch(
            {
                action: 'Load',
                args: {
                    model: 'CatalogWithFilters',
                    args: {
                        request: {
                            base: 'https://v3-cinemeta.strem.io/manifest.json',
                            path: { resource: 'addon_catalog', type: 'all', id: source, extra: [] },
                        },
                    },
                },
            },
            'remote_addons'
        );
    });
    $effect(() => () => core.dispatch({ action: 'Unload' }, 'remote_addons'));

    // The app's own (its Home rows, settings sync) aren't addons to manage.
    const installedList = $derived((app.ctx?.profile.addons ?? []).filter((a) => !isInternalAddon(a.manifest.id)));
    const installedUrls = $derived(new Set(installedList.map((a) => a.transportUrl)));

    const remoteContent = $derived(remote?.catalog?.content ?? null);
    const loading = $derived(source !== 'installed' && (!remoteContent || remoteContent.type === 'Loading'));
    const failed = $derived(source !== 'installed' && remoteContent?.type === 'Err');

    const list = $derived.by(() => {
        const base =
            source === 'installed' ? installedList : remoteContent?.type === 'Ready' ? remoteContent.content : [];
        const q = query.trim().toLowerCase();
        return base.filter(
            (a) =>
                (!type || a.manifest.types?.includes(type)) &&
                (!q || a.manifest.name.toLowerCase().includes(q) || a.manifest.description?.toLowerCase().includes(q))
        );
    });

    const typeOptions = [
        { value: null, label: 'All Types' },
        { value: 'movie', label: 'Movies' },
        { value: 'series', label: 'Series' },
        { value: 'channel', label: 'Channels' },
        { value: 'tv', label: 'TV' },
        { value: 'other', label: 'Other' },
    ];
</script>

<svelte:head><title>Addons · Stremio</title></svelte:head>

<div class="page">
    <header class="top">
        <div>
            <h1>Addons</h1>
            <p class="lede">Addons provide catalogs, metadata, subtitles and streams. They sync with your Stremio account.</p>
        </div>
        <button class="install-url" onclick={() => (installOpen = true)}>
            <Icon name="link" size={15} /> Install from URL…
        </button>
    </header>

    <div class="controls">
        <div class="segmented" role="tablist" aria-label="Addon source">
            {#each sources as s (s.id)}
                <button role="tab" aria-selected={source === s.id} class:on={source === s.id} onclick={() => (source = s.id)}>
                    {s.label}
                    {#if s.id === 'installed'}<span class="count">{installedList.length}</span>{/if}
                </button>
            {/each}
        </div>
        <div class="right">
            <label class="filter">
                <Icon name="search" size={15} />
                <input bind:value={query} type="search" placeholder="Filter addons" aria-label="Filter addons" />
            </label>
            <PopupButton label="Type" bind:value={type} options={typeOptions} />
        </div>
    </div>

    {#if loading}
        <div class="grid" aria-busy="true">
            {#each Array(6) as _}<div class="skeleton"></div>{/each}
        </div>
    {:else if failed}
        <EmptyState icon="puzzle" title="Couldn’t load addons">
            <p>The addon catalog didn’t respond. Check your connection and try again.</p>
        </EmptyState>
    {:else if list.length === 0}
        <EmptyState icon="puzzle" title={query || type ? 'No matching addons' : 'No addons here yet'}>
            <p>{query || type ? 'Try a different name or type.' : 'Browse Official or Community addons to add catalogs and sources.'}</p>
        </EmptyState>
    {:else}
        <div class="grid">
            {#each list as addon (addon.transportUrl)}
                <AddonCard {addon} installed={installedUrls.has(addon.transportUrl)} />
            {/each}
        </div>
    {/if}
</div>

{#if installOpen}
    <InstallFromUrl onclose={() => (installOpen = false)} />
{/if}

<style>
    .page {
        padding: calc(var(--nav-h) + 28px) var(--gutter) 64px;
        max-width: 1400px;
        margin: 0 auto;
    }
    .top {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 24px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(28px, 3vw, 36px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .lede {
        margin: 6px 0 0;
        color: var(--label-2);
    }
    .install-url {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 16px;
        border: 1px solid var(--separator);
        border-radius: 999px;
        background: var(--fill);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .install-url:hover {
        background: var(--fill-hover);
    }
    .controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
    }
    .right {
        display: flex;
        gap: 10px;
    }
    .segmented {
        display: flex;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .segmented button {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--label-2);
        font-weight: 500;
        cursor: pointer;
    }
    .segmented button:hover {
        color: var(--label);
    }
    .segmented button.on {
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    }
    .count {
        font-size: 11px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label-2);
    }
    .filter {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        width: 220px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label-2);
    }
    .filter:focus-within {
        border-color: var(--accent-hover);
    }
    .filter input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: none;
        color: var(--label);
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
        gap: 12px;
    }
    @media (max-width: 900px) {
        .grid {
            grid-template-columns: 1fr;
        }
    }
    .skeleton {
        height: 90px;
        border-radius: var(--radius-l);
        background: var(--elevated);
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
    /* Phones: title and intro full width, the install button under them. */
    @media (max-width: 700px) {
        .top {
            flex-direction: column;
            align-items: stretch;
            gap: 14px;
        }
        .install-url {
            justify-content: center;
            height: 44px;
        }
        .controls {
            flex-direction: column;
            align-items: stretch;
        }
        .right {
            width: 100%;
        }
        .right .filter {
            flex: 1;
            min-width: 0;
        }
    }
</style>
