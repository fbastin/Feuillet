# Premiers pas

*[English](../en/getting-started.md)*

## Créer un compte

Sur la page d'accueil de Feuillet, choisissez **Créer un compte** et donnez
un nom d'utilisateur, un mot de passe et, si vous le voulez, une adresse
courriel : un lien envoyé à cette adresse la confirme, et elle servira si
vous oubliez votre mot de passe (voir [Compte](compte.md)). Le compte
existe dans votre navigateur et sur le serveur de Feuillet : en vous
connectant sur un autre appareil avec le même nom et le même mot de passe,
vous retrouvez vos projets.

Une **session invitée** permet d'essayer Feuillet sans compte, mais elle n'a
pas de compte sur le serveur : on ne peut ni y être invité ni partager par
invitation. Comme sur Overleaf, ses propres projets ne se compilent pas sur
le serveur, mais dans le navigateur; un projet ouvert par le lien de son
propriétaire, si.

Selon le serveur, créer un compte peut demander une invitation : à un
projet, ou un lien de son administrateur; ou une adresse courriel d'un
domaine qu'il accepte, à laquelle il envoie un lien.

## La liste des projets

La colonne de gauche classe les projets : **Tous les projets**, **Mes
projets**, **Partagés avec moi**, **Archivés** et **Corbeille**. Comme sur
Overleaf, chaque carte dit quand le projet a été modifié en dernier, et par
qui (« par vous » pour vous-même), d'après sa dernière version. Elle offre
aussi :

- **Ouvrir**;
- **Faire une copie**, qui crée un projet à vous avec les mêmes documents et
  fichiers, sans la discussion ni les versions;
- **Télécharger le PDF** d'un projet LaTeX : Feuillet le compile aussitôt
  avec TeX Live, son document principal, son moteur et sa version de TeX
  Live, puis télécharge le PDF à son nom;
- **Archiver**, pour ranger un projet sans le supprimer;
- **Mettre à la corbeille**, d'où on peut le **Restaurer** ou le
  **Supprimer définitivement**. Supprimer définitivement un de vos projets
  l'efface aussi du serveur, pour ses collaborateurs également;
- pour un projet partagé avec vous, **Quitter le projet**
  (voir [Collaborer](collaborer.md)).

Les étiquettes données aux projets (dans **Modifier le projet**) filtrent la
liste. Comme sur Overleaf, chaque étiquette peut avoir une couleur : le
bouton palette à côté de **Toutes les étiquettes** en propose neuf, une
autre au choix, ou aucune. Les couleurs suivent votre compte sur vos autres
appareils.

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

### Ouvrir dans Feuillet

Comme « Open in Overleaf », un lien ou un formulaire d'une autre page crée un
projet dans Feuillet. L'adresse est celle du serveur suivie de `/docs`
(`https://feuillet.exemple.org/docs`), avec les mêmes champs que celle
d'Overleaf (`https://www.overleaf.com/docs`) : remplacer l'une par l'autre
suffit.

- `snip_uri` : l'adresse d'un fichier (`.tex`, `.bib`, image…) ou d'une
  archive `.zip`, ou une adresse `data:`. Plusieurs fichiers :
  `snip_uri[]=…&snip_uri[]=…`;
- `snip` ou `encoded_snip` : du code LaTeX, tel quel ou encodé
  (`encodeURIComponent`). Sans `\documentclass`, il est placé dans le
  préambule d'Overleaf (article 12 pt, `amsmath`, `tikz`);
- `snip_name` (ou `snip_name[]`) : le nom de chaque fichier, dans l'ordre;
- `engine` : `pdflatex`, `latex_dvipdf` (le moteur LaTeX), `xelatex` ou
  `lualatex`;
- `main_document` : le document principal;
- `visual_editor=true` : propose l'éditeur visuel.

