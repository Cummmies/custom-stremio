//! Embedded mpv player. We load libmpv-2.dll at runtime (no build-time linking),
//! point mpv at the main window with `wid` so it draws video underneath the
//! transparent WebView, and forward property changes to the UI as events.

use libloading::Library;
use serde::Serialize;
use std::{
    collections::HashMap,
    env,
    ffi::{c_char, c_double, c_int, c_void, CStr, CString},
    path::PathBuf,
    ptr,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// --- libmpv C API -----------------------------------------------------------

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

const FORMAT_STRING: c_int = 1;
const EVENT_SHUTDOWN: c_int = 1;
const EVENT_END_FILE: c_int = 7;
const EVENT_FILE_LOADED: c_int = 8;
const EVENT_PLAYBACK_RESTART: c_int = 21;
const EVENT_PROPERTY_CHANGE: c_int = 22;

type Handle = *mut c_void;

pub(crate) struct Api {
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(Handle),
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut MpvEvent,
    free: unsafe extern "C" fn(*mut c_void),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    // Render API, used by the thumbnailer to draw frames into memory.
    pub(crate) render_create: unsafe extern "C" fn(*mut *mut c_void, Handle, *mut RenderParam) -> c_int,
    pub(crate) render_render: unsafe extern "C" fn(*mut c_void, *mut RenderParam) -> c_int,
    pub(crate) render_update: unsafe extern "C" fn(*mut c_void) -> u64,
    pub(crate) render_free: unsafe extern "C" fn(*mut c_void),
    _lib: Library,
}

#[repr(C)]
pub(crate) struct RenderParam {
    pub kind: c_int,
    pub data: *mut c_void,
}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

/// Where to find libmpv-2.dll: an override, our bundled copy, then Stremio installs.
fn dll_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut c = Vec::new();
    if let Ok(p) = env::var("MPV_DLL") {
        c.push(PathBuf::from(p));
    }
    if let Ok(dir) = app.path().resource_dir() {
        c.push(dir.join("lib").join("libmpv-2.dll"));
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
        let programs = PathBuf::from(local).join("Programs");
        c.push(programs.join("Stremio").join("libmpv-2.dll"));
        c.push(programs.join("LNV").join("Stremio-5").join("libmpv-2.dll"));
    }
    c
}

pub(crate) fn api(app: &AppHandle) -> Result<&'static Api, String> {
    API.get_or_init(|| {
        let path = dll_candidates(app)
            .into_iter()
            .find(|p| p.is_file())
            .ok_or("libmpv-2.dll not found. Put it in src-tauri/lib/ or install Stremio.")?;
        unsafe {
            // Resolve the DLL's own dependencies from its folder.
            #[cfg(windows)]
            let lib: Library = libloading::os::windows::Library::load_with_flags(
                &path,
                libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH,
            )
            .map_err(|e| format!("Couldn't load {}: {e}", path.display()))?
            .into();
            #[cfg(not(windows))]
            let lib = Library::new(&path).map_err(|e| e.to_string())?;

            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name).map_err(|e| format!("libmpv is missing a function: {e}"))?
                };
            }
            Ok(Api {
                create: sym!(b"mpv_create\0"),
                initialize: sym!(b"mpv_initialize\0"),
                terminate_destroy: sym!(b"mpv_terminate_destroy\0"),
                set_option_string: sym!(b"mpv_set_option_string\0"),
                command: sym!(b"mpv_command\0"),
                set_property_string: sym!(b"mpv_set_property_string\0"),
                get_property_string: sym!(b"mpv_get_property_string\0"),
                observe_property: sym!(b"mpv_observe_property\0"),
                wait_event: sym!(b"mpv_wait_event\0"),
                free: sym!(b"mpv_free\0"),
                error_string: sym!(b"mpv_error_string\0"),
                render_create: sym!(b"mpv_render_context_create\0"),
                render_render: sym!(b"mpv_render_context_render\0"),
                render_update: sym!(b"mpv_render_context_update\0"),
                render_free: sym!(b"mpv_render_context_free\0"),
                _lib: lib,
            })
        }
    })
    .as_ref()
    .map_err(Clone::clone)
}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| "argument contains a NUL byte".to_string())
}

