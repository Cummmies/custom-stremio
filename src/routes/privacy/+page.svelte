<script lang="ts">
    // The Privacy Policy, in plain words: what the app and its server keep, why,
    // who else sees it, and how to have it removed. Who runs it: lib/legal.ts.
    import LegalPage from '$lib/components/LegalPage.svelte';
    import { CONTACT, OPERATOR } from '$lib/legal';
</script>

<LegalPage title="Privacy Policy">
    <p>
        This app is run by <strong>{OPERATOR}</strong>. This page explains what it keeps about you, why, and what you can do about it.
        There are no ads, no analytics and no tracking, and nothing about you is sold.
    </p>

    <h2>Signing in</h2>
    <p>
        You sign in with your Stremio account. The app asks Stremio who you are, once, and keeps your Stremio account’s email address and ID so
        your history and lists are yours on every device. Your Stremio password never reaches the app’s server, and the sign-in key Stremio
        gives the app is used once, to bring over your watch history, and not kept (unless you turn on automatic syncing with Stremio on the
        website, which keeps it, encrypted, to sync every hour).
    </p>

    <h2>What’s kept</h2>
    <ul>
        <li><strong>Your activity:</strong> what you start and finish watching, the episode, and when.</li>
        <li><strong>What you add:</strong> statuses (Watching, Plan to Watch and so on), watches, scores, reviews, lists and their names.</li>
        <li><strong>Your devices:</strong> each signed-in device’s name and kind (for example, “iPhone”), so you can see and sign them out.</li>
        <li><strong>Preferences:</strong> such as subtitled or dubbed anime, kept with your account. Other settings stay on your device, or in your Stremio account.</li>
        <li>
            <strong>Error reports</strong>, unless you turn them off in Settings: what broke, where in the app, its version and the kind of
            device. Nothing about your account or what you watch.
        </li>
    </ul>

    <h2>Why</h2>
    <p>
        To show your library, history, calendar and lists, to work out new episodes and recommendations for you, to send the notifications you
        asked for, and to fix what breaks. Nothing is used for anything else.
    </p>

    <h2>Who else sees it</h2>
    <ul>
        <li><strong>Friends:</strong> your scores and reviews show to friends you’ve added, as your profile’s visibility allows.</li>
        <li><strong>Shared lists:</strong> anyone with a list’s link can see its name and titles, until you stop sharing it. Never your scores or history.</li>
        <li>
            <strong>Stremio</strong> keeps your Stremio library and addons, as its own privacy policy says. The addons you install are run by
            others: they see what you ask them for, such as a title’s streams.
        </li>
        <li>
            <strong>Title information and pictures</strong> come from services such as TMDb, AniList and Kitsu. They’re asked about titles, never
            about you, though your device loads pictures from them directly.
        </li>
    </ul>

    <h2>How long, and removing it</h2>
    <p>
        What you add is kept while you use the app. You can download all of it, or add a backup, in Settings → Data. To have your data
        deleted, write to <strong>{CONTACT}</strong> from your Stremio account’s email address, and it will be removed from the server.
    </p>

    <h2>Children</h2>
    <p>The app isn’t meant for children under 13, and doesn’t knowingly keep data about them.</p>

    <h2>Changes</h2>
    <p>If this policy changes, the date above changes with it.</p>

    <h2>Questions</h2>
    <p>Write to <strong>{CONTACT}</strong>.</p>
</LegalPage>
