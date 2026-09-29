mod player;
mod server;
mod window_modes;

use player::Player;
use server::{ServerStatus, StreamingServer};
use std::sync::Arc;
use tauri::{Manager, RunEvent};
use window_modes::WindowModes;

#[tauri::command]
fn server_status(server: tauri::State<'_, Arc<StreamingServer>>) -> ServerStatus {
    server.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (e.g. from a stremio:// link) hands its
        // arguments to the running app instead of opening another window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                w.unminimize().ok();
                w.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(StreamingServer::new()))
        .manage(Player::default())
        .manage(player::Thumbnailer::default())
        .manage(WindowModes::default())
        .invoke_handler(tauri::generate_handler![
            server_status,
            player::mpv_start,
            player::mpv_command,
            player::mpv_set,
            player::mpv_get,
            player::mpv_stop,
            player::thumb_frame,
            player::thumb_close,
            window_modes::set_fullscreen,
            window_modes::is_fullscreen,
            window_modes::set_pip,
            window_modes::start_dragging,
        ])
        .setup(|app| {
            server::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                player::shutdown(&app.state::<Player>());
                app.state::<Arc<StreamingServer>>().stop();
            }
        });
}
