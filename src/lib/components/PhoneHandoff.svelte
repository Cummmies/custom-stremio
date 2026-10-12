<script lang="ts">
    // The QR code for whatever the TV is handing to your phone (lib/handoff.svelte.ts):
    // typing or rating. Closing it cancels; the phone's answer closes it by itself.
    import { phone } from '$lib/handoff.svelte';
    import QrDialog from './QrDialog.svelte';
</script>

{#if phone.current}
    {#key phone.current.id}
        <QrDialog title={phone.current.title} caption={phone.current.caption} url={phone.current.url} onclose={() => phone.cancel()} />
    {/key}
{/if}