// --- player instance --------------------------------------------------------

struct Mpv {
    api: &'static Api,
    handle: Handle,
}

// libmpv handles are thread-safe.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

impl Mpv {
    fn check(&self, code: c_int) -> Result<(), String> {
        if code >= 0 {
            Ok(())
        } else {
            Err(unsafe { CStr::from_ptr((self.api.error_string)(code)) }.to_string_lossy().into_owned())
        }
    }

    fn command(&self, args: &[String]) -> Result<(), String> {
        let owned: Vec<CString> = args.iter().map(|a| cstr(a)).collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(ptr::null());
        self.check(unsafe { (self.api.command)(self.handle, ptrs.as_mut_ptr()) })
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstr(name)?, cstr(value)?);
        self.check(unsafe { (self.api.set_property_string)(self.handle, n.as_ptr(), v.as_ptr()) })
    }

    fn get(&self, name: &str) -> Option<String> {
        let n = cstr(name).ok()?;
        unsafe {
            let p = (self.api.get_property_string)(self.handle, n.as_ptr());
            if p.is_null() {
                return None;
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            (self.api.free)(p as *mut c_void);
            Some(s)
        }
    }
}

#[derive(Default)]
pub struct Player {
    mpv: Mutex<Option<Arc<Mpv>>>,
}

#[derive(Clone, Serialize)]
struct PropEvent {
    name: String,
    value: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PlayerEvent {
    FileLoaded,
    PlaybackRestart,
    EndFile { reason: &'static str, error: Option<String> },
    Shutdown,
}

/// Properties the UI renders. Everything comes across as mpv's string form.
const OBSERVED: &[&str] = &[
    "time-pos",
    "duration",
    "pause",
    "paused-for-cache",
    "cache-buffering-state",
    "demuxer-cache-time",
    "volume",
    "mute",
    "track-list",
    "aid",
    "sid",
    "speed",
    "video-params/gamma",
    "video-params/w",
    "video-params/h",
    "hwdec-current",
    "eof-reached",
];

fn window_handle(window: &WebviewWindow) -> Result<i64, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match window.window_handle().map_err(|e| e.to_string())?.as_raw() {
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as i64),
        _ => Err("Embedded playback is only supported on Windows for now.".into()),
    }
}

fn spawn_events(app: AppHandle, mpv: Arc<Mpv>) {
    thread::spawn(move || {
        let mut last_time_emit = Instant::now() - Duration::from_secs(1);
        loop {
            let ev = unsafe { &*(mpv.api.wait_event)(mpv.handle, -1.0) };
            match ev.event_id {
                EVENT_PROPERTY_CHANGE => {
                    let prop = unsafe { &*(ev.data as *const MpvEventProperty) };
                    let name = unsafe { CStr::from_ptr(prop.name) }.to_string_lossy().into_owned();
                    let value = if prop.format == FORMAT_STRING && !prop.data.is_null() {
                        let s = unsafe { *(prop.data as *const *const c_char) };
                        (!s.is_null()).then(|| unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned())
                    } else {
                        None
                    };
                    // Position changes every frame; the UI only needs a few updates a second.
                    if name == "time-pos" {
                        if last_time_emit.elapsed() < Duration::from_millis(200) {
                            continue;
                        }
                        last_time_emit = Instant::now();
                    }
                    app.emit("mpv://prop", PropEvent { name, value }).ok();
                }
                EVENT_FILE_LOADED => {
                    app.emit("mpv://event", PlayerEvent::FileLoaded).ok();
                }
                EVENT_PLAYBACK_RESTART => {
                    app.emit("mpv://event", PlayerEvent::PlaybackRestart).ok();
                }
                EVENT_END_FILE => {
                    let end = unsafe { &*(ev.data as *const MpvEventEndFile) };
                    let reason = match end.reason {
                        0 => "eof",
                        2 => "stop",
                        3 => "quit",
                        4 => "error",
                        _ => "other",
                    };
                    let error = (end.reason == 4).then(|| {
                        unsafe { CStr::from_ptr((mpv.api.error_string)(end.error)) }.to_string_lossy().into_owned()
                    });
                    app.emit("mpv://event", PlayerEvent::EndFile { reason, error }).ok();
                }
                EVENT_SHUTDOWN => {
                    // This thread owns the final teardown: mpv forbids destroying the
                    // handle while another thread is blocked in mpv_wait_event.
                    let player = app.state::<Player>();
                    let mut slot = player.mpv.lock().unwrap();
                    if slot.as_ref().is_some_and(|m| Arc::ptr_eq(m, &mpv)) {
                        *slot = None;
                    }
                    drop(slot);
                    unsafe { (mpv.api.terminate_destroy)(mpv.handle) };
                    app.emit("mpv://event", PlayerEvent::Shutdown).ok();
                    break;
                }
                _ => {}
            }
        }
    });
}

