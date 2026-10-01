// The video player for this platform. Screens import `player` from here and
// never a specific backend, so a new platform only has to add a backend
// (see backend.ts) and pick it below.
import type { PlayerBackend } from './backend';
import { mpv } from './mpv.svelte';
import { avplay } from './avplay.svelte';
import { isTV } from '$lib/platform';

export type { PlayerBackend, PlayerEvent, Track } from './backend';

/** mpv on the desktop and iOS, Samsung's AVPlay on TVs. */
export const player: PlayerBackend = isTV ? avplay : mpv;

/** Whether this build can play video at all (the browser dev build can't). */
export { canPlay } from '$lib/platform';
