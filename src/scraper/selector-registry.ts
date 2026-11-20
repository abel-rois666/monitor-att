import fs from 'fs';
import path from 'path';
import {
  ATT_OUT_OF_STOCK_FULL_MESSAGE,
  ATT_OUT_OF_STOCK_PHRASE,
} from './contracts.ts';

/**
 * Registro de selectores con 3 grupos de validación independientes y carga externa desde JSON.
 *
 * GRUPOS INDEPENDIENTES:
 * 1. `catalog`: listado principal en /market/destacados.
 * 2. `productDetail`: ficha individual y precio (puede validarse y usarse sin configurar `catalog` ni `cartProbe`).
 * 3. `cartProbe`: interacción supervisada de carrito y verificación de limpieza.
 *
 * REGLAS:
 * - Ningún selector no comprobado con Playwright puede marcarse como validado.
 * - Los candidatos de precio (`[class*="brandArea"] h2`, `[class*="currentPrice"]`, `[class*="pricingArea"]`)
 *   permanecen como `unvalidated_candidate` hasta su verificación explícita.
 */

export interface CandidateSelectorEntry {
  readonly selector: string;
  readonly status: 'unvalidated_candidate' | 'validated_playwright' | 'rejected';
  readonly lastPlaywrightMatchCount: number | null;
  readonly notes: string;
}

export interface SelectorGroupValidation {
  readonly validated: boolean;
  readonly validatedAtIso: string | null;
  readonly validatedBy: string | null;
}

export interface AttSelectorRegistry {
  /** Compatibilidad general: true solo si catalog y productDetail están validados. */
  readonly configured: boolean;
  readonly validatedAtIso: string | null;
  readonly validatedBy: string | null;
  readonly groups: {
    readonly catalog: SelectorGroupValidation;
    readonly productDetail: SelectorGroupValidation;
    readonly cartProbe: SelectorGroupValidation;
  };
  readonly priceCandidates: {
    readonly title: CandidateSelectorEntry;
    readonly currentPrice: CandidateSelectorEntry;
    readonly pricingArea: CandidateSelectorEntry;
  };
  readonly catalog: {
    readonly productCardContainer: string | null;
    readonly productCardTitle: string | null;
    readonly productCardPrice: string | null;
    readonly productCardBrand: string | null;
    readonly productDetailLink: string | null;
    readonly paginationNextTrigger: string | null;
  };
  readonly productDetail: {
    readonly titleElement: string | null;
    readonly brandElement: string | null;
    readonly priceElement: string | null;
    readonly listPriceElement: string | null;
    readonly storageOptionGroup: string | null;
    readonly colorOptionGroup: string | null;
    readonly addToCartButton: string | null;
    readonly explicitOutOfStockBadge: string | null;
  };
  readonly cartProbe: {
    readonly outOfStockToastOrModal: string | null;
    readonly outOfStockExpectedPhrase: string;
    readonly outOfStockFullMessage: string;
    readonly cartSuccessIndicator: string | null;
    readonly cartCounterBadge: string | null;
    readonly cartItemVariantLocator: string | null;
    readonly removeFromCartButton: string | null;
  };
}

export const ATT_PRICE_CANDIDATE_SELECTORS = {
  title: '[class*="brandArea"] h2',
  currentPrice: '[class*="currentPrice"]',
  pricingArea: '[class*="pricingArea"]',
} as const;

export const DEFAULT_SELECTORS_CONFIG_PATH = path.resolve(
  process.cwd(),
  'worker',
  'config',
  'selectors.json'
);

