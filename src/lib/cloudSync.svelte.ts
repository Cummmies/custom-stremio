// Keeps this app's own data with your Stremio account: your profile's name,
// color and picture, your Home layout (Customize Home), all its settings, and
// your tracker connection (its address and token, so a device signed in to
// the account is connected too).
// Log in on another PC or your phone and it's there. Settings about the device
// (upscaling, HDR/audio passthrough, volume, window pausing) are kept per kind
// of device and only applied to that kind: a new PC gets your PC's, a new
// phone your phone's.
//
// Stremio has no place for an app's own data, but it does sync your addons,
// manifests included. So the data rides in an addon of its own ("Custom
// Stremio Sync"): installed while you're logged in, updated a few seconds after
// each change. It has no catalogs or streams, so no Stremio app ever asks it
// for anything, and its address never resolves.
//
// Stremio's core keeps only the manifest fields it knows, so the data sits in
// one of them, `contactEmail`, which apps don't show.
import { untrack } from 'svelte';
import { core } from '$lib/core';
import { app } from '$lib/app.svelte';
import { nameFromEmail, profiles } from '$lib/profiles.svelte';
import { homeLayout, type Layout } from '$lib/homeLayout.svelte';
import { playerPrefs, type DevicePrefs, type SyncedPrefs } from '$lib/player/prefs.svelte';
import { isDesktop, isIOS, isTV } from '$lib/platform';
import { tracker } from '$lib/tracker.svelte';
import { NAME_BEFORE } from '$lib/serverIds';

/** Which kind of device this is, for device settings. */
const DEVICE_KIND = isDesktop ? 'desktop' : isIOS ? 'ios' : isTV ? 'tv' : 'web';

export const SYNC_ADDON_URL = 'https://sync.custom-stremio.invalid/manifest.json';
const SYNC_ADDON_ID = 'community.customstremio.sync';
const PREFIX = 'cs1:';
const PUSH_DELAY_MS = 3000;
const AVATAR_PX = 128;

type Payload = {
    v: 1;
    /** When this data last changed (ms since 1970), on whichever device. */
    updated: number;
    /**
     * When each part last changed, on whichever device changed it. Each part
     * goes its own way: a device that never touched your profile passes the
     * account's profile along as it is, instead of overwriting it with its own
     * defaults. Missing in data from before parts had their own (then
     * `updated` stands for all of them).
     */
    stamps?: Partial<Record<Part, number>>;
    profile?: { name: string; color: string; avatar?: string };
    home?: Layout;
    prefs?: SyncedPrefs;
    /** This profile's tracker connection (tracker.svelte.ts); older data has only the server. */
    tracker?: { server: string | null; token?: string | null; addonUrl?: string | null };
    /** Device settings, by kind of device ('desktop', 'ios', …). */
    devices?: Record<string, DevicePrefs>;
};

const PARTS = ['profile', 'home', 'prefs', 'tracker'] as const;
type Part = (typeof PARTS)[number];
type Stamps = Record<Part | 'devices', number>;

type Descriptor = {
    transportUrl: string;
    manifest: { id: string; contactEmail?: string | null };
};

// --- encoding -----------------------------------------------------------------

function encode(p: Payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return PREFIX + btoa(bin);
}

function decode(s: string | null | undefined): Payload | null {
    if (!s?.startsWith(PREFIX)) return null;
    try {
        const bin = atob(s.slice(PREFIX.length));
        const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
        return p?.v === 1 ? p : null;
    } catch {
        return null;
    }
}

/** Profile pictures are stored at 256px; the synced copy is smaller. */
const shrunk = new Map<string, Promise<string>>();
function smallAvatar(src: string): Promise<string> {
    let p = shrunk.get(src);
    if (!p) {
        p = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = AVATAR_PX;
                const ctx = canvas.getContext('2d')!;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, AVATAR_PX, AVATAR_PX);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => resolve(src);
            img.src = src;
        });
        shrunk.set(src, p);
    }
    return p;
}

// --- sync ---------------------------------------------------------------------

const stampKey = (uid: string) => `cloudSync:${uid}`;
const partsKey = (uid: string) => `cloudSync:${uid}:parts`;

function remoteOf(addons: Descriptor[] | undefined) {
    return fromBefore(decode(addons?.find((a) => a.transportUrl === SYNC_ADDON_URL)?.manifest.contactEmail));
}

/** A copy from before the rename keeps the tracker under its old name (serverIds.ts): read it as this one. */
function fromBefore(r: ReturnType<typeof decode>): ReturnType<typeof decode> {
    if (!r) return r;
    const old = r as typeof r & Record<string, unknown>;
    const before = old[NAME_BEFORE] as Payload['tracker'] | undefined;
    const beforeStamp = (old.stamps as Record<string, number> | undefined)?.[NAME_BEFORE];
    return {
        ...r,
        tracker: r.tracker ?? before,
        ...(r.stamps ? { stamps: { ...r.stamps, tracker: r.stamps.tracker ?? beforeStamp } } : {}),
    };
}

