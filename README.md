# AT&T Price Monitor

Aplicación full-stack modular para monitorear precios, rebajas, disponibilidad real con verificación de carrito y alertas Telegram de celulares en `https://www.att.com.mx/market/destacados`.

> **Estado actual (Etapa 1):** Todos los datos de catálogo, precios e historial mostrados en la interfaz son **simulados y están claramente identificados**. No existe conexión activa contra `att.com.mx` ni selectores DOM inventados.

## Regla crítica de disponibilidad (AT&T México)

En el sitio de AT&T México, el botón **Agregar al carrito** puede mostrarse habilitado incluso cuando la variante está agotada, devolviendo el mensaje `"Este producto se agotó"` tras el clic.

El contrato `resolveEffectiveAvailability()` en `src/scraper/contracts.ts` garantiza que un botón habilitado **nunca** se clasifique como disponible por sí solo:

- `disabled` / `not_found` -> `out_of_stock_confirmed`
- `enabled` + `"Este producto se agotó"` -> `out_of_stock_false_positive`
- `enabled` + sonda no ejecutada -> `unverified`
- `enabled` + alta confirmada y limpieza inmediata del carrito (sin checkout) -> `available_verified`

## Arquitectura

- **Frontend (`src/`):** React 19 + TypeScript + Tailwind CSS v4 + Recharts.
- **Backend (`server.ts`, `src/server/runtime-config.ts`):** Node.js + Express funcionando sin credenciales obligatorias en desarrollo (`SCRAPER_LIVE_ENABLED` es `false` por defecto).
- **Persistencia (`firestore.rules`, `firebase-blueprint.json`):** Firebase Auth + Firestore desde el cliente bajo reglas con aislamiento por usuario (`users/{userId}/...`). El backend Express no usa `firebase-admin` ni exige IAM en Etapa 1.
- **Contratos de extracción (`src/scraper/`):** Interfaces y esqueleto para Crawlee + Playwright (`contracts.ts`, `selector-registry.ts`, `crawlee-playwright-adapter.ts`, `telegram-formatter.ts`) con máximo 1 sonda de carrito por variante/corrida y bloqueo estricto de compras o checkout.
- **Worker independiente (`worker/`):** `Dockerfile` y `cloud-run-job.yaml` para **Cloud Run Jobs** (sin URL HTTP pública), disparado mediante **Cloud Scheduler → API autenticada de Cloud Run v2 (`:run`)** con OAuth2/IAM.

## Etapas de implementación

1. **Etapa 1 (Implementada):** Estructura full-stack, modo demostración sin credenciales de Telegram ni Cloud Run, Firestore con reglas de aislamiento por usuario, dashboard funcional y contratos del scraper.
2. **Etapa 2 (Planificada):** Inspección manual permitida del DOM de `att.com.mx/market/destacados`, registro real de selectores en `selector-registry.ts` y sonda segura de carrito (máx. 1 intento/variante) con Crawlee + Playwright.
3. **Etapa 3 (Planificada):** Contenedor del worker en Cloud Run Jobs + Cloud Scheduler invocando la API autenticada de Cloud Run v2 (requiere proyecto GCP propio con IAM para Service Accounts).
4. **Etapa 4 (Planificada):** Despacho real a Telegram mediante `TELEGRAM_BOT_TOKEN` en Secret Manager y deduplicación por cooldown.

## Desarrollo local

```bash
npm install
npm run dev
```

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID` y las variables de Cloud Run son opcionales en desarrollo. Ver `.env.example`.
