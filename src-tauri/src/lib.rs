mod server;

use server::{ServerStatus, StreamingServer};
use std::sync::Arc;
use tauri::{Manager, RunEvent};

#[tauri::command]
fn server_status(server: tauri::State<'_, Arc<StreamingServer>>) -> ServerStatus {
    server.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(StreamingServer::new()))
        .invoke_handler(tauri::generate_handler![server_status])
        .setup(|app| {
            server::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Arc<StreamingServer>>().stop();
            }
        });
}
