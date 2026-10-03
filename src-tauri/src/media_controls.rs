//! Windows media overlay (System Media Transport Controls): the panel that shows
//! what's playing next to the volume flyout, and the keyboard's media keys.
//! We show the title, episode and a picture, the position on a timeline you can
//! drag, and play/pause, next episode and stop. Each comes back to the page as a
//! `media://button` ("play", "pause", "toggle", "next", "stop") or `media://seek`
//! (seconds) event; the page acts on mpv itself.
//!
//! While a video plays, the PC and screen are kept awake, and the taskbar
//! button gets a play/pause button and a progress bar (taskbar.rs), as in
//! stremio-native.
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
    use windows::Foundation::TimeSpan;
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
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
        controls.SetIsStopEnabled(true)?;
        let buttons = app.clone();
        controls.ButtonPressed(&TypedEventHandler::new(
            move |_, args: &Option<SystemMediaTransportControlsButtonPressedEventArgs>| {
                if let Some(args) = args {
                    let button = args.Button()?;
                    let action = if button == SystemMediaTransportControlsButton::Play {
                        "play"
                    } else if button == SystemMediaTransportControlsButton::Pause {
                        "pause"
                    } else if button == SystemMediaTransportControlsButton::Next {
                        "next"
                    } else if button == SystemMediaTransportControlsButton::Stop {
                        "stop"
                    } else {
                        return Ok(());
                    };
                    let _ = buttons.emit("media://button", action);
                }
                Ok(())
            },
        ))?;
        // Dragging the overlay's timeline.
        let seeks = app.clone();
        controls.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_, args: &Option<PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(args) = args {
                    let seconds = args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
                    let _ = seeks.emit("media://seek", seconds);
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
        can_next: bool,
    ) -> windows::core::Result<()> {
        let controls = controls(app, hwnd)?;
        controls.SetIsEnabled(true)?;
        controls.SetIsNextEnabled(can_next)?;
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

    /// The overlay's timeline: where playback is, out of how long.
    pub fn timeline(app: &AppHandle, hwnd: isize, position: f64, duration: f64) -> windows::core::Result<()> {
        let controls = controls(app, hwnd)?;
        let span = |seconds: f64| TimeSpan { Duration: (seconds.max(0.0) * 10_000_000.0) as i64 };
        let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
        timeline.SetStartTime(span(0.0))?;
        timeline.SetMinSeekTime(span(0.0))?;
        timeline.SetEndTime(span(duration))?;
        timeline.SetMaxSeekTime(span(duration))?;
        timeline.SetPosition(span(position.min(duration)))?;
        controls.UpdateTimelineProperties(&timeline)
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
    pub fn register(aumid: &str, icon_path: Option<&std::path::Path>, shortcut_icon: Option<&std::path::Path>) {
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(aumid));
        }
        let Ok(key) = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{aumid}")) else { return };
        let _ = key.set_string("DisplayName", super::DISPLAY_NAME);
        if let Some(icon) = icon_path {
            let _ = key.set_string("IconUri", icon.to_string_lossy().as_ref());
        }

        // The media panel only takes the name and icon from a Start menu shortcut
        // carrying the same AUMID. Keep one pointing at this .exe (rewritten only
        // when the .exe moves, e.g. after an update or a new build location).
        let Ok(exe) = std::env::current_exe() else { return };
        let exe = exe.to_string_lossy().into_owned();
        // Windows caches shortcut icons by file, so a new icon gets a new file name.
        let icon = shortcut_icon.map_or_else(|| exe.clone(), |p| p.to_string_lossy().into_owned());
        let marker = format!("{exe}|{icon}");
        let Some(programs) = std::env::var_os("APPDATA").map(|d| {
            std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs")
        }) else {
            return;
        };
        let lnk = programs.join(format!("{}.lnk", super::DISPLAY_NAME));
        if lnk.exists() && key.get_string("Shortcut").is_ok_and(|s| s == marker) {
            return;
        }
        let aumid = aumid.to_owned();
        // Its own thread and COM apartment, so startup doesn't wait and the UI
        // thread's COM setup is left alone.
        std::thread::spawn(move || {
            let written = write_shortcut(&lnk, &exe, &icon, &aumid);
            match &written {
                Ok(()) => eprintln!("media controls: Start menu shortcut written: {}", lnk.display()),
                Err(e) => eprintln!("media controls: couldn't write the Start menu shortcut {}: {e}", lnk.display()),
            }
            if written.is_ok() {
                if let Ok(key) = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{aumid}")) {
                    let _ = key.set_string("Shortcut", &marker);
                }
            }
        });
    }

    fn write_shortcut(lnk: &std::path::Path, exe: &str, icon: &str, aumid: &str) -> windows::core::Result<()> {
        use windows::core::{Interface, PWSTR};
        use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
        use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, VT_LPWSTR,
        };
        use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)?;
            let result = (|| {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&HSTRING::from(exe))?;
                link.SetIconLocation(&HSTRING::from(icon), 0)?;
                if let Some(dir) = std::path::Path::new(exe).parent() {
                    link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
                }

                // A VT_LPWSTR PROPVARIANT borrowing `id` (not freed with PropVariantClear).
                let id: Vec<u16> = aumid.encode_utf16().chain(Some(0)).collect();
                let mut value = PROPVARIANT::default();
                let inner = &mut *value.Anonymous.Anonymous;
                inner.vt = VT_LPWSTR;
                inner.Anonymous.pwszVal = PWSTR(id.as_ptr() as *mut u16);
                let store: IPropertyStore = link.cast()?;
                store.SetValue(&PKEY_AppUserModel_ID, &value)?;
                store.Commit()?;

                let file: IPersistFile = link.cast()?;
                file.Save(&HSTRING::from(lnk.as_os_str()), true)
            })();
            CoUninitialize();
            result
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

