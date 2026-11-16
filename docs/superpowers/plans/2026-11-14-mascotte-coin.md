# Mascotte MascotForge dans le coin : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coucou Windows affiche n'importe quel export MascotForge (blob, 3D, vidéo) dans un coin de l'écran, sans fond, et ouvre le panneau de l'île à côté d'elle au survol ou sur alerte.

**Architecture:** La fenêtre `island` existante change d'ancrage : en mode « coin », Rust la place dans un coin et la fait grandir vers le centre quand le panneau s'ouvre (`corner_layout`, fonction pure testée). La mascotte tourne dans une iframe (`mascot-frame.html`) qui charge l'export copié dans `%APPDATA%\Coucou\mascots\current` par le protocole d'assets de Tauri ; l'île lui envoie l'état à jouer par `postMessage`. Le clic-traversant existant passe d'un rectangle à une liste.

**Tech Stack:** Tauri 2 (Rust), TypeScript strict, Vite 6, `node:test`, `cargo test`, GitHub Actions (`windows-ci.yml`, `windows.yml`).

**Spec:** `docs/superpowers/specs/2026-11-14-mascotte-coin-design.md`

## Global Constraints

- Branche `dan-lion` du fork `Darius-Tokam/coucou`. Jamais de commit sur `main`, jamais de push vers `Louis-CFM/coucou`.
- Tous les chemins de code sont relatifs à `windows/` sauf mention contraire.
- TypeScript strict : `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (`import type` pour les types).
- Ne pas toucher à `coucou-hook`, à `hooks.rs`, ni à la logique de surveillance et d'autorisation.
- Aucun secret dans le code. Aucun em-dash dans la prose, les commits ou les chaînes.
- Chaînes visibles : clé anglaise passée à `t()`, traduction ajoutée dans `src/i18n/extra.json` pour les 13 langues `zh-Hans, hi, es, ar, fr, bn, pt-BR, ru, id, de, tr, ko, ja`. `tests/i18n.test.mjs` échoue sinon. Ne jamais éditer `strings.json`.
- Tout bouton : retour visuel à l'appui (`transform: scale(0.97)` + transition), état « en cours » désactivé pendant une action asynchrone, message d'échec visible dans la page, `:focus-visible` marqué.
- Taille de la mascotte : 200 × 200 px logiques. Fermeture du panneau : 300 ms après la sortie du curseur.
- Le PC de Darius a ~11 Go libres sur C: et Node 22.14 (`npm test` y échoue sur `module.registerHooks`). `npm test` et `cargo test` se vérifient en CI ; `tsc` et `vite build` se vérifient en local. Avant tout `tauri dev` local, vérifier au moins 8 Go libres.
- Exports de test : `C:\Users\Darius\Desktop\text-to-mascot\exports\mascot-blob-04bb2162`, `...\mascot-3d-03adb60e`, `...\mascot-5791080d` (vidéo, alpha `stacked`). Lecture seule.

## Review Focus

1. Un écran débranché pendant que la mascotte y vivait : elle doit réapparaître en bas à droite de l'écran principal (test dans la tâche 5).
2. Darius choisit le dossier parent de l'export (celui qui contient `mascot/`) ou un dossier quelconque : le premier marche, le second affiche « Ce dossier ne contient pas d'export MascotForge » sans toucher à la mascotte active (tests dans la tâche 2).
3. Une mascotte placée en haut à gauche : le panneau s'ouvre vers la droite et le bas et reste entier à l'écran, même si la place manque d'un côté (test dans la tâche 5).
4. Changer de mascotte pendant qu'une autorisation attend : le panneau et les boutons Autoriser / Refuser restent en place, seule l'iframe recharge (vérification dans la tâche 8).
5. Un export vidéo sans masque alpha (`"alpha": "none"`) : il se charge, et les Réglages affichent l'avertissement de fond (test dans la tâche 2, vérification dans la tâche 7).

---

### Task 1: Retirer le lion

**Files:**
- Delete: `src/mochi/lion.ts`, `src/mochi/assets/lion-corps.png`, `src/mochi/assets/lion-coeur.png`, `dev/lion-preview.html`
- Restore from `main`: `src/mochi/engine.ts`, `src/mochi/greeting.ts`

**Interfaces:**
- Produces: un `BotEngine` identique à celui de `main`.

- [ ] **Step 1:** `git checkout main -- src/mochi/engine.ts src/mochi/greeting.ts` puis `git rm src/mochi/lion.ts src/mochi/assets/lion-corps.png src/mochi/assets/lion-coeur.png dev/lion-preview.html`.
- [ ] **Step 2:** Run `git diff main --stat -- src dev`. Expected: aucune ligne.
- [ ] **Step 3:** Run `npx tsc --noEmit; echo RC=$?` puis `npx vite build; echo RC=$?`. Expected: `RC=0` deux fois, aucun fichier `lion-*` dans `dist/assets`.
- [ ] **Step 4:** Commit `git commit -m "Retire le lion Dan, retour a Mochi"`.

### Task 2: Importer un export MascotForge (Rust)

**Files:**
- Create: `src-tauri/src/mascot.rs`
- Modify: `src-tauri/src/lib.rs` (déclarer le module, enregistrer les commandes vers la ligne 917, autoriser le dossier dans le protocole d'assets au `setup`)
- Modify: `src-tauri/Cargo.toml` (feature `protocol-asset` sur `tauri`)
- Modify: `src-tauri/tauri.conf.json` (`app.security.assetProtocol = { "enable": true, "scope": [] }`)
- Modify: `src/core/bridge.ts` (trois méthodes + type `MascotInfo`)

**Interfaces:**
- Produces (Rust) :
  - `#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")] pub struct MascotInfo { name: String, engine: String /* "blob" | "3d" | "video" */, credit: Option<String>, alpha: String /* "stacked" | "none" */, states: Vec<String>, default_state: String, manifest_path: String, script_path: String }`
  - `pub enum ImportError { NotAnExport, BadManifest, WrongVersion, MissingFile(String), Io }` avec `fn code(&self) -> &'static str` qui rend `"not_an_export" | "bad_manifest" | "wrong_version" | "missing_file" | "io"`.
  - `pub fn mascots_dir() -> PathBuf` = `platform::config_dir().join("mascots")` ; dossier actif `mascots_dir().join("current")`.
  - `pub fn find_export(chosen: &Path) -> Option<PathBuf>` : `chosen` s'il contient `manifest.json`, sinon `chosen/mascot` s'il en contient un.
  - `pub fn read_export(dir: &Path) -> Result<MascotInfo, ImportError>` : exige `version == 2`, `mascot.js`, le fichier `engine_src` s'il est présent, chaque `states.*.src`. `engine` = champ `engine`, ou `"video"` s'il manque. `name` = champ `name`.
  - `pub fn install(src: &Path, dest_root: &Path) -> Result<MascotInfo, ImportError>` : copie dans `dest_root/current.tmp`, valide la copie, remplace `dest_root/current`, rend l'info lue dans la copie.
  - Commandes : `mascot_import(app, folder: String) -> Result<MascotInfo, String>` (erreur = `code()`), `mascot_current() -> Option<MascotInfo>`, `mascot_clear(app)`. Import et suppression émettent `mascot-changed` avec `Option<MascotInfo>` vers toutes les fenêtres.
