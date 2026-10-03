use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct OrganizeMove {
    pub from: String,
    pub to: String,
    pub category: String,
}

#[derive(Serialize)]
pub struct OrganizeResult {
    pub moves: Vec<OrganizeMove>,
    pub counts: Vec<(String, usize)>,
}

fn category_for_ext(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff" | "heic" | "svg" => "Images",
        "pdf" => "PDF",
        "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "html" | "htm" => "Documents",
        "xlsx" | "xls" | "csv" => "Tableurs",
        "zip" | "rar" | "7z" | "tar" | "gz" => "Archives",
        "dmg" | "exe" | "pkg" | "ipsw" => "Installateurs",
        "mp3" | "wav" | "m4a" | "aac" | "flac" => "Audio",
        "mp4" | "mov" | "avi" | "mkv" | "webm" => "Videos",
        "py" | "json" | "js" | "ts" | "rs" | "go" | "java" | "c" | "cpp" | "sh" => "Code",
        _ => "Autres",
    }
}

/// Scans a folder's top-level files (not recursive, skips hidden files and
/// directories) and returns the category each file would land in, without
/// moving anything. Used to preview the result before the user confirms.
#[tauri::command]
pub fn preview_organize(folder: String) -> Result<Vec<OrganizeMove>, String> {
    let dir = Path::new(&folder);
    let mut preview = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let category = if ext.is_empty() {
            "Autres"
        } else {
            category_for_ext(ext)
        };
        preview.push(OrganizeMove {
            from: path.to_string_lossy().to_string(),
            to: format!("{}/{}", category, file_name),
            category: category.to_string(),
        });
    }

    Ok(preview)
}

/// Actually moves the top-level files of `folder` into category
/// subfolders. Mirrors `preview_organize` but performs the filesystem
/// changes and resolves name collisions by appending " (n)".
#[tauri::command]
pub fn organize_folder(folder: String) -> Result<OrganizeResult, String> {
    let dir = Path::new(&folder);
    let mut moves = Vec::new();
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut files: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            !p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(true)
        })
        .collect();
    files.sort();

    for path in files {
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let category = if ext.is_empty() {
            "Autres"
        } else {
            category_for_ext(ext)
        };

        let dest_dir = dir.join(category);
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

        let mut target = dest_dir.join(&file_name);
        if target.exists() {
            let stem = path.file_stem().unwrap().to_string_lossy().to_string();
            let mut i = 1;
            loop {
                let candidate_name = if ext.is_empty() {
                    format!("{} ({})", stem, i)
                } else {
                    format!("{} ({}).{}", stem, i, ext)
                };
                let candidate = dest_dir.join(candidate_name);
                if !candidate.exists() {
                    target = candidate;
                    break;
                }
                i += 1;
            }
        }

        fs::rename(&path, &target).map_err(|e| e.to_string())?;
        *counts.entry(category.to_string()).or_insert(0) += 1;
        moves.push(OrganizeMove {
            from: path.to_string_lossy().to_string(),
            to: target.to_string_lossy().to_string(),
            category: category.to_string(),
        });
    }

    Ok(OrganizeResult {
        moves,
        counts: counts.into_iter().collect(),
    })
}
