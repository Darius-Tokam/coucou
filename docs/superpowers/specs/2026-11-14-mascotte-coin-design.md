# Conception : une mascotte MascotForge dans le coin de l'écran (Coucou Windows)

Date : 2026-11-14. Branche : `dan-lion` du fork `Darius-Tokam/coucou`. App concernée : `windows/` (Tauri 2, Vite 6, TypeScript strict).

## Pourquoi

Darius veut montrer MascotForge. Le livrable final est une vidéo démo : sa mascotte MascotForge vit dans le coin de son écran Windows, sans fond, réagit à ses sessions Claude Code, et ouvre le panneau de Coucou au survol ou quand Claude demande une autorisation. Coucou sert de vitrine ; la mascotte doit être la vedette.

## Objectifs

1. Coucou affiche n'importe quel export MascotForge des trois modes (blob, 3D, vidéo) sans modifier le code pour en changer.
2. Au repos, seule la mascotte est visible, dans un coin de l'écran, sans fond, déplaçable à la souris.
3. Au survol, le panneau actuel de l'île s'ouvre à côté de la mascotte, avec son fond.
4. Une autorisation ou une question d'un agent ouvre le panneau d'elle-même.
5. La mascotte joue l'état qui correspond à ce que fait l'agent.

## Hors périmètre

- Mac et Linux. Pas de PR vers `Louis-CFM/coucou` pour l'instant.
- Les hooks (`coucou-hook`, `settings.json`) et la logique de surveillance et d'autorisation : on ne touche qu'à l'affichage.
- Les mini-mascottes des intégrations (Stripe, GitHub, n8n…) : elles restent des Mochi colorés dans le panneau.
- La pill, le hub, le chat, la dictée : inchangés.
- Le lion Dan : son code est retiré (voir plus bas).

## Échecs à éviter même si « ça marche »

- La mascotte ou la fenêtre bloque des clics sur ce qu'il y a dessous.
- Une demande d'autorisation passe inaperçue et bloque Claude.
- Un fond (rectangle, halo, bord) apparaît autour d'une mascotte blob ou 3D.
- La mascotte saute ou glisse quand le panneau s'ouvre : elle doit rester fixe à l'écran.
- La 3D fait tourner le CPU ou le GPU en continu quand rien ne se passe.

## Contraintes

