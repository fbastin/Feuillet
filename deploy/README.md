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
  editors or readers. The project appears in their list, and they follow its
  links when they change. Removing an editor replaces the editing link, and
  removing a reader the read-only link, which cuts them off;
- versions, as on Overleaf: a short while after a project changes, the
  server saves a version with who changed what. The Versions tab lists them
  by day, shows each change against the version before, and restores a file
  or the whole project as it was.

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
texts are with the files); none is touched by an update. The TeX Live server keeps nothing: each
connection compiles in its own temporary directory.

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
  There is no e-mail, so a forgotten password cannot be reset; removing the
  account frees its name (the projects themselves are kept):
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
