# Une mascotte par agent : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans le mode coin de Coucou Windows, une petite mascotte MascotForge par session Claude Code ou Codex et par sous-agent, qui joue l'état de son agent, avec un export par famille d'agent.

**Architecture:** Un modèle pur côté page (`src/mascot/agents.ts`) suit les agents à partir des événements de hooks déjà reçus (`agent_id`, `session_id`). La page dit à Rust combien de cases afficher ; `corner_layout` (fonction pure testée) range ces cases en file le long du bord et agrandit la fenêtre du coin. Chaque petite mascotte est une iframe `MascotHost`, comme la grande. Le protocole `mascot` sert deux exports : `/claude/` et `/codex/`.

**Tech Stack:** Tauri 2 (Rust), TypeScript strict, Vite 6, `node:test`, `cargo test`, GitHub Actions (`windows-ci.yml`, `windows.yml`).

**Spec:** `docs/superpowers/specs/2026-11-14-mascottes-par-agent-design.md`

## Global Constraints

- Branche `dan-lion` du fork `Darius-Tokam/coucou`. Jamais de commit sur `main`, jamais de push vers `Louis-CFM/coucou`. Ne jamais fusionner la PR brouillon du fork.
- Chemins relatifs à `windows/` sauf mention contraire.
- TypeScript strict : `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- Ne pas toucher à `coucou-hook` (`hook/`) ni aux règles d'autorisation de `hooks.ts` : on lit les événements, on n'en change pas le traitement.
- Aucun secret, aucun em-dash dans la prose, les commits ou les chaînes.
- Chaînes visibles : clé anglaise passée à `t()`, traduction dans `src/i18n/extra.json` pour les 13 langues `zh-Hans, hi, es, ar, fr, bn, pt-BR, ru, id, de, tr, ko, ja` (`tests/i18n.test.mjs`).
- Tout bouton : retour à l'appui (`scale(0.97)`), état désactivé pendant une action asynchrone, échec visible, `:focus-visible`.
- Valeurs de la spec : petite mascotte 120 px logiques, écart 8 px, 8 petites au plus puis une case « +N », départ après 3 s de « terminé », départ de secours après 30 min sans événement, grande mascotte 240 px inchangée.
- Disque C: ~4 Go libres : aucune compilation Rust locale. Les tests Rust s'observent en CI : pousser le commit de tests seul, lire l'échec dans le run « Windows CI », puis pousser l'implémentation. `tsc` et les tests TS (`node --experimental-strip-types --no-warnings --test <fichier>`) tournent en local ; `npm test` complet en CI.
- Installeur : `gh workflow run Windows --repo Darius-Tokam/coucou --ref dan-lion`.

## Review Focus

1. Une session Claude Code déjà ouverte avant le lancement de Coucou (aucun `SessionStart` reçu) : sa mascotte apparaît au premier événement (test dans la tâche 3).
2. Une session qui plante sans `SessionEnd` : sa mascotte part au bout de 30 minutes, et dort avant (test dans la tâche 3).
3. Un sous-agent qui demande une autorisation : sa petite mascotte joue `approval` (test dans la tâche 3) ; le panneau s'ouvre comme aujourd'hui (rien à changer).
4. 20 sous-agents d'un coup sur un écran 1366 px : 8 cases + « +12 », tout reste à l'écran (tests dans les tâches 2 et 3).
5. Aucun export Codex, ou aucun export du tout : les mascottes Codex prennent l'export Claude Code, et sans export elles sont des Mochi (test dans la tâche 3).

---

### Task 1: Deux exports, `/claude/` et `/codex/` (Rust + pont)

**Files:**
- Modify: `src-tauri/src/mascot.rs` (dossiers, `install`, routage, commandes), `src-tauri/src/lib.rs` (protocole), `src/core/bridge.ts`, `src/main.ts`, `src/settings/mascot.ts`

**Interfaces:**
- Produces (Rust) : `pub enum Slot { Claude, Codex }` avec `Slot::parse(&str) -> Option<Slot>` (`"claude"`, `"codex"`) ; `pub fn slot_dir(slot: Slot) -> PathBuf` (Claude : `mascots/current`, gardé pour l'export déjà installé ; Codex : `mascots/codex`) ; `pub fn route(url_path: &str) -> Option<(Slot, String)>` (`/codex/a/b.js` donne `(Codex, "/a/b.js")`) ; `install(src, dest_root, name: &str)` ; `MascotInfo.base_url` vaut `BASE_URL + "claude/"` ou `BASE_URL + "codex/"`.
- Commandes : `mascot_import(app, folder, slot: String)`, `mascot_current(slot: String) -> Option<MascotInfo>`, `mascot_clear(app, slot: String)`. Événement `mascot-changed` : `{ slot: "claude" | "codex", info: MascotInfo | null }`. Un `slot` inconnu renvoie l'erreur `"bad_slot"`.
- Produces (TS) : `export type MascotSlot = "claude" | "codex"` ; `Bridge.mascotImport(folder, slot)`, `Bridge.mascotCurrent(slot)`, `Bridge.mascotClear(slot)` ; `export interface MascotChanged { slot: MascotSlot; info: MascotInfo | null }`.

- [ ] **Step 1: Tests Rust** dans `mascot.rs` : `route_splits_the_slot_from_the_path` (`/claude/manifest.json` donne `(Claude, "/manifest.json")`, `/codex/__coucou_frame.html` donne `(Codex, "/__coucou_frame.html")`, `/other/x` et `/` donnent `None`) ; `each_slot_has_its_own_folder` (`slot_dir(Claude)` finit par `current`, `slot_dir(Codex)` par `codex`) ; `install_writes_the_named_folder` (installer un export blob avec `name = "codex"` crée `dest/codex/manifest.json` et laisse `dest/current` absent) ; `the_base_url_names_the_slot` (`read_export` d'un dossier sous `.../codex` donne une `base_url` finissant par `codex/`).
- [ ] **Step 2:** Pousser ; le run « Windows CI » échoue sur ces tests (fonctions absentes).
- [ ] **Step 3:** Implémenter. `read_export(dir, slot)` reçoit le slot pour la `base_url`. Le protocole (`lib.rs`) appelle `route`, puis `respond(&slot_dir(slot), &rest, range)` ; `None` donne un 404 avec `Access-Control-Allow-Origin: *`.
- [ ] **Step 4:** Pont et appelants : `bridge.ts` (types et fonctions ci-dessus), `main.ts` (`mascot-changed` : `island.corner.load(info)` seulement si `slot === "claude"`, charge `Bridge.mascotCurrent("claude")` au démarrage), `settings/mascot.ts` (appels avec `"claude"`, écoute filtrée sur `slot === "claude"`). `npx tsc --noEmit` passe.
- [ ] **Step 5:** Pousser ; « Windows CI » vert.
- [ ] **Step 6: Commit** : `Deux emplacements d'export MascotForge : claude et codex`.