- Produces (TS, `bridge.ts`) : `interface MascotInfo` (mêmes champs en camelCase), `Bridge.mascotImport(folder: string): Promise<MascotInfo | string>` (rend le code d'erreur en cas d'échec), `Bridge.mascotCurrent(): Promise<MascotInfo | null>`, `Bridge.mascotClear(): Promise<void>`.

- [ ] **Step 1: Write the failing tests** dans `#[cfg(test)] mod tests` de `mascot.rs`, sur des dossiers temporaires construits par le test (`std::env::temp_dir()` + nom unique) :
  - `an_export_folder_is_found_from_its_parent` : parent/mascot/manifest.json existe → `find_export(parent) == Some(parent/mascot)`.
  - `a_folder_without_manifest_is_not_an_export` → `find_export` rend `None`.
  - `a_blob_export_reads_its_engine_and_states` : manifeste blob avec 8 états → `engine == "blob"`, `states.len() == 8`, `default_state == "idle"`.
  - `a_video_export_without_engine_is_video` : manifeste sans `engine`, `"alpha": "none"` → `engine == "video"`, `alpha == "none"`.
  - `a_missing_clip_is_reported` : `states.idle.src = "videos/idle.mp4"` absent → `Err(MissingFile("videos/idle.mp4"))`.
  - `version_one_is_refused` → `Err(WrongVersion)`.
  - `a_failed_install_keeps_the_current_mascot` : `current/` contient un export valide, `install` d'un export invalide → `Err`, et `current/manifest.json` inchangé.
