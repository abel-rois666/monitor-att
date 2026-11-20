# AT&T Price Monitor

Aplicación full-stack modular para monitorear precios, rebajas, disponibilidad verificada y alertas Telegram de celulares en `https://www.att.com.mx/market/destacados`.

> **Estado actual (Etapa 2 — Preparación y validación lógica completada; extracción en vivo desactivada):**
> - El **dashboard** sigue operando en **modo demostración** con datos simulados claramente identificados.
> - El **motor de disponibilidad, correlación de SKU, limpieza de carrito e inspección de hidratación** está implementado y cubierto por pruebas unitarias con *fixtures* simulados.
> - `SCRAPER_LIVE_ENABLED` permanece en **`false`** por defecto. **No** se ha ejecutado extracción real en producción, **no** se ha activado monitoreo automático y **no** se han habilitado sondas de carrito en vivo.

---

## Reglas de disponibilidad (AT&T México — Etapa 2)

En AT&T México el botón **Agregar al carrito** puede aparecer habilitado incluso cuando la variante está agotada. El analizador (`src/scraper/availability-analyzer.ts`) aplica estrictamente la siguiente tabla:

| Evidencia observada | Estado | Motivo interno |
|---|---|---|
| SKU coincidente + rechazo de reserva (ej. HTTP 422) + mensaje explícito `"Este producto se agotó"` de la misma interacción | `OUT_OF_STOCK` | `EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU` |
| SKU coincidente + rechazo HTTP 422 sin explicación explícita de agotamiento | `UNKNOWN` | `RESERVATION_REJECTED` |
| SKU coincidente + reserva confirmada + presencia verificada de esa variante en el carrito | `IN_STOCK` | `CONFIRMED_RESERVATION_AND_CART` |
| Solo incremento de contador general del carrito sin confirmar la variante específica | `UNKNOWN` | `CART_COUNTER_ONLY_UNVERIFIED` |
| SKU diferente sin mapeo de *bundle* verificado | `UNKNOWN` | `UNCORRELATED_SKU` |
| Botón habilitado sin confirmación de reserva/carrito | `UNKNOWN` | `ENABLED_BUTTON_UNVERIFIED` |
| Botón deshabilitado sin mensaje explícito de agotamiento | `UNKNOWN` | `DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE` |
| Sincronización de carrito previo o mensaje oculto/anterior/ajeno | `UNKNOWN` | `STALE_CART_SYNC_IGNORED` / `UNASSOCIATED_OR_STALE_MESSAGE_IGNORED` |
| Error de red, timeout o bloqueo HTTP (403/429) | `UNKNOWN` | `NETWORK_OR_ACCESS_ERROR` / `TIMEOUT` / `ACCESS_BLOCKED` |

Adicionalmente, `cartClearedAfterProbe` solo se marca `true` tras comprobar que el artículo específico desapareció del carrito (nunca por el mero clic en el botón de eliminación).

---

## Configuración externa de selectores (3 grupos independientes)

El worker carga selectores desde JSON externo sin modificar código fuente, usando (en orden de prioridad):
1. Bandera CLI `--selectors-file=<ruta>`
2. Variable de entorno `ATT_SELECTORS_FILE`
3. Archivo opcional `worker/config/selectors.json` (si existe)
4. Respaldo seguro `UNCONFIGURED_ATT_SELECTORS` (todos los grupos en `validated: false`)

Consulta la plantilla `worker/config/selectors.example.json`. La validación está separada en **3 grupos independientes**:

- **`catalog`**: listado de `/market/destacados` (requerido solo para `--mode=discover-readonly`).
- **`productDetail`**: título y precio en ficha individual (puede validarse y ejecutarse en `--mode=inspect-product` **sin** requerir `catalog` ni `cartProbe`).
- **`cartProbe`**: interacción supervisada de carrito y verificación de limpieza (requerido solo para `--mode=supervised-cart-probe`).

Los selectores candidatos de precio (`[class*="brandArea"] h2`, `[class*="currentPrice"]`, `[class*="pricingArea"]`) permanecen como `unvalidated_candidate` hasta comprobar su visibilidad real en el DOM hidratado de Next.js con Playwright.

---

## Arquitectura

