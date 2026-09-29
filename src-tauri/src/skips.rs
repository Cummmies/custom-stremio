//! Fetches intro/recap/credits timestamps for the player. Done in Rust because
//! one of the services only allows its own website to call it from a browser.
//! Only these hosts can be requested.

const ALLOWED: &[&str] = &["api.introdb.app", "api.theintrodb.org"];

/// GETs a skip-timestamp URL and returns the body (JSON text), or None on 404.
#[tauri::command(async)]
pub fn skip_lookup(url: String) -> Result<Option<String>, String> {
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|h| ALLOWED.contains(&h)) {
        return Err("Host not allowed".into());
    }
    match ureq::get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .set("User-Agent", "CustomStremio/0.1")
        .call()
    {
        Ok(res) => res.into_string().map(Some).map_err(|e| e.to_string()),
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