Le lien se suit en GET; un formulaire s'envoie en POST
(`application/x-www-form-urlencoded`, jusqu'à 10 Mo). Feuillet montre les
fichiers et leur provenance, et ne crée le projet que si vous le demandez;
sans compte ouvert, il demande d'abord de se connecter. Le serveur
télécharge les fichiers des autres sites pour votre compte, comme l'ajout
d'un fichier **Depuis une URL externe**. Il garde la demande 30
minutes, en mémoire seulement : passé ce délai, rouvrez le lien.

Pour un dépôt GitHub public, ce badge ouvre une copie du dépôt (remplacez
`feuillet.exemple.org` par l'adresse du serveur et `PROPRIETAIRE/DEPOT` par
le dépôt) :

```markdown
[![Ouvrir dans Feuillet](https://feuillet.exemple.org/badges/ouvrir-dans-feuillet.svg)](https://feuillet.exemple.org/docs?snip_uri=https://github.com/PROPRIETAIRE/DEPOT/archive/HEAD.zip)
```

Le badge anglais est `badges/open-in-feuillet.svg`. Pour garder le projet
lié au dépôt et y pousser vos changements, importez plutôt le dépôt depuis
GitHub (voir [GitHub](github.md)).

## L'éditeur

- À gauche, l'arbre des **Fichiers**, avec les **Collaborateurs** (voir
  [Collaborer](collaborer.md)), la **Recherche** dans tout le projet, la
  **Relecture**, les **Versions** et l'**Historique Git**. Le
  bouton **Nouveau fichier** crée un fichier LaTeX, BibTeX ou autre; on peut
  aussi y déposer des images. Un clic droit sur un fichier ou un dossier
  ouvre son menu (renommer, déplacer, dupliquer, supprimer…).
- Au centre, le texte, en mode **Code** ou **Visuel**. Le mode visuel montre
  les titres, les listes, les formules, les figures et les tableaux comme
  dans le document; une barre d'outils sert à la mise en forme, et
  **Ctrl+B** et **Ctrl+I** (**Cmd** sur Mac) mettent la sélection en gras
  ou en italique. Changer le nom d'un environnement, dans `\begin{…}` ou
  dans `\end{…}`, change aussi l'autre (sauf pendant le suivi des
  modifications, où chaque changement est proposé à part).
- À droite, la sortie : le **Journal** de compilation et le PDF. L'éditeur
  et le PDF se partagent la largeur à moitié; la séparation se déplace, et
  la proportion choisie suit la fenêtre.

En mode visuel, comme dans l'éditeur de tableaux d'Overleaf, un clic dans un
tableau sélectionne une cellule et montre sa barre d'outils : lignes,
colonnes, alignement, bordures, fusion et légende. Un double clic édite la
cellule. **Maj** avec un clic ou les flèches sélectionne plusieurs cellules
d'une ligne; **Fusionner les cellules** les réunit (`\multicolumn`), et
**Séparer les cellules** les défait. Le menu **Légende** met la légende
au-dessus ou en dessous du tableau, ou la retire avec son étiquette; un
tableau sans environnement `table` en reçoit un, centré.

Une image collée dans le texte, ou glissée depuis l'ordinateur, s'ajoute au
projet dans le dossier `images` (avec son nom, si on la glisse) et devient
une figure à cet endroit. Un fichier glissé depuis l'arbre des fichiers met
ce qui y renvoie : une figure pour une image, `\input` pour un fichier
`.tex`, `\bibliography` (ou `\addbibresource` avec biblatex) pour un
`.bib`, `#include` ou `#bibliography` en Typst, sinon son chemin.

Le bouton **Figure** de la barre de l'éditeur prend l'image parmi les
fichiers du projet, depuis l'ordinateur, depuis un autre projet ou depuis
une URL, comme sur Overleaf; les deux dernières gardent leur source, pour
être rafraîchies comme les autres fichiers importés. Le curseur au début
d'une ligne (sur `\end{document}`, par exemple), la figure se place avant
elle.

Dans `\cite{…}` (et `\citep`, `\parencite`…), comme la recherche avancée de
références d'Overleaf, l'éditeur propose les entrées des fichiers `.bib` du
projet d'après n'importe quels mots de leur clé, de leurs auteurs, de leur
titre, de leur année ou de leur revue, dans n'importe quel ordre et sans
égard aux accents : `\cite{einstein 1905`, ou `\cite{schrodinger` pour
`Schr{\"o}dinger`. **Entrée** remplace les mots par la clé choisie; après
une virgule, on cherche la référence suivante.

