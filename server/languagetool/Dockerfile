# server/languagetool/Dockerfile
# LanguageTool's server, for grammar and style checking
# (server/collab/grammar.js): the official release from languagetool.org,
# whose checksum is checked (languagetool.org publishes none: this one is of
# the archive as downloaded on 2026-11-04), run without privileges. It
# reaches no network but the collaboration server's (docker-compose.yml).
FROM eclipse-temurin:21-jre-noble

ARG LT_VERSION=6.6
ARG LT_SHA256=53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -fsSL -o /tmp/languagetool.zip \
        "https://languagetool.org/download/LanguageTool-${LT_VERSION}.zip" \
    && echo "${LT_SHA256}  /tmp/languagetool.zip" | sha256sum -c - \
    && unzip -q /tmp/languagetool.zip -d /opt \
    && mv "/opt/LanguageTool-${LT_VERSION}" /opt/languagetool \
    && rm /tmp/languagetool.zip \
    && apt-get purge -y unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY server.properties /opt/languagetool/server.properties
WORKDIR /opt/languagetool
USER 65534:65534
EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:8010/v2/languages || exit 1

# --public: on the container's network, where only the collaboration server
# is; no Access-Control-Allow-Origin: browsers never call it.
CMD ["java", "-Xms256m", "-Xmx1200m", "-XX:-UsePerfData", "-cp", "languagetool-server.jar", \
     "org.languagetool.server.HTTPServer", "--port", "8010", "--public", "--config", "server.properties"]
