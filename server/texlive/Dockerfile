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

RUN useradd --create-home --uid 10001 --user-group feuillet \
    && install -d -o feuillet -g feuillet /work

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./

USER feuillet
# Builds LuaTeX's font cache now rather than during the first compile.
RUN luaotfload-tool --update --quiet || true

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7045 \
    WORK_DIR=/work
EXPOSE 7045

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:7045/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