### Task 2: File de petites mascottes dans la géométrie du coin (Rust)

**Files:**
- Modify: `src-tauri/src/island.rs` (`CornerLayout`, `corner_layout`, `apply_corner`, `corner_tests`), `src-tauri/src/lib.rs` (commande), `src/core/bridge.ts` (`CornerLayout.minis`, `setCornerMinis`)

**Interfaces:**
- Produces (Rust) : `pub const MINI_SIZE: f64 = 120.0; pub const MINI_GAP: f64 = 8.0;` ; `CornerLayout { window, mascot, panel, minis: Vec<IslandRect> }` (`minis` en logique, dans la fenêtre) ; `pub fn corner_layout(work, scale, mascot_at, panel, minis: usize) -> CornerLayout` ; `static CORNER_MINIS: AtomicUsize` lu par `apply_corner` ; commande `set_corner_minis(app, shared, count: usize)` qui range le nombre puis refait `apply_geometry` comme `reposition`.
- Produces (TS) : `CornerLayout.minis: Rect[]` ; `Bridge.setCornerMinis(count: number)`.
- Règle de placement : la file part de la grande mascotte vers le centre, horizontalement (à gauche si la mascotte est dans la moitié droite). Rangée alignée en bas sur la mascotte si elle est dans la moitié basse, en haut sinon. Autant de cases par rangée que la place jusqu'au bord de la zone de travail en permet (au moins 1) ; les rangées suivantes s'empilent vers le centre. Avec au moins une case, le panneau s'ouvre au-dessus (ou en dessous) du bloc mascotte + rangées, à `MINI_GAP`, aligné sur le bord extérieur de la mascotte, et reste à l'écran. Avec 0 case, comportement actuel inchangé.