export const UNCONFIGURED_ATT_SELECTORS: AttSelectorRegistry = {
  configured: false,
  validatedAtIso: null,
  validatedBy: null,
  groups: {
    catalog: {
      validated: false,
      validatedAtIso: null,
      validatedBy: null,
    },
    productDetail: {
      validated: false,
      validatedAtIso: null,
      validatedBy: null,
    },
    cartProbe: {
      validated: false,
      validatedAtIso: null,
      validatedBy: null,
    },
  },
  priceCandidates: {
    title: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.title,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar visibilidad con Playwright tras hidratación completa de Next.js.',
    },
    currentPrice: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.currentPrice,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar visibilidad con Playwright tras hidratación completa de Next.js.',
    },
    pricingArea: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.pricingArea,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar visibilidad con Playwright tras hidratación completa de Next.js.',
    },
  },
  catalog: {
    productCardContainer: null,
    productCardTitle: null,
    productCardPrice: null,
    productCardBrand: null,
    productDetailLink: null,
    paginationNextTrigger: null,
  },
  productDetail: {
    titleElement: null,
    brandElement: null,
    priceElement: null,
    listPriceElement: null,
    storageOptionGroup: null,
    colorOptionGroup: null,
    addToCartButton: null,
    explicitOutOfStockBadge: null,
  },
  cartProbe: {
    outOfStockToastOrModal: null,
    outOfStockExpectedPhrase: ATT_OUT_OF_STOCK_PHRASE,
    outOfStockFullMessage: ATT_OUT_OF_STOCK_FULL_MESSAGE,
    cartSuccessIndicator: null,
    cartCounterBadge: null,
    cartItemVariantLocator: null,
    removeFromCartButton: null,
  },
};

function asNullableString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGroupValidation(raw: unknown): SelectorGroupValidation {
  if (!raw || typeof raw !== 'object') {
    return { validated: false, validatedAtIso: null, validatedBy: null };
  }
  const obj = raw as Record<string, unknown>;
  const validated = obj.validated === true;
  return {
    validated,
    validatedAtIso: validated ? asNullableString(obj.validatedAtIso) : null,
    validatedBy: validated ? asNullableString(obj.validatedBy) : null,
  };
}

function normalizeCandidateEntry(
  raw: unknown,
  fallback: CandidateSelectorEntry
): CandidateSelectorEntry {
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const selector = asNullableString(obj.selector) ?? fallback.selector;
  const rawStatus = obj.status;
  const matchCount =
    typeof obj.lastPlaywrightMatchCount === 'number' && Number.isFinite(obj.lastPlaywrightMatchCount)
      ? obj.lastPlaywrightMatchCount
      : fallback.lastPlaywrightMatchCount;

  // No permite marcar como validated_playwright si no hay conteo positivo confirmado (> 0)
  const status: CandidateSelectorEntry['status'] =
    rawStatus === 'validated_playwright' && (matchCount ?? 0) > 0
      ? 'validated_playwright'
      : rawStatus === 'rejected'
        ? 'rejected'
        : 'unvalidated_candidate';

  return {
    selector,
    status,
    lastPlaywrightMatchCount: matchCount,
    notes: asNullableString(obj.notes) ?? fallback.notes,
  };
}

/**
 * Construye y normaliza un AttSelectorRegistry a partir de un objeto JSON externo
 * sin marcar nunca como validados selectores no comprobados.
 */
