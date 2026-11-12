# Deploying Feuillet

How a Feuillet server is set up, and every setting; `feuillet.example.org`
stands for the server's address throughout. The
user guide gives the steps in short, with what the machine needs:
[English](../docs/en/hosting.md) · [Français](../docs/fr/heberger.md).

Feuillet is served as static files by Apache or nginx. Collaboration goes through a
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
browser ──https──▶ Apache or nginx ── /                  ▶ /var/www/DOMAIN (deploy/publish.sh)
                                  ├─ /collab/  (wss, http) ▶ 127.0.0.1:1234 feuillet-collab  (Docker)
                                  ├─ /docs     (http)      ▶ 127.0.0.1:1234 (« Ouvrir dans Feuillet »)
                                  └─ /texlive/ (wss, http) ▶ /var/lib/feuillet/texlive-socket/texlive.sock
                                                              feuillet-texlive (Docker, no network)
                                                                └─▶ texlive-2025.sock
                                                                    feuillet-texlive-2025 (same)
```

## First installation

1. DNS: a record (`A`, `AAAA` or `CNAME`) for the server's address that
   leads to this machine, with ports 80 and 443 open.
2. Run `sudo deploy/install.sh feuillet.example.org`, with the server's
   address, and the web server if Apache and nginx are both installed
   (`sudo deploy/install.sh feuillet.example.org nginx`). It keeps them in
   `/etc/feuillet/site.env` (`DOMAIN=`, `WEB=`), which later runs,
   `deploy/publish.sh` and `deploy/docker-compose.yml` read.
   It creates the web root `/var/www/DOMAIN`, sets up the web server for
   that address (Apache: `deploy/apache/feuillet.conf`; nginx: see below),
   builds and starts the servers with Docker (the TeX Live image downloads
   about 3 GB) and requests the HTTPS certificate with certbot
   (`python3-certbot-apache` or `python3-certbot-nginx`).
3. Run `deploy/publish.sh` (no sudo, Node.js 22 or newer) to build and publish
   the application. The servers it goes to by default are this address's:
   it writes them in the build's `userdata.json`, in place of those
   `texlyre.config.ts` names.

## nginx

With `WEB=nginx`, `install.sh` writes three files, from `deploy/nginx/`:

- `/etc/nginx/sites-available/DOMAIN` (`feuillet.conf`), enabled in
  `sites-enabled`: the server block, written once, to which
  `certbot --nginx` then adds HTTPS and a redirect from HTTP;
- `/etc/nginx/snippets/feuillet.conf` (`routes.conf`), which that block
  includes: the web root and the routes of Apache's virtual host, written
  again at each run so that an update reaches them;
- `/etc/nginx/conf.d/feuillet.conf` (`maps.conf`): two maps the routes use,
  for WebSocket and for caching.

The routes do what Apache does, with what nginx would otherwise do
differently: `.mjs` served as JavaScript (pdf.js and Typst run their
workers from such modules, which browsers refuse under another type),
`.wav`, `.ttf` and `.otf` with their types, scripts, styles and WebAssembly
compressed, the client's address passed on in `X-Forwarded-For`, requests
up to 512 MiB (Git pushes), streamed rather than buffered, and no time
limit on open WebSocket connections. nginx runs as `www-data`, which may
open the TeX Live server's socket.

## Another web server

With `sudo deploy/install.sh feuillet.example.org none`, `install.sh` does
all but the web server and its certificate: Caddy, Traefik, or a proxy on
another machine then serves Feuillet with these routes (`deploy/nginx/routes.conf`
is a complete example):

| Path | To | Notes |
| --- | --- | --- |
| `/` | the files of `/var/www/DOMAIN` (`deploy/publish.sh`) | a missing file answers 404 with `/404.html`; `.mjs` as `text/javascript`; `Cache-Control: public, max-age=31536000, immutable` for the files directly in `/assets/`, `no-cache` for `index.html`, `sw.js`, `manifest.json` and `userdata*.json` |
| `/collab/` | `http://127.0.0.1:1234/`, without `/collab` | WebSocket; the client's address appended to `X-Forwarded-For`, of which the server takes the last; requests up to 512 MiB; no time limit on open connections |
| `/texlive/` | the Unix socket `/var/lib/feuillet/texlive-socket/texlive.sock`, path `/` | WebSocket, with its `Sec-WebSocket-Protocol` header (the compile ticket); the web server's user must be in the group `www-data` to open it |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | `http://127.0.0.1:1234`, the path kept | prefixes: `…/oauth-protected-resource/collab/mcp` too |
| `/docs` | `http://127.0.0.1:1234`, the path kept | forms up to 10 MB |

