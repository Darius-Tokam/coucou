# Conception : une mascotte MascotForge par agent qui tourne (Coucou Windows)

Date : 2026-11-14. Branche : `dan-lion` du fork `Darius-Tokam/coucou`. App concernée : `windows/` (Tauri 2, Vite 6, TypeScript strict). Suite de `2026-11-14-mascotte-coin-design.md` (mode coin, déjà livré).

## Pourquoi

Darius veut montrer MascotForge. Aujourd'hui une seule mascotte, dans le coin, résume tous les agents. Il veut voir chaque agent vivre : quand Claude Code lance 10 sous-agents, 10 mascottes apparaissent ; pareil pour Codex. On doit distinguer d'un coup d'œil une mascotte Claude Code d'une mascotte Codex.

## Objectifs

1. Une petite mascotte par session d'agent (Claude Code, Codex) et une par sous-agent qu'elle lance.
2. Chaque petite mascotte joue l'état de son propre agent : réflexion, travail, autorisation, erreur, terminé.
3. Elle apparaît quand l'agent démarre et part quand il s'arrête.
4. Deux exports MascotForge au choix : un pour Claude Code, un pour Codex.
5. Un clic sur une petite mascotte ouvre le panneau sur l'agent qu'elle représente.

## Hors périmètre

- Mac et Linux (le mode coin est Windows seulement).
- Les autres agents que Coucou suit (Gemini, Hermes, Antigravity, Cursor…) : pas de petite mascotte. Ils restent dans le panneau et comptent pour la grande mascotte.
- Les hooks et le relais `coucou-hook` : aucun changement. Les champs nécessaires arrivent déjà (voir plus bas).
- Le contenu du panneau : inchangé, sauf l'onglet qu'il montre au clic sur une petite mascotte.

## Échecs à éviter même si « ça marche »

- Une petite mascotte qui reste à l'écran après la fin de son agent (session plantée, `SessionEnd` jamais reçu).
- Une demande d'autorisation d'un sous-agent qui passe inaperçue.
- Les petites mascottes qui couvrent le panneau, sortent de l'écran ou bloquent les clics hors d'elles.
- Le processeur ou le GPU qui chauffent avec 8 mascottes 3D à l'écran.
- La grande mascotte qui bouge quand une petite apparaît ou part.

## Constaté (2026-11-14)