/** When each part of the account's copy last changed. */
function remoteStamps(r: Payload): Stamps {
    const s = r.stamps ?? {};
    // Data from before the tracker was synced has none: never set (0).
    return {
        profile: s.profile ?? r.updated,
        home: s.home ?? r.updated,
        prefs: s.prefs ?? r.updated,
        tracker: s.tracker ?? 0,
        devices: r.updated,
    };
}

class CloudSync {
    #uid: string | null = null;
    /** Each part as last sent or received, as JSON; a difference is a change made here. */
    #lastParts: Record<Part | 'devices', string | null> = { profile: null, home: null, prefs: null, tracker: null, devices: null };
    /** Other kinds of devices' settings from the account, passed along untouched. */
    #devices: Record<string, DevicePrefs> = {};
    #timer: ReturnType<typeof setTimeout> | undefined;
    #started = false;
    /** The last send: when Stremio took it, or why it didn't (Settings shows it). */
    status = $state<{ at: number; error: string | null } | null>(null);

    start() {
        if (this.#started) return;
        this.#started = true;
        core.onEvent((event, args) => {
            if (event === 'AddonsPushedToAPI') this.status = { at: Date.now(), error: null };
            else if (event === 'Error' && args?.source?.event === 'AddonsPushedToAPI') {
                this.status = { at: Date.now(), error: args.error?.message ?? 'Stremio didn’t accept the update.' };
            }
        });
        $effect.root(() => {
            // Logged in, switched profile, or the account's copy changed: take what's newer.
            $effect(() => {
                const uid = app.user?._id ?? null;
                const addons = app.ctx?.profile.addons as Descriptor[] | undefined;
                // Again once the profile is saved here (the account's name and
                // picture wait for it).
                void (uid && profiles.get(uid));
                if (uid !== this.#uid) {
                    this.#uid = uid;
                    clearTimeout(this.#timer);
                    this.status = null;
                    untrack(() => {
                        // This profile's own settings, before comparing or sending anything.
                        playerPrefs.sync(uid);
                        homeLayout.sync();
                        // What's here now is where changes are measured from: a new
                        // device's defaults aren't changes to send.
                        this.#lastParts = uid ? this.#parts(uid) : { profile: null, home: null, prefs: null, tracker: null, devices: null };
                    });
                }
                if (uid) untrack(() => this.#pull(uid, addons));
            });
            // Something synced changed on this device: mark it and send it shortly.
            $effect(() => {
                const uid = app.user?._id;
                if (!uid) return;
                const now = this.#parts(uid);
                untrack(() => {
                    const stamps = this.#stamps(uid);
                    let changed = false;
                    for (const k of [...PARTS, 'devices'] as const) {
                        if (now[k] === this.#lastParts[k]) continue;
                        // A part appearing (the profile saved right after logging in)
                        // is where it starts, not a change.
                        if (this.#lastParts[k] != null) {
                            stamps[k] = Date.now();
                            changed = true;
                        }
                        this.#lastParts[k] = now[k];
                    }
                    if (!changed) return;
                    this.#saveStamps(uid, stamps);
                    clearTimeout(this.#timer);
                    this.#timer = setTimeout(() => this.#push(uid), PUSH_DELAY_MS);
                });
            });
        });
    }

    /** Each synced part as it is on this device (reactive reads), as JSON. */
    #parts(uid: string): Record<Part | 'devices', string | null> {
        const p = profiles.get(uid);
        return {
            profile: p ? JSON.stringify({ name: p.name, color: p.color, avatar: p.avatar }) : null,
            home: JSON.stringify($state.snapshot(homeLayout.layout)),
            prefs: JSON.stringify(playerPrefs.synced()),
            // Always a value, so connecting (from none) counts as a change to send.
            tracker: JSON.stringify(tracker.sharedFor(uid)),
            devices: JSON.stringify(playerPrefs.device()),
        };
    }

    /** When this device's copy of each part changed (0: never set here, defaults). */
    #stamps(uid: string): Stamps {
        try {
            const s = JSON.parse(localStorage.getItem(partsKey(uid)) ?? 'null');
            if (s) return { profile: 0, home: 0, prefs: 0, tracker: 0, devices: 0, ...s };
        } catch {}
        // From before parts had their own: everything as of the last sync.
        const all = Number(localStorage.getItem(stampKey(uid))) || 0;
        return { profile: all, home: all, prefs: all, tracker: 0, devices: all };
    }

    #saveStamps(uid: string, s: Stamps) {
        try {
            localStorage.setItem(partsKey(uid), JSON.stringify(s));
        } catch {}
    }

    /** Takes each part the account has a newer copy of. */
    #pull(uid: string, addons: Descriptor[] | undefined) {
        const remote = remoteOf(addons);
        if (!remote) return;
        const theirs = remoteStamps(remote);
        const mine = this.#stamps(uid);
        let took = false;
        // The profile lands only once it's saved here (right after logging in it
        // may not be yet); until then it isn't counted as taken, so it's tried again.
        const here = profiles.get(uid);
        let resend = false;
        if (remote.profile && theirs.profile > mine.profile && here) {
            let { name, color, avatar } = remote.profile;
            // Data from before parts had their own may be another device's
            // defaults written over the real profile: a picture or a chosen name
            // here beats none or the email-derived one there, and goes back up.
            if (!remote.stamps) {
                if (!avatar && here.avatar) avatar = here.avatar;
                if (name === nameFromEmail(here.email) && here.name !== name) name = here.name;
                resend = avatar !== remote.profile.avatar || name !== remote.profile.name;
            }
            profiles.update(uid, avatar ? { name, color, avatar } : { name, color, avatar: undefined });
            mine.profile = resend ? Date.now() : theirs.profile;
            took = true;
        }
        if (remote.home && theirs.home > mine.home) {
            homeLayout.sync();
            homeLayout.replace(remote.home);
            mine.home = theirs.home;
            took = true;
        }
        if (remote.prefs && theirs.prefs > mine.prefs) {
            playerPrefs.applySynced(remote.prefs);
            mine.prefs = theirs.prefs;
            took = true;
        }
        if (remote.tracker && theirs.tracker > mine.tracker) {
            tracker.setShared(uid, remote.tracker);
            mine.tracker = theirs.tracker;
            took = true;
        }
        this.#devices = remote.devices ?? {};
        const forMe = this.#devices[DEVICE_KIND];
        if (forMe && theirs.devices > mine.devices) {
            playerPrefs.applyDevice(forMe);
            mine.devices = theirs.devices;
            took = true;
        }
        if (!took) return;
        this.#saveStamps(uid, mine);
        // What was just taken isn't a change made here.
        this.#lastParts = this.#parts(uid);
        if (resend) {
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => this.#push(uid), PUSH_DELAY_MS);
        }
    }

    async #push(uid: string) {
        if (app.user?._id !== uid) return;
        const addons = app.ctx?.profile.addons as Descriptor[] | undefined;
        // Anything newer on the account comes in first.
        this.#pull(uid, addons);
        const remote = remoteOf(addons);
        const theirs = remote ? remoteStamps(remote) : null;
        const mine = this.#stamps(uid);
        const here = JSON.parse(JSON.stringify(untrack(() => this.#parts(uid)))) as Record<Part | 'devices', string | null>;
        const local = {
            profile: here.profile ? JSON.parse(here.profile) : undefined,
            home: here.home ? JSON.parse(here.home) : undefined,
            prefs: here.prefs ? JSON.parse(here.prefs) : undefined,
            tracker: here.tracker ? JSON.parse(here.tracker) : undefined,
        };

        // Each part: this device's copy if it has one at least as new as the
        // account's; otherwise the account's, passed along as it is.
        const payload: Payload = { v: 1, updated: Date.now(), stamps: {} };
        for (const k of PARTS) {
            const useMine = !remote || !remote[k] || mine[k] >= (theirs?.[k] ?? 0);
            (payload as any)[k] = useMine ? local[k] : remote[k];
            payload.stamps![k] = useMine ? mine[k] : theirs![k];
        }
        this.#devices = { ...(remote?.devices ?? this.#devices), [DEVICE_KIND]: JSON.parse(here.devices ?? '{}') };
        payload.devices = this.#devices;
        if (payload.profile?.avatar) payload.profile.avatar = await smallAvatar(payload.profile.avatar);
        if (app.user?._id !== uid) return;
        core.dispatch({
            action: 'Ctx',
            args: {
                action: 'InstallAddon',
                args: {
                    transportUrl: SYNC_ADDON_URL,
                    flags: { official: false, protected: false },
                    manifest: {
                        id: SYNC_ADDON_ID,
                        version: '1.0.0',
                        name: 'Stremio Sync',
                        description:
                            'Added by this app to keep your profile picture, Home rows, app settings and watch-history sign-in the same on every device you log in to. It stores those in your Stremio account and nothing else: no catalogs, no streams, and it never connects anywhere. Removing it only stops that syncing (the app adds it back when a setting changes).',
                        contactEmail: encode(payload),
                        types: [],
                        resources: [],
                        catalogs: [],
                        behaviorHints: {},
                    },
                },
            },
        });
    }
}

export const cloudSync = new CloudSync();
