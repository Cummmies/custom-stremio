//! Fullscreen and picture-in-picture for the main window. PiP is a small,
//! borderless, always-on-top window in the corner; we remember the previous
//! geometry so leaving PiP puts everything back exactly.

use std::sync::Mutex;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Default)]
pub struct WindowModes {
    before_pip: Mutex<Option<Saved>>,
}

struct Saved {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
    fullscreen: bool,
}

#[tauri::command]
pub fn set_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pip(window: WebviewWindow, modes: tauri::State<'_, WindowModes>, enabled: bool) -> Result<(), String> {
    let e = |e: tauri::Error| e.to_string();
    let mut saved = modes.before_pip.lock().unwrap();

    if enabled {
        if saved.is_some() {
            return Ok(());
        }
        *saved = Some(Saved {
            position: window.outer_position().map_err(e)?,
            size: window.inner_size().map_err(e)?,
            maximized: window.is_maximized().map_err(e)?,
            fullscreen: window.is_fullscreen().map_err(e)?,
        });
        window.set_fullscreen(false).map_err(e)?;
        window.unmaximize().map_err(e)?;

        // 16:9 at a quarter of the screen width, tucked into the bottom-right of the work area.
        let monitor = window.current_monitor().map_err(e)?.ok_or("No monitor found")?;
        let area = monitor.work_area();
        let width = (area.size.width / 4).max(400);
        let height = width * 9 / 16;
        let margin = (24.0 * monitor.scale_factor()) as i32;
        window.set_min_size(None::<PhysicalSize<u32>>).map_err(e)?;
        window.set_decorations(false).map_err(e)?;
        window.set_always_on_top(true).map_err(e)?;
        window.set_size(PhysicalSize::new(width, height)).map_err(e)?;
        window
            .set_position(PhysicalPosition::new(
                area.position.x + area.size.width as i32 - width as i32 - margin,
                area.position.y + area.size.height as i32 - height as i32 - margin,
            ))
            .map_err(e)?;
    } else if let Some(prev) = saved.take() {
        window.set_always_on_top(false).map_err(e)?;
        window.set_decorations(true).map_err(e)?;
        window.set_size(prev.size).map_err(e)?;
        window.set_position(prev.position).map_err(e)?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(900.0, 600.0)))
            .map_err(e)?;
        if prev.maximized {
            window.maximize().map_err(e)?;
        }
        if prev.fullscreen {
            window.set_fullscreen(true).map_err(e)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}