- TypeScript strict : `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- Aucun secret dans le code.
- Le disque C: de Darius a environ 11 Go libres. Une compilation Rust de debug en prend environ 6. Le build de l'installeur passe par GitHub Actions (`windows.yml`, lancement manuel sur `dan-lion`), qui a déjà réussi.
- Les tests npm ne tournent pas sous Node 22.14 (le PC de Darius) : `module.registerHooks` manque. Ils tournent en CI.
- Licences : les moteurs sont sous MIT (Blob Atelier, Victoria Wu ; Wobnimo, Pourya Akhbari). Le champ `credit` du manifeste doit rester visible quelque part (Réglages).

## Ce que fait Coucou aujourd'hui (constaté dans le code)

- L'île est une seule fenêtre Tauri (`island`, `src-tauri/src/island.rs` + `src/island/island.ts`). Fermée, elle prend la taille de l'encoche ; ouverte, 720 × 320 (`PANEL_W`, `PANEL_H`). `apply_geometry` la centre en haut de l'écran.
- Sur Windows, un fil Rust lit le curseur (`spawn_cursor_poll`) et rend la fenêtre traversable aux clics hors du rectangle dessiné (`Bridge.setIslandRect`, `HIT_MARGIN`). Fermée, il la réveille au survol (`wake_if_hovered`, événement `closed-hover`). Ce mécanisme existe et doit être réutilisé tel quel.
- Mochi est dessiné sur canvas par `BotEngine` (`src/mochi/engine.ts`) à cinq endroits : île, fenêtre bureau (`src/desktop/main.ts`), pill, hub, minis.
- Une fenêtre « Mochi sur le bureau » existe déjà (`desktop.rs`, 120 px, transparente, toujours au premier plan, déplaçable).
- La CSP de `tauri.conf.json` n'autorise que `'self'` pour les scripts et `'self' blob:` pour les médias. Aucun plugin dialog ni fs n'est installé.

## Format d'un export MascotForge (constaté dans `text-to-mascot/exports/`)

Un dossier `mascot/` contient `manifest.json` (version 2), `mascot.js` et un README. `mascot.js` définit le composant web `<mascot-avatar manifest="...">`, sans dépendance, qui expose `play(etat, { immediate })`, `getState()`, `ready()` et l'événement `statechange`. Il traduit déjà quelques noms d'états (`STATE_ALIASES` : talking/speaking, happy/celebrating/done).

| Mode | Manifeste | Fichiers en plus | Fond |
|------|-----------|------------------|------|
| blob | `"engine": "blob"`, `engine_src: engines/agent-mascot.js` (script classique) | aucun | transparent (WebGL, clearColor 0) |
| 3D | `"engine": "3d"`, `engine_src: engines/wobnimo.js` (module ES, ~150 Ko) | aucun | transparent (WebGL2, clearColor 0) |
| vidéo | `states.<etat>.src: videos/<etat>.mp4`, `"alpha": "stacked"` ou `"none"` | `videos/*.mp4` | transparent si `stacked`, fond sinon |

Les états varient d'un export à l'autre : 8 pour blob (idle, listening, thinking, talking, working, happy, done, error), 10 pour la 3D, 4 pour la vidéo d'exemple (idle, thinking, talking, error).

## Approches étudiées

- **A. Deux fenêtres.** La fenêtre bureau de Mochi devient la mascotte ; la fenêtre de l'île devient le panneau, déplacée à côté. Réutilise `desktop.rs`. Deux fenêtres à synchroniser à chaque survol, et le passage de l'une à l'autre se voit.
- **B. Une fenêtre qui grandit (choisie par Darius).** La fenêtre de l'île quitte le haut de l'écran pour un coin. Fermée, elle a la taille de la mascotte ; ouverte, elle contient la mascotte et le panneau. C'est déjà le fonctionnement de l'île (fermée / ouverte, clics traversants hors de la forme), seul l'ancrage change. Transition plus fluide, une seule fenêtre.
- **C. Garder l'île en haut et poser la mascotte dans le coin.** Écartée : Darius veut que l'île disparaisse.

## Conception retenue (B)

### Comportement

- **Repos :** la fenêtre fait 200 × 200 px logiques. La mascotte occupe ce carré, sans fond. Position par défaut : coin bas droit de la zone de travail (au-dessus de la barre des tâches) de l'écran choisi dans les réglages actuels de Coucou.
- **Déplacement :** glisser la mascotte déplace la fenêtre. La position est enregistrée et restaurée au lancement. Un simple clic n'est pas un glissement (seuil existant `DRAG_THRESHOLD`).
- **Survol :** le panneau s'ouvre. La fenêtre grandit vers le centre de l'écran : vers la gauche si la mascotte est dans la moitié droite, vers le haut si elle est dans la moitié basse, et l'inverse sinon. La mascotte ne bouge pas à l'écran. Le panneau se referme 300 ms après que le curseur a quitté la mascotte et le panneau.
- **Clic sur la mascotte :** épingle le panneau ouvert ; un second clic le désépingle et le referme.
- **Autorisation ou question d'un agent :** le panneau s'ouvre seul et reste ouvert jusqu'à la réponse, puis se referme si le curseur n'est pas dessus.
- **Autres ouvertures automatiques (choix de Darius : comme aujourd'hui) :** tout ce qui ouvre l'île seule aujourd'hui (`alert(view)` : fin de tâche, erreur, mise à jour, accueil au lancement, etc.) ouvre le panneau du coin, avec les mêmes minuteries de fermeture. Seul l'état compact (`reveal()` sur un événement de travail ou la musique) disparaît : en mode coin, il se traduit par l'état de la mascotte.
- **Clics (choix de Darius : le carré suffit) :** panneau fermé, tout le carré de la mascotte (plus `HIT_MARGIN`) prend la souris, transparence comprise. Panneau ouvert, deux zones prennent la souris : le carré de la mascotte et le panneau. Le coin vide du rectangle englobant laisse passer les clics. `setIslandRect` passe donc d'un rectangle à une liste de rectangles.
- **Panneau :** le contenu actuel de l'île ouverte (sessions, autorisations, pills, intégrations), dessiné comme une carte aux coins arrondis et non plus comme une encoche collée au haut de l'écran.
- **Sans export chargé :** Mochi (`BotEngine`) occupe le carré de 200 px, sans fond, avec le même comportement.
- **La fenêtre « Mochi sur le bureau »** (`desktop.rs`) ne s'affiche plus en mode coin : la mascotte est déjà sur le bureau.

### États

Coucou demande un état ; Coucou essaie les noms dans l'ordre et garde le premier que l'export possède. En dernier recours : `default_state` du manifeste.

| État Coucou | Noms essayés |
|-------------|--------------|
| idle | idle |
| working | working, thinking |
| thinking | thinking, working |
| searching | thinking, working |
| approval | listening, surprised, talking |
| question | listening, talking, surprised |
| error | error, sad |
| finished | done, happy, celebrating |
| ratelimit | sad, error, sleeping |
| sleeping | sleeping, idle |
| dizzy | surprised, error |

Les changements passent par `play(etat)` sans `immediate`, sauf `approval` et `question` qui passent en `immediate: true` pour réagir sans attendre la fin d'un clip vidéo.

### Charger une mascotte

- Réglages, nouvelle section « Mascotte » : bouton « Choisir un dossier MascotForge », bouton « Revenir à Mochi », nom et crédit de la mascotte active, et un avertissement si l'export est une vidéo sans masque alpha (« elle aura un fond »).
- Le dossier choisi peut être le dossier d'export ou son sous-dossier `mascot/`. Coucou vérifie la présence de `manifest.json` (version 2), de `mascot.js` et des fichiers qu'il cite (`engine_src`, `states.*.src`). En cas d'échec : message clair dans les Réglages, mascotte actuelle inchangée.
- Coucou copie le dossier `mascot/` dans son dossier de données (`%APPDATA%\<identifiant de l'app>\mascots\current\`) en remplaçant l'ancien. Supprimer ou déplacer le dossier d'origine ne casse rien.
- La page charge les fichiers par le protocole d'assets de Tauri : `assetProtocol` activé avec un scope limité au dossier `mascots`, et la CSP élargie à `asset:` et `http://asset.localhost` pour `script-src`, `media-src`, `img-src`, `connect-src` (le composant fait un `fetch` du manifeste) et `frame-src`. Une iframe charge `mascot.js` par une balise script, puis un élément `<mascot-avatar>` dont l'attribut `manifest` pointe sur l'URL d'asset du manifeste. L'île lui transmet l'état à jouer par `postMessage`.
- Changer de mascotte s'applique sans relancer l'app.

### Retrait du lion

`src/mochi/lion.ts`, `src/mochi/assets/lion-*.png`, `dev/lion-preview.html` disparaissent ; `engine.ts` et `greeting.ts` reviennent à leur version de `main`.

### Sobriété

Quand l'agent est inactif depuis le délai de sommeil existant, la mascotte passe en `sleeping` si elle l'a. La page de l'île ne redessine plus Mochi tant qu'une mascotte MascotForge est active. Le reste (rythme de rendu interne aux moteurs) appartient à MascotForge.

### Décisions prises par Claude (à vérifier par Darius)

- **Mode coin = réglage.** Les Réglages gagnent « Position de Coucou : en haut / dans le coin ». Par défaut sur Windows : dans le coin. Le mode en haut, son code, ses tests (`clamp_collapsed`, barre des tâches en haut) et le build Linux restent intacts. Ça garde un retour arrière et ne casse pas Linux, qui partage `windows/src` et `island.rs`.
- **La mascotte vit dans une iframe** à l'intérieur de la fenêtre de l'île. Les exports n'ont pas tous la même version de `mascot.js`, et `<mascot-avatar>` ne s'enregistre qu'une fois par page : l'iframe permet de changer de mascotte sans relancer, et isole les moteurs du reste de l'île. La CSP ajoute donc l'origine d'asset à `frame-src`.
- **Sobriété :** Coucou peut appeler les méthodes publiques de pause des moteurs (par exemple `pause()` de Wobnimo) quand la mascotte dort. Coucou ne modifie jamais les fichiers copiés d'un export. Si le moteur blob tourne en continu sans moyen de pause, la correction se fait dans MascotForge, hors de ce chantier.
- **Mochi dans le panneau :** quand une mascotte MascotForge est active, le Mochi dessiné dans le panneau, la garde-robe et le clic droit sur Mochi sont masqués. Les minis des intégrations restent.

## Vérification attendue

- `npx tsc --noEmit` et `npx vite build` sans erreur ; tests npm et build Rust verts sur la CI GitHub.
- Avec trois exports réels de `text-to-mascot/exports/` (un blob, un 3D, `mascot-5791080d` en vidéo) : capture du coin au repos (aucun fond visible), du panneau ouvert au survol, et du panneau ouvert seul sur une demande d'autorisation Claude Code.
- Un clic à côté de la mascotte, panneau fermé, atteint bien l'application en dessous.
- Le build de l'installeur passe par `windows.yml` lancé à la main sur `dan-lion`.

## Laissé au constructeur

- Dimensions exactes du panneau et animation d'ouverture.
- Choix du mécanisme de sélection de dossier (plugin dialog de Tauri ou commande Rust).
- Noms des clés de configuration et des événements.
- Ordre de travail. Recommandation : commencer par une preuve que `<mascot-avatar>` charge un export 3D (module ES) depuis le protocole d'assets dans la WebView2 transparente, avant de toucher à la géométrie de l'île.

## Risques connus

- Chargement d'un module ES (`wobnimo.js`) depuis `http://asset.localhost` : en-têtes CORS et type MIME à vérifier tôt.
- WebGL2 dans une fenêtre transparente WebView2 : la transparence réelle des pixels est à vérifier sur une capture.
- Écrans multiples et changement d'échelle : `apply_geometry` gère déjà ces cas pour l'ancrage en haut ; l'ancrage en coin doit garder la mascotte à l'écran si un écran disparaît.