- [ ] **Step 2:** Les tests ne compilent pas tant que `mascot.rs` est vide. Ils tournent en CI (tâche 8) ; en local, `cargo test -p coucou mascot` seulement si au moins 8 Go sont libres.
- [ ] **Step 3:** Implémenter les fonctions et les trois commandes. Au `setup` de `lib.rs`, appeler `app.asset_protocol_scope().allow_directory(mascot::mascots_dir(), true)`.
- [ ] **Step 4:** Ajouter les méthodes de `Bridge`. Run `npx tsc --noEmit; echo RC=$?`. Expected: `RC=0`.
- [ ] **Step 5:** Commit `git commit -m "Import d'un export MascotForge dans le dossier de Coucou"`.

### Task 3: L'iframe de la mascotte (preuve sur les trois moteurs)

C'est le risque principal de la conception : à faire valider avant la géométrie.

**Files:**
- Create: `mascot-frame.html` (page Vite, ajoutée aux entrées de `vite.config.ts` comme les autres pages HTML)
- Create: `src/mascot/frame.ts` (code de la page iframe)
- Create: `src/mascot/host.ts` (côté île)
- Create: `src/mascot/protocol.ts` (types des messages)
- Modify: `src-tauri/tauri.conf.json` : ajouter `asset: http://asset.localhost` à `script-src`, `media-src`, `img-src`, `connect-src`, et `frame-src 'self'`, dans `csp` et `devCsp`.

**Interfaces:**
- Consumes: `MascotInfo`, `Bridge.mascotCurrent` (tâche 2).
- Produces :
  - `protocol.ts` : `type HostMessage = { type: "load"; manifestUrl: string; scriptUrl: string } | { type: "state"; state: string; immediate: boolean } | { type: "clear" }` et `type FrameMessage = { type: "ready"; states: string[]; defaultState: string } | { type: "error"; message: string }`.
  - `host.ts` : `class MascotHost { constructor(container: HTMLElement); load(info: MascotInfo | null): void; play(state: string, immediate: boolean): void; get active(): boolean; onError: ((message: string) => void) | null }`. `load` crée ou recharge l'iframe (nouvelle URL avec `?v=<compteur>`, donc nouveau document et nouveau registre de composants), convertit les chemins avec `convertFileSrc` de `@tauri-apps/api/core`, et envoie `load` quand l'iframe est prête. `load(null)` retire l'iframe. Les messages reçus sont filtrés sur `event.source === iframe.contentWindow`.
  - `frame.ts` : à `load`, ajoute une balise `<script src=scriptUrl>`, puis `<mascot-avatar manifest=manifestUrl follow-cursor="false">` en plein cadre, fond transparent ; attend `ready()` et répond `ready`. À `state`, appelle `avatar.play(state, { immediate })`. Toute erreur de chargement répond `error`.
  - L'iframe a `pointer-events: none` : la souris est gérée par l'île (tâche 6).

