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
Copiez-le aussitôt : il n'est affiché qu'une fois.

Git le demande comme mot de passe, la première fois que vous clonez, tirez
ou poussez. Git pour Windows et Git sur macOS le gardent ensuite pour vous.
Ailleurs, gardez-le dans votre gestionnaire de mots de passe, ou lancez une
fois cette commande pour que Git le garde, non chiffré, dans
`~/.git-credentials` :

```
git config --global credential.helper store
```

L'onglet liste vos jetons, avec leur date de création et de dernière
utilisation; **Supprimer** en retire un, que Git ne peut plus utiliser.
Changer votre mot de passe les supprime tous. Un compte en a dix au plus.

## Cloner

Le bouton **Git**, en haut de l'éditeur, donne la commande `git clone` du
projet, avec votre nom de compte dans l'adresse. Lancez-la dans un
terminal. Quand Git demande « Password for … », collez votre jeton Git, qui
commence par `fgt_` : votre mot de passe Feuillet n'y fonctionne pas, et
Feuillet le dit à Git (« This is not a Git token »).

```
git clone -c user.name="alice" -c user.email="alice@example.org" https://alice@feuillet.slashbin.net/collab/git/<projet> "Thèse"
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

Votre nom dans Feuillet et l'auteur de vos commits sont deux choses
distinctes. Pour vous connecter, Git envoie le nom de compte qui est dans
l'adresse, avec votre jeton; c'est lui que Feuillet vérifie, et l'historique
du projet note **Git (votre nom de compte)**. L'auteur d'un commit, lui, est
le nom et l'adresse que Git lui donne (`user.name` et `user.email`), que
voient les collaborateurs qui clonent le projet; Feuillet ne s'en sert pas.

La commande du bouton **Git** règle l'auteur du clone : `user.name` sur
votre nom dans Feuillet, celui que portent aussi les commits **Update from
Feuillet**, et `user.email` sur le **courriel des commits Git** de votre
profil, s'il en a un, celui des envois vers [GitHub](github.md). Vous
apparaissez ainsi sous un seul nom et une seule adresse. Vos autres dépôts
n'en sont pas touchés. Sans courriel des commits Git dans le profil,
l'adresse reste celle de votre configuration Git. Pour changer l'adresse
d'un clone déjà fait, lancez dans son dossier :

```
git config user.email "adresse que vos collaborateurs peuvent voir"
```
