# The tracker integration plan

Connect this app to [the tracker](../../movie%20review/README.md), the self-hosted movie/TV/anime tracker,
so that the tracker provides your history, ratings, watchlist and calendar, and the app
tells the tracker what you watch the moment you watch it.

**Status:** All seven phases are built, on Windows, iPhone and TV. Phase 1 (the tracker: `core/devices.py`, migration 031, `/app-api/v1/*`,
the `/pair` screen and Settings > Devices, `tests/test_devices.py`); Phase 2 (`src/lib/tracker.svelte.ts`, Settings → the tracker). It started Windows-first; iPhone and TV are now built too (see "iPhone and TV").

**Decided:** the tracker connection is **per profile**: each profile pairs its own tracker account.

## Ground rules

**Server-first.** The tracker runs in one place (a PC, Docker or a home server, reached at
its network name or over Tailscale). Every device (Windows, iPhone, TV) connects to that
one server. Nothing is embedded in the app, so every device sees the same history.

**Who owns what:**

| Data | Owner | Notes |
| --- | --- | --- |
| Resume points, Continue Watching, the Stremio library | Stremio | Untouched by this work. |
| Watch history, ratings, reviews | the tracker | The app sends events; the tracker decides what becomes history. |
| Watchlist and status (watching, plan to watch, dropped…) | the tracker | |
| Calendar | the tracker | Includes dub dates and new seasons. |

The tracker's existing Stremio sync rules (`instructions/stremio_sync_plan.md` §1: add only,
deletions stick, your own logs win, progress only moves forward) apply to everything the
app sends too.

**When the server is down, the app hides the tracker quietly.** Every the tracker feature
(rows, the Calendar tab, the title-page section, the rating prompt) disappears or stays
hidden when the server can't be reached. It never shows an error card on Home and never
slows anything else down. Watch events wait in a queue and are sent once the server is back.

---

## Phase 1 — The tracker: device tokens and pairing *(the tracker repo)* — built

Today the tracker signs people in only with a session cookie plus a CSRF token. That
doesn't suit an app, and Google sign-in can't work on a TV.

1. **Migration `031_add_devices.sql`**
   - `device_tokens`: `id`, `user_id`, `name` ("Living room TV"), `platform`, `scope`
     (`app` now, `addon` for Phase 5), `token_hash` (SHA-256; the token is shown only once),
     `created_at`, `last_used_at`. Revoking deletes the row.
   - `device_pair_codes`: `code` (e.g. `K7QM-4P2X`), `poll_secret_hash`, `device_name`,
     `platform`, `expires_at` (10 min, stored in the DB like migration 019), `approved_user_id`,
     `denied`. The token is created on the first poll after approval, so it's never stored raw.
