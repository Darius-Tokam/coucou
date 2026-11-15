// A MascotForge export chosen by the user replaces Mochi in the corner.
//
// An export is a `mascot/` folder: manifest.json (version 2), mascot.js (the
// <mascot-avatar> web component), and either an engine script (blob, 3D) or one
// clip per state (video). Coucou copies it under platform::config_dir()/mascots,
// so the user can move or delete the original, and the island loads it from
// there through the `mascot` protocol below. Tauri's asset protocol can't do:
// it sends no Access-Control-Allow-Origin, and the 3D engine is an ES module,
// which the webview only runs cross-origin with that header.
//
// The island shows it in an iframe whose page (FRAME_HTML) comes from that
// protocol too: the export's scripts then run on the mascot origin, not the
// island's, so they can't reach the island's window or its commands.

use crate::platform;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// Where the page finds the active mascot's files (lib.rs registers the scheme).
#[cfg(windows)]
pub const BASE_URL: &str = "http://mascot.localhost/";
#[cfg(not(windows))]
pub const BASE_URL: &str = "mascot://localhost/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Claude,
    Codex,
}

impl Slot {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn folder(self) -> &'static str {
        match self {
            Self::Claude => "current",
            Self::Codex => "codex",
        }
    }
}

/// Splits the export slot from a path served by the `mascot` protocol.
pub fn route(url_path: &str) -> Option<(Slot, String)> {
    let (name, rest) = url_path.strip_prefix('/')?.split_once('/')?;
    Some((Slot::parse(name)?, format!("/{rest}")))
}

/// One response of the `mascot` protocol.
#[derive(Debug)]
pub struct Served {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// The iframe page: loads the export's mascot.js and its manifest, then plays
/// the states the island posts. Talks to the island by postMessage only.
pub const FRAME_PATH: &str = "__coucou_frame.html";
const FRAME_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>Coucou mascot</title>
<style>
:root { color-scheme: dark; }
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
mascot-avatar { display: block; width: 100%; height: 100%; }
</style></head>
<body>
<script>
(function () {
  var avatar = null;
  var wanted = null;
  function tell(message) { window.parent.postMessage(message, "*"); }
  function play() { if (avatar && wanted) avatar.play(wanted.state, { immediate: wanted.immediate }); }
  // The engine's canvas, wherever it sits in the shadow roots (none for a video).
  function canvasIn(root) {
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      if (all[i].tagName === "CANVAS") return all[i];
      if (all[i].shadowRoot) { var c = canvasIn(all[i].shadowRoot); if (c) return c; }
    }
    return null;
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || !event.data) return;
    var data = event.data;
    if (data.type === "state") {
      wanted = { state: String(data.state), immediate: !!data.immediate };
      play();
    } else if (data.type === "pointer") {
      // The island is the one that sees the mouse: it is replayed here, where
      // the engine listens for it (and looks at the cursor).
      window.dispatchEvent(new PointerEvent("pointermove", {
        clientX: Number(data.x), clientY: Number(data.y), pointerType: "mouse", bubbles: true,
      }));
    } else if (data.type === "poke" && avatar) {
      // A click on the engine's canvas: Wobnimo hops, and mascot.js plays its
      // "clicked" state when the export has one.
      var target = canvasIn(avatar.shadowRoot || avatar) || avatar;
      target.click();
    }
  });
  var script = document.createElement("script");
  script.src = "mascot.js";
  script.onerror = function () { tell({ type: "error", message: "mascot.js failed to load" }); };
  script.onload = function () {
    customElements.whenDefined("mascot-avatar").then(function () {
      var el = document.createElement("mascot-avatar");
      el.setAttribute("manifest", "manifest.json");
      el.setAttribute("parallax", "false");
      document.body.appendChild(el);
      return el.ready().then(function () { avatar = el; tell({ type: "ready" }); play(); });
    }).catch(function (err) { tell({ type: "error", message: String(err) }); });
  };
  document.head.appendChild(script);
})();
</script>
</body></html>
"#;