impl Player {
    fn current(&self) -> Result<Arc<Mpv>, String> {
        self.mpv.lock().unwrap().clone().ok_or_else(|| "The player isn't running.".into())
    }
}

/// Starts mpv inside the window (if it isn't running) with the given options.
#[tauri::command]
pub fn mpv_start(
    app: AppHandle,
    window: WebviewWindow,
    player: tauri::State<'_, Player>,
    options: HashMap<String, String>,
) -> Result<(), String> {
    let mut slot = player.mpv.lock().unwrap();
    if slot.is_some() {
        return Ok(());
    }
    let api = api(&app)?;
    let handle = unsafe { (api.create)() };
    if handle.is_null() {
        return Err("mpv couldn't be created.".into());
    }
    let mpv = Arc::new(Mpv { api, handle });

    let wid = window_handle(&window)?;
    let defaults: &[(&str, String)] = &[
        ("wid", wid.to_string()),
        // Our Svelte UI is the only OSD; mpv must not grab keys or the mouse.
        ("osc", "no".into()),
        ("osd-level", "0".into()),
        ("input-default-bindings", "no".into()),
        ("input-vo-keyboard", "no".into()),
        ("input-cursor", "no".into()),
        ("cursor-autohide", "no".into()),
        ("keep-open", "yes".into()),
        ("idle", "yes".into()),
        ("force-window", "yes".into()),
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("ytdl", "no".into()),
        ("background-color", "#000000".into()),
    ];
    for (k, v) in defaults {
        let (k, v) = (cstr(k)?, cstr(v)?);
        unsafe { (api.set_option_string)(handle, k.as_ptr(), v.as_ptr()) };
    }
    for (k, v) in &options {
        let (kc, vc) = (cstr(k)?, cstr(v)?);
        let code = unsafe { (api.set_option_string)(handle, kc.as_ptr(), vc.as_ptr()) };
        if code < 0 {
            eprintln!("mpv: ignoring option {k}={v}");
        }
    }
    if let Err(e) = mpv.check(unsafe { (api.initialize)(handle) }) {
        unsafe { (api.terminate_destroy)(handle) };
        return Err(format!("mpv failed to start: {e}"));
    }
    for (i, name) in OBSERVED.iter().enumerate() {
        let n = cstr(name)?;
        unsafe { (api.observe_property)(handle, i as u64, n.as_ptr(), FORMAT_STRING) };
    }
    spawn_events(app, mpv.clone());
    *slot = Some(mpv);
    Ok(())
}

#[tauri::command]
pub fn mpv_command(player: tauri::State<'_, Player>, args: Vec<String>) -> Result<(), String> {
    player.current()?.command(&args)
}

#[tauri::command]
pub fn mpv_set(player: tauri::State<'_, Player>, name: String, value: String) -> Result<(), String> {
    player.current()?.set(&name, &value)
}

#[tauri::command]
pub fn mpv_get(player: tauri::State<'_, Player>, name: String) -> Result<Option<String>, String> {
    Ok(player.current()?.get(&name))
}

/// Stops playback and shuts mpv down; the event thread finishes the teardown.
#[tauri::command]
pub fn mpv_stop(player: tauri::State<'_, Player>) -> Result<(), String> {
    if let Ok(mpv) = player.current() {
        mpv.command(&["quit".into()]).ok();
    }
    Ok(())
}

/// Called on app exit.
pub fn shutdown(player: &Player) {
    if let Ok(mpv) = player.current() {
        mpv.command(&["quit".into()]).ok();
    }
}

