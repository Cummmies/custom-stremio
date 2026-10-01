// Keeps this app's own data with your Stremio account: your profile's name,
// color and picture, your Home layout (Customize Home) and all its settings.
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
import { profiles } from '$lib/profiles.svelte';
import { homeLayout, type Layout } from '$lib/homeLayout.svelte';
import { playerPrefs, type DevicePrefs, type SyncedPrefs } from '$lib/player/prefs.svelte';
import { isDesktop, isIOS, isTV } from '$lib/platform';

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
    profile?: { name: string; color: string; avatar?: string };
    home?: Layout;
    prefs?: SyncedPrefs;
    /** Device settings, by kind of device ('desktop', 'ios', …). */
    devices?: Record<string, DevicePrefs>;
};

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

function remoteOf(addons: Descriptor[] | undefined) {
    return decode(addons?.find((a) => a.transportUrl === SYNC_ADDON_URL)?.manifest.contactEmail);
}

class CloudSync {
    #uid: string | null = null;
    /** This device's synced data as last sent or received; equal means nothing to send. */
    #last = '';
    /** Other kinds of devices' settings from the account, passed along untouched. */
    #devices: Record<string, DevicePrefs> = {};
    #timer: ReturnType<typeof setTimeout> | undefined;
    #started = false;

    start() {
        if (this.#started) return;
        this.#started = true;
        $effect.root(() => {
            // Logged in, switched profile, or the account's copy changed: take it if newer.
            $effect(() => {
                const uid = app.user?._id ?? null;
                const addons = app.ctx?.profile.addons as Descriptor[] | undefined;
                if (uid !== this.#uid) {
                    this.#uid = uid;
                    clearTimeout(this.#timer);
                    // Already in step with the account: nothing to send until something changes.
                    this.#last = uid && this.#stamp(uid) ? untrack(() => this.#snapshot(uid)) : '';
                }
                if (uid) untrack(() => this.#pull(uid, addons));
            });
            // Something synced changed on this device: send it shortly.
            $effect(() => {
                const uid = app.user?._id;
                if (!uid) return;
                const state = this.#snapshot(uid);
                clearTimeout(this.#timer);
                if (state !== this.#last) this.#timer = setTimeout(() => this.#push(uid), PUSH_DELAY_MS);
            });
        });
    }

    /** The synced data as it is on this device (reactive reads), as JSON. */
    #snapshot(uid: string) {
        const p = profiles.get(uid);
        return JSON.stringify({
            profile: p ? { name: p.name, color: p.color, avatar: p.avatar } : undefined,
            home: $state.snapshot(homeLayout.layout),
            prefs: playerPrefs.synced(),
            device: playerPrefs.device(),
        });
    }

    #stamp(uid: string) {
        return Number(localStorage.getItem(stampKey(uid))) || 0;
    }

    #pull(uid: string, addons: Descriptor[] | undefined) {
        const remote = remoteOf(addons);
        if (!remote || remote.updated <= this.#stamp(uid)) return;
        if (remote.profile) {
            const { name, color, avatar } = remote.profile;
            profiles.update(uid, avatar ? { name, color, avatar } : { name, color });
        }
        if (remote.home) {
            homeLayout.sync();
            homeLayout.replace(remote.home);
        }
        if (remote.prefs) playerPrefs.applySynced(remote.prefs);
        this.#devices = remote.devices ?? {};
        const mine = this.#devices[DEVICE_KIND];
        if (mine) playerPrefs.applyDevice(mine);
        localStorage.setItem(stampKey(uid), String(remote.updated));
        this.#last = this.#snapshot(uid);
    }

    async #push(uid: string) {
        if (app.user?._id !== uid) return;
        // A device that has never synced takes the account's copy first.
        const remote = remoteOf(app.ctx?.profile.addons as Descriptor[] | undefined);
        if (remote && remote.updated > this.#stamp(uid)) return this.#pull(uid, app.ctx?.profile.addons as Descriptor[]);

        const state = this.#snapshot(uid);
        if (state === this.#last) return;
        const { device, ...data } = JSON.parse(state) as Omit<Payload, 'v' | 'updated'> & { device: DevicePrefs };
        const updated = Date.now();
        this.#devices = { ...(remote?.devices ?? this.#devices), [DEVICE_KIND]: device };
        const payload: Payload = { v: 1, updated, ...data, devices: this.#devices };
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
                        name: 'Custom Stremio Sync',
                        description:
                            'Added by the Custom Stremio app to keep your profile picture, Home rows and app settings the same on every device you log in to. It stores those settings in your Stremio account and nothing else: no catalogs, no streams, and it never connects anywhere. Removing it only stops that syncing (the app adds it back when a setting changes).',
                        contactEmail: encode(payload),
                        types: [],
                        resources: [],
                        catalogs: [],
                        behaviorHints: {},
                    },
                },
            },
        });
        localStorage.setItem(stampKey(uid), String(updated));
        this.#last = state;
    }
}

export const cloudSync = new CloudSync();
