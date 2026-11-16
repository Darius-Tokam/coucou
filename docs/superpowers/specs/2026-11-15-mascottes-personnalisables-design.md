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

### Clic sur une mini : sa propre fiche (demande de Darius, 2026-11-15)

- Un clic sur une petite mascotte ouvre sa propre fiche. Un sous-agent montre son type ; une session montre son agent, Claude Code ou Codex, et son projet.
- La fiche montre la couleur, l'état, le projet, les étapes propres à cette mascotte et sa réponse finale. Les sessions lisent `last_assistant_message` de `Stop` ; les sous-agents lisent celui de `SubagentStop`.
- Un lien « Ouvrir la session » ouvre le grand panneau sur l'onglet de la session concernée.
- Les étapes sont gardées dans le modèle des mascottes (`agents.ts`), par mascotte, 50 au plus, et partent avec elle.
- Une autorisation ou une question en attente garde la priorité : le clic ouvre le grand panneau sur la carte qui demande une réponse.
- La case groupée « +N » garde le comportement du clic sur la grande mascotte.

### Petit panneau de chaque mini

- Un clic sur une petite mascotte de session ou de sous-agent ouvre sa fiche dans une carte dédiée de 320 px de large. Cette carte n'affiche ni l'en-tête ni les onglets du grand panneau.
- Rust réserve une zone d'au plus 320 x 300 px. La page mesure le contenu et réduit la hauteur réelle de la carte dans cette zone. La liste des étapes défile si elle atteint la hauteur maximale ; la réponse finale tient sur quatre lignes au plus.
- La carte est centrée horizontalement sur la petite mascotte et séparée d'elle par `MINI_GAP`. Elle s'ouvre au-dessus dans la moitié basse de la zone de travail, et en dessous dans la moitié haute ou quand elle ne tient pas au-dessus. Elle reste entièrement dans la zone de travail.
- Une pointe sur le bord supérieur ou inférieur vise le centre de la petite mascotte. Près d'un bord d'écran, la carte se décale tandis que la pointe reste face à la mascotte.
- La règle vaut pour une mascotte dans la file et une mascotte posée librement. La carte passe devant les autres petites mascottes et peut les recouvrir.
- Cliquer une autre petite mascotte déplace la carte et remplace son contenu. Recliquer la même petite mascotte ferme la carte.
- Si la mascotte part pendant que sa fiche est ouverte, la copie de ses données et l'ancre restent jusqu'à la fermeture.
- Un clic sur la grande mascotte efface l'ancre et ouvre le grand panneau de 720 x 320 px avec son en-tête et ses onglets. Toutes les autres vues gardent ce grand panneau.
- Hors mode coin, la fiche garde son comportement actuel dans le grand panneau.

### Galerie des mascottes (demande de Darius, 2026-11-15)

Darius veut un endroit visuel pour changer de mascotte, sans repasser par le sélecteur de dossier.

- **Où** : Réglages, Général, section Mascotte, en tête : une grille de vignettes « Galerie ».
- **Ce qu'elle montre** :
  - toutes les mascottes déjà importées. Chaque import est désormais gardé dans une bibliothèque (`mascots/library/<nom du dossier d'export>`) en plus d'être installé ;
  - les exports d'un « Dossier de mascottes » choisi une fois (bouton « Choisir le dossier de mascottes », par exemple `text-to-mascot\exports`). Coucou lit chaque sous-dossier qui contient un export valide, sans rien copier tant qu'on ne l'applique pas.
- **Une vignette** :
  - la mascotte elle-même, rendue en petit (environ 96 px) puis figée après son premier état `idle`, avec la même iframe et la même pause que les mascottes du coin ;
  - son nom (celui du manifeste, sinon le nom du dossier) et un badge du moteur (3D, Blob, Vidéo) ;
  - deux boutons, « Claude Code » et « Codex » : un clic applique cet export à ce rôle (même vérification et même installation qu'un import). La vignette active pour chaque rôle est marquée.
- **Survol d'une vignette** : elle s'anime, puis se fige de nouveau en sortant.
- **Coût** : les vignettes ne se chargent que lorsqu'elles sont visibles à l'écran (défilement), au plus 12 à la fois. Une vignette sortie de la vue est déchargée. La limite de contextes WebGL d'une page (de l'ordre de 16) n'est jamais atteinte.
- **Protocole** : le protocole `mascot` sert aussi `/lib/<id>/…` pour la bibliothèque et `/dir/<id>/…` pour le dossier de mascottes. Il est en lecture seule et garde la même protection contre les chemins qui sortent du dossier. L'`id` est le nom du sous-dossier, refusé s'il contient autre chose que des lettres, des chiffres, `-`, `_` ou `.`.
- **Erreurs** : un export invalide du dossier de mascottes n'apparaît pas, et son nom est noté dans le journal. Une application qui échoue affiche le message d'erreur d'import existant sous la vignette.
- **Retirer** : un bouton « Retirer de la galerie » sur une vignette de la bibliothèque la supprime de la bibliothèque, sans toucher à la mascotte active.

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
