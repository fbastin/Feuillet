# Deploying Feuillet on feuillet.slashbin.net

Feuillet is served as static files by Apache. Real-time collaboration goes
through a small WebSocket server ([`server/collab`](../server/collab)) that
relays and stores the shared documents, so collaborators do not need to be
online at the same time and there is no peer-to-peer connection limit.

```
browser ──https──▶ Apache ── /           ▶ /var/www/feuillet.slashbin.net (deploy/publish.sh)
                         └─ /collab/ (wss) ▶ 127.0.0.1:1234 feuillet-collab (Docker)
```

## First installation

1. DNS: add a `CNAME` record `feuillet` → `tireur.no-ip.org` for `slashbin.net`
   (same target as the other subdomains).
2. Run `sudo deploy/install.sh`. It creates the web root, installs and enables
   the Apache virtual host, starts the collaboration server with Docker and
   requests the HTTPS certificate with certbot.
3. Run `deploy/publish.sh` (no sudo) to build and publish the application.

## Updating

- Application: `deploy/publish.sh`.
- Collaboration server: `sudo docker compose -f deploy/docker-compose.yml up -d --build`.
  Documents are kept in the `feuillet_collab-data` Docker volume.

## Checks

- `curl https://feuillet.slashbin.net/collab/health` returns
  `{"status":"ok",...}`.
- `sudo docker logs feuillet-collab` shows rejected origins, if any. Only
  `https://feuillet.slashbin.net` is allowed (`ALLOWED_ORIGINS` in
  `docker-compose.yml`).

## Local development

```
cd server/collab && npm install && ALLOWED_ORIGINS=http://localhost:5173 npm start
```

Then set Settings → Collaboration → WebSocket server to `ws://localhost:1234`.
