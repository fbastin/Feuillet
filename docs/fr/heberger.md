# Installer son serveur

*[English](../en/hosting.md)*

Feuillet s'installe sur votre propre machine, à votre adresse, avec vos
comptes et vos projets : pour un laboratoire, un cours ou une équipe.

Cette page donne la marche à suivre. Le détail de chaque réglage est dans
[`deploy/README.md`](../../deploy/README.md), en anglais.

## Ce qu'il faut

- **Une machine Linux** joignable depuis Internet, sous Ubuntu 24.04 ou
  Debian : les scripts d'installation utilisent Docker, systemd et un
  serveur web, Apache ou nginx (un autre aussi, voir plus bas). Un compte
  qui peut utiliser `sudo`.
- **Une adresse**, par exemple `feuillet.exemple.org`, dont l'enregistrement
  DNS (`A`, `AAAA` ou `CNAME`) mène à cette machine, avec les ports 80 et
  443 ouverts : le certificat HTTPS de Let's Encrypt en a besoin. Feuillet
  occupe toute l'adresse, à sa racine (pas `exemple.org/feuillet/`).
- **De la place pour compiler**, ce qui demande le plus. Chaque année de
  TeX Live est une image d'environ 3 Go à télécharger, davantage une fois
  décompressée : prévoyez au moins 30 Go libres sur le disque, plus vos
  projets. Le serveur TeX Live est borné à 4 Go de mémoire et 4
  processeurs, deux compilations à la fois; celui de TeX Live 2025, à 3 Go
  et 3 processeurs; la vérification de la grammaire (LanguageTool), à 3 Go.
  Une machine de 4 processeurs et 8 Go de mémoire suffit pour commencer;
  ces bornes sont dans
  [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml), et se
  changent dans `/etc/feuillet/docker-compose.override.yml` (voir plus
  bas).

## Installer