- [ ] **Step 1:** Implémenter `protocol.ts`, `host.ts`, `frame.ts`, `mascot-frame.html`, la CSP. Run `npx tsc --noEmit; echo RC=$?` et `npx vite build; echo RC=$?`. Expected: `RC=0`, `dist/mascot-frame.html` présent.
- [ ] **Step 2: Preuve dans l'app.** Brancher temporairement un `MascotHost` dans un coin de la page de l'île (position fixe 200 × 200 en bas à droite de la fenêtre ouverte), importer tour à tour les trois exports de test par `Bridge.mascotImport` depuis la console de développement, et lancer `npm run tauri dev` (Rust dans le PATH : `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`).
  Expected pour chacun : la mascotte s'affiche et bouge, aucun rectangle de fond autour d'elle (capture d'écran sur un fond clair et un fond sombre), aucune erreur CSP ni CORS dans la console. Pour la 3D, le module `engines/wobnimo.js` se charge depuis `http://asset.localhost`.
- [ ] **Step 3:** Si le module ES 3D est refusé (CORS ou type MIME), arrêter et rapporter l'erreur exacte de la console à Darius avant toute autre tâche. Ne pas contourner en modifiant les fichiers de l'export.
- [ ] **Step 4:** Retirer le branchement temporaire. Commit `git commit -m "Iframe qui affiche une mascotte MascotForge"`.

### Task 4: Correspondance des états

**Files:**
- Create: `src/mascot/states.ts`
- Test: `tests/mascot-states.test.mjs`

**Interfaces:**
- Consumes: `BotStateName` (`src/core/layout.ts:31`).
- Produces : `MASCOT_STATE_FALLBACKS: Record<BotStateName, readonly string[]>` (table copiée de la conception), `resolveMascotState(state: BotStateName, available: readonly string[], defaultState: string): string`, `playsImmediately(state: BotStateName): boolean` (`true` pour `approval` et `question`).

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMascotState, playsImmediately, MASCOT_STATE_FALLBACKS } from "../src/mascot/states.ts";

const BLOB = ["idle","listening","thinking","talking","working","happy","done","error"];
const VIDEO = ["idle","thinking","talking","error"];

test("every Coucou state has a fallback list", () => {
  for (const s of ["idle","working","thinking","searching","approval","question","error","finished","ratelimit","sleeping","dizzy"])
    assert.ok(MASCOT_STATE_FALLBACKS[s].length > 0, s);
});
test("approval asks the blob to listen", () => assert.equal(resolveMascotState("approval", BLOB, "idle"), "listening"));
test("approval on a video mascot talks", () => assert.equal(resolveMascotState("approval", VIDEO, "idle"), "talking"));
test("finished on a blob is done", () => assert.equal(resolveMascotState("finished", BLOB, "idle"), "done"));
test("searching on a video thinks", () => assert.equal(resolveMascotState("searching", VIDEO, "idle"), "thinking"));
test("sleeping without a sleeping state falls back to idle", () => assert.equal(resolveMascotState("sleeping", VIDEO, "idle"), "idle"));
test("nothing matches: the default state", () => assert.equal(resolveMascotState("dizzy", ["wave"], "wave"), "wave"));
test("only approval and question are immediate", () => {
  assert.equal(playsImmediately("approval"), true);
  assert.equal(playsImmediately("question"), true);
  assert.equal(playsImmediately("working"), false);
});
```

- [ ] **Step 2:** Les tests tournent en CI (Node 24). En local, vérifier au moins que `npx tsc --noEmit` passe.
- [ ] **Step 3:** Implémenter `states.ts`.
- [ ] **Step 4:** Commit `git commit -m "Correspondance entre etats Coucou et etats MascotForge"`.

### Task 5: Géométrie du coin (Rust)

**Files:**
- Modify: `src-tauri/src/island.rs` (fonction pure, `PollGate.rects`, branche dans `apply_geometry`, test de clic)
- Modify: `src-tauri/src/settings.rs` (deux clés, test `CUSTOM` ligne ~456 et test de l'ordre des clés ligne ~972)
- Modify: `src-tauri/src/lib.rs` (`set_island_rects`, `set_corner_open`, sauvegarde de position au déplacement, `save_settings` qui conserve `corner_pos` comme il conserve `desktop_mochi`)
- Modify: `src/core/state.ts` (`Settings`, `DEFAULT_SETTINGS`), `src/core/bridge.ts`

**Interfaces:**
- Produces (Rust) :
  - Réglages : `island_anchor: String` (`"top" | "corner"`, défaut `"corner"`), `corner_pos: Option<CornerPos>` avec `CornerPos { x: f64, y: f64 }` = coin haut gauche de la mascotte en pixels physiques de l'écran virtuel ; `None` = défaut.
  - `pub const MASCOT_SIZE: f64 = 200.0;`
  - `#[derive(Serialize, Clone, Copy)] #[serde(rename_all = "camelCase")] pub struct CornerLayout { window: Rect, mascot: Rect, panel: Option<Rect> }` où `window` est en pixels physiques écran et `mascot` / `panel` en pixels logiques relatifs à la fenêtre. `Rect { x, y, w, h: f64 }`.
  - `pub fn corner_layout(work: Rect /* zone de travail, physique */, scale: f64, mascot_at: Option<(f64, f64)>, panel: Option<(f64, f64)> /* logique */) -> CornerLayout`. Sans `mascot_at`, ou si la mascotte ne tient pas entière dans `work` : coin bas droit de `work` avec 16 px logiques de marge. Le panneau se place du côté du centre de `work` en x et en y, collé à la mascotte, puis se décale pour rester entier dans `work`. La mascotte ne bouge jamais à cause du panneau.
  - `PollGate.rect: Mutex<IslandRect>` devient `rects: Mutex<Vec<IslandRect>>` ; le test de clic (`island.rs` ~560) accepte le curseur s'il est dans l'un des rectangles agrandi de `HIT_MARGIN`. `set_island_rect` reste et remplace la liste par un seul rectangle.
  - Commandes : `set_island_rects(rects: Vec<IslandRect>)` ; `set_corner_open(open: bool, panel_w: f64, panel_h: f64) -> Option<CornerLayout>` qui applique la géométrie et rend le placement (`None` en mode `"top"`).
  - Fenêtre `island` déplacée par l'utilisateur en mode coin, panneau fermé : enregistrer `corner_pos` (événement `WindowEvent::Moved`, regroupé sur 500 ms).
