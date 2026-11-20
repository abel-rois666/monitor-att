# Etapa 3: Imagen independiente para el worker en Cloud Run Jobs (sin servidor HTTP público)
# Base oficial de Playwright con Chromium preinstalado compatible con Crawlee.
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Instala dependencias dedicadas del worker (Crawlee + Playwright)
COPY worker/package.json ./worker/package.json
RUN cd worker && npm install --omit=dev

# Copia código compartido del scraper y entrypoint del worker
COPY tsconfig.json ./
COPY src/shared ./src/shared
COPY src/scraper ./src/scraper
COPY worker/src ./worker/src

ENV NODE_ENV=production
ENV SCRAPER_LIVE_ENABLED=false
ENV MAX_PROBES_PER_VARIANT_PER_RUN=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Ejecución finita por corrida (disparada por Cloud Scheduler -> Cloud Run Admin API v2)
CMD ["npx", "--prefix", "worker", "tsx", "worker/src/index.ts", "--mode=discover-readonly"]
