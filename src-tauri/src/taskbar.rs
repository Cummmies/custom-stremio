//! The taskbar button while a video plays (Windows), as in stremio-native:
//!
//! - a play/pause button in the window preview that shows when you hover the
//!   app on the taskbar (`ITaskbarList3::ThumbBarAddButtons`); a click comes
//!   back to the page as a `media://button` "toggle" event, like the media
//!   overlay's buttons (media_controls.rs);
//! - the playback position as the taskbar button's progress bar (yellow
//!   while paused);
//! - keeping the PC and screen awake while a video plays (`keep_awake`).
//!
//! All but the last run on the main (UI) thread, which owns the window.

#[cfg(windows)]
pub use imp::{keep_awake, set_progress, set_state};

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::sync::mpsc::{self, Sender};
    use std::sync::{Mutex, OnceLock};

    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED,
        THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON, THUMBBUTTONMASK, TBPF_NOPROGRESS, TBPF_NORMAL, TBPF_PAUSED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND};

    /// Our one thumbnail button's id.
    const BUTTON_ID: u32 = 1;
    const SUBCLASS_ID: usize = 0x5354_524d; // "STRM"
    /// Icon size; Windows scales thumbnail toolbar icons from 16 px.
    const ICON: i32 = 16;

    /// Playing: Some(paused); no video: None.
    static STATE: Mutex<Option<bool>> = Mutex::new(None);
    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// Windows' "the taskbar button exists (again)" message, e.g. after Explorer restarts.
    static BUTTON_CREATED: OnceLock<u32> = OnceLock::new();

    struct Taskbar {
        list: ITaskbarList3,
        hwnd: HWND,
        added: bool,
        play: HICON,
        pause: HICON,
    }

    thread_local! {
        // COM objects and the window belong to the main thread.
        static TASKBAR: RefCell<Option<Taskbar>> = const { RefCell::new(None) };
    }

    /// Shows the play/pause button for a playing (`Some(false)`) or paused
    /// (`Some(true)`) video, or hides it and the progress bar (`None`). Main thread.
    pub fn set_state(app: &AppHandle, hwnd: isize, paused: Option<bool>) {
        *STATE.lock().unwrap_or_else(|e| e.into_inner()) = paused;
        let _ = APP.set(app.clone());
        with_taskbar(hwnd, |t| {
            update_button(t);
            let flag = match paused {
                None => TBPF_NOPROGRESS,
                Some(true) => TBPF_PAUSED,
                Some(false) => TBPF_NORMAL,
            };
            let _ = unsafe { t.list.SetProgressState(t.hwnd, flag) };
        });
    }

    /// The progress bar: `position` of `duration` seconds. Main thread.
    pub fn set_progress(hwnd: isize, position: f64, duration: f64) {
        if STATE.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
            return;
        }
        with_taskbar(hwnd, |t| {
            let total = (duration * 10.0) as u64;
            let done = ((position * 10.0) as u64).min(total);
            let _ = unsafe { t.list.SetProgressValue(t.hwnd, done, total) };
        });
    }

    fn with_taskbar(hwnd: isize, f: impl FnOnce(&mut Taskbar)) {
        TASKBAR.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                *slot = create(HWND(hwnd));
            }
            if let Some(t) = slot.as_mut() {
                ensure_added(t);
                f(t);
            }
        });
    }

    fn create(hwnd: HWND) -> Option<Taskbar> {
        unsafe {
            // Already initialised on the UI thread (OLE); this is a harmless no-op then.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let list: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
            list.HrInit().ok()?;
            let _ = BUTTON_CREATED.set(RegisterWindowMessageW(w!("TaskbarButtonCreated")));
            // Clicks on the button arrive as WM_COMMAND to the window.
            let _ = SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, 0);
            Some(Taskbar { list, hwnd, added: false, play: glyph(false)?, pause: glyph(true)? })
        }
    }

    fn ensure_added(t: &mut Taskbar) {
        if t.added {
            return;
        }
        let button = button(t);
        // Fails until Windows has made the taskbar button; tried again on each update.
        t.added = unsafe { t.list.ThumbBarAddButtons(t.hwnd, &[button]) }.is_ok();
    }

    fn update_button(t: &mut Taskbar) {
        if !t.added {
            return;
        }
        let button = button(t);
        let _ = unsafe { t.list.ThumbBarUpdateButtons(t.hwnd, &[button]) };
    }

    fn button(t: &Taskbar) -> THUMBBUTTON {
        let paused = *STATE.lock().unwrap_or_else(|e| e.into_inner());
        let mut tip = [0u16; 260];
        let text = if paused == Some(false) { "Pause" } else { "Play" };
        for (slot, unit) in tip.iter_mut().zip(text.encode_utf16()) {
            *slot = unit;
        }
        THUMBBUTTON {
            dwMask: THUMBBUTTONMASK(THB_ICON.0 | THB_TOOLTIP.0 | THB_FLAGS.0),
            iId: BUTTON_ID,
            iBitmap: 0,
            hIcon: if paused == Some(false) { t.pause } else { t.play },
            szTip: tip,
            dwFlags: if paused.is_some() { THBF_ENABLED } else { THBF_HIDDEN },
        }
    }

    unsafe extern "system" fn subclass(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if Some(&msg) == BUTTON_CREATED.get() {
            // Explorer restarted (or the button was remade): add ours again.
            TASKBAR.with(|cell| {
                if let Some(t) = cell.borrow_mut().as_mut() {
                    t.added = false;
                    ensure_added(t);
                }
            });
        } else if msg == WM_COMMAND
            && (wparam.0 >> 16) as u32 & 0xffff == THBN_CLICKED
            && wparam.0 as u32 & 0xffff == BUTTON_ID
        {
            if let Some(app) = APP.get() {
                let _ = app.emit("media://button", "toggle");
            }
            return LRESULT(0);
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    /// A white play triangle or pause bars, as a 16 px icon with alpha.
    fn glyph(pause: bool) -> Option<HICON> {
        let mut pixels = vec![0u32; (ICON * ICON) as usize];
        for y in 0..ICON {
            for x in 0..ICON {
                let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
                let inside = if pause {
                    (3.0..13.0).contains(&fy) && ((3.5..6.5).contains(&fx) || (9.5..12.5).contains(&fx))
                } else {
                    // Triangle pointing right: x from 4 to 13, y between the edges.
                    let t = (fx - 4.0) / 9.0;
                    (0.0..=1.0).contains(&t) && (fy - 8.0).abs() <= 5.5 * (1.0 - t)
                };
                if inside {
                    // Premultiplied BGRA: opaque white.
                    pixels[(y * ICON + x) as usize] = 0xffff_ffff;
                }
            }
        }
        unsafe {
            let header = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: ICON,
                biHeight: -ICON, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            };
            let info = BITMAPINFO { bmiHeader: header, ..Default::default() };
            let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
            let color: HBITMAP = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            if bits.is_null() {
                let _ = DeleteObject(color);
                return None;
            }
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());
            // The colour bitmap's alpha decides; the mask just has to exist.
            let mask = CreateBitmap(ICON, ICON, 1, 1, None);
            let icon = CreateIconIndirect(&ICONINFO {
                fIcon: BOOL(1),
                xHotspot: 0,
                yHotspot: 0,
                hbmMask: mask,
                hbmColor: color,
            });
            let _ = DeleteObject(color);
            let _ = DeleteObject(mask);
            icon.ok()
        }
    }

    /// Keeps the PC and its screen awake while `true` (a video playing), like
    /// stremio-native's sleep inhibitor. Windows ties the request to the thread
    /// that makes it, so one thread of its own makes and ends it.
    pub fn keep_awake(awake: bool) {
        static WAKE: OnceLock<Mutex<Sender<bool>>> = OnceLock::new();
        let sender = WAKE.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<bool>();
            std::thread::Builder::new()
                .name("keep awake".into())
                .spawn(move || {
                    let mut held = false;
                    for awake in rx {
                        if awake == held {
                            continue;
                        }
                        held = awake;
                        unsafe {
                            SetThreadExecutionState(if awake {
                                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                            } else {
                                ES_CONTINUOUS
                            });
                        }
                    }
                })
                .expect("keep-awake thread");
            Mutex::new(tx)
        });
        let _ = sender.lock().unwrap_or_else(|e| e.into_inner()).send(awake);
    }
}
