//! Windows media overlay (System Media Transport Controls): the panel that shows
//! what's playing next to the volume flyout, and the keyboard's media keys.
//! We show the title and episode, and let its play/pause button (or the media
//! key) control the player. The page sends play/pause back to mpv itself.

use tauri::{AppHandle, WebviewWindow};

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use windows::core::HSTRING;
    use windows::Foundation::TypedEventHandler;
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

    pub fn update(app: &AppHandle, hwnd: isize, title: &str, subtitle: &str, paused: bool) -> windows::core::Result<()> {
        let controls = controls(app, hwnd)?;
        controls.SetIsEnabled(true)?;
        controls.SetPlaybackStatus(if paused { MediaPlaybackStatus::Paused } else { MediaPlaybackStatus::Playing })?;
        let display = controls.DisplayUpdater()?;
        display.SetType(MediaPlaybackType::Video)?;
        let video = display.VideoProperties()?;
        video.SetTitle(&HSTRING::from(title))?;
        video.SetSubtitle(&HSTRING::from(subtitle))?;
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
pub fn media_update(app: AppHandle, window: WebviewWindow, title: String, subtitle: String, paused: bool) {
    #[cfg(windows)]
    {
        let Some(hwnd) = imp::hwnd(&window) else { return };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = imp::update(&handle, hwnd, &title, &subtitle, paused) {
                eprintln!("media controls: {e}");
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, window, title, subtitle, paused);
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
