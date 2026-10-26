# Full TeX Live (texlive/texlive, rebuilt daily from CTAN) with the Feuillet
# compile server. `docker compose build --pull` picks up package updates.
ARG TEXLIVE_IMAGE=texlive/texlive:latest

FROM node:22-bookworm-slim AS node

FROM ${TEXLIVE_IMAGE}

# Ghostscript converts EPS figures (epstopdf); Python runs minted's
# latexminted, which restricted shell escape allows.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ghostscript python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && node --version

# Font caches are built now, in the system trees that every session uid
# reads, rather than during the first compile of each connection.
RUN (fc-cache -s && luaotfload-tool --update --quiet \
    && cd /tmp \
    && printf '%s\n' '\documentclass{article}\usepackage{fontspec}' \
        '\begin{document}x\end{document}' >warm.tex \
    && lualatex --nosocket --interaction=nonstopmode warm.tex >/dev/null \
    && rm -f warm.*) || echo 'Font caches will be built during compiles.'

# Biber is a self-extracting program. It is unpacked once here instead of
# into /tmp, where nothing may run; server.js links each session to it.
ENV BIBER_DIR=/opt/biber
COPY check-biber.sh /tmp/
RUN sh /tmp/check-biber.sh && rm /tmp/check-biber.sh

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./

# The server stays root, with the few capabilities docker-compose.yml grants,
# to give each connection its own uid; compiles run without any capability.
RUN install -d -m 0711 /work
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7045 \
    WORK_DIR=/work
EXPOSE 7045

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:7045/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
