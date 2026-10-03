use std::fs;
use std::path::Path;

/// Some subfolders (TCC-protected system caches, etc.) can't be read or
/// written by a normal app. Probing access up front lets callers skip
/// those instead of letting a destructive operation hang or fail on them.
pub fn is_accessible(path: &Path) -> bool {
    if path.is_dir() {
        fs::read_dir(path).is_ok()
    } else {
        fs::metadata(path).is_ok()
    }
}

/// Total size in bytes of everything under `path` (or just `path` itself
/// if it's a file). Unreadable subdirectories are skipped rather than
/// aborting the whole walk.
pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_entry(|e| !e.file_type().is_dir() || is_accessible(e.path()))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
