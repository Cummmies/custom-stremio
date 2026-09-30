//! Durable app storage (login, library, settings, profiles…).
//!
//! The web side keeps using `localStorage`, but it's only a cache: every write is
//! mirrored here to one file per key under `%APPDATA%\<identifier>\storage`, and on
//! launch those files are copied back into `localStorage` before any page script
//! runs. So data survives hard exits, and the dev build (http://localhost:1420)
//! and the installed build (a different origin, so different browser storage)
//! see the same account and settings.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Wry;

const IDENTIFIER: &str = "com.sdola.customstremio";

enum Msg {
    /// Key, value (None = removed), and the page's write counter so late arrivals can't win.
    Set(String, Option<String>, u64),
    Flush(Sender<()>),
}

pub struct Storage {
    tx: Mutex<Sender<Msg>>,
}

fn dir() -> PathBuf {
    // iOS: only the app container's Library (and Documents, tmp) is writable.
    #[cfg(target_os = "ios")]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join("Library").join("Application Support").join("storage");
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(IDENTIFIER).join("storage")
}

/// Keys are simple names ("profile", "library"…); anything else is hex-encoded.
fn file_name(key: &str) -> String {
    if !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        format!("{key}.json")
    } else {
        format!("x{}.json", key.bytes().map(|b| format!("{b:02x}")).collect::<String>())
    }
}

fn key_from_file(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".json")?;
    if let Some(hex) = stem.strip_prefix('x').filter(|h| h.len() % 2 == 0 && h.chars().all(|c| c.is_ascii_hexdigit())) {
        let bytes = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect::<Option<Vec<_>>>()?;
        return String::from_utf8(bytes).ok();
    }
    Some(stem.to_string())
}

fn load_all() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(entries) = fs::read_dir(dir()) else { return out };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if let (Some(key), Ok(value)) = (key_from_file(&name), fs::read_to_string(e.path())) {
            out.insert(key, value);
        }
    }
    out
}

fn write(key: &str, value: Option<&str>) {
    let d = dir();
    let path = d.join(file_name(key));
    match value {
        Some(v) => {
            let _ = fs::create_dir_all(&d);
            // Write then rename, so a crash mid-write never leaves a half file.
            let tmp = d.join(format!("{}.tmp", file_name(key)));
            if fs::write(&tmp, v).is_ok() {
                let _ = fs::rename(&tmp, &path);
            }
        }
        None => {
            let _ = fs::remove_file(&path);
        }
    }
}

impl Default for Storage {
    fn default() -> Self {
        let (tx, rx) = channel::<Msg>();
        std::thread::spawn(move || {
            // Coalesce bursts (the core rewrites some keys often) and keep only the latest value per key.
            let mut pending: HashMap<String, Option<String>> = HashMap::new();
            let mut latest: HashMap<String, u64> = HashMap::new();
            let mut waiters: Vec<Sender<()>> = Vec::new();
            loop {
                let first = if pending.is_empty() { rx.recv().ok() } else { rx.recv_timeout(Duration::from_millis(250)).ok() };
                match first {
                    Some(Msg::Set(k, v, seq)) => {
                        if latest.get(&k).is_some_and(|&s| s > seq) {
                            continue;
                        }
                        latest.insert(k.clone(), seq);
                        pending.insert(k, v);
                        continue;
                    }
                    Some(Msg::Flush(w)) => waiters.push(w),
                    None if pending.is_empty() => return, // channel closed
                    None => {}
                }
                for (k, v) in pending.drain() {
                    write(&k, v.as_deref());
                }
                for w in waiters.drain(..) {
                    let _ = w.send(());
                }
            }
        });
        Self { tx: Mutex::new(tx) }
    }
}

impl Storage {
    fn send(&self, msg: Msg) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(msg);
        }
    }

    /// Writes everything still pending; called on exit.
    pub fn flush(&self) {
        let (tx, rx) = channel();
        self.send(Msg::Flush(tx));
        let _ = rx.recv_timeout(Duration::from_secs(3));
    }
}

#[tauri::command]
pub fn storage_set(storage: tauri::State<'_, Storage>, key: String, value: Option<String>, seq: u64) {
    storage.send(Msg::Set(key, value, seq));
}

#[tauri::command]
pub fn storage_set_many(storage: tauri::State<'_, Storage>, items: HashMap<String, String>) {
    for (k, v) in items {
        storage.send(Msg::Set(k, Some(v), 0));
    }
}

/// Seeds `localStorage` from disk before the page's own scripts run, then
/// mirrors every later write back to disk.
pub fn plugin() -> TauriPlugin<Wry> {
    let saved = load_all();
    let data = serde_json::to_string(&saved).unwrap_or_else(|_| "{}".into());
    let script = format!(
        r#"(function () {{
  var saved = {data};
  var hasSaved = Object.keys(saved).length > 0;
  var ls = window.localStorage, seq = Date.now() * 1000;
  var invoke = function (cmd, args) {{
    var t = window.__TAURI_INTERNALS__;
    if (t) t.invoke(cmd, args).catch(function () {{}});
    else setTimeout(function () {{ invoke(cmd, args); }}, 50);
  }};
  try {{
    // Once per window session; a reload keeps the (newer) values already in localStorage.
    if (!sessionStorage.getItem('__storageSeeded')) {{
      sessionStorage.setItem('__storageSeeded', '1');
      if (hasSaved) {{
        ls.clear();
        for (var k in saved) ls.setItem(k, saved[k]);
      }} else {{
        // First run with file storage: keep what this browser storage already has.
        var all = {{}};
        for (var i = 0; i < ls.length; i++) {{ var key = ls.key(i); all[key] = ls.getItem(key); }}
        if (Object.keys(all).length) invoke('storage_set_many', {{ items: all }});
      }}
    }}
  }} catch (e) {{}}
  var proto = Storage.prototype, set = proto.setItem, remove = proto.removeItem, clear = proto.clear;
  proto.setItem = function (k, v) {{
    set.call(this, k, v);
    if (this === ls) invoke('storage_set', {{ key: String(k), value: String(v), seq: ++seq }});
  }};
  proto.removeItem = function (k) {{
    remove.call(this, k);
    if (this === ls) invoke('storage_set', {{ key: String(k), value: null, seq: ++seq }});
  }};
  proto.clear = function () {{
    if (this === ls) for (var i = 0; i < ls.length; i++) invoke('storage_set', {{ key: ls.key(i), value: null, seq: ++seq }});
    clear.call(this);
  }};
}})();"#
    );
    Builder::new("app-storage").js_init_script(script).build()
}
