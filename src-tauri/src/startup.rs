use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct LoginItem {
    pub name: String,
    pub path: String,
}

/// Lists classic "Login Items" (System Events / the legacy API most
/// third-party apps still register through). Modern items added only via
/// the Ventura+ "Login Items & Extensions" pane that never touch this
/// legacy list won't appear here — there is no public, documented API for
/// those; macOS stores them in an internal format Apple doesn't expose.
/// We're upfront about that in the UI rather than parsing that undocumented
/// format and risking it silently breaking on the next macOS release.
#[tauri::command]
pub fn list_login_items() -> Result<Vec<LoginItem>, String> {
    let script = r#"
        tell application "System Events"
            set out to ""
            repeat with li in login items
                set out to out & (name of li) & "|||" & (path of li) & "\n"
            end repeat
            return out
        end tell
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Impossible de lancer osascript : {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.contains("-1743") || stderr.to_lowercase().contains("not authorized") {
            "Macadam n'a pas la permission de contrôler « Système Events ». Autorise-la dans Réglages Système > Confidentialité et sécurité > Automatisation.".to_string()
        } else {
            format!("Erreur osascript : {}", stderr)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let items = stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(2, "|||");
            let name = parts.next()?.trim().to_string();
            let path = parts.next().unwrap_or("").trim().to_string();
            Some(LoginItem { name, path })
        })
        .collect();

    Ok(items)
}

/// Removes a classic Login Item by name. This only drops the login-item
/// reference (the app itself is untouched) but, unlike every other
/// destructive action in Macadam, it can't be routed through the Trash —
/// there's nothing file-like to trash. The UI must warn the user this one
/// isn't undoable the way everything else is.
#[tauri::command]
pub fn remove_login_item(name: String) -> Result<(), String> {
    let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "System Events" to delete login item "{}""#,
        escaped
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Impossible de lancer osascript : {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Erreur osascript : {}", stderr));
    }

    Ok(())
}

#[derive(Serialize, Clone)]
pub struct LaunchAgent {
    pub label: String,
    pub path: String,
    pub enabled: bool,
    /// "user" (~/Library/LaunchAgents, fully manageable) or "system"
    /// (/Library/LaunchAgents, owned by root — shown read-only since
    /// disabling it would need administrator privileges we don't request).
    pub scope: String,
}

fn label_for_plist(path: &Path) -> String {
    plist::Value::from_file(path)
        .ok()
        .and_then(|v| v.as_dictionary().and_then(|d| d.get("Label")).cloned())
        .and_then(|v| v.as_string().map(|s| s.to_string()))
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string())
        })
}

fn scan_agents_dir(dir: &Path, scope: &str) -> Vec<LaunchAgent> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_string_lossy().to_string();
            if file_name.ends_with(".plist") {
                Some(LaunchAgent {
                    label: label_for_plist(&path),
                    path: path.to_string_lossy().to_string(),
                    enabled: true,
                    scope: scope.to_string(),
                })
            } else if file_name.ends_with(".plist.disabled") {
                Some(LaunchAgent {
                    label: label_for_plist(&path),
                    path: path.to_string_lossy().to_string(),
                    enabled: false,
                    scope: scope.to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
pub fn list_launch_agents() -> Vec<LaunchAgent> {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"));

    let mut agents = scan_agents_dir(&home.join("Library/LaunchAgents"), "user");
    agents.extend(scan_agents_dir(Path::new("/Library/LaunchAgents"), "system"));
    agents.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    agents
}

/// Enables or disables a user-scope LaunchAgent. Disabling renames the
/// plist to `*.plist.disabled` (launchd ignores it on the next login) —
/// reversible at any time by re-enabling, nothing is deleted. We also
/// best-effort `launchctl unload`/`load` it immediately so the change
/// doesn't wait for the next login; that step is allowed to fail silently
/// since the renamed file is what actually determines future state.
#[tauri::command]
pub fn toggle_launch_agent(path: String, enable: bool) -> Result<(), String> {
    let current = PathBuf::from(&path);
    if !current.exists() {
        return Err("Ce fichier n'existe plus.".to_string());
    }

    let home = std::env::var("HOME").unwrap_or_default();
    if !current.starts_with(&home) {
        return Err("Seuls les agents de l'utilisateur (~/Library/LaunchAgents) peuvent être modifiés sans droits administrateur.".to_string());
    }

    let target = if enable {
        if let Some(stripped) = path.strip_suffix(".disabled") {
            PathBuf::from(stripped)
        } else {
            current.clone()
        }
    } else if path.ends_with(".disabled") {
        current.clone()
    } else {
        PathBuf::from(format!("{}.disabled", path))
    };

    if !enable {
        // Unload while the job's identity still matches its current path,
        // then rename so launchd skips it on the next login too.
        let _ = Command::new("launchctl").arg("unload").arg(&current).output();
    }

    if target != current {
        fs::rename(&current, &target).map_err(|e| e.to_string())?;
    }

    if enable {
        // Load from the final (.plist) path now that the rename landed it there.
        let _ = Command::new("launchctl").arg("load").arg(&target).output();
    }

    Ok(())
}
