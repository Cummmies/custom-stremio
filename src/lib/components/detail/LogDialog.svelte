<script lang="ts" module>
    export type LogMode = 'rate' | 'watch' | 'edit';
    export type LogDraft = { score: number | null; date: string | null; review: string };
</script>

<script lang="ts">
    // Your score, or a watch to log or change, as Lightboxd's own Log Watch
    // form has it: score (optional; the wheel moves it a tenth), watch date
    // (optional; never after today or before the title was out, which
    // Lightboxd works out (earliest); out-of-range dates move to the nearest
    // allowed one; the wheel moves it a day) and review. Whether it's a
    // rewatch is Lightboxd's to say (every watch after your first), so it's in
    // the heading, not a switch. Editing a watch can also delete it.
    //
    // A modal <dialog>: focus stays inside, Escape (the TV remote's Back)
    // closes it. PC: Cancel and Save at the bottom right. iPhone: a sheet from
    // the bottom with Cancel and Save in its top bar (HIG, Sheets). TV: the
    // date is a stepper the remote's Left/Right move, not a date field.
    import ScoreSlider from '$lib/components/ScoreSlider.svelte';
    import ReviewField from '$lib/components/ReviewField.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import { isTV } from '$lib/platform';
    import { untrack } from 'svelte';

    let {
        mode,
        rewatch = false,
        name,
        year,
        poster,
        earliest,
        initial,
        busy = false,
        error = null,
        onsave,
        ondelete,
        onclose,
        title,
    }: {
        mode: LogMode;
        /** It is (or would be) a rewatch. */
        rewatch?: boolean;
        name: string;
        year: string | null;
        poster: string | null;
        /** yyyy-mm-dd: the earliest a watch can be (Lightboxd's). */
        earliest: string | null;
        initial: LogDraft;
        busy?: boolean;
        error?: string | null;
        onsave: (d: LogDraft) => void;
        ondelete?: () => void;
        onclose: () => void;
        /** The heading, when it's not a whole title's (an episode's: "Rate Episode"). */
        title?: string;
    } = $props();

    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = iso(new Date());
    // The form starts from these once; later changes to `initial` don't reset it.
    const start = untrack(() => initial);
    let hasScore = $state(start.score != null);
    let score = $state(start.score ?? 5);
    let date = $state(start.date ?? '');
    let review = $state(start.review);
    /** Delete asks once more before it goes. */
    let confirmDelete = $state(false);

    let dialog = $state<HTMLDialogElement>();
    $effect(() => {
        dialog?.showModal();
        // Start on the score (or Add a Score): what people come here to set.
        dialog?.querySelector<HTMLElement>('input[type="range"], .empty')?.focus();
    });

    const heading = $derived(
        title ?? (mode === 'rate' ? 'Your Rating' : mode === 'edit' ? (rewatch ? 'Edit Rewatch' : 'Edit Watch') : rewatch ? 'Log Rewatch' : 'Log Watch')
    );
    const saveLabel = $derived(busy ? 'Saving…' : mode === 'edit' ? 'Save Changes' : mode === 'rate' ? 'Save' : rewatch ? 'Save Rewatch' : 'Save Watch');

    // As Lightboxd: a date outside [earliest, today] moves to the nearest end.
    const clamp = (d: string) => (d > today ? today : earliest && earliest <= today && d < earliest ? earliest : d);
    function settleDate() {
        if (date) date = clamp(date);
    }
    function stepDate(days: number) {
        const d = date ? new Date(`${date}T12:00:00`) : new Date();
        if (date) d.setDate(d.getDate() + days);
        date = clamp(iso(d));
    }
    const dateLabel = $derived(
        date ? new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'
    );
    /** Wheel up a day, down a day; from today when the date is unknown. */
    function dateWheel(e: WheelEvent) {
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        e.preventDefault();
        stepDate(e.deltaY < 0 ? 1 : -1);
    }
    /** TV: the remote's Left/Right move the date a day. */
    function dateKeys(e: KeyboardEvent) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        stepDate(e.key === 'ArrowRight' ? 1 : -1);
    }
    /** Wheel up a tenth, down a tenth (a sideways wheel does nothing). */
    function scoreWheel(e: WheelEvent) {
        if (!hasScore || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        e.preventDefault();
        score = Math.min(10, Math.max(0, Math.round((score + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    }

    function save() {
        if (busy) return;
        settleDate();
        onsave({ score: hasScore ? score : null, date: date || null, review: review.trim() });
    }
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            // Handled here, so the TV remote's Back doesn't also leave the page.
            e.preventDefault();
            onclose();
        }
    }
</script>

<dialog bind:this={dialog} class="sheet" aria-labelledby="log-heading" {onkeydown} onclick={(e) => e.target === dialog && onclose()}>
    <div class="body">
        <!-- iPhone: Cancel and Save in the sheet's top bar. -->
        <div class="toolbar">
            <button class="bar-btn" onclick={onclose}>Cancel</button>
            <span class="bar-title" aria-hidden="true">{heading}</span>
            <button class="bar-btn strong" disabled={busy} onclick={save}>{saveLabel}</button>
        </div>

        <header>
            {#if poster}<img class="poster" src={poster} alt="" />{/if}
            <div class="titles">
                <h2 id="log-heading">{heading}</h2>
                <p>{name}{year ? ` · ${year}` : ''}</p>
            </div>
        </header>

        <section class="field">
            <div class="label-row">
                <span class="label" id="log-score">Score</span>
                {#if hasScore}
                    <button class="link" onclick={() => (hasScore = false)}>No Score</button>
                {/if}
            </div>
            {#if hasScore}
                <div onwheel={scoreWheel} role="group" aria-labelledby="log-score"><ScoreSlider bind:value={score} onsubmit={save} /></div>
            {:else}
                <button class="empty" onclick={() => (hasScore = true)}>Add a Score</button>
            {/if}
        </section>

        <section class="field">
            <div class="label-row">
                <label class="label" for="log-date">Watch Date</label>
                {#if date}<button class="link" onclick={() => (date = '')}>Don’t Know</button>{/if}
            </div>
            {#if isTV}
                <div class="stepper">
                    <button class="step" onclick={() => stepDate(-1)} aria-label="Day Before"><Icon name="back" size={16} /></button>
                    <button id="log-date" class="date tv" onkeydown={dateKeys} onclick={() => !date && stepDate(0)}>{dateLabel}</button>
                    <button class="step flip" onclick={() => stepDate(1)} aria-label="Day After" disabled={date === today}><Icon name="back" size={16} /></button>
                </div>
            {:else}
                <input
                    id="log-date"
                    class="date"
                    type="date"
                    bind:value={date}
                    min={earliest ?? undefined}
                    max={today}
                    onblur={settleDate}
                    onchange={settleDate}
                    onwheel={dateWheel}
                />
                {#if !date}<span class="hint">Unknown</span>{/if}
            {/if}
        </section>

        <section class="field">
            <span class="label">Review</span>
            <ReviewField bind:value={review} onsubmit={save} />
        </section>

        {#if error}<p class="error" role="alert">{error}</p>{/if}

        <footer>
            {#if mode === 'edit' && ondelete}
                <button class="delete" disabled={busy} onclick={() => (confirmDelete ? ondelete() : (confirmDelete = true))}>
                    {confirmDelete ? 'Delete This Watch?' : 'Delete Watch'}
                </button>
            {/if}
            <button class="btn secondary" onclick={onclose}>Cancel</button>
            <button class="btn primary" disabled={busy} onclick={save}>{saveLabel}</button>
        </footer>
    </div>
</dialog>

<style>
    dialog {
        width: min(480px, calc(100vw - 32px));
        max-width: none;
        max-height: calc(100vh - 32px);
        margin: auto;
        padding: 0;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: rgb(31 31 40 / 0.94);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.55);
        color: var(--label);
        overflow-y: auto;
        animation: rise var(--fast) var(--ease);
        --score-fill: var(--label);
        --review-bg: var(--fill);
        --review-border: var(--separator);
        --review-placeholder: var(--label-2);
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.5);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
    }
    @media (prefers-reduced-transparency: reduce) {
        dialog {
            background: var(--elevated-2);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    .body {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 20px;
    }
    .toolbar {
        display: none;
    }
    header {
        display: flex;
        align-items: center;
        gap: 14px;
    }
    .poster {
        width: 48px;
        aspect-ratio: 2 / 3;
        object-fit: cover;
        border-radius: 6px;
        background: var(--elevated-2);
    }
    .titles {
        flex: 1;
        min-width: 0;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .titles p {
        margin: 2px 0 0;
        font-size: 13px;
        color: var(--label-2);
    }
    .field {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }
    .label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 28px;
    }
    .label {
        font-size: var(--text-caption);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    /* Text buttons keep a 28 px target (44 on touch). */
    .link {
        min-height: 28px;
        padding: 0 4px;
        margin-right: -4px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--label-2);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
    }
    .link:hover {
        color: var(--label);
    }
    .empty {
        height: 44px;
        border: 1px dashed var(--separator);
        border-radius: var(--radius);
        background: none;
        color: var(--label-2);
        font-weight: 600;
        cursor: pointer;
    }
    .empty:hover {
        color: var(--label);
        background: var(--fill);
    }
    .date {
        height: 36px;
        padding: 0 10px;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font: inherit;
        color-scheme: dark;
    }
    .hint {
        margin-top: -4px;
        font-size: 12px;
        color: var(--label-2);
    }
    .stepper {
        display: flex;
        gap: 8px;
    }
    .date.tv {
        flex: 1;
        cursor: pointer;
    }
    .step {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 1px solid var(--separator);
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        cursor: pointer;
    }
    .step.flip :global(svg) {
        transform: scaleX(-1);
    }
    .step:disabled {
        opacity: 0.4;
    }
    .error {
        margin: -6px 0 0;
        font-size: 13px;
        color: var(--bad);
    }
    .btn:disabled,
    .bar-btn:disabled,
    .delete:disabled {
        opacity: 0.5;
        cursor: default;
    }
    footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
    }
    .delete {
        margin-right: auto;
        min-height: 28px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--bad);
        font-weight: 600;
        cursor: pointer;
    }
    .btn {
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .btn.primary {
        background: var(--label);
        color: var(--bg);
    }
    /* TV (as tvOS): buttons stay quiet until focused; only focus lights one up. */
    :global(html.tv) .btn.primary:not(:focus) {
        background: var(--fill-hover);
        color: var(--label);
    }
    @media (pointer: coarse) {
        .btn,
        .date,
        .step {
            height: 44px;
        }
        .step {
            width: 44px;
        }
        .link,
        .delete {
            min-height: 44px;
        }
    }

    /* iPhone: a sheet from the bottom, Cancel and Save in its top bar. */
    @media (max-width: 700px) {
        dialog {
            width: 100%;
            max-height: calc(100vh - var(--safe-top, 0px) - 24px);
            margin: auto 0 0;
            border-radius: var(--radius-l) var(--radius-l) 0 0;
            border-bottom: 0;
            animation: slide var(--slow) var(--ease);
        }
        @keyframes slide {
            from {
                transform: translateY(100%);
            }
        }
        .body {
            padding: 8px 16px calc(20px + var(--safe-bottom, 0px));
        }
        .toolbar {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            margin: 0 -8px;
        }
        .bar-btn {
            min-height: 44px;
            padding: 0 8px;
            border: 0;
            background: none;
            color: var(--label);
            font-size: 17px;
            cursor: pointer;
            justify-self: start;
        }
        .bar-btn.strong {
            justify-self: end;
            font-weight: 600;
        }
        .bar-title {
            font-size: 17px;
            font-weight: 600;
        }
        header h2 {
            display: none;
        }
        footer .btn {
            display: none;
        }
        footer:not(:has(.delete)) {
            display: none;
        }
        footer .delete {
            margin: 0 auto;
        }
    }
</style>
