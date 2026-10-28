FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js accounts.js shares.js history.js github.js review.js ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1234 \
    YPERSISTENCE=/data \
    FILES_DIR=/files \
    ACCOUNTS_DIR=/accounts \
    SHARES_DIR=/shares \
    HISTORY_DIR=/history

RUN mkdir -p /data /files /accounts /shares /history \
    && chown node:node /data /files /accounts /shares /history
VOLUME ["/data", "/files", "/accounts", "/shares", "/history"]
USER node
EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:1234/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
