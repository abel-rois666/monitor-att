import type {
  AddToCartButtonState,
  CartProbeOutcome,
  EffectiveAvailability,
} from '../shared/types.ts';

/**
 * Contratos modulares para la Etapa 2 (Crawlee + Playwright) y Etapa 3 (Cloud Run Jobs).
 *
 * REGLAS DE CUMPLIMIENTO:
 * - No inventa selectores CSS, mapeos de bundles ni endpoints internos de AT&T.
 * - Prohíbe compras, checkout, evasión de controles de seguridad y reintentos repetitivos de carrito.
 * - Nunca asume IN_STOCK ni OUT_OF_STOCK sin evidencia verificable y correlacionada con el SKU/variante.
 * - Nunca almacena cookies, tokens, sessionId, reservationId ni datos privados del carrito.
 */

export const ATT_OUT_OF_STOCK_PHRASE = 'Este producto se agotó';
export const ATT_OUT_OF_STOCK_FULL_MESSAGE =
  '¡No te quedes sin estrenar! Este producto se agotó, pero hay más opciones que podrían encantarte.';

/**
 * Estados canónicos de disponibilidad de Etapa 2.
 * - IN_STOCK: SKU coincidente + confirmación positiva de reserva y carrito.
 * - OUT_OF_STOCK: SKU coincidente + rechazo de reserva + mensaje explícito de agotamiento de la misma interacción.
 * - UNKNOWN: Cualquier otro caso no concluyente, sin correlación verificada o con fallo técnico.
 */
export type ScraperAvailabilityState = 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

/**
 * Motivos internos de clasificación para auditoría transparente.
 */
export type AvailabilityClassificationReason =
  | 'EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU'
  | 'RESERVATION_REJECTED'
  | 'CONFIRMED_RESERVATION_AND_CART'
  | 'CART_COUNTER_ONLY_UNVERIFIED'
  | 'UNCORRELATED_SKU'
  | 'ENABLED_BUTTON_UNVERIFIED'
  | 'DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE'
  | 'STALE_CART_SYNC_IGNORED'
  | 'UNASSOCIATED_OR_STALE_MESSAGE_IGNORED'
  | 'PRODUCT_TEMPORARILY_MISSING'
  | 'ACCESS_BLOCKED'
  | 'TIMEOUT'
  | 'NETWORK_OR_ACCESS_ERROR'
  | 'INCONCLUSIVE_INTERACTION';

export type HydrationOutcomeStatus =
  | 'elements_found'
  | 'loaded_no_matches'
  | 'incomplete_hydration'
  | 'timeout'
  | 'network_error'
  | 'access_denied';

export type ExtractionStatus =
  | 'ok'
  | 'partial'
  | 'temporarily_missing'
  | 'blocked'
  | 'timeout'
  | 'error';

export type EvidenceMethod =
  | 'read_only_dom'
  | 'passive_network_json'
  | 'supervised_cart_probe'
  | 'catalog_reconciliation'
  | 'error_handler';

export type ObservationDataOrigin = 'real_extraction' | 'simulated_fixture';

export interface ComplianceGuardConfig {
  readonly targetCatalogUrl: 'https://www.att.com.mx/market/destacados';
  readonly allowPurchases: false;
  readonly allowCheckoutNavigation: false;
  readonly bypassSecurityControls: false;
  readonly respectRobotsAndRateLimits: true;
  readonly clearCartImmediatelyAfterProbe: true;
  readonly maxCartProbesPerVariantPerRun: 1;
  readonly noRepetitiveCartRetries: true;
  readonly maxRequestsPerMinute: number;
  readonly navigationTimeoutMs: number;
  readonly probeDelayRangeMs: [number, number];
}

export const DEFAULT_COMPLIANCE_POLICY: ComplianceGuardConfig = {
  targetCatalogUrl: 'https://www.att.com.mx/market/destacados',
  allowPurchases: false,
  allowCheckoutNavigation: false,
  bypassSecurityControls: false,
  respectRobotsAndRateLimits: true,
  clearCartImmediatelyAfterProbe: true,
  maxCartProbesPerVariantPerRun: 1,
  noRepetitiveCartRetries: true,
  maxRequestsPerMinute: 6,
  navigationTimeoutMs: 25_000,
  probeDelayRangeMs: [2_500, 5_000],
};

