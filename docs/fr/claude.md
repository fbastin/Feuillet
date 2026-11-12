# Claude

*[English](../en/claude.md)*

Claude, l'assistant d'Anthropic, peut travailler sur vos projets Feuillet,
avec votre propre abonnement Claude, par le **connecteur Feuillet** : il lit
et cherche dans les projets, compile, commente et propose des modifications,
selon votre rôle dans chaque projet. Ses modifications arrivent comme des
[modifications suivies](relecture.md), à son nom, que vous acceptez ou
rejetez.

## Connecter Claude

L'adresse du connecteur est celle du serveur suivie de `/collab/mcp`, par
exemple :

```
https://feuillet.exemple.org/collab/mcp
```

Vous la trouvez, exacte, dans votre profil, onglet **Assistants**, ou par
**Connecter Claude** dans le menu de votre compte.

- **Dans Claude (web ou application de bureau)** : ouvrez les réglages, puis
  les connecteurs, choisissez « Ajouter un connecteur personnalisé » et
  collez l'adresse. Claude vous demande ensuite de vous connecter avec votre
  nom d'utilisateur et votre mot de passe Feuillet (et, avec la double
  authentification, le code de votre application), et d'autoriser l'accès.
- **Dans Claude Code** : dans un terminal, lancez

  ```
  claude mcp add --transport http feuillet https://feuillet.exemple.org/collab/mcp
  ```

  puis tapez `/mcp` dans Claude Code pour vous connecter.

Il faut un compte sur le serveur de Feuillet; une session invitée n'en a pas.

## Ce que Claude peut faire

- lister vos projets et leurs fichiers, lire un fichier, chercher du texte
  dans un projet;
- lister les commentaires et les modifications en attente;
- proposer des modifications, comme suggestions suivies; un éditeur peut
  aussi lui demander de modifier directement, sauf si le projet suit ses
  modifications (celles de tout le monde, ou les siennes);
- créer un fichier;
- commenter et répondre aux commentaires;
- compiler le projet avec TeX Live et lire les erreurs, avec leur fichier et
  leur ligne.

Un relecteur ne laisse à Claude que les commentaires et les suggestions; une
lecture seule, que la lecture. Les versions du projet nomment Claude et votre
compte comme auteurs.

## Demander à Claude depuis l'éditeur

Le bouton **Demander à Claude** (les étincelles), dans la barre de
l'éditeur, prépare une demande sur le passage sélectionné ou sur le projet :
améliorer le style, corriger l'orthographe, expliquer, traduire, compiler et
corriger les erreurs, répondre aux commentaires, ou ce que vous écrivez. La
demande nomme le projet, le fichier et la ligne.

- **Ouvrir dans Claude** ouvre claude.ai avec la demande. Elle est aussi
  copiée : collez-la si la zone de saisie est vide.
- **Copier pour Claude Code** la copie, à coller dans Claude Code.

Dans le journal de compilation, chaque erreur a aussi son bouton **Demander
à Claude**, comme l'aide aux erreurs d'Overleaf : la demande, déjà écrite,
nomme le fichier et la ligne de l'erreur et cite son message; Claude lit le
fichier par le connecteur et propose sa correction en suggestion.

## Déconnecter Claude

Dans votre profil, onglet **Assistants**, **Déconnecter** retire l'accès
d'une application. Changer votre mot de passe ou supprimer votre compte le
retire aussi.

## Travailler sur une copie locale

Pour que Claude Code travaille sur les fichiers de votre ordinateur plutôt
que par le connecteur, liez le projet à [GitHub](github.md), clonez le dépôt,
poussez les modifications, puis récupérez-les dans Feuillet.
