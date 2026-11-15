# Conception : petites mascottes colorées, réglables et déplaçables une par une (Coucou Windows)

Date : 2026-11-15. Branche : `dan-lion` du fork `Darius-Tokam/coucou`. Suite de `2026-11-14-mascottes-par-agent-design.md` (livrée) et du lot de sobriété (pause en dormant, basse résolution).

## Pourquoi

Les petites mascottes existent, mais toutes les mascottes de sous-agents se ressemblent, ont toutes la même taille et restent alignées en file. Darius veut reconnaître un type de sous-agent à sa couleur, choisir la taille et le look, masquer ce qu'il ne veut pas voir, et poser chaque mascotte où il veut sur l'écran.

## Choix de Darius (2026-11-15)

- **Couleur : une par type de sous-agent**, réglable : Explore en bleu, general-purpose en vert… Le même type garde toujours la même couleur.
- **Réglages** : la taille des petites, la couleur par type, l'accessoire et le visage par type (blob seulement), afficher ou masquer.
- **Déplacement : placement libre dans une seule fenêtre.** Chaque petite mascotte peut se poser n'importe où à l'écran.
- **Mémoire de position : par type de sous-agent.** Le prochain Explore reprend la place du dernier Explore.

## Objectifs

1. Une petite mascotte de sous-agent prend la couleur de son type. Sans réglage, une couleur stable est tirée d'une palette à partir du nom du type (Explore a toujours la même).
2. Réglages : couleur par type (types déjà vus, plus un champ pour en ajouter un), accessoire, yeux et joues par type (blob), taille des petites, affichage (sessions et sous-agents, sessions seulement, aucune).
3. On glisse une petite mascotte à la souris pour la poser n'importe où dans la zone de travail de l'écran de la grande. Sa position est retenue par famille et par type pour un sous-agent, par famille et par projet pour une session. Une mascotte jamais déplacée reste dans la file actuelle.
4. Un double-clic sur une mascotte déplacée la renvoie dans la file. Les Réglages ont aussi « Remettre les mascottes en file ».

## Hors périmètre

- Recolorer la grande mascotte et les sessions : seule la couleur des sous-agents est réglable. Le visage et l'accessoire ne valent que pour le moteur blob ; la 3D ne change que de couleur ; une vidéo ne change pas.
- Déplacer une mascotte sur un autre écran que celui de la grande.
- Les hooks : aucun changement.

## Échecs à éviter

- Une fenêtre transparente qui couvre tout l'écran et bloque des clics : seules les mascottes, les cases et le panneau prennent la souris (liste de rectangles, déjà en place, repliée comprise).
- Le processeur ou le GPU qui grimpent parce que la fenêtre devient grande (voir Risques).
- Deux sous-agents du même type empilés exactement au même endroit : le second se décale.
- Une mascotte posée hors de l'écran après un changement de résolution ou d'écran : elle revient dans la zone de travail, ou dans la file si son écran a disparu.
- Une couleur qui casse un export : la couleur passe par les attributs publics des moteurs, jamais par une modification des fichiers.

## Constaté (2026-11-15, code des moteurs installés)

- **3D (Wobnimo)** : l'attribut observé `palette` accepte `matiere:#couleur;matiere:#couleur` et appelle `setPalette` à chaud. Les noms de matières viennent du personnage (`engine_spec.materials` du manifeste : pour Orbi `shell`, `lilac`…). Changer `framing` à chaud casse le personnage ; `palette` passe par un chemin dédié, à vérifier en vrai.
- **Blob (Blob Atelier)** : attributs observés `shape, color, material, state, eyes, cheeks, accessory, acc-color, still, seed`.
- La page de l'iframe (`FRAME_HTML`, `mascot.rs`) est la seule à toucher l'élément du moteur ; l'île lui parle par `postMessage`.

## Conception

### Couleur et look

- Message île vers iframe : `{ type: "look", color: string | null, accessory: string | null, eyes: string | null, cheeks: string | null }`.
- 3D : la couleur teinte la première matière de `engine_spec.materials` (la coque, en général) par l'attribut `palette`. Sans `engine_spec.materials`, rien.
- Blob : `color`, `accessory`, `eyes`, `cheeks` posés en attributs ; une valeur `null` retire l'attribut (retour à l'export).
- Palette par défaut : 8 couleurs lisibles sur fond sombre ; l'index vient d'un hachage stable du nom du type.

### Taille et affichage

- Réglage « Taille des petites mascottes » : 60 à 120 px, 120 par défaut. Les sessions prennent cette taille, les sous-agents 75 % de cette taille (90 px par défaut).
- Réglage « Petites mascottes » : sessions et sous-agents (défaut), sessions seulement, aucune.
- La file (`corner_layout`) reçoit les tailles au lieu d'une constante.