/**
 * Productos de referencia documentados durante la inspección manual.
 * Sirven únicamente como metadatos de verificación; nunca representan existencias actuales.
 */
export interface ReferenceProductCase {
  readonly alias: 's23-ultra' | 'honor-magic6-pro';
  readonly productId: string;
  readonly productName: string;
  readonly variantId: string;
  readonly productUrl: string;
  readonly isBundleCandidate: boolean;
  readonly verifiedSkuMappingStatus: 'exact_confirmed' | 'unverified_bundle';
  readonly notes: string;
}

export const ATT_REFERENCE_PRODUCTS: readonly ReferenceProductCase[] = [
  {
    alias: 's23-ultra',
    productId: 'BF_GALAXY_S23_ULTRA',
    productName: 'Samsung Galaxy S23 Ultra 512 GB',
    variantId: 'BF_N.S23U512BK',
    productUrl:
      'https://www.att.com.mx/market/destacados/products/BF_GALAXY_S23_ULTRA?variant=BF_N.S23U512BK',
    isBundleCandidate: false,
    verifiedSkuMappingStatus: 'exact_confirmed',
    notes:
      'Caso confirmado en inspección manual: SKU coincidente + HTTP 422 en reserva + mensaje explícito de agotamiento en la misma interacción.',
  },
  {
    alias: 'honor-magic6-pro',
    productId: 'BF_BUNDLE_HONOR_MAGIC6_PRO',
    productName: 'HONOR Magic6 Pro 512 GB',
    variantId: 'BF_N.M6PBPX9B',
    productUrl:
      'https://www.att.com.mx/market/destacados/products/BF_BUNDLE_HONOR_MAGIC6_PRO?variant=BF_N.M6PBPX9B',
    isBundleCandidate: true,
    verifiedSkuMappingStatus: 'unverified_bundle',
    notes:
      'Operación previa observada con otro SKU sin correspondencia verificada; mantener UNKNOWN hasta comprobación específica.',
  },
] as const;

export interface VerifiedBundleSkuMapping {
  readonly commercialVariantId: string;
  readonly internalSku: string;
  readonly verified: true;
  readonly verifiedAtIso: string;
  readonly verificationNotes: string;
}

export interface DiscoveredVariantOption {
  readonly variantId: string | null;
  readonly capacity: string | null;
  readonly color: string | null;
  readonly priceMxn: number | null;
  readonly variantUrl?: string;
}

export interface DiscoveredProductRef {
  readonly productId: string;
  readonly canonicalUrl: string;
  readonly slug: string;
  readonly brand: string | null;
  readonly modelName: string;
  readonly priceMxn: number | null;
  readonly rawPriceText: string | null;
  readonly capacities: string[];
  readonly colors: string[];
  readonly variants: DiscoveredVariantOption[];
  readonly discoveredAtIso: string;
}

