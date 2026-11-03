# Git

*[English](../en/git.md)*

Un projet Feuillet se clone avec Git, comme sur Overleaf, sans passer par
GitHub : vous y travaillez sur votre ordinateur, avec vos outils habituels
ou avec [Claude Code](claude.md), et ce que vous poussez apparaît aussitôt
dans Feuillet, pour vos collaborateurs aussi.

## Un jeton Git

Git ne prend pas votre mot de passe Feuillet : il demande un jeton Git. Dans
votre profil (**Paramètres du profil**, dans le menu de votre compte),
l'onglet **Git** en crée un : dites à quoi il sert si vous le voulez
(*Mon portable*), donnez votre mot de passe, puis **Créer un jeton Git**.
Copiez-le aussitôt, dans votre gestionnaire de mots de passe ou dans celui
de Git : il n'est affiché qu'une fois.

L'onglet liste vos jetons, avec leur date de création et de dernière
utilisation; **Supprimer** en retire un, que Git ne peut plus utiliser.
Changer votre mot de passe les supprime tous. Un compte en a dix au plus.

## Cloner

Le bouton **Git**, en haut de l'éditeur, donne la commande `git clone` du
projet, avec votre nom de compte dans l'adresse. Lancez-la dans un
terminal; quand Git demande un mot de passe, donnez votre jeton Git.

```
git clone https://alice@feuillet.slashbin.net/collab/git/<projet> "Thèse"
```

Le propriétaire du projet et ses éditeurs le clonent, tirent et poussent;
ses réviseurs et ses lecteurs le clonent et tirent. Git est réservé aux
collaborateurs invités par leur nom : un lien seul ne le donne pas.

## Tirer et pousser

`git pull` apporte les modifications faites dans Feuillet depuis votre
dernier pull, en un commit **Update from Feuillet**, avec le nom de ceux qui
les ont faites. `git push` envoie vos commits : leurs modifications entrent
aussitôt dans le projet, sous **Git (votre nom)** dans son
[historique](versions.md).

- Tirez avant de pousser : un push est refusé si le projet a changé dans
  Feuillet depuis votre dernier pull. Feuillet n'accepte aucun push forcé.
- Seule la branche `master` est gardée : ni autre branche ni étiquettes.
- Les liens symboliques et les sous-modules sont refusés, tout comme les
  noms de fichiers avec `< > : " | ? *`.

## Ce que voit Git

Les fichiers contiennent le texte tel qu'il se lit : les commentaires et les
modifications suivies restent dans Feuillet, les modifications suivies comme
si elles étaient acceptées. Quand vous poussez une modification d'un
document, les commentaires et les modifications suivies du texte que vous
n'avez pas touché restent où ils étaient. Un fichier que vous supprimez,
renommez ou ajoutez dans Git est supprimé, renommé ou ajouté dans Feuillet.

Vos commits gardent le nom et l'adresse que Git leur donne (`git config
user.name` et `user.email`), que voient les collaborateurs qui clonent le
projet.
