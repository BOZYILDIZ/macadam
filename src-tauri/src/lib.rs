mod cache;
mod clone_dedup;
mod disk_usage;
mod duplicates;
mod history;
mod organize;
mod startup;
mod unused_apps;
mod util;

use cache::{clean_caches, scan_caches};
use clone_dedup::clone_merge_files;
use disk_usage::analyze_disk_usage;
use duplicates::{delete_files, find_duplicates};
use history::get_growth;
use organize::{organize_folder, preview_organize};
use startup::{list_launch_agents, list_login_items, remove_login_item, toggle_launch_agent};
use unused_apps::{list_apps, trash_app};

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
            clone_merge_files,
            analyze_disk_usage,
            get_growth,
            list_login_items,
            remove_login_item,
            list_launch_agents,
            toggle_launch_agent,
            list_apps,
            trash_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