export interface CatalogDiscoveryResult {
  readonly dataOrigin: 'real_extraction';
  readonly catalogUrl: string;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly status: ExtractionStatus;
  readonly products: DiscoveredProductRef[];
  readonly warnings: string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Señal de red estrictamente sanitizada:
 * PROHIBIDO incluir cookies, tokens, sessionId, reservationId o datos privados del carrito.
 */
export interface StructuredNetworkSignal {
  readonly urlPathOnly: string;
  readonly backendPathOnly: string | null;
  readonly extractedSku: string | null;
  readonly operationKind: 'stock_reserve' | 'cart_update' | 'cart_sync' | 'catalog_or_other';
  readonly httpStatus: number;
  readonly backendStatus: number | null;
  readonly contentType: string;
  readonly isReservationRejection: boolean;
  readonly isReservationConfirmed: boolean;
  readonly confirmedVariantInCart: boolean;
  readonly detectedCartItemCount: number | null;
  readonly detectedOutOfStockMessage: string | null;
  readonly observedAtMs: number;
  readonly isPreviousCartSync: boolean;
  readonly matchedSafeKeys: string[];
}

export interface UiFeedbackObservation {
  readonly text: string | null;
  readonly isVisible: boolean;
  readonly observedAfterInteraction: boolean;
  readonly belongsToCurrentInteraction: boolean;
  readonly observedAtMs?: number;
  readonly correlatedVariantId?: string | null;
}

export interface SkuCorrelationResult {
  readonly matched: boolean;
  readonly matchType: 'exact_variant_sku' | 'verified_bundle_mapping' | 'uncorrelated' | 'missing_sku';
  readonly selectedVariantId: string | null;
  readonly operationSku: string | null;
  readonly notes: string;
}

/**
 * Verificación estricta de limpieza posterior a una sonda de carrito.
 * `cartClearedAfterProbe` solo puede ser `true` cuando se comprueba positivamente
 * que el artículo correspondiente a la variante dejó de existir en el carrito.
 */
export interface CartCleanupVerification {
  readonly removalAttempted: boolean;
  readonly variantPresentBeforeRemoval: boolean;
  readonly variantPresentAfterRemoval: boolean | null;
  readonly removalApiConfirmed: boolean;
  readonly cartClearedAfterProbe: boolean;
  readonly notes: string;
}

export interface AvailabilityEvidence {
  readonly method: EvidenceMethod;
  readonly buttonState: AddToCartButtonState;
  readonly correlation: SkuCorrelationResult;
  readonly matchedMessages: string[];
  readonly structuredSignals: StructuredNetworkSignal[];
  readonly httpStatus: number | null;
  readonly backendStatus: number | null;
  readonly cartClearedAfterProbe: boolean;
  readonly cartCleanupVerification?: CartCleanupVerification;
  readonly notes: string;
}

export interface RealObservationRecord {
  readonly dataOrigin: ObservationDataOrigin;
  readonly productId: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly selectedVariantId: string | null;
  readonly correlatedSku: string | null;
  readonly variantKey: string;
  readonly variantLabel: string;
  readonly capacity: string | null;
  readonly color: string | null;
  readonly currentPriceMxn: number | null;
  readonly productUrl: string;
  readonly availabilityState: ScraperAvailabilityState;
  readonly classificationReason: AvailabilityClassificationReason;
  readonly uiAvailability: EffectiveAvailability;
  readonly evidence: AvailabilityEvidence;
  readonly observedAtIso: string;
  readonly extractionResult: {
    readonly status: ExtractionStatus;
    readonly errorCode?: string;
    readonly errorMessage?: string;
  };
}

export interface RealExtractionRunReport {
  readonly schemaVersion: '2.1';
  readonly dataOrigin: ObservationDataOrigin;
  readonly runId: string;
  readonly mode:
    | 'read_only_discovery'
    | 'read_only_single_product'
    | 'supervised_single_cart_probe';
  readonly targetCatalogUrl: string;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly scraperLiveEnabled: boolean;
  readonly selectorsConfigured: boolean;
  readonly totalObserved: number;
  readonly summary: {
    readonly inStock: number;
    readonly outOfStock: number;
    readonly unknown: number;
    readonly reservationRejected: number;
    readonly temporarilyMissing: number;
    readonly errors: number;
  };
  readonly observations: RealObservationRecord[];
}

export interface SingleProductPriceInspectionReport {
  readonly mode: 'read_only_single_product';
  readonly executedNetworkRequest: boolean;
  readonly productUrl: string;
  readonly productId: string | null;
  readonly selectedVariantId: string | null;
  readonly title: string | null;
  readonly rawPriceText: string | null;
  readonly currentPriceMxn: number | null;
  readonly availabilityState: 'UNKNOWN';
  readonly hydrationStatus: HydrationOutcomeStatus | 'not_executed';
  readonly blockedByConfiguration: boolean;
  readonly blockedReason: string | null;
  readonly missingProductDetailSelectors: string[];
  readonly selectorSource: string;
  readonly observedAtIso: string;
  readonly notes: string;
}

export interface SupervisedProbeAuthorization {
  readonly authorized: boolean;
  readonly authorizedBy: string;
  readonly reason: string;
  readonly productId: string;
  readonly selectedVariantId: string;
  readonly singleVariantUrl: string;
  readonly singleVariantKey: string;
  readonly maxAttempts: 1;
  readonly allowCheckout: false;
  readonly allowPurchase: false;
}

export interface ExtractedVariantSnapshot {
  readonly variantKey: string;
  readonly productUrl: string;
  readonly brand: string;
  readonly modelName: string;
  readonly storage: string;
  readonly color: string;
  readonly priceMxn: number;
  readonly listPriceMxn: number | null;
  readonly buttonState: AddToCartButtonState;
  readonly cartProbeOutcome: CartProbeOutcome;
  readonly effectiveAvailability: EffectiveAvailability;
  readonly availabilityState: ScraperAvailabilityState;
  readonly classificationReason: AvailabilityClassificationReason;
  readonly detectedFeedbackMessage: string | null;
  readonly capturedAtIso: string;
}

export interface CartVerificationResult {
  readonly productId: string;
  readonly selectedVariantId: string;
  readonly correlatedSku: string | null;
  readonly buttonState: AddToCartButtonState;
  readonly cartProbeOutcome: CartProbeOutcome;
  readonly effectiveAvailability: EffectiveAvailability;
  readonly availabilityState: ScraperAvailabilityState;
  readonly classificationReason: AvailabilityClassificationReason;
  readonly shouldModifyStoredState: boolean;
  readonly detectedFeedbackMessage: string | null;
  readonly correlation: SkuCorrelationResult;
  readonly structuredSignals: StructuredNetworkSignal[];
  readonly cartClearedAfterProbe: boolean;
  readonly cartCleanupVerification: CartCleanupVerification;
  readonly verifiedAtIso: string;
  readonly extractionStatus: ExtractionStatus;
  readonly errorMessage?: string;
}

export function mapScraperStateToUiAvailability(
  state: ScraperAvailabilityState,
  buttonState: AddToCartButtonState
): EffectiveAvailability {
  if (state === 'IN_STOCK') return 'available_verified';
  if (state === 'OUT_OF_STOCK') {
    return buttonState === 'enabled'
      ? 'out_of_stock_false_positive'
      : 'out_of_stock_confirmed';
  }
  return 'unverified';
}

/**
 * Regla de negocio inmutable heredada para compatibilidad con el dashboard Etapa 1.
 */
export function resolveEffectiveAvailability(
  buttonState: AddToCartButtonState,
  cartProbeOutcome: CartProbeOutcome,
  detectedFeedbackMessage: string | null
): EffectiveAvailability {
  if (
    cartProbeOutcome === 'false_positive_out_of_stock' ||
    containsOutOfStockMessage(detectedFeedbackMessage)
  ) {
    return buttonState === 'enabled'
      ? 'out_of_stock_false_positive'
      : 'out_of_stock_confirmed';
  }

  if (cartProbeOutcome === 'confirmed_in_stock') {
    return 'available_verified';
  }

  return 'unverified';
}

/**
 * Detecta la frase clave "Este producto se agotó" sin depender del texto promocional
 * que la rodea (normalizando acentos y mayúsculas).
 */
export function containsOutOfStockMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return normalized.includes('este producto se agoto');
}