- **Claude Code** (capture réelle d'une session `claude -p` qui lance deux sous-agents) : `SubagentStart` porte `agent_id` et `agent_type` (« general-purpose »). Le `PreToolUse` d'un outil lancé par un sous-agent porte aussi `agent_id` et `agent_type`. Les outils de la session principale n'en ont pas. Tous portent `session_id`.
- **Codex** (code source `openai/codex`, `codex-rs/hooks/src/schema.rs`, au tag `rust-v0.144.6`, la version installée) : `SubagentStart` et `SubagentStop` portent `agent_id` et `agent_type` obligatoires ; `PreToolUse`, `PermissionRequest`, `PostToolUse` et `UserPromptSubmit` les portent quand un sous-agent agit.
- **Relais** : `coucou-hook` ne retire que `tool_response`, `tool_output` et `transcript_path`. `agent_id` et `agent_type` arrivent à Coucou.
- **Coucou aujourd'hui** : un seul onglet (pill) par famille d'agent (`CLAUDE_ID` ou `CURSOR_ID` pour Claude Code, `agent_codex` pour Codex). `SubagentStart` et `SubagentStop` n'ajoutent qu'une ligne au fil de l'onglet. Les sous-agents d'aide de Claude Code ont un `agent_type` vide.
- **Hooks Codex** : Codex n'exécute un hook qu'après approbation dans ses réglages. Ceux de Coucou sont approuvés depuis 2026-11-14 20:48 ; un test CLI à 20:54 est arrivé à Coucou.

## Conception

### Qui a une petite mascotte

- **Une session** : une par `session_id` de Claude Code ou de Codex. Elle naît sur `SessionStart`, ou sur le premier événement d'une session inconnue (une session ouverte avant Coucou). Elle part sur `SessionEnd`.
- **Un sous-agent** : un par `agent_id`. Il naît sur `SubagentStart` et part sur `SubagentStop`. Les sous-agents d'`agent_type` vide (aides internes de Claude Code) n'en ont pas.
- **Départ** : la mascotte joue « terminé » 3 secondes, puis s'efface.
- **Filet de sécurité** : une mascotte sans aucun événement depuis 30 minutes part aussi. Une session en attente de Darius peut rester silencieuse longtemps ; elle passe en `sleeping` après le délai de sommeil existant, et ne part qu'au bout des 30 minutes.

### Quel état elle joue

- L'événement est attribué au sous-agent si `agent_id` est présent, sinon à la session (`session_id`).
- Mêmes règles d'état que les onglets : `UserPromptSubmit` donne `thinking`, `PreToolUse` et `PostToolUse` donnent `working`, `PermissionRequest` donne `approval`, `Stop` donne `finished`, puis `idle`.
- Mêmes correspondances de noms d'états que la grande mascotte (`MASCOT_STATE_FALLBACKS`).
- Une autorisation demandée par un sous-agent : sa petite mascotte joue `approval`, la grande aussi (elle résume tout), et le panneau s'ouvre comme aujourd'hui.

### La grande mascotte

Elle reste dans le coin, en grand (240 px), déplaçable, et résume tous les agents (`cornerAgentState`, déjà livré). Elle utilise l'export de Claude Code.

### Distinguer Claude Code et Codex

- Réglages, section Mascotte : deux choix, « Mascotte Claude Code » et « Mascotte Codex », chacun avec « Choisir un dossier MascotForge » et « Revenir à Mochi ».
- L'export actuel (`mascots/current`) devient celui de Claude Code.
- Sans export Codex, les mascottes Codex prennent celui de Claude Code.
- Sous chaque petite mascotte, une étiquette courte : la pastille de couleur de l'agent (celle de son onglet) et le type du sous-agent (« Explore ») ou le nom du projet pour une session. Elle distingue aussi deux mascottes du même export.

### Placement

- Les petites mascottes (environ 120 px) se rangent en file le long du bord de l'écran, à partir de la grande, vers le centre.
- La grande ne bouge jamais à l'écran quand une petite arrive ou part.
- Le panneau, ouvert, ne couvre ni la grande ni les petites, et reste à l'écran.
- Au-delà de 8 petites, une pastille « +N » remplace les suivantes ; un clic dessus ouvre le panneau.
- Glisser la grande déplace tout le groupe. Les petites ne se glissent pas.
- Clics : chaque mascotte et la pastille prennent la souris (liste de rectangles, déjà en place pour le mode coin) ; partout ailleurs, les clics passent au travers.

### Interactions d'une petite mascotte

- Survol : son animation de survol et le regard qui suit le curseur, comme la grande.
- Clic : réaction (poke), puis le panneau s'ouvre, épinglé, sur l'onglet de son agent.

### Sobriété

- Chaque mascotte est une iframe `MascotHost`, comme la grande. Les petites demandent un rendu moins coûteux (résolution réduite) si le moteur le permet.
- Mesure attendue : utilisation processeur et GPU de Coucou, au repos et avec 8 petites mascottes 3D, relevées dans le Gestionnaire des tâches.

## Approches étudiées

- **A. Une fenêtre qui s'agrandit (recommandée).** La fenêtre du coin s'élargit pour contenir la file. Réutilise la géométrie du coin, la liste de rectangles traversants, le suivi du curseur et `MascotHost`. Une seule page, un seul processus de rendu.
- **B. Une fenêtre par petite mascotte.** Chaque fenêtre est simple et indépendante, mais 10 fenêtres à créer, détruire et placer, chacune avec sa page et sa mémoire. Écartée.
- **C. Un seul canvas qui dessine toutes les mascottes.** Le plus sobre, mais impossible sans réécrire les moteurs MascotForge (chaque export apporte son propre `mascot.js`). Écartée.

## Décisions prises par Claude (à vérifier par Darius)

- La grande mascotte reste un résumé de tous les agents, avec l'export Claude Code.
- Les autres agents suivis par Coucou n'ont pas de petite mascotte.
- Le délai de départ de secours est de 30 minutes sans événement.
- Taille des petites : environ 120 px ; limite : 8, puis « +N ».

## Vérification attendue

- Tests unitaires : attribution d'un événement à la bonne mascotte, cycle de vie (naissance, départ, filet de 30 minutes), placement de la file (bords, écran court, panneau ouvert), limite « +N ».
- CI GitHub verte (Windows CI, Linux, installeur).
- Dans l'app installée, captures à l'appui : une session Claude Code qui lance 3 sous-agents fait apparaître 4 petites mascottes, qui partent à la fin ; une tâche Codex fait apparaître une mascotte Codex distincte ; un clic sur une petite ouvre le bon onglet.
- Relevé processeur avec 8 petites mascottes 3D.

## Risques connus

- Codex Desktop peut lancer ses sous-agents autrement que la CLI : à vérifier sur une vraie tâche.
- WebGL : Chromium limite le nombre de contextes actifs par page (de l'ordre de 16). 1 + 8 mascottes 3D restent en dessous, la limite « +N » protège.
- Le disque C: a environ 4 Go libres : les tests Rust locaux ne tiennent pas ; ils tournent en CI.