export function buildSelectorRegistryFromJson(rawJson: unknown): AttSelectorRegistry {
  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    throw new Error('SELECTOR_CONFIG_INVALID: El archivo de selectores debe ser un objeto JSON.');
  }
  const root = rawJson as Record<string, unknown>;
  const rawGroups = (root.groups && typeof root.groups === 'object'
    ? root.groups
    : {}) as Record<string, unknown>;
  const rawCatalog = (root.catalog && typeof root.catalog === 'object'
    ? root.catalog
    : {}) as Record<string, unknown>;
  const rawDetail = (root.productDetail && typeof root.productDetail === 'object'
    ? root.productDetail
    : {}) as Record<string, unknown>;
  const rawCart = (root.cartProbe && typeof root.cartProbe === 'object'
    ? root.cartProbe
    : {}) as Record<string, unknown>;
  const rawCandidates = (root.priceCandidates && typeof root.priceCandidates === 'object'
    ? root.priceCandidates
    : {}) as Record<string, unknown>;

  const catalogGroup = normalizeGroupValidation(rawGroups.catalog);
  const productDetailGroup = normalizeGroupValidation(rawGroups.productDetail);
  const cartProbeGroup = normalizeGroupValidation(rawGroups.cartProbe);

  const registry: AttSelectorRegistry = {
    configured: catalogGroup.validated && productDetailGroup.validated,
    validatedAtIso:
      asNullableString(root.validatedAtIso) ??
      productDetailGroup.validatedAtIso ??
      catalogGroup.validatedAtIso ??
      null,
    validatedBy:
      asNullableString(root.validatedBy) ??
      productDetailGroup.validatedBy ??
      catalogGroup.validatedBy ??
      null,
    groups: {
      catalog: catalogGroup,
      productDetail: productDetailGroup,
      cartProbe: cartProbeGroup,
    },
    priceCandidates: {
      title: normalizeCandidateEntry(rawCandidates.title, UNCONFIGURED_ATT_SELECTORS.priceCandidates.title),
      currentPrice: normalizeCandidateEntry(
        rawCandidates.currentPrice,
        UNCONFIGURED_ATT_SELECTORS.priceCandidates.currentPrice
      ),
      pricingArea: normalizeCandidateEntry(
        rawCandidates.pricingArea,
        UNCONFIGURED_ATT_SELECTORS.priceCandidates.pricingArea
      ),
    },
    catalog: {
      productCardContainer: asNullableString(rawCatalog.productCardContainer),
      productCardTitle: asNullableString(rawCatalog.productCardTitle),
      productCardPrice: asNullableString(rawCatalog.productCardPrice),
      productCardBrand: asNullableString(rawCatalog.productCardBrand),
      productDetailLink: asNullableString(rawCatalog.productDetailLink),
      paginationNextTrigger: asNullableString(rawCatalog.paginationNextTrigger),
    },
    productDetail: {
      titleElement: asNullableString(rawDetail.titleElement),
      brandElement: asNullableString(rawDetail.brandElement),
      priceElement: asNullableString(rawDetail.priceElement),
      listPriceElement: asNullableString(rawDetail.listPriceElement),
      storageOptionGroup: asNullableString(rawDetail.storageOptionGroup),
      colorOptionGroup: asNullableString(rawDetail.colorOptionGroup),
      addToCartButton: asNullableString(rawDetail.addToCartButton),
      explicitOutOfStockBadge: asNullableString(rawDetail.explicitOutOfStockBadge),
    },
    cartProbe: {
      outOfStockToastOrModal: asNullableString(rawCart.outOfStockToastOrModal),
      outOfStockExpectedPhrase:
        asNullableString(rawCart.outOfStockExpectedPhrase) ?? ATT_OUT_OF_STOCK_PHRASE,
      outOfStockFullMessage:
        asNullableString(rawCart.outOfStockFullMessage) ?? ATT_OUT_OF_STOCK_FULL_MESSAGE,
      cartSuccessIndicator: asNullableString(rawCart.cartSuccessIndicator),
      cartCounterBadge: asNullableString(rawCart.cartCounterBadge),
      cartItemVariantLocator: asNullableString(rawCart.cartItemVariantLocator),
      removeFromCartButton: asNullableString(rawCart.removeFromCartButton),
    },
  };

  return registry;
}

export interface LoadedSelectorRegistryResult {
  readonly registry: AttSelectorRegistry;
  readonly source: 'cli_arg' | 'env_var' | 'default_file' | 'default_unconfigured';
  readonly filePath: string | null;
}

/**
 * Carga selectores validados desde archivo JSON externo sin modificar código del worker.
 * Prioridad:
 * 1. `options.filePath` (--selectors-file)
 * 2. `process.env.ATT_SELECTORS_FILE`
 * 3. `worker/config/selectors.json` (solo si existe)
 * 4. `UNCONFIGURED_ATT_SELECTORS` (respaldo seguro por defecto)
 */
export function loadSelectorRegistry(options?: {
  filePath?: string | null;
  defaultFilePath?: string;
}): LoadedSelectorRegistryResult {
  const cliPath = asNullableString(options?.filePath);
  const envPath = asNullableString(process.env.ATT_SELECTORS_FILE);
  const defaultPath = options?.defaultFilePath ?? DEFAULT_SELECTORS_CONFIG_PATH;

  const explicitPath = cliPath ?? envPath;
  const source: LoadedSelectorRegistryResult['source'] = cliPath
    ? 'cli_arg'
    : envPath
      ? 'env_var'
      : 'default_file';

  if (explicitPath) {
    const resolved = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `SELECTOR_CONFIG_NOT_FOUND: No existe el archivo de selectores especificado (${resolved}).`
      );
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown;
    return {
      registry: buildSelectorRegistryFromJson(parsed),
      source,
      filePath: resolved,
    };
  }

  if (fs.existsSync(defaultPath)) {
    const parsed = JSON.parse(fs.readFileSync(defaultPath, 'utf8')) as unknown;
    return {
      registry: buildSelectorRegistryFromJson(parsed),
      source: 'default_file',
      filePath: defaultPath,
    };
  }

  return {
    registry: UNCONFIGURED_ATT_SELECTORS,
    source: 'default_unconfigured',
    filePath: null,
  };
}

