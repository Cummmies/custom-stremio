<script lang="ts" module>
    export type AddonDescriptor = {
        transportUrl: string;
        installed?: boolean;
        flags?: { official?: boolean; protected?: boolean };
        manifest: {
            id: string;
            name: string;
            version: string;
            description?: string;
            logo?: string | null;
            types?: string[];
            behaviorHints?: { configurable?: boolean; configurationRequired?: boolean; adult?: boolean; p2p?: boolean };
        };
    };
</script>

<script lang="ts">
    import { core } from '$lib/core';
    import { openExternal } from '$lib/links';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { itemMenu } from '$lib/contextmenu';
    import Icon from '../Icon.svelte';

    let { addon, installed }: { addon: AddonDescriptor; installed: boolean } = $props();

    const m = $derived(addon.manifest);
    const configurable = $derived(!!m.behaviorHints?.configurable || !!m.behaviorHints?.configurationRequired);
    const needsSetup = $derived(!!m.behaviorHints?.configurationRequired);
    const isProtected = $derived(!!addon.flags?.protected);
    const configureUrl = $derived(addon.transportUrl.replace(/manifest\.json$/, 'configure'));
    let logoFailed = $state(false);

    const typeLabel: Record<string, string> = { movie: 'Movies', series: 'Series', channel: 'Channels', tv: 'TV' };

    function install() {
        core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: addon } });
    }

    function uninstall() {
        core.dispatch({ action: 'Ctx', args: { action: 'UninstallAddon', args: addon } });
    }

    /** The ⋯ menu, also the card's right-click menu. */
    function moreEntries(): MenuEntry[] {
        return [
            { header: m.name, detail: `Version ${m.version}` },
            ...(configurable ? [{ label: 'Configure…', icon: 'gear', onselect: () => openExternal(configureUrl) } as MenuEntry] : []),
            { label: 'Copy Manifest URL', icon: 'link', onselect: () => navigator.clipboard.writeText(addon.transportUrl) },
            { separator: true },
            {
                label: isProtected ? 'Can’t Uninstall (Built In)' : 'Uninstall',
                icon: 'trash',
                destructive: !isProtected,
                disabled: isProtected,
                onselect: uninstall,
            },
        ];
    }

    function more(el: HTMLElement) {
        menu.toggleFor(el, moreEntries(), 'end');
    }
</script>

<article class="card" use:itemMenu={moreEntries}>
    <div class="logo" aria-hidden="true">
        {#if m.logo && !logoFailed}
            <img src={m.logo} alt="" loading="lazy" onerror={() => (logoFailed = true)} />
        {:else}
            <span>{m.name.slice(0, 1).toUpperCase()}</span>
        {/if}
    </div>

    <div class="info">
        <h3>
            {m.name}
            {#if addon.flags?.official}<span class="badge">Official</span>{/if}
        </h3>
        <p class="meta">
            {[`v${m.version}`, m.types?.map((t) => typeLabel[t] ?? t).join(', ')].filter(Boolean).join(' · ')}
        </p>
        {#if m.description}<p class="description">{m.description}</p>{/if}
    </div>

    <div class="actions">
        {#if installed}
            <span class="installed"><Icon name="check" size={14} /> Installed</span>
            <button class="more" aria-haspopup="menu" aria-expanded="false" aria-label={`More actions for ${m.name}`} onclick={(e) => more(e.currentTarget)}>
                <span aria-hidden="true">•••</span>
            </button>
        {:else if needsSetup}
            <button class="primary" onclick={() => openExternal(configureUrl)} title="Opens the addon’s setup page in your browser">
                <Icon name="external" size={14} /> Configure
            </button>
        {:else}
            <button class="primary" onclick={install}><Icon name="plus" size={14} /> Install</button>
        {/if}
    </div>
</article>

<style>
    .card {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr) auto;
        gap: 16px;
        align-items: center;
        padding: 16px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        transition: border-color var(--fast);
    }
    .card:hover {
        border-color: rgb(255 255 255 / 0.16);
    }
    .logo {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        overflow: hidden;
        background: var(--elevated-2);
        display: grid;
        place-items: center;
        font-weight: 700;
        font-size: 22px;
        color: var(--label-2);
    }
    .logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--text-callout);
        font-weight: 600;
    }
    .badge {
        padding: 1px 6px;
        border-radius: 4px;
        background: var(--fill-hover);
        font-size: 11px;
        font-weight: 600;
        color: var(--label-2);
    }
    .meta {
        margin: 2px 0 0;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
    .description {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--label-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .installed {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ok);
    }
    button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .primary {
        background: var(--label);
        color: var(--bg);
    }
    .primary:hover {
        background: white;
    }
    .more {
        width: 32px;
        padding: 0;
        justify-content: center;
        background: var(--fill);
        color: var(--label-2);
        font-size: 10px;
        letter-spacing: 1px;
    }
    .more:hover,
    .more:global([aria-expanded='true']) {
        background: var(--fill-hover);
        color: var(--label);
    }
    /* Phones: the check alone says installed; the words take a third of the row. */
    @media (max-width: 700px) {
        .installed {
            font-size: 0;
            gap: 0;
        }
    }
</style>
