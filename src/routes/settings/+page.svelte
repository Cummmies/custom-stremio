<script lang="ts">
    import { core } from '$lib/core';
    import { invoke } from '@tauri-apps/api/core';
    import { app } from '$lib/app.svelte';
    import type { Settings } from '$lib/core/types';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import { getTvSize, setTvSize, tvSizes, type TvSize } from '$lib/tv/size';
    import Toggle from '$lib/components/Toggle.svelte';
    import ServerStatus from '$lib/components/ServerStatus.svelte';
    import { inTauri } from '$lib/player/mpv.svelte';
    import { isDesktop, isIOS, isTV } from '$lib/platform';
    import { player } from '$lib/player/player';
    import { updates } from '$lib/updates.svelte';
    import { whatsNew } from '$lib/whatsNew.svelte';
    import {
        presetOf,
        subtitleBottom,
        subtitleCss,
        SUB_COLORS,
        SUB_EDGES,
        SUB_FONTS,
        SUB_POSITION_MAX,
        SUB_PRESETS,
        SUB_SIZES,
        type SubPreset,
        type SubStyle,
    } from '$lib/player/subtitleStyle';
    import { profiles } from '$lib/profiles.svelte';
    import { cloudSync } from '$lib/cloudSync.svelte';
    import Avatar from '$lib/components/Avatar.svelte';
    import PhotoControls from '$lib/components/PhotoControls.svelte';
    import { playerPrefs, upscalerLabels, type Upscaler } from '$lib/player/prefs.svelte';
    import { titleTracks } from '$lib/player/titleTracks.svelte';
    import { displayHdr } from '$lib/player/hdr.svelte';
    import { setLinkHandlingWanted } from '$lib/addonLinks';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { qrSvg } from '$lib/qr';
    import { openExternal } from '$lib/links';
    import { ACTIONS, chordOf, formatChord, hotkeys, labelOf, type HotkeyAction } from '$lib/hotkeys.svelte';

    const settings = $derived(app.ctx?.profile.settings ?? null);
    const myProfile = $derived(profiles.get(app.user?._id));

    // stremio:// link handling (registered per user in Windows, not synced).
    let handlesLinks = $state(false);
    let tvSize = $state<TvSize>(isTV ? getTvSize() : 'medium');
    $effect(() => {
        if (!inTauri) return;
        import('@tauri-apps/plugin-deep-link').then(async ({ isRegistered }) => {
            handlesLinks = await isRegistered('stremio').catch(() => false);
            // Turned on before it was remembered: remember it, so it follows the app.
            if (handlesLinks) setLinkHandlingWanted(true);
        });
    });
    async function setLinkHandling(on: boolean) {
        const { register, unregister } = await import('@tauri-apps/plugin-deep-link');
        try {
            await (on ? register('stremio') : unregister('stremio'));
            handlesLinks = on;
            setLinkHandlingWanted(on);
        } catch {
            handlesLinks = !on;
        }
    }

    // Settings live in the Stremio profile, so they sync with the official apps.
    function update(patch: Partial<Settings>) {
        if (!settings) return;
        core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: { ...settings, ...patch } } });
    }

    // ISO 639-2 codes, as Stremio stores them.
    const languages = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'],
        ['por', 'Portuguese'], ['rus', 'Russian'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese'],
        ['ara', 'Arabic'], ['hin', 'Hindi'], ['tur', 'Turkish'], ['pol', 'Polish'], ['dut', 'Dutch'],
        ['swe', 'Swedish'], ['nor', 'Norwegian'], ['dan', 'Danish'], ['fin', 'Finnish'], ['gre', 'Greek'],
        ['heb', 'Hebrew'], ['ukr', 'Ukrainian'], ['cze', 'Czech'], ['hun', 'Hungarian'], ['rum', 'Romanian'],
        ['bul', 'Bulgarian'], ['vie', 'Vietnamese'], ['tha', 'Thai'], ['ind', 'Indonesian'],
    ].map(([value, label]) => ({ value, label }));

    const audioOptions = $derived([{ value: null as string | null, label: 'Default' }, ...languages]);
    const subtitleOptions = $derived([{ value: null as string | null, label: 'Off' }, ...languages]);

    let serverUrl = $state('');
    $effect(() => {
        if (settings) serverUrl = settings.streamingServerUrl;
    });
    const serverUrlChanged = $derived(!!settings && serverUrl.trim() !== settings.streamingServerUrl);

    /** Downloads Stremio's streaming server into this app (src-tauri/src/server.rs). */
    let serverSetupError = $state<string | null>(null);
    async function setUpServer() {
        serverSetupError = null;
        try {
            await invoke('server_install');
        } catch {
            // An app from before this could set it up (the update brought only the screens).
            serverSetupError = 'This version of the app can’t set it up. Install the latest version, or Stremio Service.';
        }
    }
    const canSetUpServer = $derived(isDesktop && (app.server.state === 'missing' || app.server.state === 'failed'));

    // Subtitle Style: one change at a time, shown in the preview straight away.
    const subStyle = $derived(playerPrefs.subStyle);
    const subPreset = $derived(presetOf(subStyle) ?? 'custom');
    const setSub = (patch: Partial<SubStyle>) => (playerPrefs.subStyle = { ...subStyle, ...patch });
    const optionsOf = <T extends string>(labels: Record<T, string>) =>
        (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
    const presetOptions = $derived([
        ...(Object.keys(SUB_PRESETS) as SubPreset[]).map((value) => ({ value: value as SubPreset | 'custom', label: SUB_PRESETS[value].label })),
        ...(presetOf(playerPrefs.subStyle) ? [] : [{ value: 'custom' as const, label: 'Custom' }]),
    ]);
    let previewHeight = $state(0);

    function saveServerUrl(e: SubmitEvent) {
        e.preventDefault();
        let url = serverUrl.trim();
        if (!/^https?:\/\//.test(url)) return;
        if (!url.endsWith('/')) url += '/';
        update({ streamingServerUrl: url });
        core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } });
    }

    // Lightboxd ($lib/lightboxd.svelte.ts): the address to connect to, filled
    // in with this device's last one, or the one this profile uses elsewhere.
    let lightboxdAddress = $state('');
    $effect(() => {
        lightboxdAddress = lightboxd.suggestedServer?.replace(/^http:\/\//, '') ?? '';
    });
    let lightboxdRowsError = $state<string | null>(null);
    const lightboxdHost = $derived(lightboxd.saved?.server.replace(/^https?:\/\//, '') ?? '');

    // Every shortcut in the app. Keep in step with the key handlers in
    // routes/+layout.svelte, routes/player/+page.svelte and SeekBar.svelte.
    const seekStep = $derived(Math.round(((settings?.seekTimeDuration as number | undefined) ?? 10000) / 1000));
    const fineStep = $derived(Math.max(1, Math.round(seekStep / 3)));
    const shortcutGroups = $derived<{ title: string; items: [string, string[]][] }[]>([
        {
            title: 'Browsing',
            items: [
                ['Search', ['Ctrl K', 'Ctrl F', '/']],
                ['Settings', ['Ctrl ,']],
                ['Move between titles in a row, or the banner', ['← →']],
                ['Open the menu for the focused item', ['Shift F10']],
            ],
        },
        {
            title: 'Seek Bar (After Clicking or Tabbing to It)',
            items: [
                ['Back to the start', ['Home']],
                ['To the end', ['End']],
            ],
        },
    ]);

    // --- the player's shortcuts, remappable ($lib/hotkeys.svelte.ts) ---
    /** The action waiting for its new key, and why the last one was refused. */
    let capturing = $state<HotkeyAction | null>(null);
    let hotkeyError = $state<{ action: HotkeyAction | null; text: string } | null>(null);

    function captureKey(action: HotkeyAction) {
        hotkeyError = null;
        capturing = capturing === action ? null : action;
    }

    // While waiting: the next key press (with its modifiers) is the new key;
    // Esc on its own cancels. Caught before the app's own shortcuts see it.
    $effect(() => {
        const action = capturing;
        if (!action) return;
        const onkey = (e: KeyboardEvent) => {
            const chord = chordOf(e);
            if (!chord) return; // a lone modifier: wait for the key
            e.preventDefault();
            e.stopImmediatePropagation();
            capturing = null;
            if (chord.key === 'escape' && !chord.ctrl && !chord.alt && !chord.shift && !chord.meta) return;
            const problem = hotkeys.rebind(action, chord);
            hotkeyError = problem ? { action, text: problem } : null;
        };
        window.addEventListener('keydown', onkey, true);
        return () => window.removeEventListener('keydown', onkey, true);
    });

    function resetHotkey(action?: HotkeyAction) {
        capturing = null;
        const problem = hotkeys.reset(action);
        hotkeyError = problem ? { action: action ?? null, text: problem } : null;
    }
</script>

<svelte:head><title>Settings · Stremio</title></svelte:head>

<div class="page">
    <h1>Settings</h1>

    <section>
        <h2>Account</h2>
        <div class="group">
            <div class="row account-row">
                <div class="account">
                    <Avatar profile={myProfile} fallbackName={app.user?.email ?? '?'} size={48} />
                    <div>
                        <div class="title">{myProfile?.name ?? app.user?.email ?? 'Not logged in'}</div>
                        <div class="sub">{app.user ? app.user.email : 'Log in to sync your library, addons and settings.'}</div>
                    </div>
                </div>
                {#if app.user}
                    <button class="btn" onclick={() => app.openProfiles()}>Switch Profile…</button>
                {:else}
                    <div class="account-actions">
                        {#if profiles.list.length}
                            <button class="btn" onclick={() => app.openProfiles()}>Switch Profile…</button>
                        {/if}
                        <button class="btn primary" onclick={() => app.openLogin()}>Log In…</button>
                    </div>
                {/if}
            </div>
            {#if myProfile}
                <div class="row stack">
                    <div>
                        <div class="title">Profile name</div>
                        <div class="sub">How this profile appears in the app.</div>
                    </div>
                    <input
                        class="name-input"
                        value={myProfile.name}
                        maxlength="24"
                        aria-label="Profile name"
                        onchange={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (v) profiles.update(myProfile.uid, { name: v });
                            else e.currentTarget.value = myProfile.name;
                        }}
                        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                </div>
                {#if !isTV}<!-- a TV has no files to choose a picture from -->
                <div class="row">
                    <div>
                        <div class="title">Profile picture</div>
                        <div class="sub">Syncs with your Stremio account.</div>
                    </div>
                    <PhotoControls uid={myProfile.uid} />
                </div>
                {/if}
            {/if}
            {#if app.user}
                <div class="row">
                    <div>
                        <div class="title">Sync</div>
                        <div class="sub" class:sync-error={!!cloudSync.status?.error}>
                            {#if cloudSync.status?.error}
                                Couldn’t save to your Stremio account: {cloudSync.status.error}
                            {:else if cloudSync.status}
                                Saved to your Stremio account at {new Date(cloudSync.status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                            {:else}
                                Your profile name and picture, Home rows and app settings follow your Stremio account.
                            {/if}
                        </div>
                    </div>
                </div>
                <button class="row action destructive" onclick={() => app.logout()}>Log Out</button>
            {/if}
        </div>
    </section>

    {#if settings}
        <section>
            <h2>Playback</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Audio language</div>
                        <div class="sub">Played when a stream has several audio tracks. Easy Mode also picks sources in it first.</div>
                    </div>
                    <PopupButton label="Audio language" value={settings.audioLanguage} options={audioOptions} onchange={(v) => update({ audioLanguage: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Subtitles</div>
                        <div class="sub">Turned on automatically in this language when available.</div>
                    </div>
                    <PopupButton label="Subtitle language" value={settings.subtitlesLanguage} options={subtitleOptions} onchange={(v) => update({ subtitlesLanguage: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Hide HDR sources when the screen isn’t in HDR</div>
                        <div class="sub">
                            HDR on a screen that isn’t showing it looks flat and dim. They stay under “Show hidden” in the source list.
                            {!displayHdr.supported
                                ? 'This screen isn’t showing HDR now, so they’re hidden.'
                                : isDesktop && !playerPrefs.hdrPassthrough
                                  ? 'HDR passthrough is off, so they’re hidden.'
                                  : 'This screen is showing HDR now, so they’re listed.'}
                        </div>
                    </div>
                    <Toggle label="Hide HDR sources when the screen isn’t in HDR" checked={playerPrefs.hideHdrOnSdr} onchange={(v) => (playerPrefs.hideHdrOnSdr = v)} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Remembered for each show</div>
                        <div class="sub">
                            The audio and subtitles you pick while watching are used again for the rest of that show or movie.
                            {titleTracks.count ? `${titleTracks.count} remembered on this device.` : ''}
                        </div>
                    </div>
                    <button class="btn" disabled={!titleTracks.count} onclick={() => titleTracks.clear()}>Forget All</button>
                </div>
                <div class="row">
                    <div>
                        <div class="title">Play next episode automatically</div>
                        <div class="sub">Keeps going through a series without stopping.</div>
                    </div>
                    <Toggle label="Play next episode automatically" checked={settings.bingeWatching} onchange={(v) => update({ bingeWatching: v })} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Skip intros and recaps automatically</div>
                        <div class="sub">When their timing is known. Otherwise a Skip button appears, and S skips anytime.</div>
                    </div>
                    <Toggle label="Skip intros and recaps automatically" checked={playerPrefs.autoSkip} onchange={(v) => (playerPrefs.autoSkip = v)} />
                </div>
                {#if isDesktop}
                <div class="row">
                    <div>
                        <div class="title">Pause when minimized</div>
                        <div class="sub">Pauses playback when you minimize the window.</div>
                    </div>
                    <Toggle label="Pause when minimized" checked={playerPrefs.pauseOnMinimize} onchange={(v) => (playerPrefs.pauseOnMinimize = v)} />
                </div>
                <div class="row">
                    <div>
                        <div class="title">Pause when the window loses focus</div>
                        <div class="sub">Pauses playback when you switch to another window. Not in picture in picture.</div>
                    </div>
                    <Toggle label="Pause when the window loses focus" checked={playerPrefs.pauseOnLostFocus} onchange={(v) => (playerPrefs.pauseOnLostFocus = v)} />
                </div>
                {/if}
                <div class="row">
                    <div>
                        <div class="title">Ask if you’re still watching</div>
                        <div class="sub">After two episodes play on their own with no one touching anything, asks, and pauses after 15 seconds without an answer.</div>
                    </div>
                    <Toggle label="Ask if you’re still watching" checked={playerPrefs.askStillWatching} onchange={(v) => (playerPrefs.askStillWatching = v)} />
                </div>
                {#if !isTV}<!-- the TV's own player always decodes in hardware -->
                <div class="row">
                    <div>
                        <div class="title">Hardware-accelerated decoding</div>
                        <div class="sub">Uses your graphics card to decode video. Turn off if playback shows artifacts.</div>
                    </div>
                    <Toggle label="Hardware-accelerated decoding" checked={settings.hardwareDecoding} onchange={(v) => update({ hardwareDecoding: v })} />
                </div>
                {/if}
            </div>
        </section>

        <section>
            <h2>Subtitle Style</h2>
            <div class="group">
                <div class="sub-preview" bind:clientHeight={previewHeight} aria-hidden="true">
                    <div class="sub-line" style:bottom={subtitleBottom(subStyle)}>
                        <span style={subtitleCss(subStyle, previewHeight || 200)}>I’ll meet you at the lighthouse at dawn.</span>
                    </div>
                </div>
                <div class="row">
                    <div>
                        <div class="title">Style</div>
                        <div class="sub">On every device. Anime’s styled subtitles keep their own look, for their signs and songs.</div>
                    </div>
                    <PopupButton
                        label="Subtitle style"
                        value={subPreset}
                        options={presetOptions}
                        onchange={(v) => v !== 'custom' && (playerPrefs.subStyle = SUB_PRESETS[v].style)}
                    />
                </div>
                <div class="row compact">
                    <div class="title">Size</div>
                    <PopupButton label="Subtitle size" value={subStyle.size} options={optionsOf(SUB_SIZES)} onchange={(v) => setSub({ size: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Font</div>
                    <PopupButton label="Subtitle font" value={subStyle.font} options={optionsOf(SUB_FONTS)} onchange={(v) => setSub({ font: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Color</div>
                    <PopupButton label="Subtitle color" value={subStyle.color} options={optionsOf(SUB_COLORS)} onchange={(v) => setSub({ color: v })} />
                </div>
                <div class="row compact">
                    <div class="title">Background</div>
                    <Toggle label="Subtitle background" checked={subStyle.background} onchange={(v) => setSub({ background: v })} />
                </div>
                {#if !subStyle.background}
                    <div class="row compact">
                        <div class="title">Edges</div>
                        <PopupButton label="Subtitle edges" value={subStyle.edge} options={optionsOf(SUB_EDGES)} onchange={(v) => setSub({ edge: v })} />
                    </div>
                {/if}
                <div class="row compact">
                    <label class="title" for="sub-position">Position</label>
                    <input
                        id="sub-position"
                        class="sub-position"
                        type="range"
                        min="0"
                        max={SUB_POSITION_MAX}
                        step="1"
                        value={subStyle.position}
                        oninput={(e) => setSub({ position: Number(e.currentTarget.value) })}
                        aria-valuetext={subStyle.position === 0 ? 'At the bottom' : `${subStyle.position}% up`}
                    />
                </div>
            </div>
        </section>

        {#if player.features.upscaling || player.features.hdrPassthrough || player.features.audioPassthrough}
        <section>
            <h2>Video</h2>
            <div class="group">
                {#if player.features.upscaling}
                <div class="row">
                    <div>
                        <div class="title">Upscaling</div>
                        <div class="sub">
                            Sharpens video that’s smaller than your screen. RTX Video Super Resolution needs an
                            NVIDIA RTX card and uses its AI upscaler.
                        </div>
                    </div>
                    <PopupButton
                        label="Upscaling"
                        value={playerPrefs.upscaler}
                        options={(Object.keys(upscalerLabels) as Upscaler[]).map((u) => ({ value: u, label: upscalerLabels[u] }))}
                        onchange={(v) => (playerPrefs.upscaler = v)}
                    />
                </div>
                {/if}
                {#if player.features.hdrPassthrough}
                <div class="row">
                    <div>
                        <div class="title">HDR passthrough</div>
                        <div class="sub">Sends HDR to your display when Windows HDR is on. Otherwise HDR is tone-mapped to look right on SDR.</div>
                    </div>
                    <Toggle label="HDR passthrough" checked={playerPrefs.hdrPassthrough} onchange={(v) => (playerPrefs.hdrPassthrough = v)} />
                </div>
                {/if}
                {#if player.features.audioPassthrough}
                <div class="row">
                    <div>
                        <div class="title">Audio passthrough (Dolby Atmos, DTS)</div>
                        <div class="sub">For a receiver or soundbar over HDMI. Leave off for headphones and PC speakers.</div>
                    </div>
                    <Toggle label="Audio passthrough" checked={playerPrefs.audioPassthrough} onchange={(v) => (playerPrefs.audioPassthrough = v)} />
                </div>
                {/if}
            </div>
        </section>
        {/if}

        <section>
            <h2>Easy Mode</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Pick sources automatically</div>
                        <div class="sub">
                            Press Play and the best source starts on its own, preferring cached debrid streams. If one
                            doesn’t work, the next best is tried. You’ll only see the source list if nothing works.
                        </div>
                    </div>
                    <Toggle label="Pick sources automatically" checked={playerPrefs.easyMode} onchange={(v) => (playerPrefs.easyMode = v)} />
                </div>
                {#if playerPrefs.easyMode}
                    <div class="row">
                        <div>
                            <div class="title">Maximum quality</div>
                            <div class="sub">The highest resolution to pick. Lower saves data and starts faster.</div>
                        </div>
                        <PopupButton
                            label="Maximum quality"
                            value={playerPrefs.maxResolution}
                            options={[
                                { value: 2160, label: 'Up to 4K' },
                                { value: 1080, label: 'Up to 1080p' },
                                { value: 720, label: 'Up to 720p' },
                            ]}
                            onchange={(v) => (playerPrefs.maxResolution = v)}
                        />
                    </div>
                    {#if isDesktop}
                    <div class="row">
                        <div>
                            <div class="title">Fall back to non-debrid torrents</div>
                            <div class="sub">
                                Only used as a backup, when none of the debrid sources work (e.g. Torrentio without
                                debrid).
                            </div>
                        </div>
                        <Toggle label="Fall back to non-debrid torrents" checked={playerPrefs.allowTorrents} onchange={(v) => (playerPrefs.allowTorrents = v)} />
                    </div>
                    {/if}
                {/if}
            </div>
        </section>

        {#if isDesktop}
            <section>
                <h2>Integrations</h2>
                <div class="group">
                    <div class="row">
                        <div>
                            <div class="title">Open addon install links in this app</div>
                            <div class="sub">
                                Makes “Install” buttons on addon websites open here. Windows lets only one app handle
                                these links, so this takes them over from the official Stremio app.
                            </div>
                        </div>
                        <Toggle label="Open addon install links in this app" checked={handlesLinks} onchange={setLinkHandling} />
                    </div>
                    <div class="row">
                        <div>
                            <div class="title">Show what you’re watching on Discord</div>
                            <div class="sub">Your Discord profile shows the title, episode and time left while something plays. Needs the Discord app running.</div>
                        </div>
                        <Toggle label="Show what you’re watching on Discord" checked={playerPrefs.discordPresence} onchange={(v) => (playerPrefs.discordPresence = v)} />
                    </div>
                </div>
            </section>
        {/if}

        {#if app.user}
            <section>
                <h2>Lightboxd</h2>
                <div class="group">
                    {#if lightboxd.pairing}
                        {@const p = lightboxd.pairing}
                        {#if p.state === 'waiting' && isTV}
                            <!-- A TV can't open the approval page: it shows it, for a phone. -->
                            <div class="row pair-tv">
                                <div class="qr" aria-hidden="true">{@html qrSvg(p.pairUrl)}</div>
                                <div class="pair-steps">
                                    <div class="title">Approve This TV in Lightboxd</div>
                                    <p class="sub">Scan the code with your phone, or open <strong>{p.pairUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}</strong> and enter</p>
                                    <div class="pair-code" aria-label={`Code ${p.code}`}>{p.code}</div>
                                    <p class="sub">This screen continues by itself.</p>
                                </div>
                            </div>
                        {:else}
                            <div class="row stack">
                                <div>
                                    {#if p.state === 'waiting'}
                                        <div class="title">Approve in Lightboxd</div>
                                        <div class="sub">Open Lightboxd, check the code matches, and approve. This page continues by itself.</div>
                                    {:else if p.state === 'denied'}
                                        <div class="title">Code Denied</div>
                                        <div class="sub">Lightboxd turned this code down. Get a new one to try again.</div>
                                    {:else}
                                        <div class="title">Code Expired</div>
                                        <div class="sub">Codes last 10 minutes. Get a new one to try again.</div>
                                    {/if}
                                </div>
                                {#if p.state === 'waiting'}<div class="pair-code" aria-label={`Code ${p.code}`}>{p.code}</div>{/if}
                            </div>
                        {/if}
                        <div class="row compact">
                            <span class="sub">{p.server.replace(/^https?:\/\//, '')}</span>
                            <div class="account-actions">
                                <!-- TV: the Connect button that had focus is gone; focus goes to the way out. -->
                                <button class="btn" {@attach (el) => void (isTV && setTimeout(() => el.focus()))} onclick={() => lightboxd.cancelPairing()}>Cancel</button>
                                {#if p.state !== 'waiting'}
                                    <button class="btn primary" onclick={() => lightboxd.connect(p.server)}>Get New Code</button>
                                {:else if !isTV}
                                    <button class="btn primary" onclick={() => openExternal(p.pairUrl)}>Open Lightboxd</button>
                                {/if}
                            </div>
                        </div>
                    {:else if lightboxd.saved?.token}
                        <div class="row">
                            <div>
                                <div class="title">{lightboxd.saved.user?.name ?? 'Lightboxd'}</div>
                                <div class="sub">
                                    {#if lightboxd.status === 'ok'}
                                        {lightboxd.saved.user?.handle ? `${lightboxd.saved.user.handle} · ` : ''}{lightboxdHost}
                                    {:else if lightboxd.status === 'unreachable'}
                                        Can’t reach {lightboxdHost}. Lightboxd stays hidden until it’s back.
                                    {:else}
                                        Checking {lightboxdHost}…
                                    {/if}
                                </div>
                                <div class="sub">On every device signed in to this Stremio account.</div>
                            </div>
                            <button class="btn" onclick={() => lightboxd.disconnect()} title="Disconnects every device signed in to this Stremio account">Disconnect</button>
                        </div>
                        <div class="row">
                            <div>
                                <div class="title">Rows on Home</div>
                                <div class="sub" class:sync-error={!!lightboxdRowsError}>
                                    {lightboxdRowsError ?? 'Recently Watched and Airing This Week.'}
                                </div>
                            </div>
                            <Toggle
                                label="Lightboxd rows on Home"
                                checked={lightboxd.rowsInstalled}
                                onchange={async (v) => {
                                    lightboxdRowsError = null;
                                    if (!(await lightboxd.setRows(v))) lightboxdRowsError = 'Couldn’t reach Lightboxd. Try again when it’s running.';
                                }}
                            />
                        </div>
                    {:else}
                        <form
                            class="row stack"
                            onsubmit={(e) => {
                                e.preventDefault();
                                lightboxd.connect(lightboxdAddress);
                            }}
                        >
                            <div>
                                <label class="title" for="lightboxd-url">
                                    {lightboxd.status === 'removed' ? 'This Device Was Removed' : 'Connect Lightboxd'}
                                </label>
                                <div class="sub" class:sync-error={!!lightboxd.error}>
                                    {#if lightboxd.error}
                                        {lightboxd.error}
                                    {:else if lightboxd.status === 'removed'}
                                        Lightboxd removed it. Connect again to keep using it with this profile.
                                    {:else if lightboxd.suggestedServer}
                                        This profile already uses Lightboxd. Connect, then approve this {isTV ? 'TV' : isIOS ? 'iPhone' : 'PC'} too.
                                    {:else}
                                        Your watch history, scores and calendar from your Lightboxd server. Leave the address empty to look {isDesktop ? 'on this PC and ' : ''}at lightboxd.local.
                                    {/if}
                                </div>
                            </div>
                            <div class="url">
                                <input
                                    id="lightboxd-url"
                                    type="text"
                                    inputmode="url"
                                    autocapitalize="off"
                                    autocorrect="off"
                                    spellcheck="false"
                                    autocomplete="off"
                                    enterkeyhint="go"
                                    placeholder="lightboxd.local:8000"
                                    bind:value={lightboxdAddress}
                                />
                                <button class="btn primary" type="submit" disabled={lightboxd.connecting}>{lightboxd.connecting ? 'Connecting…' : 'Connect'}</button>
                            </div>
                        </form>
                    {/if}
                </div>
            </section>
        {/if}

        {#if !isIOS && !isTV}<!-- iOS and TVs have no streaming server -->
        <section>
            <h2>Streaming Server</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Status</div>
                        <div class="sub" class:sync-error={!!serverSetupError}>
                            {serverSetupError ??
                                (canSetUpServer
                                    ? 'Torrents need Stremio’s streaming server. Set Up downloads it from Stremio (about 30 MB) and starts it.'
                                    : 'Plays torrents and converts formats. This app starts it automatically.')}
                        </div>
                    </div>
                    <div class="status"><ServerStatus status={app.server} /></div>
                    {#if canSetUpServer}<button class="btn primary" onclick={setUpServer}>Set Up</button>{/if}
                </div>
                <form class="row" onsubmit={saveServerUrl}>
                    <div>
                        <label class="title" for="server-url">Server address</label>
                        <div class="sub">Change only if you run the server on another device.</div>
                    </div>
                    <div class="url">
                        <input id="server-url" type="url" bind:value={serverUrl} spellcheck="false" />
                        {#if serverUrlChanged}<button class="btn primary" type="submit">Save</button>{/if}
                    </div>
                </form>
            </div>
        </section>
        {/if}
    {/if}

    {#if isTV}
        <section>
            <h2>Display</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Screen Size</div>
                        <div class="sub">How big text, posters and controls are. Small is the desktop app’s size.</div>
                    </div>
                    <PopupButton
                        label="Screen Size"
                        value={tvSize}
                        options={(Object.keys(tvSizes) as TvSize[]).map((s) => ({ value: s, label: tvSizes[s].label }))}
                        onchange={(v) => {
                            tvSize = v;
                            setTvSize(v);
                        }}
                    />
                </div>
            </div>
        </section>
    {/if}

    <section>
        <h2>Home</h2>
        <div class="group">
            <div class="row">
                <div>
                    <div class="title">Customize Home</div>
                    <div class="sub">Reorder, rename, merge or hide Home’s rows, including Continue Watching.</div>
                </div>
                <a class="btn" href="/customize">Customize…</a>
            </div>
        </div>
    </section>

        {#if !isIOS && !isTV}<!-- no keyboard on a phone or TV -->
    <section>
        <h2>Keyboard Shortcuts</h2>
        <h3 class="subhead">While Watching</h3>
        <div class="group">
            {#each ACTIONS as { action } (action)}
                {@const chord = hotkeys.chordFor(action)}
                <div class="row compact hotkey">
                    <span>
                        {labelOf(action, seekStep, fineStep)}
                        {#if hotkeyError?.action === action}<span class="hotkey-error" role="alert">{hotkeyError.text}</span>{/if}
                    </span>
                    <span class="keys">
                        {#if !hotkeys.isDefault(action)}
                            <button class="link" onclick={() => resetHotkey(action)} title="Back to the original key">Reset</button>
                        {/if}
                        <button
                            class="key-button"
                            class:capturing={capturing === action}
                            onclick={() => captureKey(action)}
                            aria-label={`${labelOf(action, seekStep, fineStep)}: ${chord ? formatChord(chord) : 'no key'}. Change`}
                        >
                            {#if capturing === action}Press a key…{:else if chord}<kbd>{formatChord(chord)}</kbd>{/if}
                        </button>
                    </span>
                </div>
            {/each}
            <div class="row compact">
                <span class="sub">Click a key, then press the new one (Esc cancels). Tab still skips while the Skip button shows.</span>
                <button class="btn" onclick={() => resetHotkey()}>Reset All</button>
            </div>
        </div>
        {#if hotkeyError && !hotkeyError.action}<p class="hotkey-error" role="alert">{hotkeyError.text}</p>{/if}
        {#each shortcutGroups as g (g.title)}
            <h3 class="subhead">{g.title}</h3>
            <div class="group">
                {#each g.items as [label, keys] (label)}
                    <div class="row compact">
                        <span>{label}</span>
                        <span class="keys">
                            {#each keys as key, i (key)}{#if i}<span class="or">or</span>{/if}<kbd>{key}</kbd>{/each}
                        </span>
                    </div>
                {/each}
            </div>
        {/each}
    </section>
        {/if}

    {#if updates.supported}
        <section>
            <h2>Updates</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">
                            {#if updates.phase === 'ready'}Version {updates.version} is ready
                            {:else if updates.phase === 'downloading'}Downloading version {updates.version}…{#if updates.progress != null} {Math.round(updates.progress * 100)}%{/if}
                            {:else if updates.phase === 'checking'}Checking for updates…
                            {:else if updates.phase === 'up-to-date'}You’re up to date
                            {:else if updates.phase === 'error'}Couldn’t check for updates
                            {:else}Automatic updates{/if}
                        </div>
                        <div class="sub">
                            {#if updates.phase === 'error'}Check your connection and try again.
                            {:else if updates.reloads}Updates download in the background and install when you reload.
                            {:else}Updates download in the background and install when you restart.{/if}
                        </div>
                    </div>
                    {#if updates.phase === 'ready'}
                        <button class="btn primary" onclick={() => updates.restartToUpdate()}>{updates.reloads ? 'Reload to Update' : 'Restart to Update'}</button>
                    {:else}
                        <button class="btn" disabled={updates.phase === 'checking' || updates.phase === 'downloading'} onclick={() => updates.check()}>
                            Check for Updates
                        </button>
                    {/if}
                </div>
                {#if whatsNew.available}
                    <div class="row">
                        <div>
                            <div class="title">What’s New</div>
                            <div class="sub">The latest changes to this app.</div>
                        </div>
                        <button class="btn" onclick={() => whatsNew.showRecent()}>Show</button>
                    </div>
                {/if}
            </div>
        </section>
    {/if}

    <p class="about">Stremio {updates.current ?? '0.1.0'} · stremio-core-web {import.meta.env.CORE_VERSION}</p>
</div>

<style>
    .page {
        max-width: 760px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 28px) var(--gutter) 64px;
    }
    h1 {
        margin: 0 0 28px;
        font-family: var(--font-display);
        font-size: clamp(28px, 3vw, 36px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    section {
        margin-bottom: 28px;
    }
    h2 {
        margin: 0 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    /* Grouped rows, like a native settings window. */
    .group {
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        overflow: hidden;
    }
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        min-height: 64px;
        padding: 12px 18px;
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .row.compact {
        min-height: 44px;
    }
    /* A whole row that's a single action (Log Out), like native settings lists. */
    .row.action {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 48px;
        border-top: 1px solid var(--separator);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--fast);
    }
    .row.action:hover {
        background: var(--fill);
    }
    .row.action:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: -2px;
    }
    .row.action.destructive {
        color: #ff6961;
    }
    .title {
        font-weight: 500;
    }
    /* Subtitle Style's preview: a frame with a bright bottom, where subtitles
       are hardest to read. Drawn the way the TV draws them (subtitleStyle.ts). */
    .sub-preview {
        position: relative;
        aspect-ratio: 16 / 9;
        max-height: 260px;
        width: 100%;
        overflow: hidden;
        border-bottom: 1px solid var(--separator);
        background:
            radial-gradient(ellipse 60% 40% at 70% 78%, rgb(255 236 200 / 0.9), transparent 70%),
            linear-gradient(180deg, #0f1d2e 0%, #2b4563 38%, #8a7f78 66%, #d8c7ae 84%, #efe4d1 100%);
    }
    .sub-line {
        position: absolute;
        left: 6%;
        right: 6%;
        text-align: center;
        line-height: 1.3;
    }
    .sub-line span {
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
    }
    .sub-position {
        width: min(240px, 50%);
        accent-color: var(--accent);
    }
    .sub {
        margin-top: 2px;
        font-size: 13px;
        color: var(--label-2);
    }
    .account {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
    }
    .name-input {
        width: 220px;
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
    }
    .name-input:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .sync-error {
        color: var(--bad);
    }
    .account-actions {
        display: flex;
        gap: 8px;
        flex: none;
    }
    .btn {
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--separator);
        border-radius: 8px;
        background: var(--fill);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    a.btn {
        display: inline-flex;
        align-items: center;
        color: var(--label);
        text-decoration: none;
    }
    .btn:hover {
        background: var(--fill-hover);
    }
    .btn.primary {
        background: var(--accent);
        border-color: transparent;
        color: white;
    }
    .status {
        flex: none;
        min-width: 220px;
    }
    .url {
        display: flex;
        gap: 8px;
        flex: none;
    }
    .url input {
        width: 240px;
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
    }
    .url input:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .pair-code {
        flex: none;
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        letter-spacing: 0.08em;
        font-variant-numeric: tabular-nums;
        user-select: all;
    }
    /* TV pairing: the code to scan beside what to do, read from the sofa. */
    .pair-tv {
        justify-content: flex-start;
        gap: 32px;
        padding: 20px 18px;
    }
    .qr {
        flex: none;
        width: 200px;
        height: 200px;
        padding: 12px;
        border-radius: var(--radius-l);
        background: white;
    }
    .qr :global(svg) {
        display: block;
        width: 100%;
        height: 100%;
    }
    .pair-steps {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
    }
    .pair-steps .sub {
        margin: 8px 0;
    }
    .pair-steps strong {
        color: var(--label);
    }
    .pair-steps .pair-code {
        font-size: 44px;
    }
    .subhead {
        margin: 14px 0 8px 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--label-2);
    }
    h2 + .subhead {
        margin-top: 0;
    }
    .keys {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }
    .or {
        font-size: 12px;
        color: var(--label-3);
    }
    .key-button {
        all: unset;
        box-sizing: border-box;
        min-width: 64px;
        padding: 2px;
        border-radius: 8px;
        text-align: center;
        font-size: 12px;
        color: var(--label-2);
        cursor: pointer;
    }
    .key-button:hover kbd,
    .key-button:focus-visible kbd {
        border-color: var(--label-3);
        color: var(--label);
    }
    .key-button:focus-visible {
        outline: 2px solid var(--accent);
    }
    .key-button.capturing {
        padding: 3px 10px;
        border: 1px dashed var(--accent);
        color: var(--label);
    }
    .link {
        all: unset;
        font-size: 12px;
        color: var(--label-3);
        cursor: pointer;
    }
    .link:hover {
        color: var(--label);
    }
    .hotkey-error {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: var(--bad);
    }
    p.hotkey-error {
        margin: 8px 4px 0;
    }
    kbd {
        font-family: var(--font);
        font-size: 12px;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label-2);
        white-space: nowrap;
    }
    .about {
        text-align: center;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
    /* Phones: like iOS Settings, the control stays on the right of its title
       and the explanation reads as a footnote under the title. */
    @media (max-width: 700px) {
        .row {
            gap: 14px;
            padding: 12px 16px;
        }
        .row > div:first-child {
            flex: 1;
            min-width: 0;
        }
    }
    /* Phones: the account (picture, name, email) gets the full width with
       its button underneath; the name field sits under its label. */
    @media (max-width: 700px) {
        .account-row {
            flex-wrap: wrap;
        }
        .account {
            flex: 1 1 100%;
        }
        .account > div {
            min-width: 0;
        }
        .account .sub {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .account-row .btn {
            flex: 1 1 100%;
            height: 40px;
        }
        .row.stack {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
        }
        .row.stack .name-input {
            width: 100%;
            height: 40px;
            box-sizing: border-box;
        }
        /* The Lightboxd address: the field across, Connect beside it, 44 pt. */
        .row.stack .url input {
            flex: 1;
            min-width: 0;
            width: auto;
            height: 44px;
            font-size: 16px; /* 16 px and up: iOS doesn't zoom into the field */
        }
        .row.stack .url .btn,
        .account-actions .btn {
            height: 44px;
        }
        .pair-tv {
            flex-direction: column;
            align-items: flex-start;
        }
    }
</style>