Dans `\usepackage{…}`, `\documentclass{…}`, `\bibliographystyle{…}` et les
thèmes de Beamer (`\usetheme{…}`…), l'éditeur propose, comme Overleaf, tous
les paquets, classes, styles BibTeX et thèmes de TeX Live, et d'abord ceux du
projet (ses fichiers `.sty`, `.cls` et `.bst`). À côté du nom paraît le paquet
de TeX Live qui le fournit, s'il s'appelle autrement (`tikz` vient de `pgf`),
et le moteur qu'il demande, s'il n'est que pour LuaLaTeX ou XeLaTeX; la
description de ce paquet s'affiche à côté de la liste, ou dessous.

Les commandes et les environnements des paquets et de la classe que le
projet charge sont proposés aussi, avec leurs arguments comme champs à
remplir (**Tab** passe au suivant) : `\usepackage{siunitx}` apporte
`\qty{number}{unit}`, `\documentclass{beamer}` apporte `\frametitle`, et
`\begin{` propose `align` dès qu'amsmath est chargé. Un paquet chargé dans
un autre fichier du projet compte aussi.

Dans les options, les clés que la commande accepte sont proposées :
`\includegraphics[` offre `width`, `angle` ou `keepaspectratio`,
`\usepackage[…]{geometry}` offre `margin` ou `paper`, `\documentclass[` les
options de la classe, `\begin{tcolorbox}[` celles de tcolorbox. Une clé qui
attend une longueur ou un texte arrive avec ce champ sélectionné; après une
clé qui a des valeurs, comme `labelfont=` de `\captionsetup`, ses valeurs
sont proposées. Ces listes viennent de celles de
[TeXstudio](https://github.com/texstudio-org/texstudio).

Le curseur sur un `\begin{…}` ou sur son `\end{…}`, les deux sont
encadrés, comme des parenthèses qui se répondent; en rouge si leurs noms
diffèrent.

Au-dessus de l'éditeur, après le chemin du fichier, les titres sous
lesquels se trouve le curseur suivent : `/main.tex › Méthodes › Données`
(parties, chapitres, sections… en LaTeX, titres en Typst). Un clic sur l'un
d'eux y place le curseur.

Le correcteur d'orthographe souligne les fautes dans le texte LaTeX et
Typst; un clic droit propose des corrections. Il connaît 15 langues :
français, anglais (États-Unis et Royaume-Uni), allemand, espagnol, italien,
portugais (Brésil et Portugal), néerlandais, catalan, polonais, russe,
suédois, danois et roumain. La langue suit celle du document : celle de
babel ou de polyglossia en LaTeX, celle de `#set text(lang: "fr")` en
Typst, sinon celle dans laquelle le texte est écrit; **Paramètres**,
**Vérification orthographique** en impose une. Les mots ajoutés au dictionnaire se
revoient, se retirent ou s'ajoutent dans **Paramètres**, **Mots ajoutés au
dictionnaire**; le compte les emporte sur vos autres appareils.

Comme le fait Writefull sur Overleaf, la grammaire et le style sont aussi
vérifiés, avec LanguageTool sur le serveur de Feuillet, dans les mêmes
langues : les fautes sont soulignées en bleu (l'orthographe reste en rouge).
Le survol d'une faute montre l'explication et les corrections, à choisir d'un
clic; **Ignorer** l'écarte, **Désactiver cette règle** coupe la règle partout
(les règles désactivées se réactivent dans **Paramètres**). Les commandes,
les formules et les citations ne comptent pas, ni les espaces avant « : ; ! ? »
que babel ajoute. La vérification demande d'être connecté au serveur, et se
coupe dans **Paramètres**, **Vérification grammaticale et stylistique**.

Comme sur Overleaf, on peut écrire à plusieurs endroits à la fois.
**Ctrl+Alt+→** (**Cmd+Alt+→** sur Mac) sélectionne le mot sous le curseur,
puis, à chaque nouvel appui, son occurrence suivante, et **Ctrl+Alt+←** la
précédente; **Ctrl+Alt+↑** et **Ctrl+Alt+↓** ajoutent un curseur à la ligne
du dessus ou du dessous;
**Ctrl+clic** (**Cmd+clic**) en ajoute un où l'on clique (sur un lien, il
le suit, comme avant); **Alt** en glissant sélectionne un rectangle, les
mêmes colonnes sur plusieurs lignes. Ce qu'on tape va à chaque curseur, les
boutons de la barre d'outils (gras, italique…) agissent sur chaque
sélection, une annulation défait le tout, et le suivi des modifications
propose un changement par endroit. **Échap** revient au seul curseur
principal. **Ctrl+D** (**Cmd+D**) supprime la ligne, comme sur Overleaf.

Les autres raccourcis d'Overleaf y sont aussi : **Ctrl+/** commente ou
décommente les lignes, **Ctrl+U** et **Ctrl+Maj+U** mettent la sélection
(ou le mot sous le curseur) en majuscules ou en minuscules, **Ctrl+Maj+L**
va à une ligne, **Ctrl+J** affiche ou masque le panneau de relecture et
**Ctrl+Maj+A** active ou désactive le suivi des modifications. La liste
complète s'ouvre par le lien **Mappage du clavier**, en bas de la page (au
besoin derrière le bouton **⋯**).