// --- seek-bar thumbnails ----------------------------------------------------
//
// Same idea as thumbfast (a second, silent mpv that seeks to the hovered time),
// but it renders through libmpv's software render API straight into memory, so
// frames go to the UI without temp files or a separate process.

const RENDER_PARAM_API_TYPE: c_int = 1;
const RENDER_PARAM_SW_SIZE: c_int = 17;
const RENDER_PARAM_SW_FORMAT: c_int = 18;
const RENDER_PARAM_SW_STRIDE: c_int = 19;
const RENDER_PARAM_SW_POINTER: c_int = 20;
const RENDER_UPDATE_FRAME: u64 = 1;

struct Thumb {
    mpv: Mpv,
    ctx: *mut c_void,
    url: String,
}

unsafe impl Send for Thumb {}

impl Drop for Thumb {
    fn drop(&mut self) {
        unsafe {
            // The render context must go before the handle it belongs to.
            (self.mpv.api.render_free)(self.ctx);
            (self.mpv.api.terminate_destroy)(self.mpv.handle);
        }
    }
}

impl Thumb {
    /// Waits (on this thread) for one of the given events, up to `timeout`.
    fn wait_for(&self, ids: &[c_int], timeout: Duration) -> Result<c_int, String> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let ev = unsafe { &*(self.mpv.api.wait_event)(self.mpv.handle, 0.05) };
            if ids.contains(&ev.event_id) {
                return Ok(ev.event_id);
            }
            if ev.event_id == EVENT_END_FILE {
                let end = unsafe { &*(ev.data as *const MpvEventEndFile) };
                if end.reason == 4 {
                    return Err("The thumbnail source couldn't be opened.".into());
                }
            }
        }
        Err("Timed out".into())
    }

    fn open(api: &'static Api, url: &str) -> Result<Thumb, String> {
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("mpv couldn't be created.".into());
        }
        let mpv = Mpv { api, handle };
        let options: &[(&str, &str)] = &[
            ("vo", "libmpv"),
            ("config", "no"),
            ("terminal", "no"),
            ("load-scripts", "no"),
            ("ytdl", "no"),
            ("idle", "yes"),
            ("pause", "yes"),
            ("keep-open", "always"),
            ("aid", "no"),
            ("sid", "no"),
            ("audio", "no"),
            ("hwdec", "no"),
            ("hr-seek", "no"),
            // A small cache so hovering back over a spot doesn't refetch it.
            ("cache", "yes"),
            ("demuxer-readahead-secs", "0"),
            // Don't sit waiting to build a buffer after each seek; one frame is all we need.
            ("cache-pause", "no"),
            ("demuxer-max-bytes", "48MiB"),
            ("demuxer-max-back-bytes", "48MiB"),
            ("vd-lavc-skiploopfilter", "all"),
            ("vd-lavc-fast", "yes"),
            ("vd-lavc-threads", "2"),
            ("network-timeout", "15"),
        ];
        for (k, v) in options {
            let (k, v) = (cstr(k)?, cstr(v)?);
            unsafe { (api.set_option_string)(handle, k.as_ptr(), v.as_ptr()) };
        }
        if let Err(e) = mpv.check(unsafe { (api.initialize)(handle) }) {
            unsafe { (api.terminate_destroy)(handle) };
            return Err(e);
        }

        let sw = cstr("sw")?;
        let mut params = [
            RenderParam { kind: RENDER_PARAM_API_TYPE, data: sw.as_ptr() as *mut c_void },
            RenderParam { kind: 0, data: ptr::null_mut() },
        ];
        let mut ctx: *mut c_void = ptr::null_mut();
        if let Err(e) = mpv.check(unsafe { (api.render_create)(&mut ctx, handle, params.as_mut_ptr()) }) {
            unsafe { (api.terminate_destroy)(handle) };
            return Err(format!("Thumbnail renderer unavailable: {e}"));
        }

        let thumb = Thumb { mpv, ctx, url: url.to_string() };
        thumb.mpv.command(&["loadfile".into(), url.into()])?;
        thumb.wait_for(&[EVENT_FILE_LOADED], Duration::from_secs(20))?;
        Ok(thumb)
    }

    /// Seeks to `time` and returns [width u32 LE][height u32 LE][RGBA pixels]:
    /// the nearest keyframe (quick, while the pointer moves) or, with `exact`,
    /// the frame at that time (once it stops; see thumbnails.ts).
    fn frame(&self, time: f64, width: u32, exact: bool) -> Result<Vec<u8>, String> {
        let mode = if exact { "absolute+exact" } else { "absolute+keyframes" };
        self.mpv.command(&["seek".into(), format!("{time:.2}"), mode.into()])?;

        // mpv won't report the seek as finished until its output has taken the
        // new frame, so keep draining frames while we wait for that event.
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut restarted = false;
        loop {
            if Instant::now() > deadline {
                return Err("Timed out".into());
            }
            let ev = unsafe { &*(self.mpv.api.wait_event)(self.mpv.handle, 0.005) };
            if ev.event_id == EVENT_PLAYBACK_RESTART {
                restarted = true;
            }
            let fresh = unsafe { (self.mpv.api.render_update)(self.ctx) } & RENDER_UPDATE_FRAME != 0;
            if restarted {
                break;
            }
            if fresh {
                // Render (and discard) to let mpv advance to the seeked frame.
                self.render(16)?;
            }
        }
        self.render(width)
    }

    fn render(&self, width: u32) -> Result<Vec<u8>, String> {
        let dw: f64 = self.mpv.get("video-params/dw").and_then(|v| v.parse().ok()).unwrap_or(16.0);
        let dh: f64 = self.mpv.get("video-params/dh").and_then(|v| v.parse().ok()).unwrap_or(9.0);
        let w = width.clamp(64, 640) as i32;
        let h = (((w as f64) * dh / dw).round() as i32 / 2 * 2).max(2);

        let mut size = [w, h];
        let format = cstr("rgb0")?;
        let mut stride: usize = w as usize * 4;
        let mut pixels = vec![0u8; stride * h as usize];
        let mut params = [
            RenderParam { kind: RENDER_PARAM_SW_SIZE, data: size.as_mut_ptr() as *mut c_void },
            RenderParam { kind: RENDER_PARAM_SW_FORMAT, data: format.as_ptr() as *mut c_void },
            RenderParam { kind: RENDER_PARAM_SW_STRIDE, data: &mut stride as *mut usize as *mut c_void },
            RenderParam { kind: RENDER_PARAM_SW_POINTER, data: pixels.as_mut_ptr() as *mut c_void },
            RenderParam { kind: 0, data: ptr::null_mut() },
        ];
        self.mpv.check(unsafe { (self.mpv.api.render_render)(self.ctx, params.as_mut_ptr()) })?;

        // rgb0 → rgba (the 4th byte is padding).
        for px in pixels.chunks_exact_mut(4) {
            px[3] = 255;
        }
        let mut out = Vec::with_capacity(8 + pixels.len());
        out.extend_from_slice(&(w as u32).to_le_bytes());
        out.extend_from_slice(&(h as u32).to_le_bytes());
        out.extend_from_slice(&pixels);
        Ok(out)
    }
}

#[derive(Default)]
pub struct Thumbnailer {
    inner: Mutex<Option<Thumb>>,
}

/// Returns a thumbnail of `url` at `time` seconds (opening the source on first use).
/// Runs off the main thread: seeking a network stream can take a moment.
#[tauri::command(async)]
pub fn thumb_frame(
    app: AppHandle,
    thumbs: tauri::State<'_, Thumbnailer>,
    url: String,
    time: f64,
    width: u32,
    exact: Option<bool>,
) -> Result<tauri::ipc::Response, String> {
    let mut slot = thumbs.inner.lock().unwrap();
    if slot.as_ref().map(|t| t.url != url).unwrap_or(true) {
        *slot = None;
        *slot = Some(Thumb::open(api(&app)?, &url)?);
    }
    let bytes = slot.as_ref().unwrap().frame(time, width, exact.unwrap_or(false))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command(async)]
pub fn thumb_close(thumbs: tauri::State<'_, Thumbnailer>) {
    *thumbs.inner.lock().unwrap() = None;
}
