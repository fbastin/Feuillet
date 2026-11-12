# Running your own server

*[Français](../fr/heberger.md)*

Feuillet installs on your own machine, at your address, with your accounts
and your projects: for a lab, a course or a team.

This page gives the steps. Each setting is detailed in
[`deploy/README.md`](../../deploy/README.md).

## What you need

- **A Linux machine** reachable from the Internet, running Ubuntu 24.04 or
  Debian: the install scripts use Apache, Docker and systemd. An account
  that may use `sudo`.
- **An address**, such as `feuillet.example.org`, whose DNS record (`A`,
  `AAAA` or `CNAME`) leads to that machine, with ports 80 and 443 open: the
  Let's Encrypt HTTPS certificate needs them. Feuillet takes the whole
  address, at its root (not `example.org/feuillet/`).
- **Room to compile**, which takes the most. Each year of TeX Live is an
  image of about 3 GB to download, more once unpacked: allow at least 30 GB
  of free disk, plus your projects. The TeX Live server is bounded to 4 GB
  of memory and 4 CPUs, two compiles at a time; the TeX Live 2025 one, to
  3 GB and 3 CPUs; grammar checking (LanguageTool), to 2 GB. A machine with
  4 CPUs and 8 GB of memory is enough to start with; these bounds are set
  in [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml).

## Installing

1. **The software.** On Ubuntu 24.04:

   ```
   sudo apt install git curl rsync apache2 certbot python3-certbot-apache docker.io docker-compose-v2
   ```

   Docker Compose must be version 2.24 or newer (`docker compose version`);
   otherwise, take Docker
   [from its own repository](https://docs.docker.com/engine/install/).
   Building the app also takes Node.js 22 or newer, for instance with
   [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`.

2. **The code**, with your usual account (not `root`):

   ```
   git clone https://github.com/fbastin/Feuillet.git
   cd Feuillet
   ```

3. **The servers**, giving the address:

   ```
   sudo deploy/install.sh feuillet.example.org
   ```

   The script keeps the address in `/etc/feuillet/site.env`, creates the
   site's folder (`/var/www/feuillet.example.org`, owned by your account),
   installs the Apache site, sets up nightly backups, builds and starts the
   servers with Docker (collaboration, TeX Live, LanguageTool), then asks
   for the HTTPS certificate: certbot then asks for an email address and to
   accept its terms. The first time, it downloads a few gigabytes; allow a
   good many minutes.

4. **The app**, without `sudo`, with the same account:

   ```
   deploy/publish.sh
   ```

   It builds Feuillet for your address and copies it to the site's folder.
   The first time, it downloads its dependencies.

5. **Your account.** Open `https://feuillet.example.org` and choose **Create
   account**. To administer the server, name that account in
   `/etc/feuillet/collab.env`:

   ```
   ADMIN_ACCOUNTS=yourname
   ```

   then run `sudo deploy/install.sh` again. Your account menu then offers
   **Administration**: the accounts, the space taken, orphan projects, the
   last backup.

To check, `curl https://feuillet.example.org/collab/health` and
`curl https://feuillet.example.org/texlive/health` answer
`{"status":"ok",…}`.

## What to set up next

Everything is in `/etc/feuillet/collab.env`, readable by `root` only; run
`sudo deploy/install.sh` again after each change.
[`deploy/README.md`](../../deploy/README.md) describes each setting.

- **Email** (`SMTP_URL`, `MAIL_FROM`): confirming an account's address,
  recovering a forgotten password, sending invitations. Without it,
  accounts recover with their recovery codes, and invitations open in the
  inviter's mail program.
- **Signing in with GitHub, Google or ORCID**: each service asks you to
  register your Feuillet, with its callback address, such as
  `https://feuillet.example.org/collab/github/callback`.
- **Backups**: each night in `/var/backups/feuillet`; a copy on another
  machine is set in `/etc/feuillet/backup.env`. A backup left on the same
  machine does not protect from its disk failing.
- **Years of TeX Live**: the latest, and 2025, arXiv's. On a modest
  machine, remove the `texlive-2025` service and the `OTHER_YEARS` line
  from `deploy/docker-compose.yml`.

Claude and Git need nothing set up: the connector is at
`https://feuillet.example.org/collab/mcp`, and projects clone from
`https://feuillet.example.org/collab/git/…`.

## Updating

```
cd Feuillet
git pull
sudo deploy/install.sh
deploy/publish.sh
```

`install.sh` first backs up the data, then rebuilds the servers; projects
and accounts stay. `publish.sh` publishes the new app, which browsers take
at their next visit.

## Before opening your server to others

- **The privacy page** (the **Privacy** link at the bottom of the page)
  describes one server in particular: emails sent through Gmail, web server
  logs kept 14 days, backups kept two weeks. Adapt it to what yours
  does, in
  [`src/components/common/PrivacyModal.tsx`](../../src/components/common/PrivacyModal.tsx)
  and its translations (`translations/locales/en.json`, `fr.json`): you
  answer for your users' data, under the laws that apply to you.
- **The license.** Feuillet is licensed under the AGPL 3.0: if you change
  its code and offer it to others on your server, give them access to the
  changed code. The link to the code, at the bottom of the page, leads to
  the repository named by `organizationName` and `projectName` in
  `texlyre.config.ts`: point it to your copy.
