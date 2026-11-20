import {
  ATT_OUT_OF_STOCK_FULL_MESSAGE,
  ATT_OUT_OF_STOCK_PHRASE,
} from './contracts.ts';

/**
 * Registro de selectores para Etapa 2.
 *
 * IMPORTANTE:
 * - Se conservan explícitamente los selectores candidatos aportados durante la inspección
 *   manual en `priceCandidates`, marcados como `unvalidated_candidate` porque aún NO han sido
 *   validados mediante Playwright (el diagnóstico inicial devolvió arreglos vacíos).
 * - Los selectores de producción (`catalog`, `productDetail`, `cartProbe`) permanecen en `null`
 *   y `configured: false` hasta confirmar el DOM hidratado de Next.js con Playwright.
 * - No se inventan selectores CSS ni endpoints internos de AT&T.
 */

export interface CandidateSelectorEntry {
  readonly selector: string;
  readonly status: 'unvalidated_candidate' | 'validated_playwright' | 'rejected';
  readonly lastPlaywrightMatchCount: number | null;
  readonly notes: string;
}

export interface AttSelectorRegistry {
  readonly configured: boolean;
  readonly validatedAtIso: string | null;
  readonly validatedBy: string | null;
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
    readonly removeFromCartButton: string | null;
  };
}

export const ATT_PRICE_CANDIDATE_SELECTORS = {
  title: '[class*="brandArea"] h2',
  currentPrice: '[class*="currentPrice"]',
  pricingArea: '[class*="pricingArea"]',
} as const;

export const UNCONFIGURED_ATT_SELECTORS: AttSelectorRegistry = {
  configured: false,
  validatedAtIso: null,
  validatedBy: null,
  priceCandidates: {
    title: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.title,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar tras hidratación completa de Next.js.',
    },
    currentPrice: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.currentPrice,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar tras hidratación completa de Next.js.',
    },
    pricingArea: {
      selector: ATT_PRICE_CANDIDATE_SELECTORS.pricingArea,
      status: 'unvalidated_candidate',
      lastPlaywrightMatchCount: 0,
      notes:
        'Selector candidato de inspección manual. Devolvió arreglo vacío en diagnóstico inicial; pendiente validar tras hidratación completa de Next.js.',
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
    removeFromCartButton: null,
  },
};

export function listMissingDiscoverySelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (!registry.configured) missing.push('configured=true');
  if (!registry.catalog.productCardContainer) missing.push('catalog.productCardContainer');
  if (!registry.catalog.productCardTitle) missing.push('catalog.productCardTitle');
  if (!registry.catalog.productDetailLink) missing.push('catalog.productDetailLink');
  return missing;
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

export function listMissingCartProbeSelectors(registry: AttSelectorRegistry): string[] {
  const missing: string[] = [];
  if (!registry.configured) missing.push('configured=true');
  if (!registry.productDetail.addToCartButton) missing.push('productDetail.addToCartButton');
  if (!registry.cartProbe.cartSuccessIndicator && !registry.cartProbe.cartCounterBadge) {
    missing.push('cartProbe.cartSuccessIndicator o cartProbe.cartCounterBadge');
  }
  return missing;
}

export function assertDiscoverySelectorsConfigured(registry: AttSelectorRegistry): void {
  const missing = listMissingDiscoverySelectors(registry);
  if (missing.length > 0) {
    throw new Error(
      `SCRAPER_SELECTORS_PENDING: Faltan selectores validados manualmente para discovery (${missing.join(', ')}). Consulta docs/MANUAL_INSPECTION_ATT.md.`
    );
  }
}

export function assertCartProbeSelectorsConfigured(registry: AttSelectorRegistry): void {
  const missing = listMissingCartProbeSelectors(registry);
  if (missing.length > 0) {
    throw new Error(
      `CART_PROBE_SELECTORS_PENDING: Faltan selectores validados manualmente para la sonda de carrito (${missing.join(', ')}). Consulta docs/MANUAL_INSPECTION_ATT.md.`
    );
  }
}
