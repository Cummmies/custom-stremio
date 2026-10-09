// Stremio's release dates are calendar days written as midnight UTC
// ("2026-10-09T00:00:00.000Z", the next episodes a second later each, to keep
// their order). Read in this device's time zone they'd fall a day early west
// of UTC, so a moment in the first hour of a UTC day is shown as that day;
// anything else is a real moment, shown here.

/** "Oct 9, 2026" (or as `opts` says) for a Stremio release date; null without a usable one. */
export function releasedDate(
    iso: string | null | undefined,
    opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const dayOnly = d.getUTCHours() === 0;
    return d.toLocaleDateString(undefined, dayOnly ? { ...opts, timeZone: 'UTC' } : opts);
}