Un clic droit dans le texte ouvre le menu de l'éditeur, comme sur Overleaf :
**Couper**, **Copier**, **Coller**, **Tout sélectionner**; **Aller à cet
endroit dans le PDF** une fois le projet compilé; **Ajouter un
commentaire** sur la sélection; pour qui peut décider, accepter ou rejeter
les modifications suivies de la sélection, et activer ou désactiver le
suivi des modifications. Un clic droit hors de la sélection y place d'abord
le curseur; sur un mot mal orthographié, il donne les suggestions
d'orthographe, et Maj+clic droit le menu du navigateur.

**Ctrl+Maj+M** (**Cmd+Maj+M**), ou le bouton aux quatre coins à côté du
bouton de compilation, active le mode concentration, comme sur Overleaf :
l'éditeur et le PDF seuls, sans la barre de menus, le panneau latéral, la
barre d'outils de l'éditeur ni le bas de la page. Le nom du projet, la
compilation et le bouton restent; les mêmes touches, ou le bouton, le
désactivent, de même qu'ouvrir le panneau de recherche (**Ctrl+Maj+F**).

Comme dans les réglages d'Overleaf, **Paramètres** règle l'**Interligne** de
l'éditeur (serré, normal ou large, dans **Apparence**), sa **Police**, dont
**OpenDyslexic Mono**, conçue pour les lecteurs dyslexiques, un **Curseur
clignotant** ou fixe, et la **Fermeture automatique des parenthèses** : quand elle est coupée, taper `{`, `[` ou
`$` n'écrit pas le caractère fermant. En LaTeX, comme sur Overleaf, `$`
s'écrit par paire (`$|$`), une `(` seule et les guillemets ne se ferment
pas, et rien ne se ferme après une barre oblique inverse (`\$`, `\{`).

Quand la fenêtre est étroite, les outils les moins utilisés de la barre de
l'éditeur passent dans le menu **…**.

## Compiler

**Ctrl+Entrée** (ou **Cmd+Entrée**) compile le projet avec TeX Live, sur le
serveur de Feuillet; **Ctrl+S** (**Cmd+S**) aussi, comme sur Overleaf. Le menu à côté du bouton de compilation offre :

- le **document principal** du projet et le **moteur** (pdfLaTeX, LaTeX,
  XeLaTeX ou LuaLaTeX), communs à tous les collaborateurs. Comme sur
  Overleaf et sur arXiv, **LaTeX** passe par le DVI et le PostScript (`latex`,
  `dvips`, puis `ps2pdf`) : c'est le moteur de PSTricks, et les images sont
  alors en EPS;
- la **version de TeX Live**, elle aussi commune : **La plus récente**, par
  défaut, suit les mises à jour de Feuillet; une année reste la même pour le
  projet, comme TeX Live 2025, celle avec laquelle arXiv compile. Choisir
  l'année de la plus récente fige le projet sur celle-ci quand TeX Live
  passe à une nouvelle année;
- le **mode de compilation** : normal, ou rapide (brouillon), qui dessine les
  images comme des cadres;
- la **gestion des erreurs** : compiler malgré les erreurs, ou s'arrêter à
  la première;
- la **Compilation automatique**, comme l'« Auto Compile » d'Overleaf : le
  projet se compile deux secondes après que vous avez cessé de taper, avec
  ce que vous venez d'écrire. Les modifications d'un collaborateur se
  compilent chez lui, s'il l'a activée. Le réglage est propre à chaque projet;
- la compilation avec le cache vidé.