/// The 3D engine (Wobnimo) draws its character edge to edge: a hop or a shake
/// leaves the box and is cut. Unless the export sets its own, Coucou frames it
/// wider (the camera sees 1.2 times more: the robot fills about 83 % of the box).
const CORNER_FRAMING_3D: f64 = 1.2;

/// The manifest as the mascot gets it: a 3D one framed with room to move.
fn with_room(bytes: Vec<u8>) -> Vec<u8> {
    let Ok(mut manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return bytes };
    if manifest.get("engine").and_then(|e| e.as_str()) != Some("3d") {
        return bytes;
    }
    let Some(fields) = manifest.as_object_mut() else { return bytes };
    let config = fields.entry("engine_config").or_insert_with(|| serde_json::json!({}));
    let Some(config) = config.as_object_mut() else { return bytes };
    config.entry("framing").or_insert(serde_json::json!(CORNER_FRAMING_3D));
    serde_json::to_vec(&manifest).unwrap_or(bytes)
}

/// Answers `url_path` from the files under `root`, with an optional `Range` header.
pub fn respond(root: &Path, url_path: &str, range: Option<&str>) -> Served {
    if url_path.split(['?', '#']).next().unwrap_or("").trim_start_matches('/') == FRAME_PATH {
        return Served {
            status: 200,
            headers: vec![
                ("Content-Type", "text/html; charset=utf-8".to_string()),
                ("Cache-Control", "no-store".to_string()),
            ],
            body: FRAME_HTML.as_bytes().to_vec(),
        };
    }
    let not_found = || Served { status: 404, headers: vec![("Access-Control-Allow-Origin", "*".into())], body: Vec::new() };
    let rel = percent_decode(url_path.split(['?', '#']).next().unwrap_or(""));
    let Some(file) = file_inside(root, rel.trim_start_matches('/')) else { return not_found() };
    let Ok(bytes) = std::fs::read(&file) else { return not_found() };
    let bytes = if rel.trim_start_matches('/') == "manifest.json" { with_room(bytes) } else { bytes };

    let mut headers = vec![
        ("Content-Type", mime_of(&file).to_string()),
        ("Access-Control-Allow-Origin", "*".to_string()),
        ("Cache-Control", "no-store".to_string()),
        ("Accept-Ranges", "bytes".to_string()),
    ];
    let total = bytes.len();
    match range.and_then(|r| byte_range(r, total)) {
        Some((start, end)) => {
            headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
            Served { status: 206, headers, body: bytes[start..=end].to_vec() }
        }
        None => Served { status: 200, headers, body: bytes },
    }
}

/// `%XX` escapes decoded; anything malformed is kept as it is.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// "bytes=a-b" or "bytes=a-" as an inclusive range inside `total`.
fn byte_range(header: &str, total: usize) -> Option<(usize, usize)> {
    let (start, end) = header.strip_prefix("bytes=")?.split_once('-')?;
    let start: usize = start.trim().parse().ok()?;
    let end: usize = match end.trim() {
        "" => total.checked_sub(1)?,
        e => e.parse::<usize>().ok()?.min(total.checked_sub(1)?),
    };
    (start <= end).then_some((start, end))
}

fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("js" | "mjs") => "text/javascript",
        Some("json") => "application/json",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("css") => "text/css",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

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
    /// The `mascot` protocol's root: manifest.json and mascot.js are served under it.
    pub base_url: String,
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

