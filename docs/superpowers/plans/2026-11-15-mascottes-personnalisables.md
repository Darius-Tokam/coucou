# Petites mascottes colorées, réglables, déplaçables, avec fiche de sous-agent : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les petites mascottes de sous-agents prennent la couleur de leur type, se règlent (taille, look, affichage), se posent n'importe où à l'écran une par une, et un clic sur un sous-agent ouvre sa propre fiche.

**Architecture:** Le modèle pur `src/mascot/agents.ts` gagne les étapes et la réponse finale de chaque sous-agent, la couleur par type et les clés de position. La page envoie à Rust une liste de cases (taille, position posée ou file) au lieu d'un nombre ; `corner_layout` les place et la fenêtre devient la zone de travail entière pendant un glisser. L'iframe reçoit un message `look` qu'elle traduit en attributs publics des moteurs. Une nouvelle vue du panneau, `subagent`, montre la fiche.

**Tech Stack:** Tauri 2 (Rust), TypeScript strict, Vite 6, `node:test`, `cargo test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-15-mascottes-personnalisables-design.md`

## Global Constraints

- Branche `dan-lion` du fork `Darius-Tokam/coucou`. Jamais de commit sur `main`, jamais de push vers `Louis-CFM/coucou`.
- Chemins relatifs à `windows/`.
- TypeScript strict : `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- Ne pas toucher à `hook/` ni aux règles d'autorisation de `hooks.ts`.
- Aucun secret, aucun em-dash (U+2014) dans le code, les chaînes, les commits.
- Chaînes visibles : clé anglaise dans `t()`, 13 langues dans `src/i18n/extra.json` (`zh-Hans, hi, es, ar, fr, bn, pt-BR, ru, id, de, tr, ko, ja`).
- Tout bouton : retour à l'appui, état désactivé pendant une action asynchrone, échec visible, `:focus-visible`.
- Valeurs de la spec : taille des petites 60 à 120 px, 120 par défaut ; sous-agents à 75 % de cette taille ; 8 couleurs par défaut ; 50 étapes au plus par sous-agent ; décalage d'un second du même type : la moitié de sa taille vers le centre.
- Pas de compilation Rust locale (disque) : tests Rust poussés seuls d'abord (CI rouge), puis le code (CI verte). Tests TS en local : `node --experimental-strip-types --no-warnings --test tests/<f>.test.mjs`.
- Ne jamais modifier les fichiers d'un export : la couleur et le look passent par les attributs publics des moteurs, depuis `FRAME_HTML`.

## Review Focus

1. Deux sous-agents du même type vivants en même temps, dont le type a une position posée : le second est décalé, aucun n'est caché (test tâche 5).
2. Une position enregistrée hors de la zone de travail actuelle (écran plus petit, résolution changée) : la mascotte est ramenée à l'écran (test tâche 3).
3. Un clic sur un sous-agent qui attend une autorisation : la carte d'autorisation reste au premier plan (test tâche 6).
4. Un type de sous-agent jamais vu : couleur stable tirée de la palette, la même à chaque fois (test tâche 1).
5. Affichage « sessions seulement » : aucune case de sous-agent n'est envoyée à Rust, et la fenêtre rétrécit (test tâche 5).

---

### Task 1: Le modèle (TS pur)

**Files:** Modify `src/mascot/agents.ts`, `src/island/hooks.ts` (deux lignes de l'appel existant), `tests/agent-mascots.test.mjs`.

**Interfaces:**
- `agentEventFrom(p, pillId, project, step: string | null)` : `step` vient de `stepLabel(tool, input)` (déjà dans `hooks.ts`) pour un `PreToolUse`, `null` sinon. `p` gagne `last_assistant_message?: string`.
- `AgentEvent` gagne `step: string | null; finalText: string | null`.
- `AgentMascot` gagne `type: string | null; project: string; steps: readonly string[]; finalText: string | null; parentKey: string | null`.
- `export const MINI_COLORS: readonly string[]` (8 couleurs lisibles sur fond sombre).
- `export function colorForType(type: string, overrides: Readonly<Record<string, { color?: string | null }>>): string` : la couleur réglée, sinon `MINI_COLORS[hash(type) % 8]` avec un hachage stable (FNV-1a 32 bits sur le nom).
- `export function positionKey(m: AgentMascot): string` : `"<famille>:type:<type>"` pour un sous-agent, `"<famille>:project:<projet>"` pour une session.
- `export type MiniDisplay = "all" | "sessions" | "none";` et `export function displayed(list: readonly AgentMascot[], mode: MiniDisplay): readonly AgentMascot[]`.

- [ ] **Step 1: Tests** : `a subagent keeps its own steps` (deux `PreToolUse` avec `agent_id` : 2 étapes sur le sous-agent, aucune sur la session) ; `steps stop at fifty` (60 étapes : les 50 dernières) ; `a subagent keeps its final answer` (`SubagentStop` avec `last_assistant_message` : `finalText`) ; `a subagent knows its parent` (`parentKey === "claude:s1"`) ; `an unknown type always gets the same color` (deux appels, même couleur, et elle est dans `MINI_COLORS`) ; `a chosen color wins` ; `position keys follow type or project` ; `sessions only hides subagents` ; `none hides everything`.
- [ ] **Step 2:** Lancer `tests/agent-mascots.test.mjs` : échec.
- [ ] **Step 3:** Implémenter ; `hooks.ts` passe `stepLabel(...)` pour `PreToolUse`, `null` sinon.
- [ ] **Step 4:** Les tests passent ; `npx tsc --noEmit` passe.

### Task 2: Réglages persistés (Rust + TS)

**Files:** Modify `src-tauri/src/settings.rs` (struct, défauts, tests de clés), `src/core/state.ts` (`Settings`, `DEFAULT_SETTINGS`).

**Interfaces:**
- Rust, dans `Settings` (sérialisé en camelCase comme les autres) : `mini_size: f64` (120.0), `mini_display: String` (`"all"`), `subagent_looks: BTreeMap<String, SubagentLook>`, `known_subagent_types: Vec<String>`, `mini_positions: BTreeMap<String, CornerPos>` (pixels physiques écran). `SubagentLook { color: Option<String>, accessory: Option<String>, eyes: Option<String>, cheeks: Option<String> }`. Ces champs appartiennent à la page (sauvegardés par `save_settings` comme les réglages ordinaires).
- TS : mêmes champs dans `Settings` (`miniSize`, `miniDisplay`, `subagentLooks`, `knownSubagentTypes`, `miniPositions`).

- [ ] **Step 1: Tests Rust** dans `settings.rs` : défauts ; un JSON sans ces clés se lit avec les défauts ; mise à jour du test qui liste les clés. Pousser seuls : CI rouge.
- [ ] **Step 2:** Implémenter ; CI verte.

### Task 3: Cases de tailles variées, posées ou en file (Rust)

**Files:** Modify `src-tauri/src/island.rs` (`corner_layout`, `apply_corner`, `corner_tests`), `src-tauri/src/lib.rs` (commandes), `src/core/bridge.ts`.

**Interfaces:**
- `#[derive(Deserialize, Clone, Copy, Debug, PartialEq)] pub struct MiniSlot { pub size: f64, pub at: Option<(f64, f64)> }` (`size` logique, `at` coin haut-gauche en pixels physiques écran, `None` : dans la file).
- `corner_layout(work, scale, mascot_at, panel, minis: &[MiniSlot], dragging: bool) -> CornerLayout` ; `CornerLayout` gagne `scale: f64`.
- La file contient les cases `at == None` dans l'ordre reçu, avec leur taille, alignées comme aujourd'hui (en bas si la grande est dans la moitié basse). Les cases posées sont ramenées dans la zone de travail. `dragging == true` : la fenêtre vaut la zone de travail entière. Sinon, la fenêtre est le rectangle englobant de tout ce qui est dessiné. Avec des cases toutes en file et de taille 120, le résultat est identique à aujourd'hui (les anciens tests le vérifient).
- Commandes : `set_corner_minis(app, shared, slots: Vec<MiniSlot>)` remplace l'ancienne (`count`) ; `corner_mini_drag(app, shared, on: bool)` range un `static CORNER_MINI_DRAG: AtomicBool` puis refait la géométrie.
- TS : `export interface MiniSlot { size: number; at: [number, number] | null }` ; `Bridge.setCornerMinis(slots: MiniSlot[])`, `Bridge.cornerMiniDrag(on: boolean)`.