- Produces (TS) : `Settings.islandAnchor: "top" | "corner"`, `Settings.cornerPos: { x: number; y: number } | null`, `Bridge.setIslandRects(rects: Rect[])`, `Bridge.setCornerOpen(open: boolean, panelW: number, panelH: number): Promise<CornerLayout | null>`, types `Rect` et `CornerLayout`.

- [ ] **Step 1: Write the failing tests** dans un nouveau `#[cfg(test)] mod corner_tests` d'`island.rs` (écran 1920 × 1040 de zone de travail, échelle 1 sauf mention) :
  - `the_mascot_starts_bottom_right` : `mascot_at = None`, panneau fermé → `window == Rect{x:1704, y:824, w:200, h:200}`.
  - `the_panel_opens_toward_the_centre` : mascotte en bas à droite, panneau 720 × 320 → panneau à gauche de la mascotte et son bas aligné sur celui de la mascotte ; la mascotte garde sa position à l'écran.
  - `a_top_left_mascot_opens_right_and_down` : `mascot_at = Some((16, 16))` → panneau à droite, haut aligné.
  - `the_panel_stays_on_screen` : mascotte à 100 px du haut, panneau 320 de haut, vers le haut → le panneau descend pour rester entier dans `work`.
  - `a_lost_screen_sends_the_mascot_home` : `mascot_at = Some((5000, 5000))` hors de `work` → coin bas droit.
  - `scale_two_doubles_the_window` : échelle 2 → `window.w == 400`, `mascot.w == 200`.
  - `a_click_between_mascot_and_panel_goes_through` : deux rectangles disjoints → un point dans le coin vide du rectangle englobant n'est pas pris.
- [ ] **Step 2:** Les tests tournent en CI (tâche 8), ou en local avec `cargo test -p coucou corner` si au moins 8 Go sont libres.
- [ ] **Step 3:** Implémenter `corner_layout`, les deux clés de réglage (Rust et TS), la liste de rectangles, les deux commandes, la sauvegarde de position. `work` vient de l'écran choisi par le réglage existant `screen` (`target_monitor(app, &settings.screen)`, sa `work_area()`). En mode `"top"`, rien ne change.
- [ ] **Step 4:** Run `npx tsc --noEmit; echo RC=$?`. Expected: `RC=0`.
- [ ] **Step 5:** Commit `git commit -m "Geometrie de l'ile en mode coin"`.