1. **Les logiciels.** Sous Ubuntu 24.04, avec Apache :

   ```
   sudo apt install git curl rsync openssl docker.io docker-compose-v2 apache2 certbot python3-certbot-apache
   ```

   ou avec nginx :

   ```
   sudo apt install git curl rsync openssl docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
   ```

   Docker Compose doit être en version 2.24 ou plus récente
   (`docker compose version`); sinon, prenez Docker
   [depuis son propre dépôt](https://docs.docker.com/engine/install/).
   Node.js n'est pas nécessaire : l'application arrive construite de
   GitHub (étape 4). Pour la construire vous-même, par exemple pour une
   copie modifiée, prenez Node.js 22 ou plus récent, par exemple avec
   [nvm](https://github.com/nvm-sh/nvm) : `nvm install 22`.

2. **Le code**, avec votre compte habituel (pas `root`) :

   ```
   git clone https://github.com/fbastin/Feuillet.git
   cd Feuillet
   ```

3. **Les serveurs**, en donnant l'adresse :

   ```
   sudo deploy/install.sh feuillet.exemple.org
   ```

   Le script prend le serveur web installé, Apache ou nginx; si les deux le
   sont, nommez le vôtre : `sudo deploy/install.sh feuillet.exemple.org nginx`.
   Il vérifie d'abord la machine : s'il manque quelque chose (Docker,
   Docker Compose assez récent, le greffon de certbot…), il s'arrête en
   disant quoi installer, avant d'avoir rien changé.
   Il garde l'adresse et ce choix dans `/etc/feuillet/site.env`, crée le
   dossier du site (`/var/www/feuillet.exemple.org`, à votre compte), y
   installe le site, prépare les sauvegardes de chaque nuit, construit et lance les
   serveurs avec Docker (collaboration, TeX Live, LanguageTool), puis
   demande le certificat HTTPS : certbot vous demande alors une adresse
   courriel et d'accepter ses conditions. La première fois, il télécharge
   quelques gigaoctets; comptez de longues minutes.

4. **L'application**, sans `sudo`, avec le même compte :

   ```
   deploy/publish.sh
   ```

   Il prend l'application telle que GitHub l'a construite pour le commit
   que vous avez (une dizaine de minutes après chaque changement de
   Feuillet, pour les 15 derniers), la vérifie, y met votre adresse et la
   copie dans le dossier du site. La première fois, il télécharge aussi les
   compilateurs qui s'exécutent dans le navigateur (600 Mo), qu'il garde
   dans `~/.cache/feuillet` tant qu'ils ne changent pas. Avec Node.js 22 ou
   plus récent sur la machine, il construit plutôt l'application;
   `deploy/publish.sh --download` ou `--build` choisit.

5. **Votre compte.** Ouvrez `https://feuillet.exemple.org` et choisissez
   **Créer un compte**. Pour administrer le serveur, nommez ce compte dans
   `/etc/feuillet/collab.env` :

   ```
   ADMIN_ACCOUNTS=votrenom
   ```

   puis `sudo feuillet-compose up -d collab`. Le menu de votre compte offre
   alors **Administration** : les comptes, la place prise, les projets
   orphelins, la dernière sauvegarde, et les liens pour créer un compte.
   Créez votre compte avant de réserver l'inscription aux invitations
   (voir plus bas).

Pour vérifier, `curl https://feuillet.exemple.org/collab/health` et
`curl https://feuillet.exemple.org/texlive/health` répondent
`{"status":"ok",…}`.

### Un autre serveur web

Avec Caddy, Traefik ou un proxy sur une autre machine, lancez
`sudo deploy/install.sh feuillet.exemple.org none` : le script installe
tout le reste, sans serveur web ni certificat. Les adresses que votre
serveur web doit servir et faire suivre (`/`, `/collab/`, `/texlive/`…)
sont dans [`deploy/README.md`](../../deploy/README.md), section « Another
web server »; [`deploy/nginx/routes.conf`](../../deploy/nginx/routes.conf)
en est un exemple complet.

## Ce qui se règle ensuite

Tout est dans `/etc/feuillet/collab.env`, lisible par `root` seulement;
après chaque changement, `sudo feuillet-compose up -d collab` le fait
relire (`sudo deploy/install.sh` aussi).
[`deploy/README.md`](../../deploy/README.md) décrit chaque réglage.

- **Qui peut créer un compte** : tout le monde, par défaut. Avec
  `SIGN_UP=invitation`, seulement qui reçoit une invitation à un projet ou
  un lien de la page d'administration; avec aussi, par exemple,
  `SIGN_UP_DOMAINS=exemple.org`, toute adresse de ce domaine, confirmée
  par un lien envoyé par courriel.
- **Les courriels** (`SMTP_URL`, `MAIL_FROM`) : confirmer l'adresse d'un
  compte, retrouver un mot de passe oublié, envoyer les invitations. Sans
  eux, les comptes se récupèrent avec leurs codes de récupération, et les
  invitations s'ouvrent dans le logiciel de courriel de qui invite.
- **Se connecter avec GitHub, Google ou ORCID** : chaque service demande
  d'y inscrire votre Feuillet, avec son adresse de retour, par exemple
  `https://feuillet.exemple.org/collab/github/callback`.
- **Les sauvegardes** : chaque nuit dans `/var/backups/feuillet`; une copie
  sur une autre machine se règle dans `/etc/feuillet/backup.env`. Une
  sauvegarde restée sur la même machine ne protège pas d'une panne de son
  disque.
- **Les années de TeX Live** : la plus récente, et 2025, celle d'arXiv. Sur
  une machine modeste, copiez
  [`deploy/docker-compose.override.example.yml`](../../deploy/docker-compose.override.example.yml)
  dans `/etc/feuillet/docker-compose.override.yml`, qui retire TeX Live
  2025, puis relancez `sudo deploy/install.sh`. Vos changements aux
  serveurs vont dans ce fichier : hors du dépôt, ils restent à chaque mise
  à jour.

Claude et Git n'ont rien à régler : le connecteur est à
`https://feuillet.exemple.org/collab/mcp`, et les projets se clonent depuis
`https://feuillet.exemple.org/collab/git/…`.

## Mettre à jour

```
cd Feuillet
git pull
sudo deploy/install.sh
deploy/publish.sh
```

`install.sh` sauvegarde d'abord les données, puis reconstruit les
serveurs; les projets et les comptes restent. `publish.sh` publie la
nouvelle application, que les navigateurs prennent à leur visite suivante.

## Avant d'ouvrir votre serveur à d'autres

- **Qui compile.** Comme sur Overleaf, le serveur TeX Live ne compile que
  pour un compte : celui qui est connecté, ou celui à qui appartient un
  projet ouvert par son lien. Le serveur de collaboration signe pour cela
  un jeton que TeX Live vérifie; `install.sh` en fait la clé. Connaître
  l'adresse du serveur ne suffit donc pas pour s'en servir. Si tout le
  monde peut créer un compte, n'importe qui peut encore compiler : voyez
  `SIGN_UP` ci-dessus.
- **La page de confidentialité** (le lien **Confidentialité**, en bas de
  page) dit ce qui change d'un serveur à l'autre d'après vos réglages de
  `collab.env` : à qui écrire (`PRIVACY_CONTACT`, une adresse courriel ou
  une page web), le service qui envoie les courriels (reconnu d'après
  `SMTP_URL` pour Gmail, sinon `MAIL_PROVIDER`), la durée des journaux du
  serveur web (`WEB_LOG_DAYS`) et celle des sauvegardes. Le reste décrit
  Feuillet tel que ce dépôt le fait : si vous changez ce que fait votre
  serveur, changez la page avec, dans
  [`src/components/common/PrivacyModal.tsx`](../../src/components/common/PrivacyModal.tsx).
  C'est vous qui répondez des données de vos utilisateurs, selon les lois
  qui s'appliquent à vous.
- **La licence.** Feuillet est sous licence AGPL 3.0 : si vous modifiez son
  code et l'offrez à d'autres sur votre serveur, donnez-leur accès au code
  modifié. Le lien vers le code, en bas de page, mène au dépôt nommé par
  `organizationName` et `projectName` dans `texlyre.config.ts` : faites-le
  pointer vers votre copie.

## Désinstaller

`sudo feuillet-compose down -v --rmi local` retire les serveurs, avec leurs
données (comptes, projets, versions) : faites d'abord une dernière
sauvegarde si quelque chose doit rester. Le reste de ce qu'`install.sh` a
mis en place, le site du serveur web et le certificat se retirent comme le
dit [`deploy/README.md`](../../deploy/README.md), section « Uninstalling ».
Les sauvegardes, elles, restent jusqu'à ce que vous les supprimiez.
