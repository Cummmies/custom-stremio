//! Uses a dark app icon while Windows is in dark mode, and swaps it live when
//! the setting changes. (The .exe's own icon is fixed at build time; the window
//! icon drives the title bar and the taskbar button while the app runs.)

use std::{thread, time::Duration};
use tauri::{image::Image, AppHandle, Manager};

const LIGHT: &[u8] = include_bytes!("../icons/icon.png");
const DARK: &[u8] = include_bytes!("../icons/icon-dark.png");

/// Windows' "Choose your mode" for the taskbar and system (not the app theme).
#[cfg(windows)]
fn system_dark() -> Option<bool> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()?;
    let light = key.get_u32("SystemUsesLightTheme").or_else(|_| key.get_u32("AppsUseLightTheme")).ok()?;
    Some(light == 0)
}

#[cfg(not(windows))]
fn system_dark() -> Option<bool> {
    None
}

fn apply(app: &AppHandle, dark: bool) {
    let Some(window) = app.get_webview_window("main") else { return };
    if let Ok(icon) = Image::from_bytes(if dark { DARK } else { LIGHT }) {
        window.set_icon(icon).ok();
    }
}

pub fn start(app: AppHandle) {
    let mut current = system_dark();
    if let Some(dark) = current {
        apply(&app, dark);
    }
    // A registry read every few seconds is effectively free and catches changes
    // without hooking the window procedure.
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(3));
        let now = system_dark();
        if now != current {
            if let Some(dark) = now {
                apply(&app, dark);
            }
            current = now;
        }
    });
}