2. **Pairing flow** (the same shape as Stremio's own Link sign-in, which the app already uses in `LinkLogin.svelte`):
   1. The app calls `POST /app-api/v1/pair/start {name, platform}` and gets back `{code, pair_url, poll_secret, expires_in}`.
   2. The app shows the code and a QR code for `pair_url` (`http://<network name>:8000/pair?code=…`).
   3. You open that link on your phone or PC while signed in to the tracker. It asks: *Pair "Living room TV"?* Approving sends `POST /api/device/pair/approve` (cookie + CSRF).
   4. The app polls `POST /app-api/v1/pair/status` with its `poll_secret` in the body. Once the pairing is approved, it receives the token, exactly once.
   - Rate-limit `start` and wrong codes with `core/ratelimit.py`.
3. **A separate `/app-api/v1/*` surface** that accepts **only** `Authorization: Bearer <token>`
   and ignores cookies:
   - Because nothing is sent automatically, it needs no CSRF and can allow **any origin
     without credentials** in CORS. That matters because the app's origins are awkward:
     `http://tauri.localhost` (Windows), `tauri://localhost` (iOS) and `null` (the TV's
     `file://`). The existing cookie API's CORS settings stay exactly as they are.
   - A versioned path gives the app a stable contract while the web UI's `/api/*` keeps changing.
4. **The tracker Settings → Devices**: a list of paired devices (name, platform, last used)
   with **Revoke**.
5. Also `GET /app-api/v1/me` (the app's connection check: who it's signed in as) and
   `POST /app-api/v1/disconnect` (the app's own Disconnect).
6. Tests: pairing happy path, expiry, deny, wrong code, revoked token, a cookie on `/app-api`
   being ignored, CSRF skipped only there, CORS headers on 401s, rate limits.

## Phase 2 — App: connect to the tracker *(this repo)* — built

1. **`src/lib/tracker.svelte.ts`**: holds the server address and token **per profile on
   this device** (`localStorage` key `tracker:<uid>`, which the desktop app mirrors to
   disk like everything else), plus `status`: `off | checking | ok | unreachable | removed`.
   `ready` (status `ok`) is what later phases check before showing anything.
   - Every request gives up after 4 s and never throws into the UI. `request()` returns
     `null` on any failure and updates `status`.
   - It checks `GET /app-api/v1/me` (not `/health`, which only allows the tracker's own
     origins) when the profile is known, when the app returns to the foreground (at most
     once a minute), and every minute while `unreachable`.
   - On a 401 it drops the token but keeps the address: status `removed`, and Settings
     offers to connect again.
   - Started from `app.start()`; follows profile switches.
2. **Settings → the tracker** (only for a signed-in profile, not on iPhone or TV yet):
   - **Connect:** an address field. Left empty, the app tries `localhost:8000`, then
     the server's network name, port 8000.
   - **Pairing:** the code, with an **Open the tracker** button that opens the approval page
     in the browser. There's no QR code on the PC; it comes with the TV.
   - **Connected:** the tracker name and handle, a status line, and **Disconnect**.
   - The approval page names the device (PC, iPhone, TV); once connected, the connection is
     called "Custom Stremio" and reports its Stremio account (`POST /app-api/v1/device`).
3. **The connection follows the Stremio account** through the Settings sync addon
   (`cloudSync.svelte.ts`, part `tracker`: `{server, token, addonUrl}`). A device signed in
   to the account is connected without pairing, and the tracker's Settings > Connected Accounts
   lists the account once. The tradeoff: the token sits in the account's synced addon data, so
   someone in the Stremio account has the app's access to the tracker (not its website).
   - The first device to connect shares its token; a device that paired on its own moves to
     the account's token and revokes its own. Two connecting at once settle on the newer one.
   - It tries its own address, the account's, then the usual places with the token.
   - Removed in the tracker (a 401): the shared token is cleared, so no device tries it again.
   - **Disconnect** ends the connection on every device signed in to the account.
   - The rows' addon link is the account's too (it's made from the shared token, and Stremio
     syncs installed addons), so devices don't replace each other's.
   - Two devices reaching the tracker by different addresses (its network name vs Tailscale)
     don't keep overwriting each other's address.
   - `localhost`, `127.x` and `::1` are never shared, since they mean nothing on another device.
   - A new device's Settings fills the address in ("This profile uses the tracker on another
     device. Connect, then approve this one there too."), so it only takes Connect and an
     approval.
   - Chosen over a separate the tracker sync addon: the Settings sync is already per Stremio
     account (per profile), already merges each part by when it changed, and can be read
     before the tracker is connected, which a tracker-served addon couldn't be.
4. **Platform checks for later:**
   - **iOS:** plain `http://` to a `.local` address or a LAN IP needs
     `NSAllowsLocalNetworking` and an `NSLocalNetworkUsageDescription` (iOS asks for
     Local Network permission). Tailscale HTTPS avoids both.
   - **TV (Tizen):** the widget's `config.xml` needs network access to the server, and
     `http` to a LAN address must be allowed.

## Phase 3 — Send watch events right away — built

1. **The tracker: `POST /app-api/v1/events`** (`core/app_events.py`, `tests/test_app_events.py`)
   `{kind: "started" | "finished", type: "movie" | "series", id: "tt…" | "kitsu:…", video_id: "tt…:2:5", name, times_watched, at}`
   - It uses the sync's own functions (`apply_movie`, `apply_series_title`, and
     `EpisodePlacer`, moved out of `process_item` so both share it), so the **`stremio_imports`
     ledger keys are the same**. The poller and a push can never log the same watch twice,
     resending is harmless, and a deleted log stays deleted.
   - **Movies:** `finished` logs it, dated that day. The ledger key uses Stremio's
     times-watched count (the app reads it from the player's library record), so a rewatch
     is a new log. `started` sets it to Watching.
   - **Shows:** `finished` raises the running episode count, and the last episode of an
     ended show completes it with a log. `started` sets it to Watching. Specials don't count.
   - It returns `{result: applied | unchanged | unmatched, title_id, note, log_id, needs_rating}`.
   - It shares the sync's per-user lock. While a Stremio sync is running it answers 503 with
     `Retry-After`, and the app tries again.
   - The poller stays. It still catches what you watch in the official Stremio apps.
2. **App: when to send** (`routes/player/+page.svelte`). `started` goes a minute in.
   `finished` goes when the credits segment starts, or at 90% if the credits aren't known.
   Each is sent once per episode or movie, only for `tt…`/`kitsu:…` titles, never for error
   clips, and only while connected.
3. **Queue** (`tracker.track()`). Events are saved per profile in `localStorage`
   (`tracker-queue:<uid>`) and sent in order whenever the status is `ok`. They're kept
   while the tracker is unreachable, busy or rejecting this device, and dropped once taken or
   refused as malformed. Anything older than 30 days or beyond 200 events is dropped.
   `tracker.lastResult` holds the last applied event, for Phase 4's rating prompt.
4. **Not tested in a real player:** the browser dev build can't play video. The queue, the
   endpoint and the round trip were tested against a throwaway the tracker.

## Phase 4 — Rating prompt at the credits — built

- **When:** a `finished` event that made a new, unscored log (`needs_rating` in the reply).
  That's a movie, or the last episode of an ended show. The tracker keeps shows as a running
  count with one log at the end, so there's nothing to rate per season. An anime's seasons
  are separate AniList titles, so finishing one does ask. It only asks about what's playing
  now, and not for an event sent late from the queue (over 30 minutes old).
- **Card** (`routes/player/+page.svelte`): bottom left, clear of Skip and Up Next on the
  right. A slider scores 0–10 in tenths, as the tracker does (`components/ScoreSlider.svelte`;
  it starts at 5, like the tracker's own), with an optional review under it
  (`components/ReviewField.svelte`), then **Don't Rate**, **Rate**, and **✕** (not now).
  On TV focus starts on the slider: Left/Right move a tenth, OK rates. It says "Rated 7.4
  out of 10 in the tracker" and fades out. If the tracker can't be reached, it says the title is
  waiting on the tracker's Home.
- **The tracker:** `POST /app-api/v1/ratings/{log_id}` (`{rating, review?}`), `…/later` and `…/skip`.
  These are the same queue as Home's "Rate what you finished", so ✕ (no request) leaves the
  title there, and rating or skipping in either place clears it from both.
- **App:** `tracker.answerRating(logId, score | 'later' | 'skip', review?)`.

## Phase 5 — The tracker rows as a Stremio addon — built

1. **The tracker serves an addon** (`core/addon.py`, `tests/test_addon.py`):
   `/addon/{token}/manifest.json` and `/addon/{token}/catalog/{type}/{id}.json`.
   - **Recently Watched** (`TRACKER_ROW` in serverIds.ts): like the tracker's Home row, which is logs
     plus shows whose episode count went up, newest first and one tile per title. It shows
     "S1 E3" for a show and "★ 8" for a scored log.
   - **Airing This Week** (`TRACKER_ROW` in serverIds.ts): the calendar's next seven days in your
     sub/dub preference, one tile per title (its next release), shown as "Tomorrow · S1 E4".
   - Each row mixes movies and shows, so the catalogs have a type of their own,
     `the tracker`. Stremio shows that next to the name ("Recently Watched · the tracker"), and
     the rows stay off the Movies and Series pages.
   - Metas use IMDb IDs, or `kitsu:` (through the crossref) for anime with none, so
     Cinemeta and Kitsu fill in details and streams. Titles with neither are left out.
   - The link carries a **read-only `addon` token** (`device_tokens.scope`). An app's link
     points at the app's own token (`parent_id`, migration 032), so asking again replaces it
     and removing the device removes it. Device tokens and addon tokens don't open each
     other's endpoints.
   - CORS allows any origin there, and nothing under `/addon/` reads cookies. Catalogs can
     be cached for 60 s, the manifest for an hour.
2. **App** (`tracker.svelte.ts`): the first successful connection asks for a link
   (`POST /app-api/v1/addon`) and installs it. Settings → the tracker → **Rows on Home** turns
   them on (a fresh link) or off. Disconnect, or the tracker removing the device, uninstalls
   it. If you remove it on the Addons page, it isn't put back.
3. **Official Stremio apps:** The tracker Settings → Devices → **Stremio addon link** shows a
   link once, with Copy. It's listed under Devices as "Addon link" and turned off with Remove.
4. **When the tracker is down**, the catalogs fail and Home already leaves out rows whose
   catalogs fail or are empty (`CatalogList.svelte`). There was nothing to add.
5. **Also changed:** an episode finished in the app now stamps `watchlist.last_progress_at`
   even when that's how the show got onto the watchlist. Otherwise it was missing from
   Recently Watched, on the tracker's Home too.
6. **Worth knowing:** the addon is saved in your Stremio account, so it reaches every
   device signed in to it. A device connected through `localhost` (the tracker on that PC)
   builds the rows' link on the profile's shared address instead (its network name, say),
   if that address serves this account's rows. Rows installed through `localhost` earlier
   move over by themselves once the profile has a shared address. If there's no reachable
   shared address, they stay on `localhost` and only work on that PC. The token is in the
   URL, so it can show up in server access logs; it's read-only.

## Phase 6 — Calendar tab — built (then redesigned)

- **The tracker:** `GET /app-api/v1/calendar` (`addon.calendar_events`). It takes
  `?start=&end=` (dates, at most 62 days apart: the month view asks for a day either side
  of a month) or `?days=` (from yesterday). It returns every release of the calendar feed
  in the preferred sub/dub track, each with its Stremio ID, poster, season and episode,
  `kind` and `track`. `datetime` is a UTC moment only when the release has a time of day.
- **App** (`src/routes/calendar/+page.svelte`): a month grid in the style of the tracker's
  own calendar, with the selected day's releases beside it.
  - **Toolbar:** Today, ‹ month ›, Refresh. A note under it says where the releases come from.
  - **Day cells:** today in an accent circle, up to three chips (name and time), and
    "+N more". Selecting a day lists it on the right. **Day / Month** switches that list to
    the whole month.
  - **Each release:** poster, episode name, "S1 E5", time, and tags (Series or Season
    Premiere, Premiere, Sub/Dub). It opens the title page on that episode (`?video=`).
  - **Narrower windows:** the list goes under the grid.
  - **Phones:** iOS Calendar's month view, with day numbers and dots and the selected day
    below. Controls are 44 pt.
- **Two sources, one view.** The tracker's calendar while it's connected and reachable
  (with air times). Otherwise **Stremio's own calendar**, core's `Calendar` model: new
  episodes of the shows in your library, by date, and "Log in…" for a guest.
  - While the tracker is being checked, the page waits ("Checking the tracker…") instead of
    flashing Stremio's calendar.
  - If the tracker is set up but unreachable, the note says so in amber and Stremio's
    calendar shows.
- **Nav:** **Calendar** is always there now (top bar, TV and phone tab bar), since there's
  always a calendar to show. The tab bar's grid fits any number of tabs.

## Phase 7 — The tracker on the title page — built

- **The tracker** (`core/app_titles.py`, `tests/test_app_titles.py`):
  - `GET /app-api/v1/titles/{tt…|kitsu:…}` finds every tracker title behind the ID. An
    anime's seasons share one IMDb ID, so each one is listed. For each it returns your status
    (Watching, Watchlist, Dropped, Completed), episode count, latest score, watch count, last
    watch date, and friends' reviews with each friend's sharing settings. It never downloads
    metadata.
  - `POST /app-api/v1/watchlist` adds Plan to Watch, importing the title first (like the
    Stremio sync) if the tracker doesn't have it. A status you already set is kept.
  - `POST /app-api/v1/titles/{title_id}/rating` (`{rating, review?}`) puts your score and
    review on your latest watch log; a review left out stays, an empty one clears it. It's a
    404 before you've logged it. The summary's `rating` and `review` are that latest log's, so a
    rewatch starts unscored; `earlier_rating` (the last scored watch before it) shows as
    "Last time" and starts the slider there.
- **App:** `components/detail/TrackerCard.svelte`, the first card in Details (the column
  beside the episodes, or the Details tab in a narrow window):
  - Status line, e.g. "Watching · 12 of 62 episodes" or "Watched · Mar 14, 2025".
  - "Your score: 9 / 10".
  - **Add to Watchlist** when it isn't on your list, and **Rate** / **Change Score** (1–10)
    once it's logged.
  - Friends' reviews: avatar, name, ★ score, date, and up to four lines of review.
  - A title the tracker doesn't have gets "Not in your tracker yet" with Add to Watchlist.
  - The card isn't drawn while the tracker is unreachable, or for IDs other than `tt…`/`kitsu:…`.
- **Different from the plan:** no tracker average rating. The tracker's own figures come from
  TMDb/OMDb lookups that can download data, so the card sticks to your own data and your
  friends'.
- **Replaced by Phase 8:** the card is gone; what it showed is now part of the page itself.

## Phase 8 — Library, Lists and the title page, from the tracker — built

The tracker moves into the app's own screens instead of a card: the app looks the same, with
The tracker behind it. Without the tracker connected, everything is as before (Stremio's library,
Stremio's + and eye buttons).

- **The tracker** (`core/app_library.py`, `tests/test_app_library.py`; the summary in
  `core/app_titles.py` gained `log`, `lists`, `earliest_watch_date` and `scores`):
  - `GET /library?section=watchlist|watched|ratings`: watching then plan to watch; every watch,
    newest first; each title once by your latest score.
  - `GET /lists`, `POST /lists` `{name}`, `GET /lists/{id}`, `POST /lists/{id}/titles`
    `{id, type, name}` (imports the title if needed), `DELETE /lists/{id}/titles/{title_id}`.
    Only your own lists: someone else's, or an old ownerless one, is a 404.
  - `POST /titles/{title_id}/status` `{status}` and `DELETE /titles/{title_id}` (your
    watchlist entry, watches and list entries for it; the shared catalog row stays).
  - `POST /titles/{title_id}/watches`, `PUT /watches/{log_id}` (only the fields sent change;
    `rating: null` clears the score, `watch_date: null` makes the date unknown), `DELETE
    /watches/{log_id}`. Dates move into range as `log_watch` moves them: not after today, not
    before the title was out. Rewatch is the tracker's to say (every watch after your first).
  - `GET /titles/{title_id}/reviews`: the reviews the tracker gathers (TMDb, Trakt, AniList),
    and friends' as each shares them.
  - `GET /titles/{title_id}/related`: an anime's seasons in watch order (following prequels
    and sequels, up to 10 each way, each hop cached 6 hours like `core/related.py`) and its side
    stories, as Kitsu IDs; or a film's TMDb collection in release order. Regular TV has none.
  - The app API's CORS allows PUT now (editing a watch).
- **App** (`src/lib/tracker/api.ts` the calls, `src/lib/tracker/title.svelte.ts` a title
  page's state and actions):
  - **Library** (`routes/library`): a bar at the left in place of the title, All (grouped by
    status, the default) / Watching / Plan to Watch / Completed (by month of your last watch,
    with its date, your score and "Watched 2×") / Dropped; at the right, a Type menu
    (All / Movies / Series / Anime, styled like Sort; Movies and Series leave anime out, as the tracker does), Sort
    and Edit, laid out like the tracker's. Sort has the tracker's sorts (Recently Watched, Recently
    Added, Rating, Year, Title, Episodes, Rewatched); choosing the current one again reverses
    it, and what's missing (no date, no score) always goes last. Headings show when they mean
    something: status (All) or month (Completed) by Recently Watched, score bands by Rating.
    Edit (PC and iPhone, not TV) selects titles; a toolbar then sets their status, adds them to
    a list (or a new one) or removes them (asked once more; Stremio's copy goes too).
    `?status=…` opens one, as Continue Watching's See All does (Watching).
    The status bar's highlight slides between sections and can be dragged, as the top nav's does
    (`lib/slider.ts`, after the tracker's nav).
    On phones the status bar scrolls sideways; Type, Sort (an icon) and Edit sit under it, and
    the Edit toolbar sits on the tab bar. (`GET /library?section=titles&status=…`; Completed includes titles you've logged
    without a watchlist entry, as the tracker's own status does.)
  - **Lists** (`routes/lists`), a tab in the nav: your lists as poster stacks; one opens in
    place (`?id=`); New List.
  - **Title page:** + is Status (Plan to Watch, Watching, Completed, Dropped), your lists, New
    List… and Remove from Library… (asked once more); saving also adds to Stremio's library, a
    backup for its other apps. ★ is your score (`LogDialog`: score, date, review, as
    The tracker's Log Watch form). A movie's eye logs a watch today, or opens the dialog, and
    lists your watches to edit or delete. The scores row in the tab bar: You, Friends, AniList
    (anime) and IMDb. Reviews (Aggregate / Friends / You) and Related are tabs; Details has
    Status and Lists rows, then a Reviews box that fills the rest of the column.
  - An anime that's several the tracker titles: the first stands for the show (status, lists),
    as the tracker's own Add to Watchlist does, but each season is scored on its own: ★ asks
    which season first, and Reviews > You has a card per season.

## Signing in with Stremio — built

Connect signs in with the profile's Stremio account first; a pairing code is the fallback.

- **The tracker:** `POST /app-api/v1/pair/stremio` `{auth_key, name, platform}` (no sign-in
  needed, rate-limited like pairing). It asks Stremio whose account the key is (`getUser`) and
  finds the tracker user who connected that account in Settings > Stremio
  (`stremio_sync.user_for_stremio_account`: by Stremio's account ID, which a link now keeps,
  migration 034; an older link is matched by its email once and the ID filled in). That user
  gets this device's token (`devices.issue_token`, as an approved code would). The key is only
  used for the question, never stored. 404 when no one connected the account, 401 when Stremio
  refuses the key, 502 when Stremio can't be reached. `tests/test_stremio_signin.py`.
- **App:** `tracker.connect` tries it at each address before asking for a code. Reached but
  not connected (404): it takes a code, and Settings says to connect this Stremio account in
  The tracker's Settings to skip the code next time.
- The key travels to your own tracker, so use HTTPS (or your home network) to reach it.

## One login: the Stremio account — built

The tracker is part of Custom Stremio: signing in to Stremio in the app is signing in to
The tracker, and there's nothing else to set up. Everything the tracker does (Library, Lists, the
title page, Calendar, the rows on Home, new-episode counts) is on by default, and the app falls
back to Stremio alone whenever the tracker can't be reached.

- **The tracker:** a Stremio account it has never seen gets a tracker account the first time it
  signs in (`stremio_sync.account_for_stremio`): no password, a friends-only profile, the
  email's first part as its display name and a random `@user_…` handle (nothing public points
  back to the email). Its Stremio connection is `signin` (just the login; no key kept, so the
  hourly sync leaves it alone); linking Stremio in the tracker's Settings makes it a full,
  synced connection. Another account that already has the email is not joined to it (Stremio
  may not have verified the email): 409, and that account connects Stremio once from its own
  Settings. `APP_STREMIO_SIGNUP=0` only lets in accounts already connected. The first account
  on a new the tracker is its admin, so sign in yourself first.
- **App:** with a Stremio account signed in, the app signs in to the tracker by itself
  (`#autoSignIn`, at most every 5 minutes): at `VITE_TRACKER_SERVER` (the hosted tracker,
  set at build time), the account's address, then this PC and its network name. Not after
  Disconnect here (until Connect) or after the tracker removed the device. Rows on Home turn on
  as soon as it's connected.
- **First sign-in brings over the Stremio history** (`stremio_sync.import_once`): the
  library and watch history, pulled once in the background with the key the app signed in
  with. The key is never stored, so nothing syncs afterwards: the app sends what you watch
  from then on. Stremio's library stays a backup (+ still saves there too).
- **One sign-in, one app:** logging out of a Stremio account (or removing its profile) signs
  it out of the tracker on that device (`tracker.signOut`). The app's wording never says
  "the tracker", and Settings has no section for it at all (no address, no Disconnect, no rows
  switch: Home's rows are on, and the Home row organizer hides any). When it can't connect, the
  screens say so plainly and use the backup (Stremio). Commit subjects show in What's New, so
  they don't say it either.
- **Settings > Data** (PC and iPhone; not the TV): Download a Backup (`GET /app-api/v1/backup`,
  `core/backup.py`, the website's Export: the file on PC, the share sheet on iPhone) and
  Import a Backup (`POST /backup/import`, the website's importer: what doesn't clash is added;
  for the titles that differ, one choice for all: Keep What's Here or Use the Backup, `POST
  /backup/resolve`). An import only ever restores list entries into lists it made or found for
  you (a file's own list ids could be anyone's).

## Notifications — built

The tracker's notifications (new episodes and movies once they're out, new seasons, replies to your
reviews; friend requests stay on the website for now) come to the app through
`GET /app-api/v1/notifications` (core/app_notifications.py), worded for the app, with the title's
Stremio ID and poster. `POST /notifications/read`, `POST /notifications/{id}/read`,
`DELETE /notifications` and `DELETE /notifications/{id}` mark them read or remove them.

- **The bell** (top bar, PC and iPhone; not TV): a red count of unread. PC opens a popover; iPhone
  opens `/notifications`. Grouped Today / Yesterday / Earlier, each with the poster; tapping one
  opens the title and marks it read; ⋯ has Mark All as Read, Notification Settings and Clear All.
- **System notifications** (`src/lib/notify.svelte.ts`, Tauri's notification plugin):
  - PC: a Windows notification for each new one while the app is open (it looks every 5 minutes
    and when the window comes back); more than 3 at once become one.
  - iPhone: the app is sideloaded with a free Apple ID, so a server can't wake it (push needs a paid
    developer account). Instead it schedules a local notification for each tracked release in the
    next two weeks, at its air time (a date-only release: 9 AM that day), redone whenever it looks;
    those aren't announced again when they reach the list. Tapping one opens the title.
  - The first look on a device announces nothing (what's there isn't news).
- **Backup**: when the tracker can't be reached, the list is Stremio's new episodes for shows in your
  Stremio library (what Continue Watching's +N counts; not ones you're on or past), with
  "Couldn't connect. Using backup." under it. Read and removed are kept on the device; Clear All
  also dismisses them in Stremio. New episodes only; the iPhone keeps what it had scheduled.
- **Settings → Notifications**: Show Notifications (asks the iPhone's permission; the list's offer
  does too, once), and New Episodes and Movies / New Seasons / Replies to Your Reviews.
- The native plugin ships with the installer / `.ipa`: an app updated only over the air shows the
  list, and Settings says notifications need the latest version.

## Before release, round 1 — built

- **Sub or Dub** (Settings → Anime → New Episodes): `GET/PUT /app-api/v1/preferences`
  (`anime_track`), the same preference the website keeps (`user_profiles.anime_release_pref`).
- **New Seasons and For You rows**: two more catalogs in the rows addon (core/addon.py, manifest
  1.1.0). New Seasons: season premieres from the calendar plus new-season notifications, a month back
  to three months ahead, out first, then soonest. For You: recommend/content_based.py, as posters,
  kept 6 hours per account. The app updates its installed copy of the manifest when the version
  changes (Stremio keeps the one it installed).
- **Banner row** (Customize Home → Banner, or a row's ⋯ → Use for Banner): any row on Home,
  Automatic by default; the row's titles are fetched from its addon if Home hasn't loaded it yet.
- **Episodes on their own**: `GET/POST /app-api/v1/episodes`, `DELETE /episodes/{log_id}`
  (core/app_episodes.py). An episode log has its episode and Stremio's episode ID (`video_id`,
  migration 036); marking one watched also counts it, as the player's "finished" does. The
  episode list shows your score, a star to rate (on hover; always once rated), and a menu
  (right-click, press and hold) with Mark as Watched and Rate Episode. Ticking an episode logs it;
  unticking removes its log.
- **Shared lists**: Share on an open list makes a link (`/l/<token>`, migration 035), a plain page of
  its titles that open in Stremio; Stop Sharing makes the link stop working.
- **Error reports**: `POST /app-api/v1/errors` (no sign-in, limited per address) and unhandled server
  exceptions, counted per distinct error (core/error_reports.py, migration 037); the admin reads them
  at `GET /api/admin/errors`. The app sends uncaught errors unless Settings → Privacy → Send Error
  Reports is off.
- **Privacy Policy and Terms of Use**: `/privacy`, `/terms`, from Settings → Privacy. Who runs it, a
  contact and the date go in `src/lib/legal.ts` (brackets until filled in).
- **What's New** leaves out subjects starting with "Notes" and any that name the tracker.
- **Continue Watching** (src/lib/continueWatching.ts, `GET /app-api/v1/continue`,
  core/app_continue.py): Completed or Dropped titles leave the row; a show the tracker has you
  further along in moves on to your next episode (from its start); shows you're Watching that
  Stremio doesn't have (the last 120 days, next episode out) join after Stremio's own. An anime
  whose seasons share one IMDb ID can't be numbered as Stremio does: no next episode for it.
- **The tracker's rows** show by name only ("Recently Watched", not "· the tracker"); Customize Home
  says what each is; the Addons page leaves out the app's own addons (rows, settings sync).
- **New Seasons**: an announcement (its event_date is when it was announced) reads "Announced", or
  the month given ("Season 4 · Jul 2027"); anime sequels "New Season" / "New Movie". Only
  announcements from the last 60 days.
- **Banner**: First Row (was Automatic) is the first row on Home after Continue Watching.
- **Calmer UI**: empty states are a plain symbol, title and line (no circle); the combine suggestion
  and the notifications offer are one line with a text button and ✕; Settings rows that open a page
  are whole rows with a chevron.

## iPhone and TV — built

The tracker now runs on every device, held to Apple's guidelines (iOS for the phone, tvOS's
focus model for the TV, macOS conventions for the PC). Each device pairs on its own; the
address comes from the profile's other devices (Settings sync).

- **iPhone:**
  - `Info.ios.plist` gets `NSLocalNetworkUsageDescription`. iOS asks the first time the app
    reaches the home network, which is when you press Connect (`privacy.md`: ask only when
    the feature needs it, with a plain purpose string). Plain http was already allowed. It
    arrives with the next iPhone build, and needs no native-API bump: without it, iOS still
    asks, just without the sentence.
  - The address field uses the URL keyboard, no autocapitalize or autocorrect, Go on return,
    16 px text so iOS doesn't zoom, and stacks under its label.
  - Every control is at least 44 pt: Connect, pairing, the player's score card (`.touch`) and
    the title page's scores (`pointer: coarse`, two rows of five).
  - Only its network name is tried when no address is given, since a phone isn't running
    The tracker itself. The PC tries `localhost` first.
- **TV:**
  - Pairing shows a **QR code** of the approval link (drawn on the TV by `src/lib/qr.ts`,
    `qrcode-generator`, no network), the short address and the code in large type, as
    Stremio's own TV sign-in does. There's no Open button, since a TV has no browser to hand
    off to.
  - Focus: the remote's spatial navigation reaches every control as is. When Connect gives
    way to the pairing screen, focus goes to Cancel. `focus-and-selection.md` allows moving
    focus when the focused item disappears. The player's score card takes focus as Up Next
    does (only when you're not in the controls), on Not now, so no score is pre-chosen.
  - TV safe area (60 at the sides) for the card and the Calendar. The Calendar's day list
    scrolls with the page instead of in its own column.
- **Generic-UI pass:**
  - The Calendar's pill row (episode, time and tag each in a capsule, tags in the accent
    color) became a TV-listings line: "S1 E5 · Chapter 5", premiere or Sub/Dub as plain
    semibold text, and the air time in a right-hand column.
  - The notes that explained the feature were cut to what's true and short ("From
    The tracker", "Shows in your library").
  - Button and title text use title case (Get New Code, Code Expired). The copy names the
    device ("approve this TV").
- **Not checked on hardware:** the iPhone permission prompt, its network name resolving on
  the TV, and scanning the QR code with a phone camera. The browser build can't stand in for
  those.

## Later, maybe

- **Brand name and email (pinned 2026-10-10):** the Privacy Policy and Terms say "Custom Stremio"
  and `support@customstremio.example` (src/lib/legal.ts) as placeholders. Before a public release:
  the app's own name (not "Stremio": it would look like the official app), a domain, and a real
  support address.
- **Windows:** "Start the tracker for me" if it's installed on the same PC, as a convenience
  only. It's still the same server-first model.
- **The tracker → Stremio** watched marks (one direction only, as `stremio_sync_plan.md`
  already says).
- **Open to anyone with a Stremio account** (decided 2026-10-07): sign-up stays on.
- **Removing data for deleted Stremio accounts:** Stremio tells no one when an account is
  deleted, and the tracker can't ask without the account's key (not kept; and a key also stops
  working on a plain log-out, so a dead key doesn't mean a deleted account). So: an account
  unused from every device for a long while (6 months?) is deleted with its data.
  **Pinned (2026-10-07): nothing deletes account data for now.**
- **API keys and caching, before many people use it:** TMDb, OMDb and AniList keys are the
  server's, shared by everyone, and so are their rate limits. Only what the tracker itself fetches is
  in question (title details, scores, reviews, related titles, episodes and air dates,
  stills); catalogs and streams come from addons to the app directly. Lean on the shared (canonical)
  title database as the cache, so most lookups never leave the tracker, and give heavy users or
  the server its own paid keys if needed.
- **Hosting:** Postgres instead of SQLite (the tracker already supports it), backups, and HTTPS
  with a certificate (sign-in sends the Stremio key to the tracker).
- **The tracker website:** maybe retired for everyone but its admin, once its settings
  (profile, sharing, friends, deleting your account and data) are in the app.

---

## Order and size

| Phase | Repo | Size | Usable on its own? |
| --- | --- | --- | --- |
| 1 Tokens + pairing | the tracker | M | No (foundation) |
| 2 Connect | App | M | No (foundation) |
| 3 Push events | Both | M | Yes: instant history |
| 4 Rating prompt | App (+ small API) | S | Yes |
| 5 Addon rows | the tracker (+ small app change) | S–M | Yes, in every Stremio app |
| 6 Calendar tab | App (+ small API) | M | Yes |
| 7 Title page | Both | S–M | Yes |

Phase 5 needs only the `addon` token from Phase 1, so it can come straight after Phase 1
if you want the rows first.

## Open questions

1. ~~Per profile or per device?~~ Per profile.
2. Rating prompt for series: at the end of a season (as planned), the end of the show, or never?
3. Which the tracker rating scale does the prompt show (stars, halves, 10-point)?
4. Should the Calendar tab replace something in the phone tab bar, or add a tab?
