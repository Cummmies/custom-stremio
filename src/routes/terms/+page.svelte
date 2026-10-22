<script lang="ts">
    // The Terms of Use, in plain words. Who runs the app: lib/legal.ts.
    import LegalPage from '$lib/components/LegalPage.svelte';
    import { APP_NAME, CONTACT, JURISDICTION, MIN_AGE, OPERATOR } from '$lib/legal';
</script>

<LegalPage title="Terms of Use">
    <p>
        {APP_NAME} (“the app”) is run by <strong>{OPERATOR}</strong> (“we”). By using the app or its website you agree to these terms and
        to the Privacy Policy. If you don’t agree, please don’t use them.
    </p>

    <h2>What it is</h2>
    <p>
        An app for watching through Stremio addons and keeping track of what you watch. It isn’t made by, or connected with, Stremio or the
        official Stremio apps.
    </p>

    <h2>What you watch</h2>
    <p>
        The app doesn’t host, provide or choose any video. Streams come from the addons you install, which are run by others. You’re
        responsible for what you install and watch, and for following the law where you live, including copyright.
    </p>

    <h2>Who can use it</h2>
    <p>You need to be at least {MIN_AGE}, and old enough where you live to agree to these terms (or have a parent or guardian agree for you).</p>

    <h2>Your account</h2>
    <p>
        You sign in with your Stremio account, and you’re responsible for what’s done with it. Keep it secure, and sign out of devices you no
        longer use.
    </p>

    <h2>What you add</h2>
    <p>
        Your reviews, scores, lists and profile stay yours. You let the app keep them and show them as you choose: to everyone, to friends, or
        to anyone with a link you share. Don’t post anything unlawful, hateful or harassing, or someone else’s private information, and don’t
        pretend to be someone else. Mark reviews that give a story away as spoilers. People can report what breaks these rules, and it may be
        hidden.
    </p>

    <h2>Fair use</h2>
    <p>
        Don’t try to break, overload or get around the app or its server, read other people’s data, or collect data from it automatically.
        Accounts that do, or that keep breaking these terms, may be warned or suspended for a while or for good, and content that breaks
        them may be removed. A suspension keeps your data; the app tells you until when, and why.
    </p>

    <h2>Other services</h2>
    <p>
        The app works with services run by others: Stremio for your account and library, the addons you install, and title information from
        services such as TMDb, AniList and Kitsu. Their own terms apply to them, and we aren’t responsible for them.
    </p>

    <h2>No guarantees</h2>
    <p>
        The app is provided as it is, without warranties. It may change, pause or stop, and features may come and go. As far as the law allows,
        {OPERATOR} isn’t liable for losses from using it, or from not being able to.
    </p>

    <h2>Ending</h2>
    <p>
        You can stop using the app at any time, and ask for your data to be deleted (see the Privacy Policy). Access may be ended for anyone who
        breaks these terms.
    </p>

    <h2>Governing law</h2>
    <p>These terms follow the laws of {JURISDICTION}, apart from any rule that would apply another place’s laws.</p>

    <h2>Changes</h2>
    <p>If these terms change, the date above changes with them. Big changes are announced in the app first.</p>

    <h2>Questions</h2>
    <p>Write to <strong>{CONTACT}</strong>.</p>
</LegalPage>
