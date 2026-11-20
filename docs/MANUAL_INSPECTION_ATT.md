# Procedimiento de Inspección Manual en Chrome o Edge — AT&T México (Etapa 2)

## Por qué se requiere esta inspección manual

Al consultar en modo solo lectura el HTML prerenderizado de `https://www.att.com.mx/market/destacados`:

1. El sitio usa **Next.js App Router** (`x-nextjs-prerender: 1`) y opera detrás de F5 Distributed Cloud / Volterra (`server: volt-adc`).
2. El HTML SSR inicial (`~223 KB`) contiene el marco de la página (`"AT&T Market | Celulares: compra tu smartphone ideal"`), pero **0 precios y 0 URLs de fichas de producto** — el catálogo y las variantes se hidratan dinámicamente en el navegador tras ejecutar JavaScript.
3. Siguiendo la regla estricta de **no inventar selectores CSS ni endpoints internos** y **no evadir controles de acceso**, los campos en `src/scraper/selector-registry.ts` permanecen en `null` hasta completar esta verificación manual.

---

## Paso 1. Inspeccionar el listado de celulares (`catalog.*`)

1. Abre **Chrome** o **Edge** en una ventana normal y navega a:
   `https://www.att.com.mx/market/destacados`
2. Abre **DevTools (`F12`) → Elements** y espera a que carguen las tarjetas de celulares.
3. Localiza una tarjeta de celular y anota los selectores estables (evita clases hash generadas dinámicamente como `css-1a2b3c` si existe un `data-testid`, atributo semántico o estructura estable):
   - `catalog.productCardContainer`: contenedor de cada tarjeta de equipo.
   - `catalog.productCardTitle`: elemento con el nombre del modelo.
   - `catalog.productCardBrand`: elemento con la marca (si viene separada del título).
   - `catalog.productCardPrice`: elemento con el precio principal en MXN.
   - `catalog.productDetailLink`: etiqueta `<a>` hacia la página individual del equipo (anota también un ejemplo real del patrón de URL, ej. `/market/destacados/...`).
   - `catalog.paginationNextTrigger`: botón "Siguiente" o "Ver más" si el catálogo está paginado.

---

## Paso 2. Inspeccionar la pestaña Network (respuestas estructuradas de catálogo)

1. Con **DevTools → Network** abierto y filtrado en **Fetch/XHR**, recarga `https://www.att.com.mx/market/destacados`.
2. Revisa si alguna respuesta JSON pública carga el catálogo de equipos y anota (sin copiar cookies ni tokens):
   - Ruta relativa del request (solo pathname, sin credenciales).
   - Qué campos JSON contienen: `id`, `name`/`model`, `brand`, `price`, `capacity`/`storage`, `color`, y si existe algún campo de inventario (`stock`, `inStock`, `available`, `status`).

---

## Paso 3. Inspeccionar una ficha de producto (`productDetail.*`)

1. Haz clic en un celular para abrir su ficha individual.
2. En **DevTools → Elements**, registra:
   - `productDetail.titleElement`: título del equipo.
   - `productDetail.priceElement`: precio de contado/actual en MXN.
   - `productDetail.listPriceElement`: precio tachado o de lista (si existe).
   - `productDetail.storageOptionGroup`: botones/opciones de capacidad (`128 GB`, `256 GB`, `512 GB`, etc.).
   - `productDetail.colorOptionGroup`: botones/swatches de color.
   - `productDetail.addToCartButton`: botón **"Agregar al carrito"**.
   - `productDetail.explicitOutOfStockBadge`: etiqueta visible de agotado (si existe).

---

## Paso 4. Inspeccionar el comportamiento del botón "Agregar al carrito" (`cartProbe.*`)

Realiza **una única prueba manual** en dos escenarios (sin avanzar nunca a checkout ni compra):

### Escenario A — Celular con botón habilitado pero agotado
1. Abre **DevTools → Network (Fetch/XHR)** y limpia el registro.
2. Haz clic una sola vez en **Agregar al carrito**.
3. Anota:
   - El selector del modal/toast que muestra:
     `¡No te quedes sin estrenar! Este producto se agotó, pero hay más opciones que podrían encantarte.`
     → guardar en `cartProbe.outOfStockToastOrModal`.
   - En **Network**, identifica la solicitud XHR/Fetch disparada por el clic:
     - Código HTTP (`200`, `400`, `409`, `422`, etc.).
     - Fragmento JSON relevante (ej. `errorCode`, `message`, `available`, `inStock`, `stock`) sin cookies ni encabezados privados.

