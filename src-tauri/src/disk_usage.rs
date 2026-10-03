use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct DiskEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

fn entry_size(path: &Path) -> u64 {
    if path.is_file() {
        return fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

/// Lists the immediate children of `folder` with their total size
/// (recursive for subdirectories), sorted largest first. One level at a
/// time keeps this fast enough to call again as the user drills down.
#[tauri::command]
pub fn analyze_disk_usage(folder: String) -> Result<Vec<DiskEntry>, String> {
    let dir = PathBuf::from(&folder);
    if !dir.exists() {
        return Err(format!("Le dossier {} n'existe pas", folder));
    }

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut results: Vec<DiskEntry> = entries
        .flatten()
        .filter(|e| {
            !e.file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false)
        })
        .map(|e| {
            let path = e.path();
            let is_dir = path.is_dir();
            DiskEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                size_bytes: entry_size(&path),
                is_dir,
            }
        })
        .collect();

    results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(results)
}
