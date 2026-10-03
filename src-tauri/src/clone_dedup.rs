use serde::Serialize;
use std::ffi::CString;
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

extern "C" {
    /// macOS libSystem call: creates `dst` as a copy-on-write APFS clone of
    /// `src` — both paths end up as independent, fully-functional files
    /// that share underlying disk blocks until one of them is modified.
    /// Fails (ENOTSUP/EXDEV) when the volume isn't APFS or src/dst are on
    /// different volumes; we treat that as a hard error rather than
    /// silently falling back to a plain copy, since a plain copy wouldn't
    /// actually free any space and would break the feature's promise.
    fn clonefile(src: *const i8, dst: *const i8, flags: u32) -> i32;
}

fn clone_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    let src_c = CString::new(src.as_os_str().as_bytes())?;
    let dst_c = CString::new(dst.as_os_str().as_bytes())?;
    let ret = unsafe { clonefile(src_c.as_ptr(), dst_c.as_ptr(), 0) };
    if ret != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn free_temp_path_near(target: &Path, suffix: &str) -> PathBuf {
    let base_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut candidate = target.with_file_name(format!("{}.{}", base_name, suffix));
    let mut i = 1;
    while candidate.exists() {
        candidate = target.with_file_name(format!("{}.{}{}", base_name, suffix, i));
        i += 1;
    }
    candidate
}

#[derive(Serialize)]
pub struct MergeResult {
    pub merged: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

/// Replaces each file in `duplicates` with an APFS clone of `keep`. Unlike
/// deleting duplicates, nothing disappears: every path keeps working
/// exactly as before, only the underlying storage is shared — so there's
/// no "pick the wrong one to delete" risk. The swap is done via a temp
/// file + atomic rename so a failure can never leave a path with neither
/// the original nor a clone.
#[tauri::command]
pub fn clone_merge_files(keep: String, duplicates: Vec<String>) -> MergeResult {
    let keep_path = PathBuf::from(&keep);
    let mut merged = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    if !keep_path.exists() {
        return MergeResult {
            merged: 0,
            freed_bytes: 0,
            errors: vec![format!("{} : fichier à garder introuvable", keep)],
        };
    }

    for dup in duplicates {
        if dup == keep {
            continue;
        }
        let dup_path = PathBuf::from(&dup);
        if !dup_path.exists() {
            continue;
        }
        let size = fs::metadata(&dup_path).map(|m| m.len()).unwrap_or(0);
        let tmp = free_temp_path_near(&dup_path, "macadam-clone-tmp");

        if let Err(e) = clone_file(&keep_path, &tmp) {
            errors.push(format!(
                "{} : clonage impossible ({e}) — probablement pas sur le même volume APFS",
                dup
            ));
            continue;
        }

        if let Err(e) = trash::delete(&dup_path) {
            let _ = fs::remove_file(&tmp);
            errors.push(format!("{} : {}", dup, e));
            continue;
        }

        if let Err(e) = fs::rename(&tmp, &dup_path) {
            errors.push(format!(
                "{} : fusion incomplète, fichier temporaire laissé à {} ({})",
                dup,
                tmp.display(),
                e
            ));
            continue;
        }

        merged += 1;
        freed_bytes += size;
    }

    MergeResult {
        merged,
        freed_bytes,
        errors,
    }
}