- [ ] **Step 1: Tests Rust** dans `corner_tests` (les appels existants passent `0`) :
  - `minis_line_up_toward_the_centre` : `corner_layout(WORK, 1.0, None, None, 3)` donne `window == rect(1280.0, 784.0, 624.0, 240.0)`, `mascot == rect(384.0, 0.0, 240.0, 240.0)`, `minis == [rect(256.0,120.0,120.0,120.0), rect(128.0,120.0,120.0,120.0), rect(0.0,120.0,120.0,120.0)]`.
  - `minis_wrap_on_a_narrow_screen` : zone `rect(0,0,800,600)`, 6 cases : 6 rectangles, tous dans la zone de travail une fois ramenés à l'écran (`window.x + m.x` etc.), aucun ne chevauche la mascotte, exactement deux valeurs de `y` distinctes.
  - `the_panel_opens_beside_the_minis_not_over_them` : `WORK`, 3 cases, panneau `(720,320)` : le panneau ne chevauche ni la mascotte ni aucune case, reste dans la zone de travail, et `window.x + mascot.x == 1664.0`, `window.y + mascot.y == 784.0`.
  - `twenty_agents_still_fit_a_small_screen` : zone `rect(0,0,1366,728)`, 9 cases (8 + « +N ») et le panneau : tout dans la zone de travail.
- [ ] **Step 2:** Pousser ; « Windows CI » échoue (signature à 5 arguments absente).
- [ ] **Step 3:** Implémenter `corner_layout` selon la règle, `CORNER_MINIS`, `set_corner_minis` (enregistrée dans `lib.rs`), `minis` dans `apply_corner`.
- [ ] **Step 4:** `bridge.ts` : `minis` et `setCornerMinis`. Les fixtures de `tests/corner.test.mjs` gagnent `minis: []`. `tsc` et `corner.test.mjs` passent en local.
- [ ] **Step 5:** Pousser ; « Windows CI » vert.
- [ ] **Step 6: Commit** : `Coin : file de petites mascottes le long du bord`.

### Task 3: Le modèle des mascottes d'agents (TS pur)

**Files:**
- Create: `src/mascot/agents.ts`, `tests/agent-mascots.test.mjs`

**Interfaces:**
- Consumes: `MascotInfo`, `MascotSlot` (tâche 1) ; `BotStateName` (`src/core/layout`).
- Produces:
  - `export type MascotFamily = MascotSlot;`
  - `export const MINI_LIMIT = 8, LEAVE_MS = 3000, FINISHED_MS = 3000, SLEEP_MS = 120_000, STALE_MS = 1_800_000;`
  - `export function familyOf(coucouAgent: string | undefined): MascotFamily | null` : absent, `""` ou `"claude-desktop"` donnent `"claude"` ; `"codex"` donne `"codex"` ; tout autre tag donne `null`.
  - `export interface AgentEvent { family: MascotFamily; pillId: string; name: string; sessionId: string; agentId: string | null; agentType: string | null; project: string; tool: string | null }`
  - `export function agentEventFrom(p: { hook_event_name?: string; session_id?: string; agent_id?: string; agent_type?: string; coucou_agent?: string; tool_name?: string }, pillId: string, project: string): AgentEvent | null` : `null` sans famille ou sans `session_id`.
  - `export interface AgentMascot { key: string; family: MascotFamily; pillId: string; label: string; subagent: boolean; state: BotStateName }`
  - `export class AgentMascots { apply(e: AgentEvent, now: number): boolean; tick(now: number): boolean; get list(): readonly AgentMascot[]; nextChangeAt(): number | null; clear(): void }` (booléen : la liste ou un état a changé ; `clear` sert aux tests).
  - `export function visibleSlots(count: number): { shown: number; more: number }` (`shown = min(count, 8)`, `more = count - shown`).
  - `export function exportFor(family: MascotFamily, claude: MascotInfo | null, codex: MascotInfo | null): MascotInfo | null` (Codex : `codex ?? claude`).
  - `export const agentMascots = new AgentMascots();`