### Task 6: L'île en mode coin (TS)

**Files:**
- Create: `src/island/corner.ts` (logique du mode coin, sans DOM, testable)
- Modify: `src/island/island.ts` (`applyGeometry` ~882, `updateWindowCollapsed` ~917, `drawBot` ~1361, `syncDom` ~1542, `wireInput` ~1021, `wireFsm` ~408)
- Modify: `src/island/desktop.ts` (`init` ~67 : sortir tout de suite en mode coin), `src/main.ts` (écouter `mascot-changed`), `src/style.css` (classe `corner`)
- Test: `tests/corner.test.mjs`

**Interfaces:**
- Consumes: `MascotHost` (tâche 3), `resolveMascotState`, `playsImmediately` (tâche 4), `Bridge.setCornerOpen`, `Bridge.setIslandRects`, `CornerLayout` (tâche 5), `IslandStateMachine` (`src/island/fsm.ts`).
- Produces :
  - `corner.ts` : `export const CORNER_HOVER_CLOSE_S = 0.3;` et `export function cornerRects(layout: CornerLayout, panelOpen: boolean): Rect[]` (mascotte seule si fermé, mascotte + panneau sinon).
  - Comportement de l'île quand `settings.islandAnchor === "corner"` :
    - `wireFsm` : `hidden` et `petit` → panneau fermé (`setCornerOpen(false, …)`), `home` et `coucou` → panneau ouvert avec la vue actuelle. `alert(view)` reste inchangé, donc tout ce qui ouvre l'île aujourd'hui ouvre le panneau. `fsm.hoverCloseDelay = CORNER_HOVER_CLOSE_S`.
    - Une boîte `.mascot-box` de 200 × 200 placée sur `layout.mascot` contient l'iframe de `MascotHost` si une mascotte est active, sinon le canvas de Mochi (dessiné à `w = 200`). Le panneau est placé sur `layout.panel`, coins tous arrondis, sans forme d'encoche.
    - Une couche transparente au-dessus de `.mascot-box` reçoit la souris : survol → `fsm.mouseEntered()`, sortie → `fsm.mouseLeft()`, clic sans glissement → `fsm.click()` (épingle et désépingle), glissement au-delà de `DRAG_THRESHOLD` (`src/mochi/desktop-logic.ts`) → `getCurrentWindow().startDragging()`. Ajouter la permission `core:window:allow-start-dragging` à `src-tauri/capabilities/default.json`.
    - Après chaque changement de placement : `Bridge.setIslandRects(cornerRects(layout, open))`.
    - `syncDom` : si `MascotHost.active`, `host.play(resolveMascotState(State.effectiveState, states, defaultState), playsImmediately(State.effectiveState))` à chaque changement d'état, et `drawBot` ne dessine plus Mochi. Le Mochi du panneau, la garde-robe et le clic droit sur Mochi sont masqués.
    - `DesktopLink.init` sort sans rien faire.
    - Sobriété : `<mascot-avatar>` n'expose aucune méthode de pause. Coucou joue `sleeping` (via la table) quand l'état effectif est `sleeping`, et ne fait rien de plus. Si un moteur consomme trop au repos, la correction appartient à MascotForge : le noter dans le compte rendu de la tâche 8, sans modifier l'export.
  - Mode `"top"` : comportement actuel, inchangé.

- [ ] **Step 1: Write the failing tests** dans `tests/corner.test.mjs` :
  - `closed corner hits only the mascot` : `cornerRects(layout, false)` rend un rectangle égal à `layout.mascot`.
  - `open corner hits mascot and panel` : `cornerRects(layout, true)` rend `[layout.mascot, layout.panel]`.
  - `the corner closes faster than the top island` : `CORNER_HOVER_CLOSE_S === 0.3`.
  - Dans `tests/fsm.test.mjs`, ajouter `a pinned corner panel stays open after the mouse leaves` : `fsm.hoverCloseDelay = 0.3`, `mouseEntered`, avancer les minuteries, `click`, `mouseLeft`, avancer d'une seconde → `fsm.state === "home"`.
