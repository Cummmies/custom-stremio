//! mpv on iOS. The player itself is Swift (ios/Sources/MpvPlugin), built on
//! MPVKit; the web side calls it as `plugin:mpv|start`, `|command`, `|set`,
//! `|get` and `|stop`, and hears `prop` and `event` back, the same shape as the
//! desktop player's `mpv_*` commands and `mpv://` events (src/player.rs).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mpv);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mpv")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_mpv)?;
            Ok(())
        })
        .build()
}
