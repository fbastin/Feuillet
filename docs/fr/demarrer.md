# Premiers pas

*[English](../en/getting-started.md)*

## Créer un compte

Sur <https://feuillet.slashbin.net>, choisissez **Créer un compte** et donnez
un nom d'utilisateur, un mot de passe et, si vous le voulez, une adresse
courriel : un lien envoyé à cette adresse la confirme, et elle servira si
vous oubliez votre mot de passe (voir [Compte](compte.md)). Le compte
existe dans votre navigateur et sur le serveur de Feuillet : en vous
connectant sur un autre appareil avec le même nom et le même mot de passe,
vous retrouvez vos projets.

Une **session invitée** permet d'essayer Feuillet sans compte, mais elle n'a
pas de compte sur le serveur : on ne peut ni y être invité ni partager par
invitation.

## La liste des projets

La colonne de gauche classe les projets : **Tous les projets**, **Mes
projets**, **Partagés avec moi**, **Archivés** et **Corbeille**. Chaque carte
de projet offre :

- **Ouvrir**;
- **Faire une copie**, qui crée un projet à vous avec les mêmes documents et
  fichiers, sans la discussion ni les versions;
- **Archiver**, pour ranger un projet sans le supprimer;
- **Mettre à la corbeille**, d'où on peut le **Restaurer** ou le
  **Supprimer définitivement**. Supprimer définitivement un de vos projets
  l'efface aussi du serveur, pour ses collaborateurs également;
- pour un projet partagé avec vous, **Quitter le projet**
  (voir [Collaborer](collaborer.md)).

### Nouveau projet

**Nouveau projet** propose des modèles : vide, exemple, article, livre,
lettre, devoir, affiche, présentation, rapport, thèse, CV. Le projet compile
avec TeX Live dès sa création.

### Importer

**Importer** crée un projet à partir :

- d'une archive `.zip`, par exemple un projet téléchargé d'Overleaf;
- d'un dépôt GitHub, GitLab, Gitea ou Forgejo (voir aussi [GitHub](github.md));
- d'une adresse web (dépôt ou archive);
- de la galerie de modèles de TeXlyre.

## L'éditeur

- À gauche, l'arbre des **Fichiers**, avec la **Recherche** dans tout le
  projet, la **Relecture**, les **Versions** et l'**Historique Git**. Le
  bouton **Nouveau fichier** crée un fichier LaTeX, BibTeX ou autre; on peut
  aussi y déposer des images.
- Au centre, le texte, en mode **Code** ou **Visuel**. Le mode visuel montre
  les titres, les listes, les formules, les figures et les tableaux comme
  dans le document; une barre d'outils sert à la mise en forme.
- À droite, la sortie : le **Journal** de compilation et le PDF.

En mode visuel, comme dans l'éditeur de tableaux d'Overleaf, un clic dans un
tableau sélectionne une cellule et montre sa barre d'outils : lignes,
colonnes, alignement, bordures, fusion et légende. Un double clic édite la
cellule. **Maj** avec un clic ou les flèches sélectionne plusieurs cellules
d'une ligne; **Fusionner les cellules** les réunit (`\multicolumn`), et
**Séparer les cellules** les défait. Le menu **Légende** met la légende
au-dessus ou en dessous du tableau, ou la retire avec son étiquette; un
tableau sans environnement `table` en reçoit un, centré.

Le correcteur d'orthographe souligne les fautes dans le texte LaTeX; un clic
droit propose des corrections. La langue suit celle du document.

Quand la fenêtre est étroite, les outils les moins utilisés de la barre de
l'éditeur passent dans le menu **…**.

## Compiler

**Ctrl+Entrée** (ou **Cmd+Entrée**) compile le projet avec TeX Live, sur le
serveur de Feuillet. Le menu à côté du bouton de compilation offre :

- le **document principal** du projet et le **moteur** (pdfLaTeX, XeLaTeX
  ou LuaLaTeX), communs à tous les collaborateurs;
- le **mode de compilation** : normal, ou rapide (brouillon), qui dessine les
  images comme des cadres;
- la **gestion des erreurs** : compiler malgré les erreurs, ou s'arrêter à
  la première;
- la compilation avec le cache vidé.

Comme sur Overleaf, un projet se compile quand on l'ouvre; son dernier PDF
s'affiche d'abord, le temps de la compilation. Le réglage **Compiler
automatiquement à l'ouverture du projet** (Paramètres, Compilation) désactive
cette compilation.

Les projets créés avant que Feuillet ait TeX Live compilaient dans le
navigateur : ils passent à TeX Live, avec leur moteur, la prochaine fois
qu'un éditeur les ouvre. Le compilateur du navigateur reste offert :
choisissez **LaTeX** comme compilateur dans les détails du projet (le crayon
à côté de son nom), et le projet le garde.

### Comprendre une erreur

Le **Journal** liste les erreurs et les avertissements avec leur fichier et
leur ligne; un clic mène à la ligne. Sous chaque erreur fréquente, une
explication dit ce que TeX n'a pas compris et comment corriger, par exemple
une commande inconnue ou un environnement qui demande un paquet. Les lignes
en cause sont aussi marquées dans l'éditeur, et leur info-bulle donne la
même explication. Ces explications sont dans la langue de l'interface.

### Du texte au PDF, et retour

Un double-clic dans le PDF mène à la ligne correspondante du texte. Le
bouton de synchronisation de la barre de l'éditeur fait l'inverse : il montre
dans le PDF l'endroit où se trouve le curseur.
