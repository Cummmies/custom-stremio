// Shared sizes for Home's rows.
import { isTV } from '$lib/platform';

/** A row of 16:9 cards (Continue Watching, and catalogs whose items are landscape). */
export const WIDE_ITEM_WIDTH = isTV ? '300px' : 'clamp(240px, 21vw, 320px)';
