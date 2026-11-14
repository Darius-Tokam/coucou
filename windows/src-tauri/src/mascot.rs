// A MascotForge export chosen by the user replaces Mochi in the corner.
//
// An export is a `mascot/` folder: manifest.json (version 2), mascot.js (the
// <mascot-avatar> web component), and either an engine script (blob, 3D) or one
// clip per state (video). Coucou copies it to platform::config_dir()/mascots/current,
// so the user can move or delete the original, and the island loads it from
// there through Tauri's asset protocol.

use crate::platform;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// What the island and the settings need to know about the active mascot.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MascotInfo {
    pub name: String,
    /// "blob", "3d" or "video".
    pub engine: String,
    pub credit: Option<String>,
    /// "stacked" (transparent video) or "none".
    pub alpha: String,
    pub states: Vec<String>,
    pub default_state: String,
    pub manifest_path: String,
    pub script_path: String,
}

#[derive(Debug, PartialEq)]
pub enum ImportError {
    NotAnExport,
    BadManifest,
    WrongVersion,
    MissingFile(String),
    Io,
}

impl ImportError {
    /// The code the settings page turns into a sentence.
    pub fn code(&self) -> &'static str {
        match self {
            ImportError::NotAnExport => "not_an_export",
            ImportError::BadManifest => "bad_manifest",
            ImportError::WrongVersion => "wrong_version",
            ImportError::MissingFile(_) => "missing_file",
            ImportError::Io => "io",
        }
    }
}

pub fn mascots_dir() -> PathBuf {
    platform::config_dir().join("mascots")
}

fn current_dir() -> PathBuf {
    mascots_dir().join("current")
}

/// The export folder inside what the user picked: the folder itself, or its `mascot/`.
pub fn find_export(chosen: &Path) -> Option<PathBuf> {
    [chosen.to_path_buf(), chosen.join("mascot")]
        .into_iter()
        .find(|dir| dir.join("manifest.json").is_file())
}

/// `rel` as a file inside `dir`, or None if it is missing or would leave `dir`.
fn file_inside(dir: &Path, rel: &str) -> Option<PathBuf> {
    let path = Path::new(rel);
    let stays = path
        .components()
        .all(|c| matches!(c, std::path::Component::Normal(_) | std::path::Component::CurDir));
    let full = dir.join(path);
    (stays && full.is_file()).then_some(full)
}

/// Reads and checks an export folder.
pub fn read_export(dir: &Path) -> Result<MascotInfo, ImportError> {
    let manifest_path = dir.join("manifest.json");
    let text = std::fs::read_to_string(&manifest_path).map_err(|_| ImportError::NotAnExport)?;
    let manifest: serde_json::Value = serde_json::from_str(&text).map_err(|_| ImportError::BadManifest)?;
    if manifest.get("version").and_then(|v| v.as_u64()) != Some(2) {
        return Err(ImportError::WrongVersion);
    }
    let script = file_inside(dir, "mascot.js").ok_or_else(|| ImportError::MissingFile("mascot.js".into()))?;

    if let Some(src) = manifest.get("engine_src").and_then(|v| v.as_str()) {
        file_inside(dir, src).ok_or_else(|| ImportError::MissingFile(src.into()))?;
    }
    let states_obj = manifest.get("states").and_then(|v| v.as_object()).ok_or(ImportError::BadManifest)?;
    let mut states = Vec::with_capacity(states_obj.len());
    for (state, spec) in states_obj {
        if let Some(src) = spec.get("src").and_then(|v| v.as_str()) {
            file_inside(dir, src).ok_or_else(|| ImportError::MissingFile(src.into()))?;
        }
        states.push(state.clone());
    }

    let text_of = |key: &str| manifest.get(key).and_then(|v| v.as_str()).map(str::to_string);
    let default_state = text_of("default_state")
        .or_else(|| states.first().cloned())
        .unwrap_or_else(|| "idle".into());
    Ok(MascotInfo {
        name: text_of("name").unwrap_or_else(|| "MascotForge".into()),
        engine: text_of("engine").unwrap_or_else(|| "video".into()),
        credit: text_of("credit"),
        alpha: text_of("alpha").unwrap_or_else(|| "none".into()),
        states,
        default_state,
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        script_path: script.to_string_lossy().into_owned(),
    })
}

/// Copies a folder tree, files and folders only.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Copies `src` to `dest_root/current`, keeping the old one if anything fails.
pub fn install(src: &Path, dest_root: &Path) -> Result<MascotInfo, ImportError> {
    let tmp = dest_root.join("current.tmp");
    let current = dest_root.join("current");
    let _ = std::fs::remove_dir_all(&tmp);
    if copy_tree(src, &tmp).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(ImportError::Io);
    }
    if let Err(e) = read_export(&tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    if current.exists() && std::fs::remove_dir_all(&current).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(ImportError::Io);
    }
    std::fs::rename(&tmp, &current).map_err(|_| ImportError::Io)?;
    read_export(&current)
}

fn announce(app: &AppHandle, info: &Option<MascotInfo>) {
    let _ = app.emit("mascot-changed", info.clone());
}

/// Settings → Choose a MascotForge folder.
#[tauri::command]
pub fn mascot_import(app: AppHandle, folder: String) -> Result<MascotInfo, String> {
    let src = find_export(Path::new(&folder)).ok_or_else(|| ImportError::NotAnExport.code().to_string())?;
    match install(&src, &mascots_dir()) {
        Ok(info) => {
            announce(&app, &Some(info.clone()));
            Ok(info)
        }
        Err(ImportError::MissingFile(file)) => Err(format!("missing_file:{file}")),
        Err(e) => Err(e.code().to_string()),
    }
}