/// Shows (or updates) what's playing in the Windows media overlay, the taskbar
/// button's play/pause, and keeps the PC awake while it plays.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn media_update(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    subtitle: String,
    image: Option<String>,
    paused: bool,
    can_next: Option<bool>,
) {
    #[cfg(windows)]
    {
        let Some(hwnd) = imp::hwnd(&window) else { return };
        crate::taskbar::keep_awake(!paused);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let image = image.as_deref().filter(|u| u.starts_with("http"));
            if let Err(e) = imp::update(&handle, hwnd, &title, &subtitle, image, paused, can_next.unwrap_or(false)) {
                eprintln!("media controls: {e}");
            }
            crate::taskbar::set_state(&handle, hwnd, Some(paused));
        });
    }
    #[cfg(not(windows))]
    let _ = (app, window, title, subtitle, image, paused, can_next);
}

/// The position: the overlay's timeline and the taskbar button's progress bar.
#[tauri::command]
pub fn media_timeline(app: AppHandle, window: WebviewWindow, position: f64, duration: f64) {
    #[cfg(windows)]
    {
        if !(duration > 0.0) || !position.is_finite() {
            return;
        }
        let Some(hwnd) = imp::hwnd(&window) else { return };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = imp::timeline(&handle, hwnd, position, duration) {
                eprintln!("media controls: {e}");
            }
            crate::taskbar::set_progress(hwnd, position, duration);
        });
    }
    #[cfg(not(windows))]
    let _ = (app, window, position, duration);
}

/// Removes the app from the Windows media overlay and the taskbar button's
/// controls, and lets the PC sleep again (leaving the player).
#[tauri::command]
pub fn media_clear(app: AppHandle, window: WebviewWindow) {
    #[cfg(windows)]
    {
        crate::taskbar::keep_awake(false);
        let hwnd = imp::hwnd(&window);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = imp::clear();
            if let Some(hwnd) = hwnd {
                crate::taskbar::set_state(&handle, hwnd, None);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, window);
}

/// Call at the very start, before any window is created (Windows only).
#[cfg(windows)]
pub fn register(aumid: &str) {
    use std::path::PathBuf;
    const PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");
    const ICO: &[u8] = include_bytes!("../icons/icon.ico");

    // Windows wants the icons as files on disk; keep copies next to our data,
    // named by content so a changed icon is a new file (see the shortcut above).
    let dir = std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(aumid));
    let save = |name: &str, bytes: &[u8]| -> Option<PathBuf> {
        let dir = dir.as_ref()?;
        std::fs::create_dir_all(dir).ok()?;
        let path = dir.join(format!("{name}-{:016x}.{}", fnv1a(bytes), if name == "app-icon" { "ico" } else { "png" }));
        if !path.exists() {
            std::fs::write(&path, bytes).ok()?;
        }
        Some(path)
    };
    let png = save("media-icon", PNG);
    let ico = save("app-icon", ICO);
    imp::register(aumid, png.as_deref(), ico.as_deref());
}

#[cfg(windows)]
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}
