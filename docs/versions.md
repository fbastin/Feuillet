# Versions

Le serveur enregistre une version du projet peu après chaque modification,
avec le nom de ceux qui l'ont faite. L'onglet **Versions** de la colonne de
gauche les montre, les plus récentes d'abord, avec les fichiers changés.

## Étiqueter

**Étiqueter cette version** donne un nom à une version, par exemple
« Soumis ». **Étiqueter le projet tel qu'il est maintenant** fait de même pour
l'état actuel. Les versions étiquetées sont gardées pour de bon; les autres,
les 1000 dernières.

## Comparer

**Comparer** une version, puis cocher une autre version, montre leurs
différences dans l'éditeur. **Arrêter la comparaison** revient au texte.

## Restaurer

- **Restaurer ce fichier** remet un fichier tel qu'il était dans la version,
  y compris un fichier supprimé depuis.
- **Restaurer** remet tous les fichiers du projet tels qu'ils étaient dans la
  version; les fichiers ajoutés depuis sont conservés.

Une restauration est elle-même une modification : elle crée une nouvelle
version, et rien n'est perdu.

## Télécharger

**Télécharger cette version (.zip)** donne les fichiers de la version, le
texte sans les commentaires ni les modifications suivies.

## Et l'historique Git?

L'onglet **Historique Git** montre les commits du dépôt lié au projet; voir
[GitHub](github.md).
