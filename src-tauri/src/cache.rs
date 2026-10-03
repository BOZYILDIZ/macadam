use crate::util::{dir_size, is_accessible};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct CacheEntry {
    pub id: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
    pub exists: bool,
}

fn known_locations() -> Vec<(&'static str, &'static str, PathBuf)> {
    let home = dirs_home();
    vec![
        (
            "user_caches",
            "Caches applications (~/Library/Caches)",
            home.join("Library/Caches"),
        ),
        (
            "user_logs",
            "Journaux applications (~/Library/Logs)",
            home.join("Library/Logs"),
        ),
        (
            "xcode_derived_data",
            "Xcode DerivedData",
            home.join("Library/Developer/Xcode/DerivedData"),
        ),
        (
            "xcode_archives_cache",
            "Simulateurs iOS (CoreSimulator Caches)",
            home.join("Library/Developer/CoreSimulator/Caches"),
        ),
        (
            "npm_cache",
            "Cache npm (~/.npm/_cacache)",
            home.join(".npm/_cacache"),
        ),
        ("generic_cache", "Cache générique (~/.cache)", home.join(".cache")),
    ]
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

#[tauri::command]
pub fn scan_caches() -> Vec<CacheEntry> {
    known_locations()
        .into_iter()
        .map(|(id, label, path)| {
            let exists = path.exists();
            let size_bytes = if exists { dir_size(&path) } else { 0 };
            CacheEntry {
                id: id.to_string(),
                label: label.to_string(),
                path: path.to_string_lossy().to_string(),
                size_bytes,
                exists,
            }
        })
        .collect()
}

#[derive(Serialize)]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

/// Empties the contents of each given cache directory (moving every child
/// entry to the Trash so the action stays undoable) without removing the
/// directory itself, since some apps expect it to keep existing.
/// Entries we can't fully read (TCC-protected system caches) are skipped
/// up front instead of being handed to `trash::delete`, which can hang
/// indefinitely on them.
#[tauri::command]
pub fn clean_caches(paths: Vec<String>) -> CleanResult {
    let mut freed_bytes = 0u64;
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    for raw_path in paths {
        let dir = PathBuf::from(&raw_path);
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("{}: {}", raw_path, e));
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            if !is_accessible(&path) {
                skipped.push(name);
                continue;
            }

            let size = if path.is_file() {
                fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
            } else {
                dir_size(&path)
            };

            match trash::delete(&path) {
                Ok(_) => freed_bytes += size,
                Err(e) => errors.push(format!("{}: {}", name, e)),
            }
        }
    }

    CleanResult {
        freed_bytes,
        skipped,
        errors,
    }
}