export interface CatalogDiscoveryAdapter {
  discoverProducts(catalogUrl: string): Promise<CatalogDiscoveryResult>;
}

export interface CartAvailabilityVerifier {
  verifySingleVariantSupervised(
    authorization: SupervisedProbeAuthorization
  ): Promise<CartVerificationResult>;
}

export interface PriceDiffEvent {
  readonly eventType:
    | 'price_drop'
    | 'price_increase'
    | 'verified_restock'
    | 'false_positive_detected';
  readonly variantKey: string;
  readonly previousPriceMxn: number;
  readonly currentPriceMxn: number;
  readonly deltaPercent: number;
  readonly previousAvailability: EffectiveAvailability;
  readonly currentAvailability: EffectiveAvailability;
  readonly detectedAtIso: string;
}

export interface FirestoreHistoryWriterContract {
  recordRunStart(runId: string, metadata: { trigger: 'cloud_scheduler' | 'manual' }): Promise<void>;
  upsertVariantSnapshot(snapshot: ExtractedVariantSnapshot): Promise<PriceDiffEvent[]>;
  recordRunFinish(runId: string, summary: { variantsChecked: number; errors: number }): Promise<void>;
}

export interface TelegramDispatcherContract {
  sendFormattedMessage(payload: {
    chatId: string;
    topicId?: string;
    markdownText: string;
    dryRun: boolean;
  }): Promise<{ delivered: boolean; dryRun: boolean; reason?: string }>;
}