- [ ] **Step 1: Tests Rust** : `mixed_sizes_line_up_bottom_aligned` (une case 120 et une 90 en file, grande à la maison sur 1920 x 1040 : bas des deux cases à `y = 1024` à l'écran) ; `a placed mini sets the window bounds` (case posée en `(16, 16)` : la fenêtre va de `(16, 16)` à `(1904, 1024)`, la grande reste en `(1664, 784)` à l'écran) ; `a mini placed off screen comes back` (case posée en `(5000, 5000)` : dans la zone de travail) ; `dragging covers the work area` (`dragging = true` : `window == WORK`) ; anciens appels adaptés (`&[MiniSlot { size: 120.0, at: None }; n]`, `false`). Pousser seuls : CI rouge.
- [ ] **Step 2:** Implémenter, adapter la page à la nouvelle commande (tâche 5 s'en sert) ; CI verte.

### Task 4: Couleur et look dans l'iframe

**Files:** Modify `src-tauri/src/mascot.rs` (`MascotInfo`, `read_export`, `FRAME_HTML`, tests), `src/mascot/protocol.ts`, `src/mascot/host.ts`, `tests/mascot-host.test.mjs`.

**Interfaces:**
- `MascotInfo.tint_material: Option<String>` (JSON `tintMaterial`) : la première clé de `engine_spec.materials` d'un export 3D, sinon `None`.
- `HostMessage` gagne `{ type: "look"; color: string | null; material: string | null; accessory: string | null; eyes: string | null; cheeks: string | null }`.
- `MascotHost.setLook(look: Omit<Extract<HostMessage, { type: "look" }>, "type"> | null)` : n'envoie que si ça change, rejoue après `ready`.
- `FRAME_HTML` : 3D, attribut `palette` = `"<material>:<color>"` (retiré si `color` ou `material` est `null`) ; blob, attributs `color`, `accessory`, `eyes`, `cheeks` posés, ou retirés si `null`. Accepté seulement depuis `window.parent`.

- [ ] **Step 1: Tests Rust** : `a 3d export names its tint material` (manifeste 3D avec `engine_spec.materials` `{ "shell": {...}, "lilac": {...} }` : `Some("shell")`) ; `a blob export has no tint material` ; `the frame page applies a look` (la page contient `data.type === "look"` et `"palette"`). Pousser seuls : CI rouge.
- [ ] **Step 2: Tests TS** : `setLook sends once per change` ; `setLook is replayed when ready`. Lancer : échec.
- [ ] **Step 3:** Implémenter ; tests TS verts ; CI verte.
- [ ] **Step 4: Vérification manuelle prévue en tâche 8** : changer `palette` à chaud ne doit pas casser le personnage 3D (contrairement à `framing`).

### Task 5: Petites mascottes : tailles, couleurs, affichage, glisser

**Files:** Modify `src/island/minis-view.ts`, `src/island/island.ts`, `src/mascot/agents.ts`, `src/style.css`, `tests/agent-mascots.test.mjs`.

**Interfaces:**
- `export function placementFor(m: AgentMascot, live: readonly AgentMascot[], positions: Readonly<Record<string, { x: number; y: number }>>, sizePx: number, towardLeft: boolean): [number, number] | null` dans `agents.ts` (`sizePx` en pixels physiques : taille logique de la case fois `layout.scale`, comme les positions) : la position enregistrée pour `positionKey(m)`, décalée de `sizePx / 2` vers le centre (`towardLeft`) pour chaque mascotte vivante plus ancienne de même clé ; `null` sans position.
- L'île construit les `MiniSlot` : `displayed(list, settings.miniDisplay)`, les 8 premières plus « +N », taille `miniSize` pour une session et `miniSize * 0.75` pour un sous-agent, `at` d'après `placementFor`. Elle n'appelle `setCornerMinis` que si la liste change.
- `MinisView` : chaque case prend sa taille du layout ; la pastille et le look d'un sous-agent viennent de `colorForType` et de `settings.subagentLooks[type]` (`host.setLook`) ; une session garde la couleur de son onglet et aucun look.
- Glisser une case : au-delà de `DRAG_THRESHOLD`, `Bridge.cornerMiniDrag(true)` ; la case suit le pointeur (`setPointerCapture`) dans la fenêtre devenue zone de travail ; au relâcher, position écran physique = `layout.window.x + x * layout.scale` (idem `y`), enregistrée dans `settings.miniPositions[positionKey(m)]`, réglages sauvés, `Bridge.cornerMiniDrag(false)`. Double-clic : la clé est retirée, la case revient en file. La grande mascotte garde son glisser actuel.
- À chaque `SubagentStart` d'un type inconnu, il est ajouté à `settings.knownSubagentTypes` et sauvé.

- [ ] **Step 1: Tests** : `a placed type comes back to its place` ; `a second one of the same type is shifted toward the centre` (deux vivantes même clé : la seconde décalée de `sizePx / 2`) ; `sessions only sends no subagent slot` (fonction pure qui construit les slots, à exporter : `slotsFor(list, settings, towardLeft): MiniSlot[]`).
- [ ] **Step 2:** Lancer : échec. **Step 3:** Implémenter. **Step 4:** Tests, `tsc`, `vite build` verts.

### Task 6: Fiche de sous-agent

**Files:** Create `src/views/subagent.ts`, `tests/subagent-card.test.mjs`. Modify `src/core/layout.ts` (`IslandViewName`, `VIEW_LAYOUTS`), `src/views/views.ts` (`buildViews`), `src/core/state.ts` (`subagentKey: string | null`), `src/island/island.ts` (`openSubagent`), `src/island/corner.ts`, `src/i18n/extra.json`.

**Interfaces:**
- Vue `"subagent"`, hauteur 200, `agentMode: "none"`.
- `export function subagentCard(m: AgentMascot, color: string): { title: string; color: string; state: BotStateName; project: string; steps: readonly string[]; finalText: string | null }` (les 6 dernières étapes) dans `src/views/subagent.ts`, et `buildSubagent(actions): ViewHost` qui l'affiche, avec un bouton « Session » (`actions` gagne `openPill(pillId: string): void`).
- `export function miniClickTarget(m: AgentMascot, approvalWaits: boolean): "approval" | "subagent" | "session"` dans `corner.ts`.
- `Island.openSubagent(key)` : `State.subagentKey = key`, épinglé, ouvert sur `"subagent"` ; pendant une autorisation, `State.defaultView()` comme aujourd'hui. Un sous-agent parti pendant que sa fiche est ouverte : la fiche garde ses dernières données (copie au moment du départ) jusqu'à la fermeture.

- [ ] **Step 1: Tests** : `the card shows the last six steps and the answer` ; `clicking a subagent opens its card` ; `a waiting approval wins` ; `clicking a session opens its tab`.
- [ ] **Step 2:** Lancer : échec. **Step 3:** Implémenter, clés i18n (« Session », libellés d'état si nouveaux). **Step 4:** Tests, `tsc`, `vite build` verts ; CI verte (`i18n.test.mjs`).

### Task 7: Réglages

**Files:** Modify `src/settings/mascot.ts`, `src/i18n/extra.json`, `tests/mascot-settings.test.mjs`.

- Curseur « Size of the small mascots » (60 à 120, pas de 10), choix « Small mascots » (`all` / `sessions` / `none`), liste « Subagent colors » (une ligne par `knownSubagentTypes` : sélecteur de couleur, et pour un export blob : accessoire, yeux, joues, avec les valeurs acceptées par Blob Atelier lues dans `engines/agent-mascot.js` ; grisés pour un export non blob), champ « Add a type », bouton « Put the mascots back in line » (vide `miniPositions`).
- [ ] **Step 1: Test** : `the settings offer size, display and subagent colors`. **Step 2:** Implémenter, 13 langues. **Step 3:** CI verte.

### Task 8: Vérification dans l'app

- [ ] Installeur, installation silencieuse.
- [ ] Une session `claude -p` qui lance 2 sous-agents Explore et 1 general-purpose : deux couleurs, captures. Capturer aussi le `SubagentStop` de Claude Code (fichier de réglages temporaire `--settings`, comme le 2026-11-14) pour vérifier `last_assistant_message`.
- [ ] Changer la couleur d'Explore dans les Réglages : la petite mascotte change de couleur sans casser le personnage 3D.
- [ ] Glisser une petite mascotte à l'opposé de l'écran ; un nouveau sous-agent Explore y revient ; double-clic : retour en file. Captures.
- [ ] Clic sur un sous-agent : sa fiche, ses étapes, le lien « Session ». Capture.
- [ ] Mesure processeur et GPU, mascotte posée loin (fenêtre presque plein écran) contre toutes en file. Si la hausse est nette, s'arrêter et en parler à Darius (repli : une fenêtre par mascotte posée).
