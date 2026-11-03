# Deploying Feuillet on feuillet.slashbin.net

Feuillet is served as static files by Apache. Collaboration goes through a
small server ([`server/collab`](../server/collab)) that every editor connects
to, so collaborators do not need to be online at the same time and there is
no peer-to-peer connection limit:

- shared documents, chat, comments and presence are Yjs documents relayed
  over WebSocket and stored in LevelDB;
- project files (images, bibliographies, any file in the tree) are listed in
  a shared manifest and their contents are stored by SHA-256 checksum;
- opening a text file makes it a shared document, edited live by everyone;
- accounts (username and password) keep the list of their projects and the
  words of their spelling dictionary, so that logging in on another device
  shows the same projects and accepts the same words, as on Overleaf.
  Signing up creates the account there; an account created earlier in a
  browser is linked at its next login, or from Profile Settings;
- read-only links, as on Overleaf: the Share dialog gives a second link, and
  whoever opens it receives the project and follows it live, but the server
  drops everything they send to change it. The link does not reveal the
  editing link, and replacing it cuts off everyone who used the old one;
- project owners, as on Overleaf: the account that creates a project owns it
  (on an older project, the first account to choose "Become the owner" in
  the Share dialog). Its owner can replace the editing link: whoever kept the
  old one is cut off and told so, those given the new one keep working, and
  the owner's other devices move to it through the account;
- collaborators, as on Overleaf: the owner invites accounts by name, as
  editors, reviewers or readers. The project appears in their list, and they
  follow its links when they change. Removing an editor replaces the editing
  link, a reviewer the review link, and a reader the read-only link, which
  cuts them off;
- reviewers, as on Overleaf: they comment and suggest changes, always
  tracked, which editors accept or reject; they chat, and only read files
  and settings. The server checks every change they send to a document: it
  must leave the text, with every tracked change rejected, as it was, or the
  server refuses it, and their browser reloads the document;
- the project list, as on Overleaf: all projects, yours and those shared
  with you (the server tells each account who owns what), archived ones and
  the trash, from which projects are deleted for good, on every device of
  the account; "Make a copy" has the server copy a project any link opens
  (documents with their comments, files and settings, not its chat,
  versions, collaborators or GitHub link) into a new one the account owns;
- versions, as on Overleaf: a short while after a project changes, the
  server saves a version with who changed what. The Versions tab lists them
  by day, shows each change against the version before or compares any two,
  labels versions (labelled ones are kept for good), and restores a file or
  the whole project as it was;
- "Sign in with GitHub" for GitHub sync, as on Overleaf (see below): the
  server runs GitHub's sign-in and hands the token to the browser, which
  encrypts and keeps it; the server keeps none.

LaTeX projects compile on a full TeX Live ([`server/texlive`](../server/texlive)),
as on Overleaf. It is the default compiler for new LaTeX projects and for
imported ones; the in-browser LaTeX compiler stays available in the project
settings, for instance to work offline.

```
browser ──https──▶ Apache ── /                  ▶ /var/www/feuillet.slashbin.net (deploy/publish.sh)
                         ├─ /collab/  (wss, http) ▶ 127.0.0.1:1234 feuillet-collab  (Docker)
                         └─ /texlive/ (wss, http) ▶ 127.0.0.1:7045 feuillet-texlive (Docker)
```

## First installation

1. DNS: add a `CNAME` record `feuillet` → `tireur.no-ip.org` for `slashbin.net`
   (same target as the other subdomains).
2. Run `sudo deploy/install.sh`. It creates the web root, installs and enables
   the Apache virtual host, builds and starts both servers with Docker (the
   TeX Live image downloads about 3 GB) and requests the HTTPS certificate
   with certbot.
3. Run `deploy/publish.sh` (no sudo, Node.js 22 or newer) to build and publish
   the application.

## Sign in with GitHub

GitHub sync works with a personal access token pasted in each browser. To
offer "Sign in with GitHub" instead, register a GitHub OAuth App once:

1. On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
   - Application name: `Feuillet`
   - Homepage URL: `https://feuillet.slashbin.net`
   - Authorization callback URL:
     `https://feuillet.slashbin.net/collab/github/callback`
2. Register it, then generate a client secret.
3. Put both in `/etc/feuillet/collab.env` (created by `deploy/install.sh`,
   readable by root only, kept out of the repository):

   ```
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

4. Run `sudo deploy/install.sh` again. The collaboration server's start line
   in `sudo docker logs feuillet-collab` then says "GitHub sign-in on".

The sign-in asks for the `repo` scope, as the personal access token does, so
that private repositories can be synced. Leaving the file empty turns the
button off; pasting a token keeps working either way.

## Email: recovering accounts and invitations

Accounts may give an email address, which a link mailed to it confirms; a
forgotten password then sends a link there, valid one hour, as on Overleaf
(server/collab/mail.js). Owners whose address is confirmed also have
Feuillet mail their invitations to a project. Without mail settings, this
stays off: accounts recover with recovery codes only, and invitations open
the owner's mail program. The collaboration server sends through an SMTP
server set in `/etc/feuillet/collab.env`:

```
SMTP_URL=smtps://USER:PASSWORD@smtp.example.org:465
MAIL_FROM=Feuillet <noreply@example.org>
```

`SMTP_URL` may also be `smtp://...:587` (STARTTLS). Characters such as `@`
or `:` in the user or password are written percent-encoded (`%40`, `%3A`).
The sender's domain should allow that server in its SPF record, and sign
with DKIM, or mail providers may set the messages aside as spam. Links lead
to `APP_URL`, by default the first of `ALLOWED_ORIGINS`.

