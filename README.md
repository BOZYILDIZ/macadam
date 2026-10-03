# Macadam

![version](https://img.shields.io/badge/version-0.1.1-0a84ff)

Macadam est une application open source pour **nettoyer et organiser ton Mac**, sans jamais rien supprimer définitivement : tout passe par la Corbeille.

Construite avec [Tauri](https://tauri.app/) (Rust + interface web légère) — binaire natif léger, pas de moteur Electron embarqué.

## Fonctionnalités

- **Rangement de fichiers** — trie les fichiers d'un dossier (ex: `Téléchargements`) dans des sous-dossiers par type : Images, PDF, Documents, Tableurs, Archives, Installateurs, Audio, Vidéos, Code, Autres.
- **Nettoyage de caches** — scanne les emplacements de cache courants (`~/Library/Caches`, `~/Library/Logs`, Xcode DerivedData, cache npm, etc.) et libère l'espace qu'ils occupent.
- **Détection de doublons** — trouve les fichiers identiques (par contenu, via hash Blake3) dans un dossier, récursivement.
- **Analyse d'espace disque** — explore un dossier niveau par niveau pour voir ce qui prend le plus de place.

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

## Changelog

### v0.1.1
- Correction : le nettoyage de caches pouvait rester bloqué indéfiniment sur des dossiers système protégés par macOS (Safari, CloudKit, HomeKit, Find My…). Ces éléments sont maintenant détectés et ignorés automatiquement, avec un message clair listant ce qui a été sauté.
- Ajout d'un retour visuel (bouton en état "en cours…") pendant les scans et nettoyages, pour éviter l'impression de blocage.
- Nouvelle navigation en barre latérale avec icônes (au lieu d'onglets textuels en haut).
- Le numéro de version s'affiche maintenant dans l'application (coin inférieur de la barre latérale).

### v0.1.0
- Première version : Rangement de fichiers, Nettoyage de caches, Détection de doublons, Analyse d'espace disque.

## Licence

[MIT](./LICENSE)