The address must be served over HTTPS, at its root.

## Sign in with GitHub

GitHub sync works with a personal access token pasted in each browser. To
offer "Sign in with GitHub" instead, register a GitHub OAuth App once:

1. On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
   - Application name: `Feuillet`
   - Homepage URL: `https://feuillet.example.org`
   - Authorization callback URL:
     `https://feuillet.example.org/collab/github/callback`
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

## Sign in with Google

"Sign in with Google" opens Feuillet accounts as on Overleaf (server/collab/
google.js). It asks Google for the `openid` scope only: Feuillet learns which
Google account signs in, never its address, name or picture, and keeps only
a hash of its identifier. To offer it, create an OAuth client once:

1. In the Google Cloud console (https://console.cloud.google.com), create a
   project (or pick one), then go to **Google Auth Platform**:
   - **Branding**: app name `Feuillet`, a support email, the home page
     `https://feuillet.example.org`; authorized domain `example.org`. Leave
     the logo out: with one, Google asks for a brand verification first.
   - **Audience**: user type **External**, then **Publish app**. The
     `openid` scope is not sensitive, so the app needs no verification;
     while it is in "Testing", only the test users listed there may sign in.
   - **Data Access**: nothing to add (`openid` is always granted).
2. **Clients** → **Create client** → type **Web application**:
   - Authorized JavaScript origins: none needed.
   - Authorized redirect URI:
     `https://feuillet.example.org/collab/google/callback`
3. Put its client ID and secret in `/etc/feuillet/collab.env`:

   ```
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

4. Run `sudo deploy/install.sh` again. The collaboration server's start line
   in `sudo docker logs feuillet-collab` then says "Google sign-in on", and
   the sign-in page shows « Se connecter avec Google ».

Leaving them empty keeps the button off. Accounts linked to Google keep a
password, which encrypts what browsers keep and confirms changes to the
account.

## Sign in with ORCID

"Sign in with ORCID" works the same way, as on Overleaf (server/collab/
orcid.js, with google.js on oidcSignIn.js): the `openid` scope only;
Feuillet learns which ORCID iD signs in and keeps only a hash of it, never
the iD itself nor the name ORCID sends with it. To offer it, register a
client of ORCID's free public API once:

1. Sign in to https://orcid.org (an ORCID account with a verified email),
   then open **Developer tools** (https://orcid.org/developer-tools) and
   **Register for the free ORCID public API**.
2. Fill in: name `Feuillet`, website `https://feuillet.example.org`, a short
   description (a collaborative LaTeX editor), and the redirect URI
   `https://feuillet.example.org/collab/orcid/callback`.
3. Put its client ID (`APP-…`) and secret in `/etc/feuillet/collab.env`:

   ```
   ORCID_CLIENT_ID=APP-...
   ORCID_CLIENT_SECRET=...
   ```

4. Run `sudo deploy/install.sh` again. The start line then says "ORCID
   sign-in on", and the sign-in page shows « Se connecter avec ORCID ».

To try it first on ORCID's sandbox (https://sandbox.orcid.org, with a client
registered there), add `ORCID_AUTHORIZE_URL=https://sandbox.orcid.org/oauth/authorize`
and `ORCID_TOKEN_URL=https://sandbox.orcid.org/oauth/token`.

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
Docker network send through it (Postfix's `mynetworks`), which is better kept
closed (the TeX Live container, which runs anyone's documents, has no
network at all).

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
the Model Context Protocol: `https://feuillet.example.org/collab/mcp`
(server/collab/mcp.js). Nothing needs registering:

- in Claude (web or desktop app): Settings → Connectors → Add custom
  connector, with that address;
- in Claude Code: `claude mcp add --transport http feuillet
  https://feuillet.example.org/collab/mcp`, then `/mcp` to sign in.

Claude signs in on a Feuillet page with the account's username and password
(server/collab/oauth.js), and then works with the account's role in each
project: it reads, searches and compiles, suggests changes as tracked changes,
and comments. Its connections are listed, and can be ended, in the profile's
Assistants tab; changing the password ends them too.

`deploy/install.sh` adds the routes Claude looks for
(`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`); the connections are kept in the
`collab-mcp` volume, and compiles go to the TeX Live container through its
socket (`TEXLIVE_URL` in `deploy/docker-compose.yml`). Applications may send people
back only to Claude or to a program on the same computer; `MCP_REDIRECT_URIS`
in `/etc/feuillet/collab.env` adds other addresses.

## Git

As Overleaf's Git integration, the collaboration server lets a project's
owner and editors clone it with Git, pull and push, and its reviewers and
readers clone and pull it (server/collab/git.js):

```
git clone https://alice@feuillet.example.org/collab/git/<project>
```

Nothing needs setting up: the `/collab/` route carries it, and the image
installs `git`. Git signs in with the account's name and a Git token, made
in the profile's Git tab (never the password); only their hashes are kept,
and changing the password ends them. Thirty wrong tokens from one address,
or ten for one account, in a quarter of an hour, are refused for a while.

Each project cloned has a bare repository in the `collab-git` volume
(`GIT_BRIDGE_DIR`), whose `master` follows the project: before each clone,
pull and push, the project as it is now becomes a commit "Update from
Feuillet" when it changed, texts without their comments and tracked changes.
A push must start from the latest commit; its changes go into the project at
once, into open documents too, keeping comments and tracked changes on the
text left. Other branches, tags, forced pushes, symbolic links and
submodules are refused. Deleting a project deletes its repository.

## Backups

`install.sh` sets up a backup of the collaboration server's data each night
at 4:30 (`/etc/cron.d/feuillet-backup`, running `deploy/backup.sh` as
`/usr/local/sbin/feuillet-backup`), and makes one before each update. It
copies the Docker volumes (documents, files, accounts, project links,
versions, assistant connections, Git repositories), one archive each, into
`/var/backups/feuillet/<date>/`, readable by root only: they hold the
accounts' password hashes. The latest 14 are kept, and
`/var/log/feuillet-backup.log` tells how each went.

The collaboration server is paused while the volumes are read, usually a
few seconds; open connections wait. The TeX Live server keeps nothing, and
everything else comes from this repository, except
`/etc/feuillet/collab.env`, whose secrets are best kept elsewhere, such as
in a password manager.

These backups are on the server's own disk: if it fails, they go with it.
`BACKUP_COPY_TO` also copies them elsewhere, each night bringing the
backups the last ones missed, as when the other disk was away:

- to a folder of another disk of this machine, such as a USB one, which
  must exist (`sudo install -d -m 700 /media/usb/feuillet-backups`). A copy
  is refused when the folder is missing or on the same disk as the backups,
  as a mount point is when its disk is not there. It keeps the latest
  `BACKUP_KEEP`, as here;
- or off this machine, with rsync over SSH (root's SSH key must open that
  account). The copies there are not removed by `backup.sh`: remove the old
  ones there too, since the privacy page says that backups keep what was
  erased for two weeks at most.

```
# /etc/feuillet/backup.env
BACKUP_COPY_TO=/media/usb/feuillet-backups
# or BACKUP_COPY_TO=user@other-host:feuillet-backups/
BACKUP_KEEP=14
```

A copy that fails leaves the backup made and shows on the administration
page; `/var/log/feuillet-backup.log` says why. A copy restores as a backup
does: `sudo feuillet-restore /media/usb/feuillet-backups/<date>`.

To put a backup back: everything changed since is lost from the server,
but the current data is backed up first, so a restore can be undone the
same way. A backup made before the Git repositories existed leaves them as
they are: their next commit brings them back to the projects restored.

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
  page says;
- the orphan projects, which no one can find any more: on no account's list
  and owned by none ("No owner, on no list": a project made without an
  account on the server, such as a guest's, is one),
  owned by an account whose list no longer names them, left by an account
  deleted before its projects went with it, or deleted but with contents
  left on the disk. Of each it shows why, when it last changed, its members
  and its space, and whether it is open now, under a key rather than its id.

An account may be deleted there, once its name is typed, as its owner would
from the profile: with the projects it owns, for their collaborators too.
Neither one's own account nor another administrator's is deleted there.
Orphan projects may be deleted there too, those checked at once, as their
owner would: their documents, files and versions are erased, and none of
their links opens them again. One claimed or listed meanwhile stays.

The names are taken as they are: before deleting an account named in
`ADMIN_ACCOUNTS`, take its name out, or someone could make an account with
that name and administer the server.

## Who may create an account

By default, anyone who opens Feuillet may create an account, as on
overleaf.com. For a lab, a course or a team, keep that to invitations, as
an Overleaf Server whose administrator makes the accounts:

```
SIGN_UP=invitation
SIGN_UP_DOMAINS=example.org
```

in `/etc/feuillet/collab.env`, then `sudo deploy/install.sh`. An account is
then created only with:

- a personal invitation to a project, by email or by its link (the
  **Share** dialog): whoever receives it creates an account, then joins the
  project;
- a link from the administration page (**Creating accounts**, **New link
  to create an account**): it makes one account within 7 days, shows only
  when made, and may be taken back;
- with `SIGN_UP_DOMAINS` and email turned on (see above), an address of
  those domains or their subdomains (`example.org` takes
  `lab.example.org`): the sign-up form asks for it and mails a link, which
  makes one account within 24 hours, with that address confirmed.

Accounts that exist stay; sign in with Google or ORCID creates an account
only by the same ways. Create your own account first, before
`SIGN_UP=invitation`, and name it in `ADMIN_ACCOUNTS`.

## Compiling: for accounts only

As on Overleaf, the TeX Live servers compile only for accounts: the
signed-in account, or the one that owns a project opened by its link (a
guest given a read-only link sees its PDF). The collaboration server signs
a ticket for each connection (`server/collab/compileTickets.js`), which the
TeX Live server checks: whoever only knows the server's address cannot use
it to compile. A guest's own project compiles in the browser, with the
compilers TeXlyre brings, or once signed in.

`deploy/install.sh` makes the key once (`COMPILE_TICKET_KEY` in
`/etc/feuillet/collab.env`, an Ed25519 private key) and gives the TeX Live
servers its public key (`COMPILE_TICKET_PUBLIC_KEY` in
`/etc/feuillet/site.env`): they hold nothing that makes a ticket, nor do
the documents they compile. To change the key, remove its line from
`collab.env` and run `sudo deploy/install.sh` again; the editors open
connect again with new tickets.

## Updating

- Servers and web server routes: `sudo deploy/install.sh` again. With
  Apache, it adds any missing proxy route to the HTTPS virtual host created
  by certbot (keeping a copy of the previous file next to it); with nginx,
  it writes the routes and maps again. It rebuilds the containers and
  leaves the certificate alone.
- Application: `deploy/publish.sh`.
- TeX Live packages: `sudo feuillet-compose build --pull texlive` then
  `sudo feuillet-compose up -d texlive`.

`feuillet-compose`, which `install.sh` writes in `/usr/local/sbin`, is
`docker compose` with the files `install.sh` uses: `deploy/docker-compose.yml`,
the address in `/etc/feuillet/site.env`, and your
`/etc/feuillet/docker-compose.override.yml` if any. `sudo feuillet-compose
ps`, `logs collab` or `restart collab` work the same way.

## Your own settings

What is yours stays out of the repository, in `/etc/feuillet`, so that
`git pull` never meets it and updates keep it:

- `collab.env`: the collaboration server's settings (sign-in, email,
  administrators, sign-up, privacy page); after a change, `sudo
  feuillet-compose up -d collab` is enough (`install.sh` does it too).
- `docker-compose.override.yml`: changes to the servers of
  `docker-compose.yml`, which Docker Compose merges with it: without
  TeX Live 2025 on a modest machine, other memory or processor bounds,
  without grammar checking... Copy
  [`docker-compose.override.example.yml`](docker-compose.override.example.yml)
  there and keep what you need, then `sudo deploy/install.sh`.
- `backup.env`: the backups (see Backups).

The privacy page (the **Privacy** link at the bottom of the page) says what
differs from one server to another as the collaboration server tells it
(`server/collab/site.js`), from `collab.env`:

- `PRIVACY_CONTACT`: whom to ask, an email address or an `https://` page;
  without it, the page points to the issues of the code's repository;
- the service that sends the emails: told by `SMTP_URL` for Gmail, Outlook
  and Fastmail; otherwise name it, with its privacy policy,
  `MAIL_PROVIDER=Example Mail` and `MAIL_PROVIDER_PRIVACY_URL=https://…`;
- `WEB_LOG_DAYS`: how long your web server keeps its logs (14 by default,
  as Debian and Ubuntu rotate Apache's and nginx's);
- how long the backups keep what was erased, from `BACKUP_KEEP`
  (`backup.env`), as the last backup tells; Google and ORCID sign-in, and
  grammar checking, only when they are on.

Beyond that, the page describes Feuillet as this repository makes it: if
you change what your server does, change the page with it
([`src/components/common/PrivacyModal.tsx`](../src/components/common/PrivacyModal.tsx)).

## Years of TeX Live

As on Overleaf, each project chooses its TeX Live in the compile menu
(« Version de TeX Live »), for all its collaborators: « La plus récente »,
the default, follows `texlive/texlive:latest` and its updates; a year stays
the same, as TeX Live 2025, the one arXiv compiles with (the arXiv package
then matches it, biblatex's `.bbl` included).

The latest's server (`texlive`) passes the compiles of another year to that
year's server, on a socket of the same directory: `OTHER_YEARS` names them
(`2025=/socket/texlive-2025.sock`), and `/texlive/health` lists the years,
which the compile menu offers. Each year is an image of about 3 GB
(`texlive/texlive:TL2025-historic`, made by the Island of TeX; their
historic images go back to 2013) and an idle server of a few dozen MB.

Each spring, when `latest` moves to a new year, `install.sh` says so. The
projects that chose the year before then compile with the new one (their
menu says so), unless a server offers it. To keep it, as for 2026:

1. In `/etc/feuillet/docker-compose.override.yml` (see Your own settings),
   add a service `texlive-2026` as `texlive-2025` is in
   `docker-compose.yml`, with `TEXLIVE_IMAGE: texlive/texlive:TL2026-historic`,
   `container_name: feuillet-texlive-2026` and
   `SOCKET_PATH: "/socket/texlive-2026.sock"`.
2. Give the latest's `OTHER_YEARS` there:
   `"2025=/socket/texlive-2025.sock,2026=/socket/texlive-2026.sock"`.
3. Run `sudo deploy/install.sh`.

A year nobody uses any more is removed the other way round (its service,
its entry in `OTHER_YEARS`, then `sudo docker image prune`); TeX Live 2025
is turned off as `docker-compose.override.example.yml` shows.

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
(`x-logging` in `docker-compose.yml`). Apache's and nginx's own logs follow
the system's logrotate (14 days on Debian and Ubuntu).

## Checks

- `curl https://feuillet.example.org/collab/health` returns
  `{"status":"ok",...}`.
- `curl https://feuillet.example.org/texlive/health` returns
  `{"status":"ok","connections":…,"compiling":…,"queued":…,"shellEscape":"full"}`;
  `"restricted"` means the server found a network and refused to let
  documents run programs (`sudo docker logs feuillet-texlive` says why).
- `sudo docker logs feuillet-collab` and `sudo docker logs feuillet-texlive`
  show rejected origins, if any, and one line per compile (engine, status,
  duration). Only the server's own address is allowed (`ALLOWED_ORIGINS`
  in `docker-compose.yml`).
- Files larger than 100 MiB are refused (`MAX_FILE_BYTES`).
- `sudo docker logs feuillet-collab` shows each account created or deleted.
  An account without a confirmed email address nor recovery codes cannot be
  recovered; removing the account file by hand frees its name (the projects
  themselves are kept, unlike when the person deletes their account):
  ```
  name=$(printf %s 'alice' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -d' ' -f1)
  sudo docker exec feuillet-collab rm "/accounts/$name.json"
  ```

## Grammar checking (LanguageTool)

As Overleaf's Writefull, the editor underlines grammar and style mistakes,
found by [LanguageTool](https://languagetool.org) 6.6, the official release
([`server/languagetool`](../server/languagetool); its checksum is checked
when the image is built). Its container (`feuillet-languagetool`, 2 GB of
memory at most) is on a Docker network of its own with the collaboration
server only, without access to the Internet, and writes no logs; the
collaboration server passes it the paragraphs of signed-in accounts
(`GRAMMAR_URL`, `server/collab/grammar.js`), 120 a minute per account at
most, and keeps nothing. Spelling stays with Feuillet's own checker. The
first check of each language takes a few seconds, while LanguageTool makes
its rules; later ones take milliseconds. `sudo docker inspect --format
'{{.State.Health.Status}}' feuillet-languagetool` says how it is. Leaving
`GRAMMAR_URL` empty (`docker-compose.override.example.yml`) turns grammar
checking off.

## TeX Live server limits

Any account can compile on this server (see Compiling: for accounts only),
so the container is bounded (`docker-compose.yml`; yours in
`docker-compose.override.yml`) and connections are kept apart:

- each connection compiles under its own uid, in a directory that only this
  uid can open, with its own home and temporary directory. The server runs as
  root in the container, with only the capabilities it needs for that
  (changing owner and uid, removing files, stopping processes); compiles have
  none.
- As on Overleaf, documents may run programs (`-shell-escape`): Inkscape for
  the `svg` package, TikZ's externalization, PythonTeX, gnuplot… So that they
  reach nothing, the container has no network (`network_mode: none`), not even
  this machine's: the web server and the collaboration server reach it through a Unix
  socket in `/var/lib/feuillet/texlive-socket`, a directory of the group
  `www-data` that compiles cannot open. The server refuses full shell escape
  (`SHELL_ESCAPE=full`) if it finds a network interface other than loopback,
  and documents then keep TeX Live's restricted shell escape (BibTeX,
  makeindex, epstopdf, minted's latexminted…).
- Each connection runs at most 64 processes (`SESSION_MAX_PROCESSES`), and
  whatever a compile started is stopped when it ends.
- latexmk never reads `latexmkrc` files from projects (they are Perl); its
  own rules make glossaries and nomenclatures. LuaLaTeX runs without its
  socket library.
- At most `MAX_CONCURRENT` (2) compiles run at once, others wait in a queue of
  20; each compile stops after `COMPILE_TIMEOUT_MS` (3 minutes).
- Each project's files are kept by content in the volume `texlive-file-cache`
  (`FILE_CACHE_DIR`), for that project alone (the page sends a key only its
  members know) and readable by the servers only (0700), so that a project
  reopened sends only what changed. Files unused for `FILE_CACHE_DAYS` (7)
  go, and the oldest beyond `FILE_CACHE_MB` (2 GB in all). Files are written
  into a connection's working tree without following the links a compile
  may have left there.
- 4 GB of memory, 4 CPUs, 256 processes, and a 2 GB in-memory working area
  that is emptied when the container restarts; each other year's server has
  the same bounds, with 3 GB, 3 CPUs and one compile at a time.
- What remains: a compile may use the processor and memory within these
  bounds, and a flaw of the Linux kernel is easier to reach with any program
  than with TeX alone. Overleaf compiles each project in a container of its
  own; here connections share one, under different uids.

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

The TeX Live server uses the `latexmk` found on the machine, with TeX Live's
restricted shell escape (`SHELL_ESCAPE=full` is refused on a machine with a
network). Then set
Settings → Connectivity → WebSocket server to `ws://localhost:1234` and
Settings → Compilation → LaTeX → TeX Live compile server to
`ws://localhost:7045`.