A Gmail account sends with an app password (Google account → Security →
App passwords), its 16 letters without spaces; Gmail shows the account's
own address as the sender, so `MAIL_FROM` names it:

```
SMTP_URL=smtps://ACCOUNT%40gmail.com:APPPASSWORD@smtp.gmail.com:465
MAIL_FROM=Feuillet <ACCOUNT@gmail.com>
```

Relaying through the host's own mail server instead would mean letting the
Docker network send through it (Postfix's `mynetworks`); the TeX Live
container shares that network and runs anyone's documents, so it would be
able to send mail too.

So that whoever makes accounts cannot have the server mail anyone, and the
mail provider close the sending account, the server sends at most 200
emails in any 24 hours (`MAIL_DAILY_LIMIT` in `collab.env` changes it),
invitations three quarters of them so that recovering accounts still
works, 10 to one address, and 30 invitations for one owner. A refused
invitation is still made: its owner copies the link or opens it in their
mail program. These counts restart with the server.

After `sudo deploy/install.sh`, the start line in
`sudo docker logs feuillet-collab` says "recovery by email on". The server
logs that a message was sent or not, or that a limit was reached, never to
which address.

## Claude (MCP connector)

The collaboration server lets Claude work on an account's projects through
the Model Context Protocol: `https://feuillet.slashbin.net/collab/mcp`
(server/collab/mcp.js). Nothing needs registering:

- in Claude (web or desktop app): Settings → Connectors → Add custom
  connector, with that address;
- in Claude Code: `claude mcp add --transport http feuillet
  https://feuillet.slashbin.net/collab/mcp`, then `/mcp` to sign in.

Claude signs in on a Feuillet page with the account's username and password
(server/collab/oauth.js), and then works with the account's role in each
project: it reads, searches and compiles, suggests changes as tracked changes,
and comments. Its connections are listed, and can be ended, in the profile's
Assistants tab; changing the password ends them too.

`deploy/install.sh` adds the Apache routes Claude looks for
(`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`); the connections are kept in the
`collab-mcp` volume, and compiles go to the TeX Live container
(`TEXLIVE_URL` in `deploy/docker-compose.yml`). Applications may send people
back only to Claude or to a program on the same computer; `MCP_REDIRECT_URIS`
in `/etc/feuillet/collab.env` adds other addresses.

## Backups

`install.sh` sets up a backup of the collaboration server's data each night
at 4:30 (`/etc/cron.d/feuillet-backup`, running `deploy/backup.sh` as
`/usr/local/sbin/feuillet-backup`), and makes one before each update. It
copies the six Docker volumes (documents, files, accounts, project links,
versions, assistant connections), one archive each, into
`/var/backups/feuillet/<date>/`, readable by root only: they hold the
accounts' password hashes. The latest 14 are kept, and
`/var/log/feuillet-backup.log` tells how each went.

The collaboration server is paused while the volumes are read, usually a
few seconds; open connections wait. The TeX Live server keeps nothing, and
everything else comes from this repository, except
`/etc/feuillet/collab.env`, whose secrets are best kept elsewhere, such as
in a password manager.

These backups are on the server's own disk: if it fails, they go with it.
To also copy each one off this machine, with rsync over SSH (root's SSH key
must open that account), and keep another number of them:

```
# /etc/feuillet/backup.env
BACKUP_COPY_TO=user@other-host:feuillet-backups/
BACKUP_KEEP=14
```

The copies there are not removed by `backup.sh`: remove the old ones there
too, since the privacy page says that backups keep what was erased for two
weeks at most.

To put a backup back: everything changed since is lost from the server,
but the current data is backed up first, so a restore can be undone the
same way.

```
sudo ls /var/backups/feuillet
sudo feuillet-restore /var/backups/feuillet/2026-11-03T043000
```

A backup can be looked at without restoring it:
`sudo cat /var/backups/feuillet/<date>/info.txt`, or
`sudo tar -tzf /var/backups/feuillet/<date>/accounts.tar.gz`.

`backup.sh` also tells the administration page (below) how the last backup
went, in `/var/lib/feuillet/backup-status/` (`backup.json`, and
`backup-failed.json` after a failure), which the collaboration server reads
through a read-only mount.

## Administration

As Overleaf Server's admin panel, a page for the accounts named in
`ADMIN_ACCOUNTS`, in `/etc/feuillet/collab.env`, comma-separated:

```
ADMIN_ACCOUNTS=alice
```

then `sudo deploy/install.sh` (a running container does not read the file
again). Those accounts find **Administration** in their account menu, at
the top right. It shows:

- the server: since when it runs, open documents and connections, projects,
  and the space taken by documents, files, versions and accounts, with what
  is left on the disk;
- the emails sent in the last 24 hours, against `MAIL_DAILY_LIMIT`;
- the last backup, and whether it failed, is more than a day old or stays
  on this machine;
- every account: when it was made and last used, its signed-in devices,
  how many projects it owns and is a member of, the space the projects it
  owns take, and whether its email address is confirmed. Neither the
  address nor the projects' names or contents are shown, as the privacy
  page says.

An account may be deleted there, once its name is typed, as its owner would
from the profile: with the projects it owns, for their collaborators too.
Neither one's own account nor another administrator's is deleted there.

The names are taken as they are: before deleting an account named in
`ADMIN_ACCOUNTS`, take its name out, or someone could make an account with
that name and administer the server.

## Updating

- Servers and Apache routes: `sudo deploy/install.sh` again. It adds any
  missing proxy route to the HTTPS virtual host created by certbot (keeping a
  copy of the previous file next to it), rebuilds the containers and leaves
  the certificate alone.
- Application: `deploy/publish.sh`.
- TeX Live packages: `sudo docker compose -f deploy/docker-compose.yml build --pull texlive`
  then `sudo docker compose -f deploy/docker-compose.yml up -d texlive`.

Documents are kept in the `feuillet_collab-data` volume, file contents in
`feuillet_collab-files`, accounts in `feuillet_collab-accounts` (one JSON
file per account, with a scrypt hash of its password and the hashes of its
session tokens), project links and owners in `feuillet_collab-shares` and
the list of each project's versions in `feuillet_collab-history` (their
texts are with the files); none is touched by an update. The TeX Live server
keeps nothing: each connection compiles in its own temporary directory.

