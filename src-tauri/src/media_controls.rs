//! Windows media overlay (System Media Transport Controls): the panel that shows
//! what's playing next to the volume flyout, and the keyboard's media keys.
//! We show the title, episode and a picture, and let its play/pause button (or
//! the media key) control the player. The page sends play/pause back to mpv itself.
//!
//! Windows names the app in that panel from its AppUserModelID: `register`
//! gives the process one and records a display name and icon for it.

use tauri::{AppHandle, WebviewWindow};

/// Name shown in the media panel (and anywhere else Windows asks for our AUMID's name).
pub const DISPLAY_NAME: &str = "Stremio";

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use windows::core::HSTRING;
    use windows::Foundation::{TypedEventHandler, Uri};
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    thread_local! {
        // WinRT objects stay on the thread that made them: the main (UI) thread.
        static CONTROLS: RefCell<Option<SystemMediaTransportControls>> = const { RefCell::new(None) };
    }

    fn controls(app: &AppHandle, hwnd: isize) -> windows::core::Result<SystemMediaTransportControls> {
        if let Some(c) = CONTROLS.with(|c| c.borrow().clone()) {
            return Ok(c);
        }
        let interop: ISystemMediaTransportControlsInterop =
            windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(HWND(hwnd)) }?;
        controls.SetIsPlayEnabled(true)?;
        controls.SetIsPauseEnabled(true)?;
        let app = app.clone();
        controls.ButtonPressed(&TypedEventHandler::new(
            move |_, args: &Option<SystemMediaTransportControlsButtonPressedEventArgs>| {
                if let Some(args) = args {
                    let button = args.Button()?;
                    let action = if button == SystemMediaTransportControlsButton::Play {
                        "play"
                    } else if button == SystemMediaTransportControlsButton::Pause {
                        "pause"
                    } else {
                        return Ok(());
                    };
                    let _ = app.emit("media://button", action);
                }
                Ok(())
            },
        ))?;
        CONTROLS.with(|c| *c.borrow_mut() = Some(controls.clone()));
        Ok(controls)
    }

    pub fn update(
        app: &AppHandle,
        hwnd: isize,
        title: &str,
        subtitle: &str,
        image: Option<&str>,
        paused: bool,
    ) -> windows::core::Result<()> {
        let controls = controls(app, hwnd)?;
        controls.SetIsEnabled(true)?;
        controls.SetPlaybackStatus(if paused { MediaPlaybackStatus::Paused } else { MediaPlaybackStatus::Playing })?;
        let display = controls.DisplayUpdater()?;
        // Start clean so a picture from the last episode doesn't linger.
        display.ClearAll()?;
        display.SetType(MediaPlaybackType::Video)?;
        let video = display.VideoProperties()?;
        video.SetTitle(&HSTRING::from(title))?;
        video.SetSubtitle(&HSTRING::from(subtitle))?;
        if let Some(url) = image {
            // Windows downloads it itself.
            display.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(&Uri::CreateUri(&HSTRING::from(url))?)?)?;
        }
        display.Update()
    }

    pub fn clear() -> windows::core::Result<()> {
        if let Some(controls) = CONTROLS.with(|c| c.borrow().clone()) {
            controls.DisplayUpdater()?.ClearAll()?;
            controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
            controls.SetIsEnabled(false)?;
        }
        Ok(())
    }

    /// Gives the process our AUMID (before any window exists) and records its name
    /// and icon under HKCU, so Windows can show "Stremio" and our logo.
    pub fn register(aumid: &str, icon_path: Option<&std::path::Path>) {
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(aumid));
        }
        let Ok(key) = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{aumid}")) else { return };
        let _ = key.set_string("DisplayName", super::DISPLAY_NAME);
        if let Some(icon) = icon_path {
            let _ = key.set_string("IconUri", icon.to_string_lossy().as_ref());
        }
    }

    pub fn hwnd(window: &WebviewWindow) -> Option<isize> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Win32(h) => Some(h.hwnd.get()),
            _ => None,
        }
    }
}

/// Shows (or updates) what's playing in the Windows media overlay.
#[tauri::command]
pub fn media_update(app: AppHandle, window: WebviewWindow, title: String, subtitle: String, image: Option<String>, paused: bool) {
    #[cfg(windows)]
    {
        let Some(hwnd) = imp::hwnd(&window) else { return };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let image = image.as_deref().filter(|u| u.starts_with("http"));
            if let Err(e) = imp::update(&handle, hwnd, &title, &subtitle, image, paused) {
                eprintln!("media controls: {e}");
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, window, title, subtitle, image, paused);
}

/// Removes the app from the Windows media overlay (leaving the player).
#[tauri::command]
pub fn media_clear(app: AppHandle) {
    #[cfg(windows)]
    let _ = app.run_on_main_thread(|| {
        let _ = imp::clear();
    });
    #[cfg(not(windows))]
    let _ = app;
}

/// Call at the very start, before any window is created (Windows only).
#[cfg(windows)]
pub fn register(aumid: &str) {
    // The icon has to be a file on disk; keep a copy next to our data.
    const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");
    let icon = std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join(aumid).join("media-icon.png"));
    let icon = icon.filter(|p| {
        p.parent().is_some_and(|d| std::fs::create_dir_all(d).is_ok())
            && (std::fs::read(p).is_ok_and(|b| b == ICON) || std::fs::write(p, ICON).is_ok())
    });
    imp::register(aumid, icon.as_deref());
}
