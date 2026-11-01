# GitHub

Un projet Feuillet peut être lié à un dépôt GitHub, comme dans Overleaf : on
envoie ses modifications vers GitHub et on récupère celles qui y ont été
faites. GitLab, Gitea et Forgejo fonctionnent de la même façon.

## Se connecter

Le bouton **GitHub**, en haut de l'éditeur, ouvre la synchronisation. La
première fois, **Se connecter à GitHub** vous fait autoriser Feuillet chez
GitHub; vous pouvez aussi donner un jeton d'accès personnel. Le jeton est
chiffré et gardé dans votre navigateur; le serveur de Feuillet ne le garde
pas. Si GitHub refuse un jeton expiré ou révoqué, Feuillet le dit et en
demande un autre (**Changer de jeton**).

## Lier un projet à un dépôt

- **Créer un nouveau dépôt** : donnez son nom, une description si vous le
  voulez, choisissez **Privé** ou **Public**, puis **Créer le dépôt et
  envoyer**.
- **Utiliser un dépôt existant** : choisissez le dépôt et la branche, puis
  **Lier le dépôt et récupérer**.

Pour créer un projet à partir d'un dépôt, utilisez plutôt **Importer** dans
la liste des projets.

## Envoyer et récupérer

Une fois le projet lié, la fenêtre indique où il en est : fichiers modifiés
depuis le dernier commit, commits pas encore sur GitHub, modifications de
GitHub pas encore dans le projet.

- **Envoyer vers GitHub** crée un commit avec votre message et l'envoie.
  Si GitHub a reçu d'autres modifications entre-temps, elles sont d'abord
  fusionnées.
- **Récupérer depuis GitHub** fusionne les modifications de GitHub dans le
  projet. Quand les mêmes lignes ont changé des deux côtés, Feuillet montre
  les conflits à résoudre; vous pouvez aussi annuler la fusion.

Par défaut, les commentaires et les modifications suivies ne vont pas sur
GitHub : seul le texte y est envoyé, tel qu'il serait une fois les
modifications acceptées.

L'onglet **Historique Git**, à gauche, montre les commits et leurs
différences. **Délier le dépôt** défait le lien sans toucher ni au projet ni
à son historique.

## Travailler sur son ordinateur

Sous **Y travailler dans votre ordinateur, avec Claude Code**, la fenêtre
donne la commande `git clone` du dépôt. Clonez-le, modifiez-le avec vos
outils habituels ou avec [Claude Code](claude.md), poussez vos commits, puis
**Récupérer depuis GitHub** dans Feuillet.
