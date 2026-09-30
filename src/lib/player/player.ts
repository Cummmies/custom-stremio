// The video player for this platform. Screens import `player` from here and
// never a specific backend, so a new platform only has to add a backend
// (see backend.ts) and pick it below.
import type { PlayerBackend } from './backend';
import { mpv, inTauri } from './mpv.svelte';

export type { PlayerBackend, PlayerEvent, Track } from './backend';

/** Desktop (Windows) plays with embedded mpv. */
export const player: PlayerBackend = mpv;

/** Whether this build can play video at all (the browser dev build can't). */
export const canPlay = inTauri;