/// The active mascot, if any.
#[tauri::command]
pub fn mascot_current() -> Option<MascotInfo> {
    read_export(&current_dir()).ok()
}

/// Settings → Back to Mochi.
#[tauri::command]
pub fn mascot_clear(app: AppHandle) {
    let _ = std::fs::remove_dir_all(current_dir());
    announce(&app, &None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A fresh empty folder for one test.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coucou-mascot-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    const BLOB: &str = r#"{"version":2,"name":"nuage","engine":"blob","engine_src":"engines/agent-mascot.js",
        "default_state":"idle","alpha":"none","credit":"Blob Atelier",
        "states":{"idle":{"loop":true},"listening":{"loop":true},"thinking":{"loop":true},"talking":{"loop":true},
        "working":{"loop":true},"happy":{"loop":true},"done":{"loop":true},"error":{"loop":true}}}"#;

    fn blob_export(dir: &Path) {
        write(&dir.join("manifest.json"), BLOB);
        write(&dir.join("mascot.js"), "// component");
        write(&dir.join("engines/agent-mascot.js"), "// engine");
    }

    #[test]
    fn an_export_folder_is_found_from_its_parent() {
        let parent = scratch("parent");
        blob_export(&parent.join("mascot"));
        assert_eq!(find_export(&parent), Some(parent.join("mascot")));
        assert_eq!(find_export(&parent.join("mascot")), Some(parent.join("mascot")));
    }

    #[test]
    fn a_folder_without_manifest_is_not_an_export() {
        let dir = scratch("empty");
        write(&dir.join("notes.txt"), "hello");
        assert_eq!(find_export(&dir), None);
    }

    #[test]
    fn a_blob_export_reads_its_engine_and_states() {
        let dir = scratch("blob");
        blob_export(&dir);
        let info = read_export(&dir).unwrap();
        assert_eq!(info.name, "nuage");
        assert_eq!(info.engine, "blob");
        assert_eq!(info.states.len(), 8);
        assert_eq!(info.default_state, "idle");
        assert_eq!(info.credit.as_deref(), Some("Blob Atelier"));
        assert!(info.manifest_path.ends_with("manifest.json"));
        assert!(info.script_path.ends_with("mascot.js"));
    }

    #[test]
    fn a_video_export_without_engine_is_video() {
        let dir = scratch("video");
        write(
            &dir.join("manifest.json"),
            r#"{"version":2,"name":"renard","default_state":"idle","alpha":"none",
               "states":{"idle":{"src":"videos/idle.mp4","loop":true}}}"#,
        );
        write(&dir.join("mascot.js"), "// component");
        write(&dir.join("videos/idle.mp4"), "mp4");
        let info = read_export(&dir).unwrap();
        assert_eq!(info.engine, "video");
        assert_eq!(info.alpha, "none");
        assert_eq!(info.credit, None);
    }

    #[test]
    fn a_missing_clip_is_reported() {
        let dir = scratch("noclip");
        write(
            &dir.join("manifest.json"),
            r#"{"version":2,"name":"renard","default_state":"idle","alpha":"stacked",
               "states":{"idle":{"src":"videos/idle.mp4","loop":true}}}"#,
        );
        write(&dir.join("mascot.js"), "// component");
        assert_eq!(read_export(&dir), Err(ImportError::MissingFile("videos/idle.mp4".into())));
    }

    #[test]
    fn version_one_is_refused() {
        let dir = scratch("v1");
        write(&dir.join("manifest.json"), r#"{"version":1,"name":"old","states":{}}"#);
        write(&dir.join("mascot.js"), "// component");
        assert_eq!(read_export(&dir), Err(ImportError::WrongVersion));
    }

    #[test]
    fn a_broken_manifest_is_refused() {
        let dir = scratch("broken");
        write(&dir.join("manifest.json"), "{ not json");
        write(&dir.join("mascot.js"), "// component");
        assert_eq!(read_export(&dir), Err(ImportError::BadManifest));
    }

    #[test]
    fn an_engine_path_cannot_leave_the_export() {
        let dir = scratch("escape");
        write(
            &dir.join("manifest.json"),
            r#"{"version":2,"name":"x","engine":"blob","engine_src":"../outside.js","states":{"idle":{}}}"#,
        );
        write(&dir.join("mascot.js"), "// component");
        write(&dir.parent().unwrap().join("outside.js"), "// sneaky");
        assert_eq!(read_export(&dir), Err(ImportError::MissingFile("../outside.js".into())));
    }

    #[test]
    fn an_install_replaces_the_current_mascot() {
        let root = scratch("install-root");
        let src = scratch("install-src");
        blob_export(&src);
        let info = install(&src, &root).unwrap();
        assert_eq!(info.name, "nuage");
        assert!(root.join("current/engines/agent-mascot.js").is_file());
        assert!(info.manifest_path.starts_with(&*root.join("current").to_string_lossy()));
        assert!(!root.join("current.tmp").exists());
    }

    #[test]
    fn a_failed_install_keeps_the_current_mascot() {
        let root = scratch("keep-root");
        let good = scratch("keep-good");
        blob_export(&good);
        install(&good, &root).unwrap();
        let before = fs::read_to_string(root.join("current/manifest.json")).unwrap();

        let bad = scratch("keep-bad");
        write(&bad.join("manifest.json"), r#"{"version":1,"name":"old","states":{}}"#);
        write(&bad.join("mascot.js"), "// component");
        assert_eq!(install(&bad, &root), Err(ImportError::WrongVersion));
        assert_eq!(fs::read_to_string(root.join("current/manifest.json")).unwrap(), before);
    }
}