// =============================================================================
// Grupo 1: Selectores de catálogo (independiente)
// =============================================================================
export function listMissingCatalogSelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (!registry.groups.catalog.validated) missing.push('groups.catalog.validated=true');
  if (!registry.catalog.productCardContainer) missing.push('catalog.productCardContainer');
  if (!registry.catalog.productCardTitle) missing.push('catalog.productCardTitle');
  if (!registry.catalog.productDetailLink) missing.push('catalog.productDetailLink');
  return missing;
}

export function isCatalogSelectorsReady(registry: AttSelectorRegistry): boolean {
  return listMissingCatalogSelectors(registry).length === 0;
}

export function assertCatalogSelectorsConfigured(registry: AttSelectorRegistry): void {
  const missing = listMissingCatalogSelectors(registry);
  if (missing.length > 0) {
    throw new Error(
      `SCRAPER_SELECTORS_PENDING: Faltan selectores validados del grupo "catalog" (${missing.join(', ')}). Consulta docs/MANUAL_INSPECTION_ATT.md.`
    );
  }
}

// Alias retrocompatible
export const listMissingDiscoverySelectors = listMissingCatalogSelectors;
export const assertDiscoverySelectorsConfigured = assertCatalogSelectorsConfigured;

// =============================================================================
// Grupo 2: Selectores de ficha y precios (independiente de catálogo y carrito)
// =============================================================================
export function listMissingProductDetailSelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (!registry.groups.productDetail.validated) missing.push('groups.productDetail.validated=true');
  if (!registry.productDetail.titleElement) missing.push('productDetail.titleElement');
  if (!registry.productDetail.priceElement) missing.push('productDetail.priceElement');
  return missing;
}

export function isProductDetailSelectorsReady(registry: AttSelectorRegistry): boolean {
  return listMissingProductDetailSelectors(registry).length === 0;
}

export function assertProductDetailSelectorsConfigured(registry: AttSelectorRegistry): void {
  const missing = listMissingProductDetailSelectors(registry);
  if (missing.length > 0) {
    throw new Error(
      `PRODUCT_DETAIL_SELECTORS_PENDING: Faltan selectores validados del grupo "productDetail" (${missing.join(', ')}). Carga un archivo JSON validado con --selectors-file o ATT_SELECTORS_FILE.`
    );
  }
}

export function listMissingPriceSelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (registry.priceCandidates.title.status !== 'validated_playwright') {
    missing.push(`priceCandidates.title (${registry.priceCandidates.title.selector})`);
  }
  if (registry.priceCandidates.currentPrice.status !== 'validated_playwright') {
    missing.push(`priceCandidates.currentPrice (${registry.priceCandidates.currentPrice.selector})`);
  }
  if (registry.priceCandidates.pricingArea.status !== 'validated_playwright') {
    missing.push(`priceCandidates.pricingArea (${registry.priceCandidates.pricingArea.selector})`);
  }
  return missing;
}

// =============================================================================
// Grupo 3: Selectores de verificación del carrito (independiente de catálogo)
// =============================================================================
export function listMissingCartProbeSelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (!registry.groups.cartProbe.validated) missing.push('groups.cartProbe.validated=true');
  if (!registry.productDetail.addToCartButton) missing.push('productDetail.addToCartButton');
  if (!registry.cartProbe.cartItemVariantLocator) {
    missing.push('cartProbe.cartItemVariantLocator');
  }
  if (!registry.cartProbe.removeFromCartButton) {
    missing.push('cartProbe.removeFromCartButton');
  }
  return missing;
}

export function isCartProbeSelectorsReady(registry: AttSelectorRegistry): boolean {
  return listMissingCartProbeSelectors(registry).length === 0;
}

export function assertCartProbeSelectorsConfigured(registry: AttSelectorRegistry): void {
  const missing = listMissingCartProbeSelectors(registry);
  if (missing.length > 0) {
    throw new Error(
      `CART_PROBE_SELECTORS_PENDING: Faltan selectores validados del grupo "cartProbe" (${missing.join(', ')}). Consulta docs/MANUAL_INSPECTION_ATT.md.`
    );
  }
}
