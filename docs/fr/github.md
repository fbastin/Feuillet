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

Feuillet récupère tout l'historique du dépôt, avec les mêmes commits que sur
GitHub. Pour un long historique, la fenêtre montre où il en est (commits,
puis fichiers) : comptez moins d'une minute pour 300 commits, et une
trentaine de secondes pour 500 fichiers. GitHub limite
le nombre de requêtes de chaque compte, par minute et par heure; Feuillet
reste en deçà, et si la limite est tout de même atteinte, il dit à quelle
heure réessayer.

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

Tous les fichiers du dépôt sont gardés tels quels, fichiers binaires,
exécutables, `.gitignore` et dossier `.github` compris. Trois sortes
d'éléments restent sur GitHub sans être dans le projet; la fenêtre GitHub
les nomme, sous **Sur GitHub, mais pas dans le projet** :

- un **sous-module** apparaît comme un dossier vide. Feuillet garde le
  commit qu'il désigne, et le met à jour quand il change sur GitHub, mais
  n'a pas ses fichiers : une compilation dans Feuillet ne les a donc pas;
- un fichier gardé avec **Git LFS** n'est que son pointeur, quelques lignes
  de texte; une image LFS s'affiche donc vide. Un fichier mis à sa place
  dans Feuillet est envoyé sans LFS;
- un **lien symbolique** n'apparaît pas.

Les envois depuis Feuillet les laissent tels quels sur GitHub.

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
   branche, qui contient maintenant vos modifications. Ce que vous avez
   écrit après la demande, et qui n'est pas encore sur GitHub, vous suit :
   Feuillet le fusionne avec les fichiers de main, et vous l'envoyez ensuite
   vers main quand c'est prêt.

**Passer à une autre branche** fait de même avec n'importe quelle branche du
dépôt, par exemple celle d'un coauteur. Ce qui n'est pas encore sur GitHub
est d'abord envoyé sur la branche que l'on quitte, pour que rien ne se
perde; puis les fichiers du projet deviennent ceux de l'autre branche.

### Une branche supprimée sur GitHub

Beaucoup de dépôts suppriment la branche d'une demande dès qu'elle est
fusionnée (l'option *Automatically delete head branches*), et un coauteur
peut aussi en supprimer une. Feuillet ne la recrée pas en douce au prochain
envoi : le bouton GitHub porte un point, et la fenêtre dit que la branche
n'existe plus. Rien n'est perdu, et deux choix sont offerts :

- **Revenir sur main** (ou sur une autre branche) : vos modifications qui
  n'étaient pas sur GitHub vous suivent, fusionnées avec les fichiers de
  cette branche, et vous les envoyez ensuite.
- **La recréer sur GitHub** : la branche revient, avec tout ce que le projet
  a de plus, et le projet continue de la suivre.

La branche est celle du projet, pas seulement la vôtre : quand vous en
changez, les fichiers changent pour tous les collaborateurs, et ceux qui ont
relié le dépôt depuis leur navigateur suivent la même branche. Les
commentaires et les modifications suivies restent attachés au texte qui ne
change pas.

## Compiler sur GitHub à chaque envoi

Pour que le dépôt ait toujours un PDF à jour, y compris pour les
modifications faites hors de Feuillet, la section **Compiler sur GitHub à
chaque envoi** ajoute au dépôt un fichier GitHub Actions,
`.github/workflows/feuillet.yml`. Il compile le projet comme Feuillet : même
document principal, même moteur, même année de TeX Live (les images Docker
officielles de TeX Live), glossaires et nomenclatures compris.

- **Ajouter le fichier sur GitHub** l'écrit sur la branche liée; il arrive
  ensuite dans le projet comme toute modification faite sur GitHub.
- Chaque envoi et chaque demande de fusion lancent une compilation, dans
  l'onglet **Actions** du dépôt. Le PDF est dans chaque exécution, sous
  **Artifacts**. Une erreur de compilation apparaît comme une vérification
  échouée sur la demande de fusion.
- Quand le document principal, le moteur ou TeX Live du projet changent, la
  section propose de **mettre à jour le fichier**. Un fichier du même nom
  que Feuillet n'a pas créé est laissé tel quel.

GitHub n'accepte ce fichier que d'un jeton qui a la portée **workflow** en
plus de **repo**. Sinon, il le refuse et rien ne change dans le projet; la
section propose alors de **changer de jeton**, et le lien de création de
jeton coche les deux portées.

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