- Règles : clé `family:sessionId` pour une session, `family:sessionId:agentId` pour un sous-agent. Un `agent_id` présent avec `agentType !== ""` va au sous-agent ; `agentType === ""` va à la session, et `SubagentStart`/`SubagentStop` d'`agentType` vide sont ignorés. États : `SessionStart` donne `idle` ; `UserPromptSubmit` `thinking` ; `PreToolUse` `question` si l'outil est `ask_question` ou finit par `:ask_question`, `working` sinon ; `PostToolUse`, `PostToolUseFailure`, `SubagentStart` `working` ; `PermissionRequest` `approval` ; `Stop` `finished` puis `idle` après `FINISHED_MS` ; `SubagentStop` et `SessionEnd` `finished` puis départ après `LEAVE_MS`. Une mascotte `idle` sans événement depuis `SLEEP_MS` passe `sleeping` ; sans événement depuis `STALE_MS`, elle part. Tout événement d'une clé inconnue la crée (sauf départs). Libellé : `agentType` pour un sous-agent, `project` pour une session. Ordre de la liste : naissance.

- [ ] **Step 1: Tests** (`tests/agent-mascots.test.mjs`), un par règle :
  - `familyOf sorts the tags` : `familyOf(undefined) === "claude"`, `familyOf("claude-desktop") === "claude"`, `familyOf("codex") === "codex"`, `familyOf("gemini") === null`.
  - `a session already running appears on its first event` : un `PreToolUse` d'une session inconnue crée une mascotte `working`, `subagent === false`, libellé du projet.
  - `subagents get their own mascot and follow their own tools` : `SubagentStart` (agentId `a1`, type `Explore`) puis `PermissionRequest` de `a1` : 2 mascottes, celle de `a1` en `approval`, libellé `Explore`, la session inchangée.
  - `helper subagents with an empty type get none` : `SubagentStart` d'`agentType ""` ne crée rien ; un `PreToolUse` d'`agentType ""` met la session en `working`.
  - `a finished subagent leaves after three seconds` : `SubagentStop` à `t` : `finished` ; `tick(t + 2999)` la garde, `tick(t + 3000)` la retire.
  - `stop shows finished then idle` : `Stop` à `t` puis `tick(t + 3000)` : `idle`.
  - `a silent session sleeps, then leaves after thirty minutes` : `tick(t + 120_001)` : `sleeping` ; `tick(t + 1_800_001)` : partie.
  - `a question tool asks` : `PreToolUse` d'outil `mcp__x:ask_question` : `question`.
  - `twenty agents show eight and a plus` : `visibleSlots(20)` vaut `{ shown: 8, more: 12 }`, `visibleSlots(3)` vaut `{ shown: 3, more: 0 }`.
  - `codex falls back to the claude export` : `exportFor("codex", A, null) === A`, `exportFor("codex", A, B) === B`, `exportFor("claude", null, B) === null`.
  - `nextChangeAt points at the next departure` : après un `SubagentStop` à `t`, `nextChangeAt() === t + 3000`.
