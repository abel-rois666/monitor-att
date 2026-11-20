# Imagen independiente del worker Crawlee + Playwright (Etapa 2 local / Etapa 3 Cloud Run Jobs)
# IMPORTANTE:
# 1. La versión de imagen base (v1.52.0-noble) coincide EXACTAMENTE con "playwright": "1.52.0"
#    fijada en worker/package.json para evitar desajustes con los navegadores en /ms-playwright.
# 2. Se instala worker/package.json en /app/package.json (/app/node_modules) para que tanto
#    /app/worker/src/* como /app/src/scraper/* resuelvan "crawlee" y "playwright" correctamente
#    mediante la resolución estándar de módulos ESM de Node.js.
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Instala dependencias en /app/node_modules (compartido por /app/src/scraper y /app/worker/src)
COPY worker/package.json ./package.json
RUN npm install --omit=dev

# Copia código compartido del scraper, configuración externa de selectores y entrypoint del worker
COPY tsconfig.json ./
COPY src/shared ./src/shared
COPY src/scraper ./src/scraper
COPY worker/src ./worker/src
COPY worker/config ./worker/config

ENV NODE_ENV=production
ENV SCRAPER_LIVE_ENABLED=false
ENV MAX_PROBES_PER_VARIANT_PER_RUN=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Modo seguro por defecto: solo muestra diagnóstico y estado de selectores sin consultar AT&T.
# Para Cloud Run Jobs u otros modos autorizados, sobrescribir CMD/args explícitamente.
CMD ["npx", "tsx", "worker/src/index.ts", "--mode=status"]
