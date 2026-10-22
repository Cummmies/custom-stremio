<script lang="ts">
    // The Privacy Policy, in plain words: what the app and its server keep, why,
    // who else sees it, and how to have it removed. Who runs it: lib/legal.ts.
    import LegalPage from '$lib/components/LegalPage.svelte';
    import { APP_NAME, CONTACT, DATA_LOCATION, MIN_AGE, OPERATOR } from '$lib/legal';
</script>

<LegalPage title="Privacy Policy">
    <p>
        {APP_NAME} (“the app”) is run by <strong>{OPERATOR}</strong> (“we”), who looks after what it keeps about you. This page explains
        what that is, why, and what you can do about it.
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
        <li><strong>What you add:</strong> statuses (Watching, Plan to Watch and so on), watches, scores, reviews (and whether you marked one as a spoiler), lists and their names.</li>
        <li>
            <strong>Your profile:</strong> your name, username, bio, picture, banner and favorites, and an optional real name. Your past
            usernames are kept for 30 days, so links to them still reach you.
        </li>
        <li><strong>People:</strong> your friends and close friends, requests, who you’ve blocked or muted, and titles you recommend to friends.</li>
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
        <li>
            <strong>Your profile, scores and reviews</strong> show as you choose in Your Profile: to everyone using the app (Everyone),
            to your friends (Friends), or to no one (Only Me); and whether scores, reviews and watch dates are included. With Everyone,
            your reviews also show on title pages to people who aren’t your friends. Your real name shows only to close friends.
        </li>
        <li>
            <strong>Links you share:</strong> anyone with a link to one of your lists or reviews can see it, until you stop sharing it. A
            friend you recommend a title to sees the recommendation and its note.
        </li>
        <li>
            <strong>Reports:</strong> if someone reports your review or profile, the app’s moderators see what was reported and the reason.
            They don’t tell you who reported it. A moderator can hide a review’s text, or remove a bio, picture or name that breaks the
            rules; you’re told when that happens.
        </li>
        <li>
            <strong>Support and moderation:</strong> the app’s moderators and admins can look up an account to help with a problem or deal
            with a report. Moderators see your profile and activity, never your email; admins also see your email and can download
            your data for you if you ask. Everything they do is recorded.
        </li>
        <li>
            <strong>Stremio</strong> keeps your Stremio library and addons, as its own privacy policy says. To mark watched in your Stremio
            library what you’ve watched here (from a backup, say), the app hands the server its Stremio sign-in for that moment; it isn’t
            kept. The addons you install are run by
            others: they see what you ask them for, such as a title’s streams.
        </li>
        <li>
            <strong>Title information and pictures</strong> come from services such as TMDb, AniList and Kitsu. They’re asked about titles, never
            about you, though your device loads pictures from them directly.
        </li>
    </ul>

    <h2>How long, and removing it</h2>
    <p>
        What you add is kept while you use the app. You can download all of it (a full backup, with your profile and friends), or bring a
        backup back, in Settings → Data. A watch you delete is kept for 30 days, so it can be brought back if you ask, then it’s gone.
        To protect against loss, the server keeps daily backup copies for a short while; a deletion reaches those as they’re replaced.
        To have your data deleted, write to <strong>{CONTACT}</strong> from your Stremio account’s
        email address, and it will be removed from the server. Signing a device out (Settings → Devices) removes its sign-in.
    </p>

    <h2>Where it’s kept, and how it’s protected</h2>
    <p>
        On the app’s server, in {DATA_LOCATION}, run by {OPERATOR}. Everything travels encrypted (HTTPS). Passwords are stored only as secure
        hashes, sign-ins on devices are kept as hashes too, and the server is backed up daily. No system is perfectly secure, but these are the
        usual protections.
    </p>

    <h2>Your rights</h2>
    <ul>
        <li><strong>See and take it:</strong> download everything in Settings → Data.</li>
        <li><strong>Correct it:</strong> change your profile, scores, reviews and lists in the app at any time.</li>
        <li><strong>Limit who sees it:</strong> your profile’s privacy (everyone, friends, or only you) and what it shares.</li>
        <li><strong>Delete it:</strong> write to <strong>{CONTACT}</strong> from your Stremio account’s email address.</li>
    </ul>
    <p>Depending on where you live, you may have more rights under your local law. Write to us and we’ll help.</p>

    <h2>Children</h2>
    <p>The app isn’t meant for children under {MIN_AGE}, and doesn’t knowingly keep data about them.</p>

    <h2>Changes</h2>
    <p>If this policy changes, the date above changes with it.</p>

    <h2>Questions</h2>
    <p>Write to <strong>{CONTACT}</strong>.</p>
</LegalPage>