### Escenario B — Celular con existencia real
1. Haz clic una sola vez en **Agregar al carrito** en un equipo disponible.
2. Anota:
   - `cartProbe.cartSuccessIndicator`: elemento/drawer/toast que confirma que el equipo se agregó.
   - `cartProbe.cartCounterBadge`: contador numérico del ícono de carrito.
   - `cartProbe.removeFromCartButton`: botón para **retirar el equipo inmediatamente del carrito**.
   - En **Network**, anota el código HTTP y las llaves JSON que confirman el alta en carrito.
3. Retira el equipo del carrito inmediatamente y cierra la prueba.

---

## Paso 5. Evidencia ya confirmada y casos pendientes

### Evidencia confirmada (no requiere repetir pruebas innecesarias)
- **Samsung Galaxy S23 Ultra 512 GB** (`BF_GALAXY_S23_ULTRA?variant=BF_N.S23U512BK`):
  - Durante una interacción manual de agregar al carrito se observó rechazo `backendStatus: 422` en la ruta de reserva correspondiente al SKU `BF_N.S23U512BK` junto con el mensaje simultáneo en pantalla:
    `«¡No te quedes sin estrenar! Este producto se agotó, pero hay más opciones que podrían encantarte.»`
  - Regla implementada en `src/scraper/availability-analyzer.ts`:
    - SKU coincidente + rechazo de reserva + mensaje explícito de agotamiento de la misma interacción → `OUT_OF_STOCK`.
    - SKU coincidente + HTTP 422 sin explicación adicional → `UNKNOWN` (`RESERVATION_REJECTED`).

### Caso pendiente de verificación específica
- **HONOR Magic6 Pro 512 GB** (`BF_BUNDLE_HONOR_MAGIC6_PRO?variant=BF_N.M6PBPX9B`):
  - Producto candidato a *bundle*. Una operación previa registró otro SKU sin correspondencia confirmada.
  - Permanece en `UNKNOWN` (`UNCORRELATED_SKU`) hasta confirmar manualmente si existe un mapeo determinista y verificado entre `BF_N.M6PBPX9B` y el SKU interno. Nunca se asume ni inventa dicha relación.

---

## Paso 6. Diagnóstico de selectores candidatos de precio en DOM hidratado (Next.js)

Los siguientes selectores candidatos están preservados en `src/scraper/selector-registry.ts` como `unvalidated_candidate` porque en el diagnóstico inicial devolvieron arreglos vacíos `[]`:

- Título: `[class*="brandArea"] h2`
- Precio actual: `[class*="currentPrice"]`
- Área de precios: `[class*="pricingArea"]`

### Causas probables de que Playwright devolviera `[]` y cómo verificarlo en Chrome/Edge DevTools
1. **Control de acceso / WAF en navegador automatizado**: verifica `document.title` (si aparece `"Solicitud rechazada"` o similar, el DOM de producto nunca se montó).
2. **Evaluación antes de hidratación completa de Next.js**: la página es Next.js App Router (`x-nextjs-prerender: 1`) y carga precios/variantes tras la hidratación cliente (`?variant=...`). Espera a que desaparezcan los *skeletons* de carga.
3. **Nombres de clase con hash de CSS Modules o prefijo distinto entre catálogo y ficha**: en la consola de DevTools sobre la ficha real del producto ejecuta:
   - `document.querySelectorAll('[class*="brandArea"] h2')`
   - `document.querySelectorAll('[class*="currentPrice"]')`
   - `document.querySelectorAll('[class*="pricingArea"]')`
   Si alguno devuelve `NodeList(0)`, inspecciona el elemento real del precio con clic derecho → *Inspeccionar* y anota el atributo estable (`data-testid`, etiqueta semántica o prefijo CSS real).
4. **Iframe, Shadow DOM o modal inicial (código postal / cookies)**: comprueba en DevTools si el bloque de precio vive dentro de un `iframe` o requiere cerrar/completar un selector regional antes de renderizarse.

---

## Paso 7. Registrar los datos validados

Con la información anterior:
1. Completa `src/scraper/selector-registry.ts` (tanto `priceCandidates` con estado `validated_playwright` como `catalog`, `productDetail` y `cartProbe`) y establece `configured: true`, `validatedAtIso` y `validatedBy`.
2. Ejecuta pruebas unitarias (`npm test`) y, solo cuando autorices la extracción de solo lectura en un entorno con Chromium, ejecuta `SCRAPER_LIVE_ENABLED=true tsx worker/src/index.ts --mode=inspect-hydration` para verificar los selectores de precio antes de correr `discover-readonly`.

