use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size_bytes: u64,
    pub paths: Vec<String>,
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// Finds duplicate files under `folder` (recursive). First groups files by
/// size (cheap), then hashes only the files that share a size with at least
/// one other file, so unique-sized files never get read from disk.
#[tauri::command]
pub fn find_duplicates(folder: String) -> Result<Vec<DuplicateGroup>, String> {
    let root = PathBuf::from(&folder);
    if !root.exists() {
        return Err(format!("Le dossier {} n'existe pas", folder));
    }

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();

    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !s.starts_with('.'))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        if let Ok(meta) = entry.metadata() {
            let size = meta.len();
            if size == 0 {
                continue;
            }
            by_size.entry(size).or_default().push(entry.path().to_path_buf());
        }
    }

    let mut groups: Vec<DuplicateGroup> = Vec::new();

    for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for path in paths {
            if let Ok(hash) = hash_file(&path) {
                by_hash
                    .entry(hash)
                    .or_default()
                    .push(path.to_string_lossy().to_string());
            }
        }
        for (hash, group_paths) in by_hash {
            if group_paths.len() > 1 {
                groups.push(DuplicateGroup {
                    hash,
                    size_bytes: size,
                    paths: group_paths,
                });
            }
        }
    }

    groups.sort_by(|a, b| {
        (b.size_bytes * b.paths.len() as u64).cmp(&(a.size_bytes * a.paths.len() as u64))
    });

    Ok(groups)
}

#[derive(Serialize)]
pub struct DeleteResult {
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

/// Moves the given files to the Trash (never a permanent delete), returning
/// how much space was freed and any per-file errors encountered.
#[tauri::command]
pub fn delete_files(paths: Vec<String>) -> DeleteResult {
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for raw in paths {
        let path = PathBuf::from(&raw);
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        match trash::delete(&path) {
            Ok(_) => freed_bytes += size,
            Err(e) => errors.push(format!("{}: {}", raw, e)),
        }
    }

    DeleteResult {
        freed_bytes,
        errors,
    }
}