- [ ] **Step 2:** `node --experimental-strip-types --no-warnings --test tests/agent-mascots.test.mjs` : échec (module absent).
- [ ] **Step 3:** Implémenter `src/mascot/agents.ts`.
- [ ] **Step 4:** Même commande : tout passe ; `npx tsc --noEmit` passe.
- [ ] **Step 5: Commit** : `Modele des mascottes d'agents`.

### Task 4: Brancher les hooks sur le modèle

**Files:**
- Modify: `src/island/hooks.ts` (`handleHook`, `HookPayload`)

**Interfaces:**
- Consumes: `agentEventFrom`, `agentMascots` (tâche 3).
- Produces: `agentMascots` nourri par chaque événement de hook non mis en pause.

- [ ] **Step 1: Test** dans `tests/hooks.test.mjs` (suite CI ; ce fichier passe par le pont simulé `tests/tauri.mjs`) : `agentMascots.clear()` dans le `beforeEach` existant ; `hook events feed the agent mascots` : `hook({ hook_event_name: "SubagentStart", session_id: "s1", agent_id: "a1", agent_type: "Explore", cwd: "C:/p/demo" })` donne une mascotte de clé `claude:s1:a1` dans `agentMascots.list` ; `paused islands make no mascots` : avec `State.paused = true`, le même événement n'en crée aucune.
- [ ] **Step 2:** `HookPayload` gagne `agent_id?: string`. Dans `handleHook`, juste après le calcul de `agentId` et `projectName`, appeler `agentMascots.apply(agentEventFrom(payload, agentId, projectName), performance.now())` quand l'événement n'est pas `null`, puis `State.notify()` si la liste a changé. Aucune autre ligne du gestionnaire ne bouge.
- [ ] **Step 3:** `npx tsc --noEmit` passe ; pousser ; « Windows CI » vert (dont `hooks.test.mjs`).
- [ ] **Step 4: Commit** : `Les hooks nourrissent les mascottes d'agents`.

### Task 5: Afficher les petites mascottes dans le coin (TS)

**Files:**
- Create: `src/island/mochi-canvas.ts` (dessin de Mochi sorti de `corner-view.ts`), `src/island/minis-view.ts`
- Modify: `src/island/corner-view.ts`, `src/island/corner.ts` (`cornerRects`), `src/island/island.ts`, `src/main.ts`, `src/style.css`, `tests/corner.test.mjs`

