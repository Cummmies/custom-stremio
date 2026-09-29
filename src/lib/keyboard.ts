/** Arrow keys move focus between sibling cards in a row, like a native collection. */
export function arrowNav(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const card = e.currentTarget as HTMLElement;
    const next = (e.key === 'ArrowRight' ? card.nextElementSibling : card.previousElementSibling) as HTMLElement | null;
    if (next && next.tabIndex >= 0) {
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
}
