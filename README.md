# TISMA PLACE

Launcher gaming Windows construit avec Electron, en français et avec une interface cyberpunk sombre aux accents violets.

## Démarrage

1. Installe Node.js LTS depuis https://nodejs.org/ si nécessaire.
2. Ouvre PowerShell dans ce dossier.
3. Lance `npm.cmd install`, puis `npm.cmd start` depuis PowerShell.
4. Un raccourci **Tisma Place** est aussi disponible sur le bureau.
5. Pour générer l’installateur Windows : `npm.cmd run build:win` (sortie dans `dist`).

## Fonctionnalités

- Scan automatique au démarrage des bibliothèques Steam, Epic, GOG et de certains jeux Ubisoft.
- Ajout manuel d'un fichier `.exe`.
- Bibliothèque locale persistante, recherche, filtres, favoris et tri.
- Lancement du jeu avec son dossier d'installation comme répertoire courant.

Le scanner cherche un exécutable dans quelques sous-dossiers et peut nécessiter un ajustement selon la structure du jeu. Les jeux du Microsoft Store et les lanceurs qui exigent un protocole spécial ne sont pas encore détectés automatiquement.


- Recherche automatique des jaquettes du catalogue Steam ; les images sont gardées localement.
- Favoris enregistrés dans la bibliothèque.
- Collections intelligentes (à découvrir, favoris, en cours, terminés) et réorganisation manuelle par glisser-déposer.
- Collections personnelles renommables, avec icônes au choix, couverture personnalisée ou mosaïque automatique des jaquettes ; l’image est incluse dans la sauvegarde exportée.
- Réorganisation indépendante des jeux à l’intérieur des collections et des collections entre elles.
- Étiquettes personnelles multiples par jeu, avec filtres cumulables et sauvegardés.
- Commandes multimédias Windows avec statut lecture/pause, pochette, progression quand elle est fournie, et boutons adaptés aux commandes prises en charge par le lecteur.
- Réglage direct du volume système et bouton muet dans le panneau musique.
- Statistiques sur sept jours et nombre de lancements des jeux démarrés depuis Tisma Place.

La recherche de jaquettes nécessite une connexion Internet. Si un titre n'est pas trouvé, tu peux toujours choisir une image depuis ton PC.

## Feuille de route — idées à explorer

Ces pistes sont notées pour les prochaines versions. On les réalisera progressivement, en vérifiant la faisabilité et l'intérêt avant chaque étape.

- [x] **Filtres et étiquettes combinables** : attribuer plusieurs étiquettes à un jeu (par exemple « coop » et « survie »), puis activer plusieurs filtres simultanément.
- [x] **Statistiques de jeu** : temps suivi sur sept jours, classement des cinq jeux les plus joués, huit dernières sessions globales et historique consultable dans chaque fiche de jeu.
- [x] **Collections intelligentes et ordre manuel** : vues dynamiques « À découvrir », « Favoris », « En cours » et « Terminés », avec tri par glisser-déposer sauvegardé dans chaque collection personnelle.
- [x] **Collections personnalisées** : renommage, icônes, couvertures personnelles ou aperçu automatique des jaquettes, et réorganisation de la liste des collections.
- [x] **Accueil personnalisable** : préréglages Immersion, Focus et Compact, affichage ou masquage des widgets, ordre personnalisé et préférences incluses dans les sauvegardes.
- [x] **Gestion rapide de la bibliothèque** : sélection de plusieurs jeux visibles, affectation groupée à une collection ou retrait de la bibliothèque avec confirmation.
- [x] **Édition groupée** : changer le statut ou le genre de plusieurs jeux, ou ajouter/retirer une étiquette en une seule action.
- [x] **Options de lancement par jeu** : arguments personnalisés et application compagnon, enregistrés dans la sauvegarde. Le plein écran peut être demandé avec un argument pris en charge par le jeu.
- [x] **Commandes multimédias Windows** : titre, artiste, album, lecteur actif, état lecture/pause, progression fournie par Windows, pochette et commandes adaptées aux capacités du lecteur.

## Feuille de route — prochaines versions

Ordre proposé : d’abord rendre l’interface plus aboutie, puis ajouter des outils qui accélèrent l’organisation et le lancement des jeux.

1. [x] **Refonte visuelle de l’accueil et de la bibliothèque** : hiérarchie plus lisible, cartes de jeux plus soignées, navigation mieux mise en valeur, contraste confortable et mise en page qui s’adapte à la fenêtre.
2. [x] **Présentations de l’accueil** : préréglages Immersion, Focus et Compact pour choisir rapidement quels panneaux afficher et comment les disposer.
3. [ ] **Collections intelligentes personnalisées** : créer des vues automatiques avec des règles comme plateforme, genre, étiquette, statut, favoris ou absence de lancement récente.
4. [ ] **Lancement rapide au clavier** : une fenêtre de recherche accessible par raccourci pour retrouver et lancer un jeu sans parcourir toute la bibliothèque.
5. [ ] **Succès Steam dans les fiches de jeux** : afficher les succès débloqués et leur progression quand le jeu, le profil et l’API Steam le permettent.
6. [x] **Version Windows prête à partager** : installateur Windows publié avec raccourci et mise à jour intégrée (version 1.0.2).

### Installateur et mises à jour

L’installateur NSIS crée un raccourci Bureau et Menu Démarrer. Il conserve les données utilisateur lors des mises à jour et de la désinstallation. Le dépôt de publication configuré est `REXOUNER/TismaPlace`.

Pour publier une nouvelle version, augmente `version` dans `package.json`, crée et pousse un tag correspondant (par exemple `v1.0.2`). GitHub Actions construira l’installateur Windows et publiera les fichiers nécessaires à la mise à jour intégrée.

