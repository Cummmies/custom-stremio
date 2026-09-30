<script lang="ts" module>
    // One icon language: 24px grid, 1.75 stroke, round caps. Weight matches 14px text.

    /** A gear built from geometry so it's perfectly centered on (12, 12). */
    function gearPath() {
        const teeth = 8;
        const [outer, inner, hub] = [10, 7.4, 3];
        const step = (Math.PI * 2) / teeth;
        const pt = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
        let d = '';
        for (let i = 0; i < teeth; i++) {
            const c = i * step - Math.PI / 2;
            d += `${i ? 'L' : 'M'}${pt(inner, c - step * 0.34)}L${pt(outer, c - step * 0.2)}L${pt(outer, c + step * 0.2)}L${pt(inner, c + step * 0.34)}`;
        }
        return `${d}Z M${12 + hub} 12a${hub} ${hub} 0 1 1-${hub * 2} 0a${hub} ${hub} 0 1 1 ${hub * 2} 0z`;
    }

    const paths = {
        home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
        search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
        library: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
        chevronLeft: 'M15 5l-7 7 7 7',
        chevronRight: 'M9 5l7 7-7 7',
        play: 'M7 4.5v15a.5.5 0 0 0 .77.42l11.5-7.5a.5.5 0 0 0 0-.84L7.77 4.08A.5.5 0 0 0 7 4.5z',
        info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 7.5v.5',
        user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
        sidebar: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 4v16',
        plus: 'M12 5v14M5 12h14',
        check: 'M5 12.5l4.5 4.5L19 7',
        back: 'M14.5 5.5 8 12l6.5 6.5',
        film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4',
        replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4 3.5V7.5h4',
        forward: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M20 3.5V7.5h-4',
        tv: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM9 21h6M8.5 2.5 12 6l3.5-3.5',
        eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
        link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
        external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
        puzzle: 'M10 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H5V7a1 1 0 0 1 1-1h4z',
        gear: gearPath(),
        users: 'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20c1-3.2 3.6-5 6.5-5s5.5 1.8 6.5 5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.2c1.7.7 2.9 2.4 3.5 4.8',
        logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 16l-4-4 4-4M6 12h10',
        trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13',
        eyeOff: 'M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.2M9.9 10a2.5 2.5 0 0 0 3.6 3.5',
        more: 'M4.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M10.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M16.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0',
        grip: 'M7.8 6a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M13.8 6a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M7.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M13.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M7.8 18a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0M13.8 18a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0',
        merge: 'M7 4v5a4 4 0 0 0 4 4h6M13 9l4 4-4 4M7 20v-4',
                pencil: 'M15.5 5.5l3 3M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5z',
        chevronDown: 'M6 9l6 6 6-6',
        pause: 'M8 5v14M16 5v14',
        volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
        mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
        captions: 'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM10.5 10.2a2.5 2.5 0 1 0 0 3.6M17 10.2a2.5 2.5 0 1 0 0 3.6',
        audio: 'M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
        pip: 'M3 5h18v14H3zM12.5 12h6v5h-6z',
        fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
        exitFullscreen: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
        next: 'M6 5.5v13l9.5-6.5zM18 5v14',
        close: 'M6 6l12 12M18 6 6 18',
        minus: 'M5 12h14',
    } as const;
    export type IconName = keyof typeof paths;
</script>

<script lang="ts">
    let { name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
>
    <path d={paths[name]} />
</svg>
