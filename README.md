# Macadam

![version](https://img.shields.io/badge/version-0.4.1-0a84ff)

Macadam est une application open source pour **nettoyer et organiser ton Mac**, sans jamais rien supprimer définitivement : tout passe par la Corbeille.

Construite avec [Tauri](https://tauri.app/) (Rust + interface web légère) — binaire natif léger, pas de moteur Electron embarqué.

## Fonctionnalités

- **Rangement de fichiers** — trie les fichiers d'un dossier (ex: `Téléchargements`) dans des sous-dossiers par type : Images, PDF, Documents, Tableurs, Archives, Installateurs, Audio, Vidéos, Code, Autres.
- **Nettoyage de caches** — scanne les emplacements de cache courants (`~/Library/Caches`, `~/Library/Logs`, Xcode DerivedData, cache npm, etc.) et libère l'espace qu'ils occupent.
- **Détection de doublons** — trouve les fichiers identiques (par contenu, via hash Blake3) dans un dossier, récursivement. Au choix : les supprimer, ou les **fusionner via un clone APFS** (`clonefile`) — les deux fichiers restent intacts et utilisables, mais partagent le même espace disque tant qu'aucun n'est modifié. Zéro risque de perte de données.
- **Analyse d'espace disque** — treemap interactif (+ vue liste), et une vue **Évolution** en graphique 3D qui montre ce qui a grossi ou rétréci depuis ta dernière visite (comparé à ~7 jours en arrière), avec historique conservé localement.
- **Applications au démarrage** — gère les Login Items classiques et les LaunchAgents (processus d'arrière-plan) pour accélérer l'ouverture de session.
- **Applications inutilisées** — repère les apps de `/Applications` jamais ouvertes ou ouvertes depuis longtemps (date fournie par Spotlight/Launch Services), triées des moins utilisées aux plus utilisées.

- **Mise à jour automatique** — Macadam vérifie discrètement s'il existe une nouvelle version à chaque lancement ; si oui, une bannière propose de l'installer en un clic (ou "Plus tard"). Rien de bloquant, aucune vérification visible si tout est déjà à jour.
- **Accès complet au disque** — un bouton dans la barre latérale ouvre directement Réglages Système > Confidentialité et sécurité > Accès complet au disque, pour éviter les multiples popups d'autorisation de macOS (un par dossier protégé : Bureau, Documents, Téléchargements…).

Toutes les suppressions envoient les fichiers à la **Corbeille macOS**, jamais de suppression définitive — tu peux toujours annuler.

## Prérequis pour développer

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Xcode Command Line Tools (`xcode-select --install`)

## Démarrer

```bash
npm install
npm run dev     # lance l'app en mode développement
npm run build   # build l'app .app/.dmg
```

## Stack technique

- **Backend** : Rust (`src-tauri/`) — commandes Tauri pour le système de fichiers, le hashing et le déplacement vers la Corbeille.
- **Frontend** : HTML/CSS/JS vanilla (`src/`) — aucune dépendance front, pas de framework.

## Contribuer

Macadam est open source et les contributions sont les bienvenues ! Tu peux :

- 🐛 **Signaler un bug** ou proposer une idée via une [issue GitHub](https://github.com/BOZYILDIZ/macadam/issues)
- 🔧 **Proposer une amélioration** via une pull request (fork → branche → PR)
- ⭐ Mettre une étoile au repo si l'outil t'est utile

Avant de soumettre une PR, vérifie que `cargo check` passe côté backend et que l'app se lance correctement avec `npm run dev`. Pas besoin d'être expert Rust ou Tauri pour contribuer — les petites améliorations (UI, traductions, nouvelles catégories de tri, idées de fonctionnalités) sont tout aussi bienvenues que les grosses.

## Changelog

### v0.4.1
- **Correction :** un bug CSS faisait que la vue Liste de l'espace disque restait visible sous le Treemap une fois consultée (`.list { display: flex }` avait la même priorité que la règle masquant `hidden`, et gagnait le conflit de cascade). Règle `[hidden] { display: none !important }` ajoutée pour que `hidden` l'emporte toujours.
- **Nouveau :** bouton "Accès complet au disque" dans la barre latérale — ouvre directement le bon panneau de Réglages Système pour éviter les popups d'autorisation répétés de macOS, plus une astuce affichée une fois au premier lancement.

### v0.4.0
- **Nouveau :** mise à jour automatique (plugin officiel Tauri updater, signatures minisign). Vérification silencieuse au démarrage ; une bannière discrète propose "Mettre à jour" ou "Plus tard" si une nouvelle version existe — jamais de popup bloquante.
- Processus de release : chaque version signe désormais un `.app.tar.gz` + publie un `latest.json` en asset de la release GitHub, lus par le endpoint de l'updater.

### v0.3.0
- **Nouveau :** fusion de doublons par clone APFS (`clonefile`) — alternative à la suppression : les deux fichiers restent pleinement fonctionnels à leurs deux emplacements, mais partagent les mêmes blocs disque tant qu'aucun n'est modifié. Fonctionne uniquement sur un même volume APFS.
- **Nouveau :** vue "Évolution" dans l'onglet Espace disque — graphique 3D (CSS, pas de dépendance) montrant ce qui a grossi/rétréci depuis la dernière comparaison disponible (~7 jours), avec vue tableau alternative. Historique stocké localement dans `~/Library/Application Support/Macadam/history.json`, purgé au-delà de 90 jours.
- Releases GitHub désormais taguées (`git tag vX.Y.Z`) avec changelog et binaire `.dmg` attachés.

### v0.2.0
- **Nouveau :** analyse d'espace disque en treemap (en plus de la liste), avec palette de couleurs validée accessibilité (daltonisme, contraste).
- **Nouveau :** onglet "Démarrage" — liste et gère les Login Items classiques (via System Events) et les LaunchAgents utilisateur (`~/Library/LaunchAgents`, activer/désactiver réversible) ; les agents système (`/Library/LaunchAgents`) sont affichés en lecture seule.
- **Nouveau :** onglet "Applications inutilisées" — liste les apps de `/Applications` et `~/Applications` triées par date de dernière ouverture (Spotlight), avec suppression vers la Corbeille.
- Refactor interne : logique de calcul de taille de dossier mutualisée (`util.rs`) entre les modules cache/espace disque/applications.

### v0.1.1
- Correction : le nettoyage de caches pouvait rester bloqué indéfiniment sur des dossiers système protégés par macOS (Safari, CloudKit, HomeKit, Find My…). Ces éléments sont maintenant détectés et ignorés automatiquement, avec un message clair listant ce qui a été sauté.
- Ajout d'un retour visuel (bouton en état "en cours…") pendant les scans et nettoyages, pour éviter l'impression de blocage.
- Nouvelle navigation en barre latérale avec icônes (au lieu d'onglets textuels en haut).
- Le numéro de version s'affiche maintenant dans l'application (coin inférieur de la barre latérale).

### v0.1.0
- Première version : Rangement de fichiers, Nettoyage de caches, Détection de doublons, Analyse d'espace disque.

## Licence

[MIT](./LICENSE)
