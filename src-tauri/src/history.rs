use crate::disk_usage::scan_folder;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
struct SnapshotEntry {
    name: String,
    path: String,
    size_bytes: u64,
    is_dir: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct Snapshot {
    taken_at: DateTime<Utc>,
    entries: Vec<SnapshotEntry>,
}

#[derive(Serialize, Deserialize, Default)]
struct HistoryStore {
    /// Keyed by the exact folder path being tracked.
    snapshots: HashMap<String, Vec<Snapshot>>,
}

const MAX_SNAPSHOT_AGE_DAYS: i64 = 90;
const MIN_RESNAPSHOT_INTERVAL_MINUTES: i64 = 60;
const TARGET_BASELINE_DAYS: i64 = 7;
const MIN_BASELINE_AGE_DAYS: i64 = 5;

fn store_path() -> PathBuf {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"));
    home.join("Library/Application Support/Macadam/history.json")
}

fn load_store() -> HistoryStore {
    let path = store_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return HistoryStore::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Written to a temp file then renamed into place so a crash mid-write
/// can never leave a half-written, corrupt history file.
fn save_store(store: &HistoryStore) -> Result<(), String> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct GrowthChange {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub past_bytes: u64,
    pub current_bytes: u64,
    pub delta_bytes: i64,
}

#[derive(Serialize)]
pub struct GrowthReport {
    pub has_baseline: bool,
    pub baseline_age_days: Option<i64>,
    pub current_taken_at: DateTime<Utc>,
    pub changes: Vec<GrowthChange>,
}

/// Scans `folder` now, records that as a new snapshot, and diffs it
/// against the stored snapshot closest to 7 days old to answer "what grew
/// since last week". Calling this is the only thing that builds history —
/// there's no separate manual "take a snapshot" step, so the feature
/// starts working the first time it's opened and just gets more useful
/// over time.
#[tauri::command]
pub fn get_growth(folder: String) -> Result<GrowthReport, String> {
    let current_entries = scan_folder(&folder)?;
    let now = Utc::now();

    let mut store = load_store();
    let history = store.snapshots.entry(folder.clone()).or_default();
    history.sort_by_key(|s| s.taken_at);

    // Pick the snapshot whose age is closest to (but not under) our
    // minimum, so a snapshot taken five minutes ago never gets used as a
    // trivial "nothing changed" baseline.
    let baseline = history
        .iter()
        .filter(|s| (now - s.taken_at) >= Duration::days(MIN_BASELINE_AGE_DAYS))
        .min_by_key(|s| ((now - s.taken_at).num_days() - TARGET_BASELINE_DAYS).abs())
        .cloned();

    let mut changes = Vec::new();
    let mut baseline_age_days = None;

    if let Some(baseline) = &baseline {
        baseline_age_days = Some((now - baseline.taken_at).num_days());
        let mut past_by_name: HashMap<&str, &SnapshotEntry> = HashMap::new();
        for e in &baseline.entries {
            past_by_name.insert(e.name.as_str(), e);
        }
        let mut seen = std::collections::HashSet::new();

        for cur in &current_entries {
            seen.insert(cur.name.clone());
            let past_bytes = past_by_name.get(cur.name.as_str()).map(|e| e.size_bytes).unwrap_or(0);
            let delta = cur.size_bytes as i64 - past_bytes as i64;
            if delta != 0 {
                changes.push(GrowthChange {
                    name: cur.name.clone(),
                    path: cur.path.clone(),
                    is_dir: cur.is_dir,
                    past_bytes,
                    current_bytes: cur.size_bytes,
                    delta_bytes: delta,
                });
            }
        }
        for (name, past) in &past_by_name {
            if !seen.contains(*name) {
                changes.push(GrowthChange {
                    name: name.to_string(),
                    path: past.path.clone(),
                    is_dir: past.is_dir,
                    past_bytes: past.size_bytes,
                    current_bytes: 0,
                    delta_bytes: -(past.size_bytes as i64),
                });
            }
        }

        changes.sort_by_key(|c| -(c.delta_bytes.abs()));
        changes.truncate(15);
    }

    // Record "now" as a new data point, but don't bother if we already
    // have one from very recently (repeated clicks shouldn't bloat the file).
    let should_record = history
        .last()
        .map(|s| (now - s.taken_at) >= Duration::minutes(MIN_RESNAPSHOT_INTERVAL_MINUTES))
        .unwrap_or(true);

    if should_record {
        history.push(Snapshot {
            taken_at: now,
            entries: current_entries
                .iter()
                .map(|e| SnapshotEntry {
                    name: e.name.clone(),
                    path: e.path.clone(),
                    size_bytes: e.size_bytes,
                    is_dir: e.is_dir,
                })
                .collect(),
        });
        history.retain(|s| (now - s.taken_at) <= Duration::days(MAX_SNAPSHOT_AGE_DAYS));
        save_store(&store)?;
    }

    Ok(GrowthReport {
        has_baseline: baseline.is_some(),
        baseline_age_days,
        current_taken_at: now,
        changes,
    })
}
