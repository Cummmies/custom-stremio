<script lang="ts">
    // Quick jumps to each catalog your addons provide.
    let { tiles }: { tiles: { label: string; anchor: string; art: string | null }[] } = $props();

    function jump(e: MouseEvent, anchor: string) {
        e.preventDefault();
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(anchor)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
</script>

<nav class="tiles" aria-label="Catalogs">
    {#each tiles as tile (tile.anchor)}
        <a href={`#${tile.anchor}`} onclick={(e) => jump(e, tile.anchor)}>
            {#if tile.art}<img src={tile.art} alt="" loading="lazy" decoding="async" />{/if}
            <span>{tile.label}</span>
        </a>
    {/each}
</nav>

<style>
    .tiles {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 280px);
        gap: 12px;
        padding: 8px var(--gutter);
        margin-top: -8px;
        overflow-x: auto;
        scrollbar-width: none;
    }
    a {
        position: relative;
        height: 72px;
        display: grid;
        place-items: center;
        border-radius: var(--radius);
        overflow: hidden;
        background: rgb(255 255 255 / 0.08);
        border: 1px solid rgb(255 255 255 / 0.1);
        color: var(--label);
        text-decoration: none;
        font-weight: 600;
        text-align: center;
        transition:
            transform var(--fast) var(--ease),
            border-color var(--fast),
            background var(--fast);
    }
    a:hover {
        transform: translateY(-2px);
        border-color: rgb(255 255 255 / 0.35);
        background: rgb(255 255 255 / 0.12);
    }
    img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0.28;
        filter: saturate(0.8) blur(1px);
        transition: opacity var(--fast);
    }
    a:hover img {
        opacity: 0.45;
    }
    span {
        position: relative;
        padding: 0 12px;
        text-shadow: 0 1px 8px rgb(0 0 0 / 0.6);
    }
    @media (max-width: 700px) {
        .tiles {
            grid-auto-columns: 44vw;
            gap: 10px;
        }
        a {
            height: 56px;
            font-size: 15px;
        }
    }
</style>
