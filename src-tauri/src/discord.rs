//! Discord Rich Presence: "Watching Mushoku Tensei · S3 · E7" on your Discord
//! profile while something plays (Settings → Integrations, off by default).
//!
//! Discord shows the app name and icon from the Discord application whose id
//! is `CLIENT_ID` (discord.com/developers/applications → New Application, name
//! it "Stremio", upload the icon under Rich Presence → Art Assets as "logo").
//!
//! A background thread owns the connection: it connects when there's
//! something to show, reconnects if Discord starts later or restarts, and
//! spaces updates out to stay under Discord's rate limit.

use discord_rich_presence::activity::{Activity, ActivityType, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The Discord application's id (a long number). Empty = Rich Presence does nothing.
const CLIENT_ID: &str = "";

/// Discord allows 5 updates per 20 seconds.
const MIN_GAP: Duration = Duration::from_secs(4);

#[derive(Clone, Deserialize)]
pub struct Presence {
    /// "Mushoku Tensei: Jobless Reincarnation"
    title: String,
    /// "S3 · E7 · Phase Four" (empty for movies)
    subtitle: String,
    /// Poster or episode still (https).
    image: Option<String>,
    /// Seconds into the video, and its length, for Discord's progress bar.
    position: f64,
    duration: Option<f64>,
    paused: bool,
}

enum Msg {
    Set(Presence),
    Clear,
}

#[derive(Default)]
pub struct Discord(Mutex<Option<Sender<Msg>>>);

impl Discord {
    fn send(&self, msg: Msg) {
        if CLIENT_ID.is_empty() {
            return;
        }
        let mut tx = self.0.lock().unwrap();
        let sender = tx.get_or_insert_with(|| {
            let (tx, rx) = channel();
            thread::spawn(move || run(rx));
            tx
        });
        let _ = sender.send(msg);
    }
}

fn run(rx: Receiver<Msg>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut wanted: Option<Presence> = None;
    let mut last_sent = Instant::now() - MIN_GAP;
    loop {
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(msg) => {
                // Only the newest message matters.
                let mut msg = msg;
                while let Ok(newer) = rx.try_recv() {
                    msg = newer;
                }
                let wait = MIN_GAP.saturating_sub(last_sent.elapsed());
                if !wait.is_zero() {
                    thread::sleep(wait);
                    while let Ok(newer) = rx.try_recv() {
                        msg = newer;
                    }
                }
                wanted = match msg {
                    Msg::Set(p) => Some(p),
                    Msg::Clear => None,
                };
                apply(&mut client, wanted.as_ref());
                last_sent = Instant::now();
            }
            // Discord wasn't running (or restarted): try again now and then.
            Err(RecvTimeoutError::Timeout) => {
                if wanted.is_some() && client.is_none() {
                    apply(&mut client, wanted.as_ref());
                    last_sent = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    if let Some(mut c) = client {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}

fn apply(client: &mut Option<DiscordIpcClient>, presence: Option<&Presence>) {
    let Some(p) = presence else {
        if let Some(c) = client.as_mut() {
            if c.clear_activity().is_err() {
                *client = None;
            }
        }
        return;
    };
    if client.is_none() {
        let mut c = DiscordIpcClient::new(CLIENT_ID);
        if c.connect().is_err() {
            return; // Discord isn't running
        }
        *client = Some(c);
    }
    let c = client.as_mut().unwrap();

    let state = match (p.paused, p.subtitle.is_empty()) {
        (true, true) => "Paused".to_string(),
        (true, false) => format!("Paused · {}", p.subtitle),
        (false, _) => p.subtitle.clone(),
    };
    let mut activity = Activity::new()
        .activity_type(ActivityType::Watching)
        // The member list says "Watching Mushoku Tensei", not "Watching Stremio".
        .status_display_type(StatusDisplayType::Details)
        .details(p.title.clone());
    if !state.is_empty() {
        activity = activity.state(state);
    }
    let image = p.image.as_deref().filter(|u| u.starts_with("https://") && u.len() <= 256);
    let mut assets = Assets::new().small_image("logo").small_text("Stremio");
    if let Some(url) = image {
        assets = assets.large_image(url.to_string()).large_text(p.title.clone());
    }
    activity = activity.assets(assets);
    if let (false, Some(duration)) = (p.paused, p.duration) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let start = now - p.position.max(0.0) as i64;
        activity = activity.timestamps(Timestamps::new().start(start).end(start + duration as i64));
    }
    if c.set_activity(activity).is_err() {
        let _ = c.close();
        *client = None;
    }
}

/// Shows (or updates) what's playing on your Discord profile.
#[tauri::command]
pub fn discord_set(discord: tauri::State<'_, Discord>, presence: Presence) {
    discord.send(Msg::Set(presence));
}

/// Clears it (leaving the player, or turning the setting off).
#[tauri::command]
pub fn discord_clear(discord: tauri::State<'_, Discord>) {
    discord.send(Msg::Clear);
}
