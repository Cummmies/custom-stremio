// The audio language you prefer: the Playback setting, which is Stremio's own (it
// syncs with your account and the official apps use it too). The player picks the
// audio track by it, and Easy Mode ranks sources by it. A show's own choice
// ($lib/player/titleTracks) comes before it.
import { app } from '$lib/app.svelte';

export function audioLanguage(): string | null {
    return (app.ctx?.profile.settings.audioLanguage as string | null | undefined) ?? null;
}