### Taille de la grande mascotte (demande de Darius, 2026-11-15)

- Réglage « Taille de la grande mascotte » : 120 à 240 px, 240 par défaut (la taille actuelle).
- La fenêtre repliée, la zone cliquable, la file et le panneau suivent cette taille ; le cadrage 3D (1.2) reste le même, la mascotte garde sa marge pour sauter.
- Le coin haut-gauche enregistré (`corner_pos`) ne bouge pas quand la taille change : la mascotte rétrécit vers son coin haut-gauche, puis est ramenée dans la zone de travail si besoin.
- Masquer les petites mascottes passe par le réglage « Petites mascottes : aucune » (ci-dessous).

### Placement libre

- Une mascotte jamais déplacée est dans la file, comme aujourd'hui.
- Glisser : au-delà du seuil existant (`DRAG_THRESHOLD`), la fenêtre du coin s'étend le temps du glisser à toute la zone de travail de l'écran (transparente, clics traversants partout sauf sous la mascotte tenue), la mascotte suit le pointeur. Au relâcher, sa position écran est enregistrée et la fenêtre reprend le rectangle englobant de ce qui est dessiné.
- Positions enregistrées dans les réglages : `mini_positions: { "<famille>:type:<type>" | "<famille>:project:<projet>": { x, y } }` en pixels physiques écran, coin haut-gauche.
- Un second sous-agent du même type, alors que le premier vit encore, se pose décalé de la moitié de sa taille vers le centre.
- `corner_layout` reçoit, pour chaque case, soit « dans la file », soit sa position écran ; la fenêtre est le rectangle englobant de la grande, de la file, des mascottes posées et du panneau ; les mascottes posées hors zone de travail y sont ramenées.
- Le panneau garde sa règle actuelle (au-dessus du groupe grande + file) et passe au-dessus des mascottes posées.

### Clic sur un sous-agent : sa propre fiche (demande de Darius, 2026-11-15)

- Un clic sur la petite mascotte d'un sous-agent ouvre le panneau sur **la fiche de ce sous-agent**, pas sur l'onglet de sa session parente.
- La fiche montre : son type (« Explore ») avec sa couleur, son état, le projet de la session parente, la liste de ses propres étapes (chaque outil qu'il a lancé, au même format que les étapes d'un onglet), et sa réponse finale quand il a fini (`last_assistant_message` de `SubagentStop`, présent chez Codex, à vérifier chez Claude Code).
- Un lien « Session » sur la fiche ouvre l'onglet parent.
- Les étapes sont gardées dans le modèle des mascottes (`agents.ts`), par sous-agent, 50 au plus, et partent avec lui.
- Une autorisation demandée par ce sous-agent garde la priorité : si elle attend, le clic montre la carte d'autorisation, comme aujourd'hui.
- Un clic sur la mascotte d'une session ouvre toujours l'onglet de sa session.

### Réglages

Section « Mascotte », sous les deux exports : taille, affichage, « Couleurs des sous-agents » (une ligne par type connu : pastille de couleur, accessoire, yeux, joues ; les trois derniers grisés si l'export Claude Code ou Codex n'est pas un blob), un champ « Ajouter un type », « Remettre les mascottes en file ». Les types connus sont ceux déjà vus par Coucou, mémorisés dans les réglages.

## Vérification attendue

- Tests : couleur stable par type, message `look` envoyé seulement quand il change, clés de position, décalage du second du même type, `corner_layout` avec cases posées (rectangle englobant, ramenées à l'écran), fenêtre de glisser = zone de travail.
- CI verte.
- Dans l'app : un clic sur un sous-agent ouvre sa fiche avec ses propres étapes, et le lien « Session » ouvre l'onglet parent ; trois sous-agents de deux types montrent deux couleurs ; une mascotte déplacée reste où elle est posée et un nouveau sous-agent du même type y revient ; le double-clic la renvoie en file ; captures.
- **Mesure processeur et GPU** avec une mascotte posée à l'opposé de l'écran (fenêtre presque plein écran), comparée à la mesure du lot de sobriété.

## Risques connus

- **GPU (choix de Darius : une seule fenêtre).** Une mascotte posée loin de la grande agrandit la fenêtre transparente jusqu'à presque tout l'écran. Le GPU, déjà le premier poste de consommation, peut monter. Si la mesure montre une hausse nette, le repli est de donner une petite fenêtre à chaque mascotte posée (environ 100 Mo de mémoire par mascotte), décision à reprendre avec Darius.
- La couleur 3D dépend des noms de matières de chaque personnage : un export sans `engine_spec.materials` ne change pas de couleur.
