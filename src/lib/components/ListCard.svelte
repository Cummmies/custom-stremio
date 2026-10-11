<script lang="ts">
    // A list as one card, the same everywhere (the Lists page, profiles): its
    // first three posters fanned out, the front one as large as a poster in a
    // row (--poster-w), then its name and how many titles. A link or a button.
    import Icon from './Icon.svelte';

    let {
        list,
        href,
        onclick,
    }: { list: { name: string; count: number; posters: string[] }; href?: string; onclick?: () => void } = $props();

    const label = $derived(`${list.name}, ${list.count} ${list.count === 1 ? 'title' : 'titles'}`);
</script>

{#snippet card()}
    <span class="stack" aria-hidden="true">
        {#each list.posters.slice(0, 3) as src, i (i)}
            <img {src} alt="" loading="lazy" style="--i: {i}" />
        {:else}
            <span class="blank"><Icon name="list" size={26} /></span>
        {/each}
    </span>
    <span class="name">{list.name}</span>
    <span class="meta">{list.count} {list.count === 1 ? 'title' : 'titles'}</span>
{/snippet}

{#if href}
    <a class="list" {href} aria-label={label}>{@render card()}</a>
{:else}
    <button class="list" {onclick} aria-label={label}>{@render card()}</button>
{/if}

<style>
    .list {
        all: unset;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: calc(var(--poster-w) / 0.69);
        max-width: 100%;
        min-width: 0;
        color: inherit;
        text-decoration: none;
        border-radius: var(--radius);
        cursor: pointer;
    }
    .list:focus-visible {
        outline: 2px solid var(--label);
        outline-offset: 4px;
    }
    /* Three posters fanned out; the front one is a row's poster size. */
    .stack {
        position: relative;
        aspect-ratio: 1 / 1.03;
        margin-bottom: 6px;
    }
    img,
    .blank {
        position: absolute;
        z-index: calc(3 - var(--i, 0));
        top: 0;
        left: calc(var(--i, 0) * 15.5%);
        width: 69%;
        height: 100%;
        border-radius: var(--radius-s);
        object-fit: cover;
        background: var(--elevated-2);
        box-shadow: var(--shadow-s);
        transition: transform var(--fast) var(--ease);
    }
    .blank {
        display: grid;
        place-items: center;
        border: 1px dashed var(--separator);
        background: var(--fill);
        box-shadow: none;
        color: var(--label-3);
    }
    .list:hover img,
    .list:focus-visible img {
        transform: translateY(-4px);
    }
    :global(html.tv) .list:focus img {
        transform: translateY(-6px) scale(1.03);
    }
    .name {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .meta {
        color: var(--label-2);
        font-size: var(--text-caption);
    }
    .list:hover .name {
        text-decoration: underline;
    }
</style>