Deleting a project for good (its owner, from the trash) or deleting an
account (with the projects it owns) erases the project's documents, files
and versions from these volumes; its file in `feuillet_collab-shares` keeps
only `{"deleted": true}`, so that none of its links opens it again. The
privacy page in the app says so.

The containers' logs are rotated: three files of 10 MB at most each
(`x-logging` in `docker-compose.yml`). Apache's own logs follow the system's
logrotate (14 days).

## Checks

- `curl https://feuillet.slashbin.net/collab/health` returns
  `{"status":"ok",...}`.
- `curl https://feuillet.slashbin.net/texlive/health` returns
  `{"status":"ok","connections":…,"compiling":…,"queued":…}`.
- `sudo docker logs feuillet-collab` and `sudo docker logs feuillet-texlive`
  show rejected origins, if any, and one line per compile (engine, status,
  duration). Only `https://feuillet.slashbin.net` is allowed
  (`ALLOWED_ORIGINS` in `docker-compose.yml`).
- Files larger than 100 MiB are refused (`MAX_FILE_BYTES`).
- `sudo docker logs feuillet-collab` shows each account created or deleted.
  An account without a confirmed email address nor recovery codes cannot be
  recovered; removing the account file by hand frees its name (the projects
  themselves are kept, unlike when the person deletes their account):
  ```
  name=$(printf %s 'alice' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -d' ' -f1)
  sudo docker exec feuillet-collab rm "/accounts/$name.json"
  ```

## TeX Live server limits

Anyone who can open Feuillet can compile on this server, so the container is
bounded (`docker-compose.yml`) and connections are kept apart:

- each connection compiles under its own uid, in a directory that only this
  uid can open, with its own home and temporary directory. The server runs as
  root in the container, with only the capabilities it needs for that
  (changing owner and uid, removing files, stopping processes); compiles have
  none.
- latexmk never reads `latexmkrc` files from projects and never passes
  `-shell-escape`; TeX Live's restricted shell escape (BibTeX, makeindex,
  epstopdf, minted's latexminted…) stays in force. LuaLaTeX runs without its
  socket library.
- At most `MAX_CONCURRENT` (2) compiles run at once, others wait in a queue of
  20; each compile stops after `COMPILE_TIMEOUT_MS` (3 minutes).
- 4 GB of memory, 4 CPUs, 256 processes, and a 2 GB in-memory working area
  that is emptied when the container restarts.

## Local development

```
cd server/collab && npm install
ALLOWED_ORIGINS=http://localhost:5173 YPERSISTENCE=./data FILES_DIR=./files \
  ACCOUNTS_DIR=./accounts SHARES_DIR=./shares HISTORY_DIR=./history npm start
```

```
cd server/texlive && npm install
ALLOWED_ORIGINS=http://localhost:5173 WORK_DIR=./work npm start
```

The TeX Live server uses the `latexmk` found on the machine. Then set
Settings → Connectivity → WebSocket server to `ws://localhost:1234` and
Settings → Compilation → LaTeX → TeX Live compile server to
`ws://localhost:7045`.
