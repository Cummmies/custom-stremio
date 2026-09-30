//! Where the interesting part of a backdrop is, left to right.
//!
//! A phone shows a wide backdrop in a tall frame, so it keeps only about a
//! third of the width. Centering that works when the subject is in the middle
//! and fails when it's off to one side (a face at the right edge, empty dark
//! space in the middle). This looks at a small copy of the image and finds the
//! stretch with the most detail and contrast; the banner centers on that.
//! Done here rather than in the page because image hosts don't allow pages to
//! read their pixels.

use std::{collections::HashMap, io::Read, sync::Mutex};

/// Share of the width a phone shows (portrait screen over a 16:9 backdrop).
const WINDOW: f32 = 0.34;

static CACHE: Mutex<Option<HashMap<String, f32>>> = Mutex::new(None);

/// 0 = left edge, 0.5 = middle, 1 = right edge; where to center the crop.
#[tauri::command(async)]
pub fn art_focus(url: String) -> Result<f32, String> {
    if !url.starts_with("https://") {
        return Err("Only https images.".into());
    }
    if let Some(x) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&url) {
        return Ok(*x);
    }
    let res = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .set("User-Agent", "CustomStremio")
        .call()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    res.into_reader().take(12 * 1024 * 1024).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let x = focus_x(&img.to_luma8());
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(url, x);
    Ok(x)
}

/// Column-by-column "interest" (edges plus distance from the image's average
/// brightness), then the window of `WINDOW` width with the most of it.
fn focus_x(gray: &image::GrayImage) -> f32 {
    let small = image::imageops::resize(gray, 96, 54, image::imageops::FilterType::Triangle);
    let (w, h) = small.dimensions();
    let px = |x: u32, y: u32| small.get_pixel(x, y)[0] as f32;
    let mean = small.pixels().map(|p| p[0] as f32).sum::<f32>() / (w * h) as f32;
    // The top and bottom tenth are often letterboxing or sky; skip them.
    let (y0, y1) = (h / 10, h - h / 10);
    let mut cols = vec![0f32; w as usize];
    for x in 1..w - 1 {
        let mut e = 0.0;
        for y in y0.max(1)..y1.min(h - 1) {
            let gx = (px(x + 1, y) - px(x - 1, y)).abs();
            let gy = (px(x, y + 1) - px(x, y - 1)).abs();
            e += gx + gy + 0.35 * (px(x, y) - mean).abs();
        }
        cols[x as usize] = e;
    }
    let win = ((w as f32 * WINDOW).round() as usize).max(1);
    let mut best = (f32::MIN, 0usize);
    let mut sum: f32 = cols[..win].iter().sum();
    for start in 0..=(w as usize - win) {
        if start > 0 {
            sum += cols[start + win - 1] - cols[start - 1];
        }
        if sum > best.0 {
            best = (sum, start);
        }
    }
    let center = (best.1 as f32 + win as f32 / 2.0) / w as f32;
    // Nudge toward the middle: a near-tie shouldn't pin the crop to an edge.
    let x = 0.5 + (center - 0.5) * 0.9;
    // As an object-position: 0% shows the left edge, 100% the right edge.
    ((x - WINDOW / 2.0) / (1.0 - WINDOW)).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Flat dark image with a detailed patch at a given horizontal spot.
    fn scene(patch_center: f32) -> image::GrayImage {
        let (w, h) = (1280u32, 720u32);
        let cx = (patch_center * w as f32) as i32;
        image::GrayImage::from_fn(w, h, |x, y| {
            let dx = x as i32 - cx;
            if dx.abs() < 140 && (200..560).contains(&y) {
                image::Luma([if (x / 12 + y / 12) % 2 == 0 { 230 } else { 40 }])
            } else {
                image::Luma([20])
            }
        })
    }

    #[test]
    fn finds_a_subject_on_the_right() {
        assert!(focus_x(&scene(0.85)) > 0.8, "{}", focus_x(&scene(0.85)));
    }

    #[test]
    fn finds_a_subject_on_the_left() {
        assert!(focus_x(&scene(0.15)) < 0.2, "{}", focus_x(&scene(0.15)));
    }

    #[test]
    fn keeps_a_centered_subject_centered() {
        let x = focus_x(&scene(0.5));
        assert!((0.4..0.6).contains(&x), "{x}");
    }
}