Comme sur Overleaf, la bibliographie (BibTeX ou Biber), l'index, les
glossaires du paquet `glossaries` (glossaire, acronymes, symboles, nombres)
et la nomenclature de `nomencl` se font d'eux-mêmes, en autant de passes
qu'il faut. Pour la sécurité du serveur, Feuillet lance lui-même
`makeindex` au lieu de `makeglossaries`; xindy et bib2gls ne sont pas
lancés.

Comme sur Overleaf, un document peut lancer des programmes pendant la
compilation (`\write18`, l'échappement shell) : Inkscape pour le paquet `svg`,
l'externalisation TikZ, PythonTeX, minted, gnuplot… Le serveur de compilation
n'a aucun accès au réseau : un document ne peut rien télécharger ni rien
joindre.

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

### Les autres fichiers de la compilation

Sous le Journal, le menu **Autres journaux et fichiers** liste, comme sur
Overleaf, les fichiers que la dernière compilation a écrits sur le serveur :
le journal complet (`.log`), la bibliographie mise en forme (`.bbl`), le
journal de BibTeX ou de Biber (`.blg`), le `.aux`, etc. Un clic télécharge le
fichier. Le serveur les garde tant que l'éditeur reste ouvert : après une
longue pause, compilez de nouveau pour les obtenir.

### Soumettre à arXiv

Dans le menu d'exportation (la flèche à côté du bouton de téléchargement),
**Paquet pour arXiv (.zip)** compile le projet puis télécharge une archive
prête à téléverser sur arXiv :

- les sources du projet, sans ce qu'écrit la compilation (`.aux`, `.log`,
  le PDF du document…) ni les fichiers cachés;
- le `.bbl` de cette compilation, au nom du document principal comme arXiv
  le demande, car arXiv ne lance ni BibTeX ni Biber (et aussi l'index et les
  glossaires : `.ind`, `.gls`, `.acr`, `.sls` ou `.nls`, s'il y en a);
- un fichier `00README.json` qui indique à arXiv le document principal, le
  compilateur (pdfLaTeX, LaTeX ou XeLaTeX) et l'année de TeX Live. Si le projet a
  déjà son propre `00README`, c'est le sien qui part.

Le menu dit ensuite ce que contient l'archive et ce qu'arXiv pourrait
refuser : LuaLaTeX, qu'arXiv n'offre pas; un document principal hors de la
racine, car arXiv compile depuis la racine; une bibliographie sans `.bbl`;
un `.bbl` de biblatex d'un autre format que celui d'arXiv; des erreurs de
compilation. Pour que le `.bbl` soit celui qu'attend arXiv, choisissez
**TeX Live 2025 (arXiv)** comme version de TeX Live avant l'exportation.

### Du texte au PDF, et retour

Un double-clic dans le PDF mène à la ligne correspondante du texte. Le
bouton de synchronisation de la barre de l'éditeur fait l'inverse : il montre
dans le PDF l'endroit où se trouve le curseur.

### Présenter des transparents

Le bouton **Mode présentation** de la barre du PDF (l'écran sur son pied)
montre le PDF seul, en plein écran sur fond noir, une page à la fois aussi
grande que l'écran le permet, comme sur Overleaf; c'est fait pour les
transparents Beamer. Les flèches, la barre d'espace, Page préc./Page suiv.
(celles d'une télécommande de présentation), un clic ou la molette tournent
les pages; Maj+clic revient en arrière, Début et Fin vont à la première et à
la dernière. Les liens du PDF restent actifs, et le pointeur se cache quand
la souris ne bouge plus. Échap termine la présentation, à la page atteinte.
Pour présenter sur un projecteur en gardant l'éditeur sous les yeux, ouvrez
d'abord le PDF dans une fenêtre à part (**Ouvrir la sortie dans une nouvelle
fenêtre**, à côté du bouton de compilation), glissez-la sur le projecteur,
puis lancez-y le mode présentation.

### Le PDF avec un thème sombre

Avec un thème sombre, comme sur Overleaf, le PDF s'affiche en couleurs
sombres : les couleurs de ses pages sont inversées à l'écran, alors que le
PDF lui-même, téléchargé ou présenté, garde les siennes. Le bouton soleil de
la barre du PDF le montre dans ses couleurs, le bouton lune de nouveau en
couleurs sombres; le choix est gardé, et se trouve aussi dans
**Paramètres**, *Sortie PDF* : **PDF sombre avec un thème sombre**.
