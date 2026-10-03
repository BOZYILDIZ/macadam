use crate::util::dir_size;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct AppInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// Days since Launch Services last recorded opening this app, or
    /// `None` if it has never been opened (or that metadata was cleared).
    pub days_since_used: Option<i64>,
}

/// Spotlight's `kMDItemLastUsedDate` is the same "Date Last Opened" value
/// Finder shows in the Get Info panel and column view — backed by Launch
/// Services, not something we have to track ourselves or infer from file
/// timestamps (which `cp`/backups/Time Machine can all perturb).
fn last_used_days_ago(app_path: &Path) -> Option<i64> {
    let output = Command::new("mdls")
        .arg("-raw")
        .arg("-name")
        .arg("kMDItemLastUsedDate")
        .arg(app_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() || raw == "(null)" {
        return None;
    }

    // mdls prints e.g. "2026-05-20 14:32:10 +0000"
    let parsed = DateTime::parse_from_str(&raw, "%Y-%m-%d %H:%M:%S %z").ok()?;
    let days = (Utc::now() - parsed.with_timezone(&Utc)).num_days();
    Some(days.max(0))
}

fn scan_dir(dir: &Path, apps: &mut Vec<AppInfo>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_app = path.extension().map(|e| e == "app").unwrap_or(false);
        if !is_app || !path.is_dir() {
            continue;
        }
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());

        apps.push(AppInfo {
            name,
            size_bytes: dir_size(&path),
            days_since_used: last_used_days_ago(&path),
            path: path.to_string_lossy().to_string(),
        });
    }
}

/// Scans /Applications and ~/Applications (never /System/Applications —
/// those are Apple's own, SIP-protected, and not something a cleanup tool
/// should ever suggest removing). Sorted so the apps least recently
/// opened (or never opened) surface first.
#[tauri::command]
pub fn list_apps() -> Vec<AppInfo> {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"));

    let mut apps = Vec::new();
    scan_dir(Path::new("/Applications"), &mut apps);
    scan_dir(&home.join("Applications"), &mut apps);

    apps.sort_by(|a, b| match (a.days_since_used, b.days_since_used) {
        (None, None) => b.size_bytes.cmp(&a.size_bytes),
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(x), Some(y)) => y.cmp(&x),
    });

    apps
}

/// Moves an app bundle to the Trash. Leftover support files (Application
/// Support, Preferences, caches tied to the app) are intentionally left
/// alone — Macadam doesn't claim to be a full uninstaller, and guessing at
/// which scattered files belong to an app risks removing the wrong thing.
#[tauri::command]
pub fn trash_app(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}
