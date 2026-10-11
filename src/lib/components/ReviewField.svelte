<script lang="ts">
    // Your tracker review, written with a score. Grows with what you write;
    // Ctrl+Enter saves.
    let {
        value = $bindable(''),
        disabled = false,
        onsubmit,
    }: { value?: string; disabled?: boolean; onsubmit?: () => void } = $props();

    /** The tracker's limit for a review sent from the app. */
    const MAX = 5000;

    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onsubmit && !disabled) {
            e.preventDefault();
            onsubmit();
        }
    }
</script>

<textarea bind:value {disabled} {onkeydown} rows="2" maxlength={MAX} placeholder="Add a review" aria-label="Review"></textarea>

<style>
    textarea {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-height: 56px;
        max-height: 160px;
        field-sizing: content;
        margin: 0;
        padding: 8px 10px;
        border: 1px solid var(--review-border, rgb(255 255 255 / 0.12));
        border-radius: 8px;
        background: var(--review-bg, rgb(255 255 255 / 0.08));
        color: inherit;
        font: inherit;
        font-size: 14px;
        line-height: 1.4;
        resize: none;
    }
    textarea::placeholder {
        color: var(--review-placeholder, rgb(255 255 255 / 0.45));
    }
    textarea:focus-visible {
        outline: none;
        border-color: rgb(255 255 255 / 0.4);
    }
    textarea:disabled {
        opacity: 0.5;
    }
    /* iPhone: 16 px or more, so Safari doesn't zoom in on focus. */
    @media (pointer: coarse) {
        textarea {
            font-size: 16px;
        }
    }
    :global(html.tv) textarea {
        min-height: 72px;
        padding: 10px 14px;
        font-size: 18px;
    }
</style>