pub fn slot_dir(slot: Slot) -> PathBuf {
    mascots_dir().join(slot.folder())
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
pub fn read_export(dir: &Path, slot: Slot) -> Result<MascotInfo, ImportError> {
    let manifest_path = dir.join("manifest.json");
    let text = std::fs::read_to_string(&manifest_path).map_err(|_| ImportError::NotAnExport)?;
    let manifest: serde_json::Value = serde_json::from_str(&text).map_err(|_| ImportError::BadManifest)?;
    // No version at all: some other app's manifest.json (a web app, an extension).
    match manifest.get("version").and_then(|v| v.as_u64()) {
        None => return Err(ImportError::NotAnExport),
        Some(2) => {}
        Some(_) => return Err(ImportError::WrongVersion),
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
        base_url: format!("{BASE_URL}{}/", slot.name()),
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

/// Copies `src` to the named slot folder, keeping the old one if anything fails.
pub fn install(src: &Path, dest_root: &Path, name: &str) -> Result<MascotInfo, ImportError> {
    let slot = match name {
        "current" => Slot::Claude,
        "codex" => Slot::Codex,
        _ => return Err(ImportError::Io),
    };
    // Checked where it is first: nothing is copied from a folder that isn't an export.
    read_export(src, slot)?;
    let tmp = dest_root.join(format!("{name}.tmp"));
    let current = dest_root.join(name);
    let _ = std::fs::remove_dir_all(&tmp);
    if copy_tree(src, &tmp).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(ImportError::Io);
    }
    if let Err(e) = read_export(&tmp, slot) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    if current.exists() && std::fs::remove_dir_all(&current).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(ImportError::Io);
    }
    std::fs::rename(&tmp, &current).map_err(|_| ImportError::Io)?;
    read_export(&current, slot)
}

#[derive(Serialize, Clone)]
struct MascotChanged {
    slot: String,
    info: Option<MascotInfo>,
}

fn announce(app: &AppHandle, slot: Slot, info: &Option<MascotInfo>) {
    let event = MascotChanged { slot: slot.name().to_string(), info: info.clone() };
    let _ = app.emit("mascot-changed", event);
}

/// Settings → Choose a MascotForge folder. Off the main thread: a copy must
/// not freeze the island while an approval waits.
#[tauri::command(async)]
pub fn mascot_import(app: AppHandle, folder: String, slot: String) -> Result<MascotInfo, String> {
    let slot = Slot::parse(&slot).ok_or_else(|| "bad_slot".to_string())?;
    let src = find_export(Path::new(&folder)).ok_or_else(|| ImportError::NotAnExport.code().to_string())?;
    match install(&src, &mascots_dir(), slot.folder()) {
        Ok(info) => {
            announce(&app, slot, &Some(info.clone()));
            Ok(info)
        }
        Err(ImportError::MissingFile(file)) => Err(format!("missing_file:{file}")),
        Err(e) => Err(e.code().to_string()),
    }
}

/// The active mascot, if any.
#[tauri::command]
pub fn mascot_current(slot: String) -> Option<MascotInfo> {
    let slot = Slot::parse(&slot)?;
    read_export(&slot_dir(slot), slot).ok()
}

/// Settings → Back to Mochi.
#[tauri::command]
pub fn mascot_clear(app: AppHandle, slot: String) {
    let Some(slot) = Slot::parse(&slot) else { return };
    let _ = std::fs::remove_dir_all(slot_dir(slot));
    announce(&app, slot, &None);
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
    fn route_splits_the_slot_from_the_path() {
        assert_eq!(
            route("/claude/manifest.json"),
            Some((Slot::Claude, "/manifest.json".into()))
        );
        assert_eq!(
            route("/codex/__coucou_frame.html"),
            Some((Slot::Codex, "/__coucou_frame.html".into()))
        );
        assert_eq!(route("/other/x"), None);
        assert_eq!(route("/"), None);
    }

    #[test]
    fn each_slot_has_its_own_folder() {
        assert!(slot_dir(Slot::Claude).ends_with("current"));
        assert!(slot_dir(Slot::Codex).ends_with("codex"));
    }

    #[test]
    fn install_writes_the_named_folder() {
        let dest = scratch("install-named-root");
        let src = scratch("install-named-src");
        blob_export(&src);

        install(&src, &dest, "codex").unwrap();

        assert!(dest.join("codex/manifest.json").is_file());
        assert!(!dest.join("current").exists());
    }

    #[test]
    fn the_base_url_names_the_slot() {
        let dir = scratch("base-url").join("codex");
        blob_export(&dir);

        let info = read_export(&dir, Slot::Codex).unwrap();

        assert!(info.base_url.ends_with("codex/"));
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
        let info = read_export(&dir, Slot::Claude).unwrap();
        assert_eq!(info.name, "nuage");
        assert_eq!(info.engine, "blob");
        assert_eq!(info.states.len(), 8);
        assert_eq!(info.default_state, "idle");
        assert_eq!(info.credit.as_deref(), Some("Blob Atelier"));
        assert!(info.manifest_path.ends_with("manifest.json"));
        assert!(info.script_path.ends_with("mascot.js"));
        assert_eq!(info.base_url, format!("{BASE_URL}claude/"));
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
        let info = read_export(&dir, Slot::Claude).unwrap();
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
        assert_eq!(read_export(&dir, Slot::Claude), Err(ImportError::MissingFile("videos/idle.mp4".into())));
    }

    #[test]
    fn version_one_is_refused() {
        let dir = scratch("v1");
        write(&dir.join("manifest.json"), r#"{"version":1,"name":"old","states":{}}"#);
        write(&dir.join("mascot.js"), "// component");
        assert_eq!(read_export(&dir, Slot::Claude), Err(ImportError::WrongVersion));
    }

    #[test]
    fn a_broken_manifest_is_refused() {
        let dir = scratch("broken");
        write(&dir.join("manifest.json"), "{ not json");
        write(&dir.join("mascot.js"), "// component");
        assert_eq!(read_export(&dir, Slot::Claude), Err(ImportError::BadManifest));
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
        assert_eq!(read_export(&dir, Slot::Claude), Err(ImportError::MissingFile("../outside.js".into())));
    }

    #[test]
    fn an_install_replaces_the_current_mascot() {
        let root = scratch("install-root");
        let src = scratch("install-src");
        blob_export(&src);
        let info = install(&src, &root, "current").unwrap();
        assert_eq!(info.name, "nuage");
        assert!(root.join("current/engines/agent-mascot.js").is_file());
        assert!(info.manifest_path.starts_with(&*root.join("current").to_string_lossy()));
        assert!(!root.join("current.tmp").exists());
    }

    fn header<'a>(served: &'a Served, name: &str) -> Option<&'a str> {
        served.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    #[test]
    fn a_module_is_served_with_its_type_and_cors() {
        let root = scratch("serve-js");
        write(&root.join("engines/wobnimo.js"), "export {}");
        let served = respond(&root, "/engines/wobnimo.js", None);
        assert_eq!(served.status, 200);
        assert_eq!(served.body, b"export {}");
        assert_eq!(header(&served, "Content-Type"), Some("text/javascript"));
        assert_eq!(header(&served, "Access-Control-Allow-Origin"), Some("*"));
        assert_eq!(header(&served, "Cache-Control"), Some("no-store"));
    }

    #[test]
    fn a_video_range_is_partial() {
        let root = scratch("serve-range");
        write(&root.join("videos/idle.mp4"), "0123456789");
        let served = respond(&root, "/videos/idle.mp4", Some("bytes=2-5"));
        assert_eq!(served.status, 206);
        assert_eq!(served.body, b"2345");
        assert_eq!(header(&served, "Content-Type"), Some("video/mp4"));
        assert_eq!(header(&served, "Content-Range"), Some("bytes 2-5/10"));
    }

    #[test]
    fn an_open_range_runs_to_the_end() {
        let root = scratch("serve-open-range");
        write(&root.join("videos/idle.mp4"), "0123456789");
        let served = respond(&root, "/videos/idle.mp4", Some("bytes=7-"));
        assert_eq!(served.status, 206);
        assert_eq!(served.body, b"789");
        assert_eq!(header(&served, "Content-Range"), Some("bytes 7-9/10"));
    }

    #[test]
    fn nothing_outside_the_mascot_is_served() {
        let root = scratch("serve-escape").join("current");
        write(&root.join("manifest.json"), "{}");
        write(&root.parent().unwrap().join("secret.txt"), "secret");
        assert_eq!(respond(&root, "/../secret.txt", None).status, 404);
        assert_eq!(respond(&root, "/%2e%2e/secret.txt", None).status, 404);
        assert_eq!(respond(&root, "/%2E%2E%5Csecret.txt", None).status, 404);
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let root = scratch("serve-missing");
        assert_eq!(respond(&root, "/mascot.js", None).status, 404);
    }

    #[test]
    fn encoded_names_are_decoded() {
        let root = scratch("serve-encoded");
        write(&root.join("videos/my clip.mp4"), "x");
        assert_eq!(respond(&root, "/videos/my%20clip.mp4", None).status, 200);
    }

    #[test]
    fn a_web_app_manifest_is_not_an_export() {
        let dir = scratch("pwa");
        write(&dir.join("manifest.json"), r#"{"name":"My PWA","icons":[]}"#);
        write(&dir.join("mascot.js"), "// not ours");
        assert_eq!(read_export(&dir, Slot::Claude), Err(ImportError::NotAnExport));
    }

    #[test]
    fn the_frame_page_comes_from_the_mascot_origin() {
        let root = scratch("frame");
        let served = respond(&root, "/__coucou_frame.html", None);
        assert_eq!(served.status, 200);
        assert_eq!(header(&served, "Content-Type"), Some("text/html; charset=utf-8"));
        let page = String::from_utf8(served.body).unwrap();
        assert!(page.contains("mascot-avatar"));
        assert!(page.contains("color-scheme: dark"));
    }

    const ORBI_3D: &str = r#"{"version":2,"name":"orbi","engine":"3d","engine_src":"engines/wobnimo.js",
        "engine_config":{},"default_state":"idle","alpha":"none","states":{"idle":{"loop":true}}}"#;

    fn served_manifest(root: &Path) -> serde_json::Value {
        serde_json::from_slice(&respond(root, "/manifest.json", None).body).unwrap()
    }

    #[test]
    fn a_3d_mascot_is_framed_with_room_to_hop() {
        let root = scratch("framing");
        write(&root.join("manifest.json"), ORBI_3D);
        assert_eq!(served_manifest(&root)["engine_config"]["framing"], serde_json::json!(CORNER_FRAMING_3D));
        // A manifest without engine_config gets one.
        write(&root.join("manifest.json"), &ORBI_3D.replace(r#""engine_config":{},"#, ""));
        assert_eq!(served_manifest(&root)["engine_config"]["framing"], serde_json::json!(CORNER_FRAMING_3D));
    }

    #[test]
    fn an_exports_own_framing_and_other_engines_are_left_alone() {
        let root = scratch("framing-own");
        write(&root.join("manifest.json"), &ORBI_3D.replace(r#""engine_config":{}"#, r#""engine_config":{"framing":1.5}"#));
        assert_eq!(served_manifest(&root)["engine_config"]["framing"], serde_json::json!(1.5));
        let blob = scratch("framing-blob");
        write(&blob.join("manifest.json"), BLOB);
        assert_eq!(respond(&blob, "/manifest.json", None).body, BLOB.as_bytes());
    }

    #[test]
    fn the_frame_page_handles_pause_and_mini_mode() {
        let root = scratch("frame-pause");
        let page = String::from_utf8(respond(&root, "/__coucou_frame.html?mini=1", None).body).unwrap();
        assert!(page.contains(r#"data.type === "pause""#));
        assert!(page.contains(r#"searchParams.get("mini")"#));
    }

    #[test]
    fn the_frame_page_lets_the_mascot_see_the_cursor_and_the_clicks() {
        let root = scratch("frame-input");
        let page = String::from_utf8(respond(&root, "/__coucou_frame.html", None).body).unwrap();
        assert!(!page.contains(r#"setAttribute("follow-cursor", "false")"#), "the engine must track the cursor");
        assert!(page.contains(r#""pointer""#) && page.contains("pointermove"));
        assert!(page.contains(r#""poke""#));
    }

    #[test]
    fn a_failed_install_keeps_the_current_mascot() {
        let root = scratch("keep-root");
        let good = scratch("keep-good");
        blob_export(&good);
        install(&good, &root, "current").unwrap();
        let before = fs::read_to_string(root.join("current/manifest.json")).unwrap();

        let bad = scratch("keep-bad");
        write(&bad.join("manifest.json"), r#"{"version":1,"name":"old","states":{}}"#);
        write(&bad.join("mascot.js"), "// component");
        assert_eq!(install(&bad, &root, "current"), Err(ImportError::WrongVersion));
        assert_eq!(fs::read_to_string(root.join("current/manifest.json")).unwrap(), before);
    }
}
