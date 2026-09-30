// Desktop: embedded libmpv, Stremio's streaming server, Discord, the Windows
// media overlay and window modes. iOS plays with MPVKit (plugins/mpv) and has
// no streaming server, so torrents aren't playable there; debrid links are.
#[cfg_attr(desktop, allow(dead_code))]
mod art;
#[cfg(desktop)]
mod discord;
#[cfg(desktop)]
mod media_controls;
#[cfg(desktop)]
mod player;
#[cfg(desktop)]
mod server;
mod skips;
mod storage;
// Wired up on iOS only (the desktop app has the full updater); compiled
// everywhere so desktop builds catch mistakes in it.
#[cfg_attr(desktop, allow(dead_code))]
mod web_update;
#[cfg(desktop)]
mod window_modes;

#[cfg(desktop)]
use server::{ServerStatus, StreamingServer};
#[cfg(desktop)]
use std::sync::Arc;
#[cfg(desktop)]
use tauri::{Manager, RunEvent};

#[cfg(desktop)]
#[tauri::command]
fn server_status(server: tauri::State<'_, Arc<StreamingServer>>) -> ServerStatus {
    server.status()
}

/// No streaming server on mobile: the app says so instead of waiting for one.
#[cfg(mobile)]
#[tauri::command]
fn server_status() -> serde_json::Value {
    serde_json::json!({ "state": "missing", "message": "Torrents play in the desktop app. Debrid links play here." })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    run_desktop();
    #[cfg(mobile)]
    run_mobile();
}

#[cfg(mobile)]
fn run_mobile() {
    let mut context = tauri::generate_context!();
    let web = web_update::install(&mut context);
    tauri::Builder::default()
        .plugin(storage::plugin())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_mpv::init())
        .manage(storage::Storage::default())
        .manage(web)
        .invoke_handler(tauri::generate_handler![
            server_status,
            skips::skip_lookup,
            storage::storage_set,
            storage::storage_set_many,
            web_update::web_update_check,
            web_update::web_update_apply,
            web_update::web_update_confirm,
            art::art_focus,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            use tauri::Manager;
            if let tauri::RunEvent::Exit = event {
                app.state::<storage::Storage>().flush();
            }
        });
}

#[cfg(desktop)]
fn run_desktop() {
    use player::Player;
    use window_modes::WindowModes;

    // Before any window: lets Windows' media panel show our name and icon.
    #[cfg(windows)]
    media_controls::register("com.sdola.customstremio");

    tauri::Builder::default()
        // Must be first: a second launch (e.g. from a stremio:// link) hands its
        // arguments to the running app instead of opening another window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                w.unminimize().ok();
                w.set_focus().ok();
            }
        }))
        .plugin(storage::plugin())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(StreamingServer::new()))
        .manage(storage::Storage::default())
        .manage(Player::default())
        .manage(player::Thumbnailer::default())
        .manage(WindowModes::default())
        .manage(discord::Discord::default())
        .invoke_handler(tauri::generate_handler![
            server_status,
            player::mpv_start,
            player::mpv_command,
            player::mpv_set,
            player::mpv_get,
            player::mpv_stop,
            player::thumb_frame,
            player::thumb_close,
            skips::skip_lookup,
            storage::storage_set,
            storage::storage_set_many,
            window_modes::set_fullscreen,
            window_modes::is_fullscreen,
            window_modes::set_pip,
            window_modes::start_dragging,
            media_controls::media_update,
            media_controls::media_clear,
            discord::discord_set,
            discord::discord_clear,
        ])
        .setup(|app| {
            server::start(app.handle().clone());
            // Title bar and taskbar icon, set here so it's always the current logo
            // (the one compiled into the .exe can lag behind in incremental builds).
            if let (Some(window), Ok(icon)) = (
                app.get_webview_window("main"),
                tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")),
            ) {
                window.set_icon(icon).ok();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                player::shutdown(&app.state::<Player>());
                app.state::<storage::Storage>().flush();
                app.state::<Arc<StreamingServer>>().stop();
            }
        });
}
