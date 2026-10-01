<script lang="ts">
    // Log in with a code: Stremio's own way for TVs. The app gets a code and a QR
    // code from Stremio; you open the link on your phone or computer (where you're
    // logged in, or log in there), confirm, and this device is logged in. No
    // typing an email and password with a remote.
    //
    // Stremio's core does the talking (its auth_link model): Load creates the
    // code, ReadData asks whether it has been confirmed yet, and the answer is an
    // auth key to log in with.
    import { core } from '$lib/core';

    type Loadable<T> = { type: 'Loading' } | { type: 'Ready'; content: T } | { type: 'Err'; content: { type: string; content?: unknown } };
    type AuthLink = {
        code: Loadable<{ code: string; link: string; qrcode: string }> | null;
        data: Loadable<{ authKey: string }> | null;
    };

    /** How often to ask whether the code has been confirmed. */
    const POLL_MS = 3000;
    /** Codes expire; get a new one after this long. */
    const RENEW_MS = 4 * 60_000;

    let link = $state<AuthLink | null>(null);
    let loggingIn = $state(false);

    const code = $derived(link?.code?.type === 'Ready' ? link.code.content : null);
    const failed = $derived(link?.code?.type === 'Err');
    const qr = $derived.by(() => {
        const q = code?.qrcode;
        if (!q) return null;
        return /^(data:|https?:)/.test(q) ? q : `data:image/png;base64,${q}`;
    });

    function newCode() {
        core.dispatch({ action: 'Load', args: { model: 'Link' } }, 'auth_link');
    }

    $effect(() => {
        const off = core.watch<AuthLink>('auth_link', (s) => (link = s));
        newCode();
        return () => {
            off();
            core.dispatch({ action: 'Unload' }, 'auth_link');
        };
    });

    // While a code is up: ask every few seconds whether it's been confirmed, and
    // replace it before it expires.
    $effect(() => {
        if (!code || loggingIn) return;
        const poll = setInterval(() => core.dispatch({ action: 'Link', args: { action: 'ReadData' } }, 'auth_link'), POLL_MS);
        const renew = setTimeout(newCode, RENEW_MS);
        return () => {
            clearInterval(poll);
            clearTimeout(renew);
        };
    });

    // Confirmed: log in with the key it came back with.
    $effect(() => {
        const data = link?.data;
        if (data?.type !== 'Ready' || loggingIn) return;
        loggingIn = true;
        core.dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'LoginWithToken', token: data.content.authKey } } });
    });
</script>

<div class="link-login">
    {#if loggingIn}
        <p class="status">Logging in…</p>
    {:else if failed}
        <p class="status">Couldn’t get a code from Stremio.</p>
        <button type="button" class="retry" onclick={newCode}>Try Again</button>
    {:else if code}
        <div class="qr">
            {#if qr}<img src={qr} alt="QR code for the link below" />{/if}
        </div>
        <div class="steps">
            <p>Scan the code with your phone, or open</p>
            <p class="link">{code.link.replace(/^https?:\/\//, '')}</p>
            <p>and enter</p>
            <p class="code">{code.code}</p>
            <p class="small">Log in there if it asks, then confirm. This screen continues by itself.</p>
        </div>
    {:else}
        <p class="status">Getting a code…</p>
    {/if}
</div>

<style>
    .link-login {
        display: flex;
        align-items: center;
        gap: 28px;
        min-height: 200px;
    }
    .qr {
        flex: none;
        width: 200px;
        height: 200px;
        padding: 10px;
        border-radius: var(--radius-l);
        background: white;
    }
    .qr img {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
    }
    .steps p {
        margin: 0 0 6px;
        color: var(--label-2);
    }
    .link {
        color: var(--label) !important;
        font-weight: 600;
        word-break: break-all;
    }
    .code {
        color: var(--label) !important;
        font-family: var(--font-display);
        font-size: 40px;
        font-weight: 700;
        letter-spacing: 0.12em;
    }
    .small {
        font-size: 13px;
    }
    .status {
        margin: 0;
        color: var(--label-2);
    }
    .retry {
        height: 36px;
        padding: 0 18px;
        border: 0;
        border-radius: var(--radius);
        background: var(--fill);
        font-weight: 600;
        cursor: pointer;
    }
</style>
