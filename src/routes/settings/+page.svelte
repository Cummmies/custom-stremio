<script lang="ts">
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import type { Settings } from '$lib/core/types';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import Toggle from '$lib/components/Toggle.svelte';
    import ServerStatus from '$lib/components/ServerStatus.svelte';
    import { inTauri } from '$lib/player/mpv.svelte';
    import { isDesktop, isIOS, isTV } from '$lib/platform';
    import { player } from '$lib/player/player';
    import { updates } from '$lib/updates.svelte';
    import { profiles } from '$lib/profiles.svelte';
    import Avatar from '$lib/components/Avatar.svelte';
    import PhotoControls from '$lib/components/PhotoControls.svelte';
    import { playerPrefs, upscalerLabels, type Upscaler } from '$lib/player/prefs.svelte';

    const settings = $derived(app.ctx?.profile.settings ?? null);
    const myProfile = $derived(profiles.get(app.user?._id));

    // stremio:// link handling (registered per user in Windows, not synced).
    let handlesLinks = $state(false);
    $effect(() => {
        if (!inTauri) return;
        import('@tauri-apps/plugin-deep-link').then(async ({ isRegistered }) => {
            handlesLinks = await isRegistered('stremio').catch(() => false);
        });
    });
    async function setLinkHandling(on: boolean) {
        const { register, unregister } = await import('@tauri-apps/plugin-deep-link');
        try {
            await (on ? register('stremio') : unregister('stremio'));
            handlesLinks = on;
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

    function saveServerUrl(e: SubmitEvent) {
        e.preventDefault();
        let url = serverUrl.trim();
        if (!/^https?:\/\//.test(url)) return;
        if (!url.endsWith('/')) url += '/';
        update({ streamingServerUrl: url });
        core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } });
    }

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
            title: 'While Watching',
            items: [
                ['Play / Pause', ['Space', 'K']],
                [`Back / Forward ${seekStep} seconds`, ['← →']],
                [`Back / Forward ${fineStep} seconds`, ['Shift ← →']],
                ['Volume up / down', ['↑ ↓']],
                ['Mute', ['M']],
                ['Skip intro, recap or credits (or find where the intro ends)', ['S']],
                ['Skip, while the Skip button shows', ['Tab']],
                ['Next episode', ['N']],
                ['Full screen', ['F']],
                ['Picture in picture', ['P']],
                ['Exit full screen or picture in picture, then leave', ['Esc']],
            ],
        },
        {
            title: 'Seek Bar (After Clicking or Tabbing to It)',
            items: [
                ['Back / Forward 5 seconds', ['← →']],
                ['Back / Forward 30 seconds', ['Shift ← →']],
                ['Back to the start', ['Home']],
            ],
        },
    ]);
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
                    <button class="btn primary" onclick={() => app.openLogin()}>Log In…</button>
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
                <div class="row">
                    <div>
                        <div class="title">Profile picture</div>
                        <div class="sub">Syncs with your Stremio account.</div>
                    </div>
                    <PhotoControls uid={myProfile.uid} />
                </div>
            {/if}
            {#if app.user}
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
                        <div class="sub">Preferred when a stream has several audio tracks.</div>
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
                <div class="row">
                    <div>
                        <div class="title">Hardware-accelerated decoding</div>
                        <div class="sub">Uses your graphics card to decode video. Turn off if playback shows artifacts.</div>
                    </div>
                    <Toggle label="Hardware-accelerated decoding" checked={settings.hardwareDecoding} onchange={(v) => update({ hardwareDecoding: v })} />
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
                            <div class="title">Audio language</div>
                            <div class="sub">Sources in this language come first. Many releases don’t say, so others are still used.</div>
                        </div>
                        <PopupButton
                            label="Easy Mode audio language"
                            value={playerPrefs.easyLanguage}
                            options={[{ value: null as string | null, label: 'No Preference' }, ...languages]}
                            onchange={(v) => (playerPrefs.easyLanguage = v)}
                        />
                    </div>
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

        {#if !isIOS && !isTV}<!-- iOS and TVs have no streaming server -->
        <section>
            <h2>Streaming Server</h2>
            <div class="group">
                <div class="row">
                    <div>
                        <div class="title">Status</div>
                        <div class="sub">Plays torrents and converts formats. This app starts it automatically.</div>
                    </div>
                    <div class="status"><ServerStatus status={app.server} /></div>
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
                            {:else}Updates download in the background and install when you restart.{/if}
                        </div>
                    </div>
                    {#if updates.phase === 'ready'}
                        <button class="btn primary" onclick={() => updates.restartToUpdate()}>Restart to Update</button>
                    {:else}
                        <button class="btn" disabled={updates.phase === 'checking' || updates.phase === 'downloading'} onclick={() => updates.check()}>
                            Check for Updates
                        </button>
                    {/if}
                </div>
            </div>
        </section>
    {/if}

    <p class="about">Custom Stremio {updates.current ?? '0.1.0'} · stremio-core-web 0.63.2</p>
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
    }
</style>