- [ ] **Step 2:** Implémenter. Run `npx tsc --noEmit; echo RC=$?` et `npx vite build; echo RC=$?`. Expected: `RC=0` deux fois.
- [ ] **Step 3:** Commit `git commit -m "Ile en mode coin : mascotte, survol, clic et deplacement"`.

### Task 7: Section « Mascotte » des Réglages

**Files:**
- Modify: `src/settings/main.ts` (nouvelle fonction `mascotSection()`, ajoutée à la page générale dans `render()` ~1539)
- Modify: `src/i18n/extra.json`

**Interfaces:**
- Consumes: `Bridge.pickFolder(null)` (existant), `Bridge.mascotImport`, `Bridge.mascotCurrent`, `Bridge.mascotClear` (tâche 2), `Settings.islandAnchor` (tâche 5), événement `mascot-changed`.
- Produces : une section avec
  - un `<select>` « Where Coucou lives » : « At the top of the screen » / « In a corner of the screen », qui écrit `settings.islandAnchor` puis `save()` ;
  - « Choose a MascotForge folder » : `pickFolder` puis `mascotImport` ; bouton désactivé avec indicateur pendant l'import ; erreur affichée sous le bouton selon le code : `not_an_export` → « This folder doesn't hold a MascotForge export. », `bad_manifest` → « The export's manifest.json can't be read. », `wrong_version` → « This export is too old. Export it again from MascotForge. », `missing_file` → « A file of the export is missing: {file} », `io` → « Coucou couldn't copy the folder. » ;
  - « Back to Mochi » : `mascotClear`, visible seulement si une mascotte est active ;
  - le nom de la mascotte active, son crédit (`credit`) s'il existe, et si `engine === "video"` et `alpha === "none"` : « This video has no transparency: it will show its background. »

- [ ] **Step 1:** Ajouter les clés anglaises ci-dessus dans `extra.json` avec les 13 traductions.
- [ ] **Step 2:** Implémenter `mascotSection()` avec les états de bouton des Global Constraints.
- [ ] **Step 3:** Run `npx tsc --noEmit; echo RC=$?`. Expected: `RC=0`. `tests/i18n.test.mjs` se vérifie en CI.
- [ ] **Step 4:** Commit `git commit -m "Reglages : choisir une mascotte MascotForge et la position de Coucou"`.

### Task 8: Vérification de bout en bout

**Files:** aucun fichier de code.

- [ ] **Step 1:** `git push origin dan-lion`, puis ouvrir une PR brouillon `dan-lion` → `main` **dans le fork** (`gh pr create -R Darius-Tokam/coucou --base main --head dan-lion --draft`), qui déclenche `windows-ci.yml`. Ne jamais la fusionner.
- [ ] **Step 2:** Suivre la CI jusqu'au bout. Expected: `tsc`, `npm test` (dont `mascot-states`, `corner`, `fsm`, `i18n`) et `cargo test --workspace --locked` verts. Sinon, corriger dans la tâche concernée.
- [ ] **Step 3:** Lancer `gh workflow run windows.yml -R Darius-Tokam/coucou --ref dan-lion`, suivre le run, télécharger `Coucou-Windows-setup` dans `windows/release/`. Darius installe.
- [ ] **Step 4:** Avec Darius, sur l'app installée, pour chacun des trois exports de test : capture du coin au repos sur fond clair et sombre (aucun fond), capture du panneau ouvert au survol, capture du panneau ouvert seul sur une demande d'autorisation de Claude Code, clic à côté du carré qui atteint l'application dessous, glisser la mascotte puis relancer Coucou (elle revient au même endroit), changer de mascotte pendant qu'une autorisation attend (le panneau et ses boutons restent).
- [ ] **Step 5:** Repasser les Réglages sur « At the top of the screen » : l'île d'origine revient, identique à `main`.
