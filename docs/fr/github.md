# GitHub

*[English](../en/github.md)*

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
  fusionnées. Le commit porte votre nom et le **courriel des commits Git**
  de votre profil; votre adresse noreply de GitHub le relie à votre compte
  GitHub sans montrer votre adresse.
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

Pour travailler sur votre ordinateur, avec vos outils habituels ou avec
[Claude Code](claude.md), clonez le projet lui-même avec [Git](git.md) :
le bouton **Git**, en haut de l'éditeur, en donne la commande, et la fenêtre
GitHub y mène aussi (**Y travailler sur votre ordinateur**, **Cloner avec
Git**). Vos push vont directement dans le projet; **Envoyer vers GitHub**
les envoie ensuite vers GitHub, comme toute autre modification.

Les deux sont indépendants : le dépôt GitHub et le dépôt Git de Feuillet ont
chacun leur historique. Un clone pousse donc vers l'endroit d'où il vient;
Feuillet refuse les push d'un clone du dépôt GitHub.

Pour un projet qui n'est que dans votre navigateur, sans le serveur, la
fenêtre donne plutôt la commande `git clone` du dépôt GitHub : clonez-le,
poussez vos commits vers GitHub, puis **Récupérer depuis GitHub** dans
Feuillet.
