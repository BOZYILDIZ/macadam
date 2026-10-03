mod cache;
mod disk_usage;
mod duplicates;
mod organize;

use cache::{clean_caches, scan_caches};
use disk_usage::analyze_disk_usage;
use duplicates::{delete_files, find_duplicates};
use organize::{organize_folder, preview_organize};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            preview_organize,
            organize_folder,
            scan_caches,
            clean_caches,
            find_duplicates,
            delete_files,
            analyze_disk_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
