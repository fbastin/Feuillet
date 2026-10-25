FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1234 \
    YPERSISTENCE=/data

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:1234/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
