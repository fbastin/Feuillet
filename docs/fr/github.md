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

## Travailler sur une branche

Pour faire relire des modifications avant qu'elles n'arrivent sur la branche
principale, comme on le fait avec GitHub, la section **Branche** de la
fenêtre GitHub dit sur quelle branche le projet se trouve (elle est propre à
GitHub).

1. **Travailler sur une nouvelle branche** : donnez-lui un nom (Feuillet en
   propose un, comme `feuillet-2026-11-06`), puis **Créer la branche et la
   suivre**. La branche part de la branche actuelle sur GitHub. Les fichiers
   ne changent pas; les prochains envois iront sur la nouvelle branche.
2. Modifiez le projet, envoyez vos modifications comme d'habitude.
3. **Ouvrir une demande de fusion** (une *pull request*) : donnez un titre et
   une description; ce qui n'est pas encore sur GitHub est d'abord envoyé sur
   la branche. Vos coauteurs relisent la demande sur GitHub, la commentent
   et la fusionnent là. Une case la marque comme brouillon. La section
   montre ensuite l'état de la demande, avec un lien vers elle.
4. Une fois la demande fusionnée, **Revenir sur main** (ou la branche visée)
   remet le projet sur cette branche : ses fichiers deviennent ceux de la
   branche, qui contient maintenant vos modifications.

**Passer à une autre branche** fait de même avec n'importe quelle branche du
dépôt, par exemple celle d'un coauteur. Ce qui n'est pas encore sur GitHub
est d'abord envoyé sur la branche que l'on quitte, pour que rien ne se
perde; puis les fichiers du projet deviennent ceux de l'autre branche.

La branche est celle du projet, pas seulement la vôtre : quand vous en
changez, les fichiers changent pour tous les collaborateurs, et ceux qui ont
relié le dépôt depuis leur navigateur suivent la même branche. Les
commentaires et les modifications suivies restent attachés au texte qui ne
change pas.

## Publier une version

Une fois le projet lié, la section **Publier une version sur GitHub** de la
fenêtre GitHub crée une version (une *release*) : un tag sur le dernier
commit du dépôt, avec le PDF du projet en pièce jointe, compilé au moment même
avec TeX Live. C'est ce que GitHub montre sous **Releases**, et ce qu'on cite
ou qu'on envoie.

- Le **Tag** proposé suit le dernier (`v2` après `v1`, `1.4` après `1.3`);
  le **Titre** et les **Notes** sont libres.
- Le projet doit être à jour avec GitHub : envoyez et récupérez d'abord les
  modifications, pour que le PDF soit fait de ce que la version désigne.
- **Prépublication** la marque comme telle sur GitHub; on peut aussi publier
  sans le PDF.
- Le PDF passe par le serveur de Feuillet, que GitHub accepte quand le
  navigateur ne le peut pas : il faut être connecté à un compte Feuillet. Le
  serveur remet le PDF et le jeton à GitHub sans les garder. Si GitHub refuse
  le PDF, rien n'est publié.
- Le jeton doit pouvoir écrire dans le dépôt : l'accès `repo` (celui que
  demande **Se connecter à GitHub**), ou **Contents: write** pour un jeton à
  accès précis.

Si le dépôt est relié à [Zenodo](https://zenodo.org/account/settings/github/),
chaque version publiée y est archivée et reçoit un DOI, à citer pour une
thèse, un rapport ou une prépublication.

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

## Un badge « Ouvrir dans Feuillet »

Dans le `README.md` d'un dépôt public, ce badge permet à quiconque de
l'ouvrir dans Feuillet d'un clic (remplacez `PROPRIETAIRE/DEPOT`) :

```markdown
[![Ouvrir dans Feuillet](https://feuillet.slashbin.net/badges/ouvrir-dans-feuillet.svg)](https://feuillet.slashbin.net/docs?snip_uri=https://github.com/PROPRIETAIRE/DEPOT/archive/HEAD.zip)
```

Le badge s'affiche ainsi : ![Ouvrir dans Feuillet](../../public/badges/ouvrir-dans-feuillet.svg).
Pour un public anglophone, prenez `badges/open-in-feuillet.svg`.

Feuillet montre ce que contient le lien, puis crée le projet, nommé d'après
le dépôt, si on le demande; il faut d'abord se connecter si on ne l'est pas.
Le projet est une **copie** du dépôt, sans lien avec lui : pour envoyer vos
modifications vers le dépôt, importez-le plutôt depuis GitHub (**Importer**
dans la liste des projets) ou liez un projet au dépôt (voir plus haut).

- `HEAD` prend la branche par défaut; pour une autre branche, écrivez
  `archive/refs/heads/BRANCHE.zip`.
- Le serveur de Feuillet télécharge l'archive sans votre jeton GitHub : le
  badge ne fonctionne que pour un dépôt public.
- Le lien suit le format « Open in Overleaf » : d'autres possibilités (code
  LaTeX dans le lien, plusieurs fichiers, moteur, document principal) sont
  décrites dans [Ouvrir dans Feuillet](demarrer.md#ouvrir-dans-feuillet).
