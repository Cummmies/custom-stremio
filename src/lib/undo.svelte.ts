// Undo, instead of "Are you sure?", for the small things that are easy to do
// by accident (a status, a list, a watch, episodes marked watched): the action
// happens at once, and for a few seconds a bar says what happened, with Undo
// (Ctrl+Z / ⌘Z on a computer). One at a time: a new one replaces the last.

const SHOW_MS = 6000;

class UndoState {
    current = $state<{ text: string; run: (() => unknown) | null; id: number } | null>(null);
    #timer: ReturnType<typeof setTimeout> | undefined;
    #next = 0;

    /** Says what just happened; `run` takes it back (null: nothing to take back). */
    show(text: string, run: (() => unknown) | null) {
        clearTimeout(this.#timer);
        const id = ++this.#next;
        this.current = { text, run, id };
        this.#timer = setTimeout(() => {
            if (this.current?.id === id) this.current = null;
        }, SHOW_MS);
    }

    /** Just says something (no Undo): "You're offline. It'll be sent when you're back." */
    note(text: string) {
        this.show(text, null);
    }

    /** Takes back what the bar says (once). */
    undo() {
        const c = this.current;
        if (!c?.run) return;
        this.dismiss();
        void c.run();
    }

    dismiss() {
        clearTimeout(this.#timer);
        this.current = null;
    }
}

export const undo = new UndoState();
