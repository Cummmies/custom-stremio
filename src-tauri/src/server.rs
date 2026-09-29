//! Starts Stremio's streaming server (server.js) in the background, the same way
//! the official desktop app does: run `stremio-runtime.exe server.js` hidden, wait
//! for it to report ready, and make sure it dies when this app exits.

use serde::Serialize;
use std::{
    env,
    io::{BufRead, BufReader},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 11470;
const DEFAULT_URL: &str = "http://127.0.0.1:11470/";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const READY_MARKER: &str = "EngineFS server started at ";

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ServerStatus {
    Starting,
    Ready { url: String, source: ServerSource },
    Missing { message: String },
    Failed { message: String },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerSource {
    /// Something was already listening on 11470 (e.g. the Stremio Service tray app).
    External,
    /// We launched server.js ourselves.
    Managed,
}

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    #[cfg(windows)]
    job: Option<win32job::Job>,
}

pub struct StreamingServer {
    status: Mutex<ServerStatus>,
    inner: Mutex<Inner>,
}

impl StreamingServer {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(ServerStatus::Starting),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn status(&self) -> ServerStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(mut child) = inner.child.take() {
            child.kill().ok();
            child.wait().ok();
        }
        #[cfg(windows)]
        {
            inner.job = None;
        }
    }
}

fn set_status(app: &AppHandle, status: ServerStatus) {
    let server = app.state::<Arc<StreamingServer>>();
    *server.status.lock().unwrap() = status.clone();
    app.emit("server-status", status).ok();
}

fn port_open() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn has_server(dir: &Path) -> bool {
    dir.join("stremio-runtime.exe").is_file() && dir.join("server.js").is_file()
}

/// Where to look for `stremio-runtime.exe` + `server.js`, in priority order.
fn find_server_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = env::var("STREMIO_SERVER_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    // Bundled with this app (src-tauri/server/ -> resources).
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("server"));
    }
    // Existing installs of Stremio Service / the official app.
    if let Ok(local) = env::var("LOCALAPPDATA") {
        let programs = PathBuf::from(local).join("Programs");
        candidates.push(programs.join("StremioService"));
        candidates.push(programs.join("Stremio"));
        candidates.push(programs.join("LNV").join("Stremio-5"));
    }
    candidates.into_iter().find(|dir| has_server(dir))
}

fn spawn(dir: &Path) -> std::io::Result<Child> {
    let mut command = Command::new(dir.join("stremio-runtime.exe"));
    command
        .arg(dir.join("server.js"))
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn()
}

/// Kill the server automatically if this app crashes or is force-closed.
#[cfg(windows)]
fn attach_job(child: &Child) -> Option<win32job::Job> {
    use std::os::windows::io::AsRawHandle;
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    let job = win32job::Job::create_with_limit_info(&info).ok()?;
    job.assign_process(child.as_raw_handle() as isize).ok()?;
    Some(job)
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        if port_open() {
            set_status(&app, ServerStatus::Ready { url: DEFAULT_URL.into(), source: ServerSource::External });
            return;
        }

        let Some(dir) = find_server_dir(&app) else {
            set_status(&app, ServerStatus::Missing {
                message: "No streaming server found. Install Stremio Service, or put stremio-runtime.exe + server.js in src-tauri/server/.".into(),
            });
            return;
        };

        let mut child = match spawn(&dir) {
            Ok(child) => child,
            Err(err) => {
                set_status(&app, ServerStatus::Failed { message: format!("Could not start server: {err}") });
                return;
            }
        };
        let stdout = child.stdout.take();

        {
            let server = app.state::<Arc<StreamingServer>>();
            let mut inner = server.inner.lock().unwrap();
            #[cfg(windows)]
            {
                inner.job = attach_job(&child);
            }
            inner.child = Some(child);
        }

        // Watch stdout for the ready line; keep draining it afterwards so the pipe never fills up.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<String>();
        if let Some(stdout) = stdout {
            thread::spawn(move || {
                let mut sent = false;
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if !sent {
                        if let Some(pos) = line.find(READY_MARKER) {
                            let url = line[pos + READY_MARKER.len()..].trim().trim_end_matches('/');
                            ready_tx.send(format!("{url}/")).ok();
                            sent = true;
                        }
                    }
                }
            });
        }

        let started = Instant::now();
        loop {
            if let Ok(url) = ready_rx.recv_timeout(Duration::from_millis(250)) {
                set_status(&app, ServerStatus::Ready { url, source: ServerSource::Managed });
                return;
            }
            // Fallback in case the log line format ever changes.
            if port_open() {
                set_status(&app, ServerStatus::Ready { url: DEFAULT_URL.into(), source: ServerSource::Managed });
                return;
            }
            let exited = {
                let server = app.state::<Arc<StreamingServer>>();
                let mut inner = server.inner.lock().unwrap();
                inner.child.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
            };
            if exited {
                set_status(&app, ServerStatus::Failed { message: "Streaming server exited during startup.".into() });
                return;
            }
            if started.elapsed() > STARTUP_TIMEOUT {
                set_status(&app, ServerStatus::Failed { message: "Streaming server did not start within 30s.".into() });
                return;
            }
        }
    });
}