- **Frontend (`src/`):** React 19 + TypeScript + Tailwind CSS v4 + Recharts (modo demostración).
- **Backend (`server.ts`, `src/server/runtime-config.ts`):** Node.js + Express sin secretos obligatorios en desarrollo (`SCRAPER_LIVE_ENABLED=false`).
- **Persistencia (`firestore.rules`, `firebase-blueprint.json`):** Firebase Auth + Firestore con aislamiento por usuario (`users/{userId}/...`).
- **Motor y adaptador (`src/scraper/`):** `contracts.ts`, `selector-registry.ts`, `availability-analyzer.ts`, `crawlee-playwright-adapter.ts`, `result-store.ts`, `telegram-formatter.ts`.
- **Worker independiente (`worker/`):** `src/index.ts`, `config/selectors.example.json`, `package.json` (Playwright fijado exactamente en `1.52.0`), `Dockerfile` (`mcr.microsoft.com/playwright:v1.52.0-noble` con dependencias instaladas en `/app/node_modules`) y `cloud-run-job.yaml`.

---

## Etapas de implementación

1. **Etapa 1 (Completada):** Estructura full-stack, modo demostración, Firestore con reglas por usuario y dashboard funcional.
2. **Etapa 2 (En curso — Lógica lista, extracción real pendiente de selectores validados):** Motor de disponibilidad corregido, correlación SKU, diagnóstico de hidratación de 6 estados, limpieza verificada de carrito, selectores externos por grupo, modo de inspección individual de fichas y suite Vitest con *fixtures* simulados. Falta validar selectores en el DOM hidratado de AT&T con Playwright y ejecutar la primera lectura autorizada.
3. **Etapa 3 (Planificada):** Despliegue del contenedor en Cloud Run Jobs + Cloud Scheduler invocando la API autenticada de Cloud Run v2 (`:run`).
4. **Etapa 4 (Planificada):** Despacho real de alertas Telegram con `TELEGRAM_BOT_TOKEN` en Secret Manager.

---

## Ejecución en Windows 11 con PowerShell

### 1. Instalación, pruebas unitarias y verificación de tipos (sin consultar AT&T)

```powershell
npm install
npm test
npm run lint
npm run build
```

### 2. Verificar estado del worker y bloqueo seguro de ficha individual (sin tráfico real)

```powershell
# Estado general y de los 3 grupos de selectores
npm run worker:status

# Preflight de ficha individual (Samsung Galaxy S23 Ultra y HONOR Magic6 Pro) sin tráfico real
npx tsx worker/src/index.ts --mode=inspect-product --target=s23-ultra
npx tsx worker/src/index.ts --mode=inspect-product --target=honor-magic6-pro
```

### 3. Construcción y prueba del contenedor Docker en modo `status` (sin consultar AT&T)

```powershell
# Construir imagen del worker desde la raíz del repositorio
docker build -f worker/Dockerfile -t att-price-monitor-worker:local .

# Ejecutar en modo status seguro por defecto (SCRAPER_LIVE_ENABLED=false, sin red hacia AT&T)
docker run --rm att-price-monitor-worker:local
```

### 4. Comando para una única inspección posterior de solo lectura (con autorización explícita)

Cuando dispongas de selectores validados en `worker/config/selectors.json` (grupo `productDetail` con `validated: true`) y decidas autorizar **una sola lectura** sobre la ficha de referencia, ejecuta desde PowerShell usando Docker:

```powershell
# Diagnóstico de hidratación de solo lectura (sin carrito ni reservas)
docker run --rm `
  -e SCRAPER_LIVE_ENABLED=true `
  -v "${PWD}/worker/config:/app/worker/config:ro" `
  att-price-monitor-worker:local `
  npx tsx worker/src/index.ts --mode=inspect-hydration --target=s23-ultra

# Inspección de solo lectura de título y precio (requiere grupo productDetail validado en selectors.json)
docker run --rm `
  -e SCRAPER_LIVE_ENABLED=true `
  -v "${PWD}/worker/config:/app/worker/config:ro" `
  -v "${PWD}/worker/output:/app/worker/output" `
  att-price-monitor-worker:local `
  npx tsx worker/src/index.ts --mode=inspect-product --target=s23-ultra --selectors-file=worker/config/selectors.json
```

> Cambia `--target=s23-ultra` por `--target=honor-magic6-pro` para la ficha de HONOR Magic6 Pro. Para desarrollo web del dashboard local usa `npm run dev` (las variables de Telegram y Cloud Run en `.env.example` son opcionales).
