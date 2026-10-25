# Deploying Feuillet on feuillet.slashbin.net

Feuillet is served as static files by Apache. Collaboration goes through a
small server ([`server/collab`](../server/collab)) that every editor connects
to, so collaborators do not need to be online at the same time and there is
no peer-to-peer connection limit:

- shared documents, chat, comments and presence are Yjs documents relayed
  over WebSocket and stored in LevelDB;
- project files (images, bibliographies, any file in the tree) are listed in
  a shared manifest and their contents are stored by SHA-256 checksum;
- opening a text file makes it a shared document, edited live by everyone.

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

Documents are kept in the `feuillet_collab-data` volume and file contents in
`feuillet_collab-files`; neither is touched by an update. The TeX Live server
keeps nothing: each connection compiles in its own temporary directory.

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

## TeX Live server limits

Anyone who can open Feuillet can compile on this server, so the container is
unprivileged and bounded (`docker-compose.yml`):

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
ALLOWED_ORIGINS=http://localhost:5173 YPERSISTENCE=./data FILES_DIR=./files npm start
```

```
cd server/texlive && npm install
ALLOWED_ORIGINS=http://localhost:5173 WORK_DIR=./work npm start
```

The TeX Live server uses the `latexmk` found on the machine. Then set
Settings → Connectivity → WebSocket server to `ws://localhost:1234` and
Settings → Compilation → LaTeX → TeX Live compile server to
`ws://localhost:7045`.
