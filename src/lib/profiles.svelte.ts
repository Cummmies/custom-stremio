// Profiles: several Stremio accounts saved on this PC, switchable in one click.
//
// Each profile keeps its account's session key (never the password). Switching
// signs in with that key. We never "log out" to switch, because Stremio's logout
// ends the session on the server and the saved key would stop working.
import { core } from '$lib/core';

export type SavedProfile = {
    uid: string;
    email: string;
    key: string;
    name: string;
    color: string;
    /** Uploaded photo as a small JPEG data URL (stored on this PC only). */
    avatar?: string;
    lastUsed: number;
};

/** Crops an image file to a centered square and shrinks it to a small JPEG. */
export async function imageToAvatar(file: File, size = 256): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.88);
}

export const PROFILE_COLORS = ['#6d4af0', '#e0457b', '#f08c2e', '#2fb67c', '#2d8cf0', '#c04ae0', '#d4a72c', '#5f6b7a'];

const KEY = 'savedProfiles';
const PREFS_KEY = 'profilePrefs';

function load<T>(key: string, fallback: T): T {
    try {
        return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
    } catch {
        return fallback;
    }
}

function nameFromEmail(email: string) {
    const local = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim() || email;
    return local.charAt(0).toUpperCase() + local.slice(1);
}

class Profiles {
    list = $state<SavedProfile[]>(load(KEY, []));
    pickerOpen = $state(false);
    /** Which screen the picker opens on. */
    pickerView = $state<'pick' | 'add'>('pick');
    /** uid being switched to, while it's in progress. */
    switching = $state<string | null>(null);
    error = $state<string | null>(null);
    askOnLaunch = $state<boolean>(load(PREFS_KEY, { askOnLaunch: false }).askOnLaunch);

    #save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(this.list));
        } catch {}
    }

    setAskOnLaunch(v: boolean) {
        this.askOnLaunch = v;
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ askOnLaunch: v }));
        } catch {}
    }

    #forgotten = new Map<string, number>();

    /** Drop a profile from this PC without touching its session. */
    forget(uid: string) {
        this.#forgotten.set(uid, Date.now());
        this.list = this.list.filter((x) => x.uid !== uid);
        this.#save();
    }

    /** Called whenever the signed-in account is known: keep its profile current. */
    remember(auth: { key: string; user: { _id: string; email: string } }) {
        // A late state update right after logging out shouldn't bring the profile back.
        if (Date.now() - (this.#forgotten.get(auth.user._id) ?? 0) < 10000) return;
        const existing = this.list.find((p) => p.uid === auth.user._id);
        if (existing) {
            if (existing.key !== auth.key || existing.email !== auth.user.email) {
                this.list = this.list.map((p) =>
                    p.uid === existing.uid ? { ...p, key: auth.key, email: auth.user.email, lastUsed: Date.now() } : p
                );
                this.#save();
            }
            return;
        }
        this.list = [
            ...this.list,
            {
                uid: auth.user._id,
                email: auth.user.email,
                key: auth.key,
                name: nameFromEmail(auth.user.email),
                color: PROFILE_COLORS[this.list.length % PROFILE_COLORS.length],
                lastUsed: Date.now(),
            },
        ];
        this.#save();
    }

    /** The saved profile for an account, if any. */
    get(uid: string | null | undefined) {
        return uid ? (this.list.find((p) => p.uid === uid) ?? null) : null;
    }

    update(uid: string, patch: Partial<Pick<SavedProfile, 'name' | 'color' | 'avatar'>>) {
        this.list = this.list.map((p) => (p.uid === uid ? { ...p, ...patch } : p));
        this.#save();
    }

    /** Forget a profile on this PC (its session is ended too). */
    remove(uid: string) {
        const p = this.list.find((x) => x.uid === uid);
        this.forget(uid);
        if (p) {
            fetch('https://api.strem.io/api/logout', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'Logout', authKey: p.key }),
            }).catch(() => {});
        }
    }

    /** Signs in to a saved profile. Resolves true on success. */
    async switchTo(uid: string, currentUid: string | null): Promise<boolean> {
        const target = this.list.find((p) => p.uid === uid);
        if (!target) return false;
        if (uid === currentUid) return true;
        this.error = null;
        this.switching = uid;

        const ok = await new Promise<boolean>((resolve) => {
            let off = () => {};
            let timer: ReturnType<typeof setTimeout>;
            const done = (success: boolean, message?: string) => {
                clearTimeout(timer);
                off();
                if (!success) this.error = message ?? 'Couldn’t switch profiles.';
                resolve(success);
            };
            timer = setTimeout(() => done(false, 'Stremio didn’t respond. Check your connection and try again.'), 20000);
            off = core.onEvent((event, args) => {
                if (event === 'UserAuthenticated') done(true);
                if (event === 'Error' && args?.source?.event === 'UserAuthenticated') {
                    done(false, 'This profile’s sign-in has expired. Log in to it again to keep using it.');
                }
            });
            core.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'LoginWithToken', token: target.key } } });
        });

        this.switching = null;
        if (ok) {
            this.list = this.list.map((p) => (p.uid === uid ? { ...p, lastUsed: Date.now() } : p));
            this.#save();
        }
        return ok;
    }
}

export const profiles = new Profiles();