**Interfaces:**
- Consumes: `CornerLayout.minis`, `Bridge.setCornerMinis` (tâche 2) ; `agentMascots`, `visibleSlots`, `exportFor`, `AgentMascot` (tâche 3) ; `MascotHost`, `mascotStateFor`, `mascotPointer` (déjà livrés).
- Produces:
  - `export class MochiCanvas { constructor(container: HTMLElement); setShown(on: boolean): void; setState(s: BotStateName): void }` (boucle à 30 i/s, les deux côtés du canvas fixés, comme aujourd'hui dans `CornerView`).
  - `export interface MiniHandlers { open(pillId: string): void; more(): void }`
  - `export class MinisView { constructor(root: HTMLElement, handlers: MiniHandlers); setExports(claude: MascotInfo | null, codex: MascotInfo | null): void; render(list: readonly AgentMascot[], layout: CornerLayout): void; pointer(x: number, y: number): void }` : une case par mascotte visible (clé stable : l'iframe d'une mascotte n'est jamais recréée tant qu'elle vit), une case « +N » en dernier, un libellé sous chaque mascotte (pastille de la couleur de l'onglet `pillId`, texte `label`). Survol : état de survol et regard ; clic : `poke` puis `handlers.open(pillId)` ; clic sur « +N » : `handlers.more()`.
  - `cornerRects(layout, card)` renvoie `[layout.mascot, ...layout.minis, card?]`.
- Île : à chaque rendu, `agentMascots.tick(now)` ; si `shown + (more > 0 ? 1 : 0)` change, `Bridge.setCornerMinis(n)` ; `minis.render(...)` ; un minuteur réveille le rendu à `nextChangeAt()`. `onCursor` et `mascot-cursor` appellent aussi `minis.pointer`. `open(pillId)` : `State.setFocus(pillId)`, épinglé, panneau ouvert sur `overview` (même chemin que `clickMascot` pour ouvrir). `more()` : comme un clic sur la grande mascotte. `main.ts` passe les deux exports à `minis.setExports` (démarrage et `mascot-changed`).

- [ ] **Step 1: Test** dans `tests/corner.test.mjs` : `minis take the mouse too` : `cornerRects({ ..., minis: [r1, r2] }, card)` vaut `[mascot, r1, r2, card]`.
- [ ] **Step 2:** Lancer `tests/corner.test.mjs` : échec.
- [ ] **Step 3:** `MochiCanvas` extrait, `CornerView` l'utilise ; `cornerRects` ; `MinisView` ; branchement dans l'île et `main.ts` ; styles (`.mini-box`, `.mini-label`, `.mini-more`, retour à l'appui `scale(0.97)`).
- [ ] **Step 4:** `corner.test.mjs`, `agent-mascots.test.mjs`, `mascot-states.test.mjs` passent ; `npx tsc --noEmit` passe ; `npx vite build` passe.
- [ ] **Step 5: Commit** : `Coin : une petite mascotte par agent`.

### Task 6: Réglages, mascotte Codex

**Files:**
- Modify: `src/settings/mascot.ts`, `src/i18n/extra.json`, `tests/mascot-settings.test.mjs`

**Interfaces:**
- Consumes: `Bridge.mascotImport/Current/Clear(slot)`, `MascotChanged` (tâche 1).
- Produces: deux blocs identiques, « Claude Code mascot » et « Codex mascot », chacun avec choix, retour à Mochi, nom, crédit, avertissement vidéo et erreurs d'import ; sous le bloc Codex, l'indication « Without a Codex mascot, Codex agents use the Claude Code one. ». Texte d'aide remplacé par « In a corner, your mascot waits without a background. Click it to open Coucou, drag it to move it. Each running agent gets its own small mascot. »

- [ ] **Step 1: Test** dans `tests/mascot-settings.test.mjs` : `the settings offer a codex mascot` : la section rendue contient deux boutons « Choose a MascotForge folder » et le texte « Codex mascot ».
- [ ] **Step 2:** Implémenter : une fonction `slotBlock(slot, title)` réutilisée deux fois ; les 4 nouvelles clés dans `extra.json`, 13 langues chacune ; l'ancienne clé d'aide retirée si plus utilisée.
- [ ] **Step 3:** `npx tsc --noEmit` passe ; pousser ; « Windows CI » vert (dont `i18n.test.mjs` et `mascot-settings.test.mjs`).
- [ ] **Step 4: Commit** : `Reglages : une mascotte pour Codex`.

### Task 7: Vérification de bout en bout

- [ ] **Step 1:** Lancer l'installeur (`gh workflow run Windows ...`), le télécharger dans `windows/release/`, installer en silencieux (`/S`), relancer Coucou.
- [ ] **Step 2:** Réglages : Orbi pour Claude Code, l'export renard (`text-to-mascot/exports/`) pour Codex.
- [ ] **Step 3:** Une session `claude -p` qui lance 3 sous-agents : capture avec 4 petites mascottes (session + 3), puis capture après leur départ.
- [ ] **Step 4:** Une tâche `codex exec` : capture d'une mascotte Codex distincte (renard, pastille Codex).
- [ ] **Step 5:** Clic sur une petite mascotte : capture du panneau ouvert sur le bon onglet.
- [ ] **Step 6:** Relevé processeur et GPU de Coucou au repos et avec au moins 6 petites mascottes 3D (Gestionnaire des tâches) ; noter les chiffres.
- [ ] **Step 7:** Mettre à jour le registre dans le dossier de notes partagé et la PR brouillon du fork.
