// Runs before the app starts in the browser.
import '$lib/polyfills';
import type { HandleClientError } from '@sveltejs/kit';

/** Show what actually went wrong on the error page, not just "Internal Error". */
export const handleError: HandleClientError = ({ error }) => {
    console.error(error);
    const e = error as { message?: string; stack?: string } | null;
    return { message: e?.message ? `${e.message}${e.stack ? `\n\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}` : String(error) };
};
