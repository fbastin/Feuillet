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

```
browser ──https──▶ Apache ── /                 ▶ /var/www/feuillet.slashbin.net (deploy/publish.sh)
                         └─ /collab/ (wss, http) ▶ 127.0.0.1:1234 feuillet-collab (Docker)
```

## First installation

1. DNS: add a `CNAME` record `feuillet` → `tireur.no-ip.org` for `slashbin.net`
   (same target as the other subdomains).
2. Run `sudo deploy/install.sh`. It creates the web root, installs and enables
   the Apache virtual host, starts the collaboration server with Docker and
   requests the HTTPS certificate with certbot.
3. Run `deploy/publish.sh` (no sudo, Node.js 22 or newer) to build and publish
   the application.

## Updating

- Application: `deploy/publish.sh`.
- Collaboration server: `sudo docker compose -f deploy/docker-compose.yml up -d --build`.
  Documents are kept in the `feuillet_collab-data` volume and file contents in
  `feuillet_collab-files`; neither is touched by an update.

## Checks

- `curl https://feuillet.slashbin.net/collab/health` returns
  `{"status":"ok",...}`.
- `sudo docker logs feuillet-collab` shows rejected origins, if any. Only
  `https://feuillet.slashbin.net` is allowed (`ALLOWED_ORIGINS` in
  `docker-compose.yml`).
- Files larger than 100 MiB are refused (`MAX_FILE_BYTES`).

## Local development

```
cd server/collab && npm install
ALLOWED_ORIGINS=http://localhost:5173 YPERSISTENCE=./data FILES_DIR=./files npm start
```

Then set Settings → Collaboration → WebSocket server to `ws://localhost:1234`.
