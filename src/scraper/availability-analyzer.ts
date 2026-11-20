import {
  containsOutOfStockMessage,
  mapScraperStateToUiAvailability,
  type AvailabilityClassificationReason,
  type AvailabilityEvidence,
  type CartCleanupVerification,
  type CartVerificationResult,
  type ExtractionStatus,
  type RealObservationRecord,
  type ScraperAvailabilityState,
  type SkuCorrelationResult,
  type StructuredNetworkSignal,
  type SupervisedProbeAuthorization,
  type UiFeedbackObservation,
  type VerifiedBundleSkuMapping,
} from './contracts.ts';
import type { AddToCartButtonState } from '../shared/types.ts';

/**
 * Motor corregido de análisis de disponibilidad y correlación de SKU para AT&T México (Etapa 2).
 *
 * Tabla de reglas implementada de forma estricta:
 * - SKU coincidente + rechazo de reserva (ej. 422) + mensaje explícito de agotamiento (misma interacción) -> OUT_OF_STOCK
 * - SKU coincidente + rechazo HTTP 422 sin explicación adicional -> UNKNOWN (RESERVATION_REJECTED)
 * - SKU coincidente + confirmación positiva de reserva y carrito -> IN_STOCK
 * - SKU diferente sin correspondencia verificada -> UNKNOWN (UNCORRELATED_SKU, no modifica estado)
 * - Botón "Agregar al carrito" habilitado sin otra evidencia -> UNKNOWN
 * - Botón deshabilitado sin mensaje explícito de agotamiento -> UNKNOWN
 * - Error de red, bloqueo, timeout o página sin cargar -> UNKNOWN
 * - Sincronización de carrito previo o mensaje oculto/anterior/ajeno -> ignorado (no modifica estado)
 */

const FORBIDDEN_PRIVATE_KEYS = new Set([
  'cookie',
  'cookies',
  'set-cookie',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'authorization',
  'sessionid',
  'session_id',
  'reservationid',
  'reservation_id',
  'cartid',
  'cart_id',
  'customerid',
  'customer_id',
  'email',
  'phone',
  'address',
]);

/**
 * Extrae productId y variantId de URLs públicas de fichas de AT&T Market.
 * Ej: /market/destacados/products/BF_GALAXY_S23_ULTRA?variant=BF_N.S23U512BK
 */
export function extractAttProductIdentifiersFromUrl(productUrl: string): {
  productId: string | null;
  variantId: string | null;
} {
  try {
    const parsed = new URL(productUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const productsIdx = segments.findIndex((s) => s.toLowerCase() === 'products');
    const productId =
      productsIdx >= 0 && segments[productsIdx + 1]
        ? decodeURIComponent(segments[productsIdx + 1])
        : null;
    const variantParam = parsed.searchParams.get('variant');
    const variantId = variantParam ? variantParam.trim() : null;
    return { productId, variantId };
  } catch {
    return { productId: null, variantId: null };
  }
}

/**
 * Extrae el SKU de una ruta de reserva de inventario cuando existe el segmento
 * `/stockKeepingUnits/{SKU}/reserve` (sin invocar ningún endpoint).
 */
export function extractSkuFromBackendPath(bePath: string | null | undefined): string | null {
  if (!bePath) return null;
  const match = bePath.match(/\/stockKeepingUnits\/([^/?#]+)\/reserve(?:[/?#]|$)/i);
  return match && match[1] ? decodeURIComponent(match[1]).trim() : null;
}

/**
 * Paso 1-3 de correlación: compara la variante seleccionada con el SKU de la operación
 * usando coincidencia exacta o un mapeo de bundle previamente verificado.
 * Jamás inventa relaciones entre identificadores comerciales y SKU internos.
 */
export function correlateVariantWithSku(params: {
  selectedVariantId: string | null;
  operationSku: string | null;
  verifiedBundleMappings?: readonly VerifiedBundleSkuMapping[];
}): SkuCorrelationResult {
  const selected = params.selectedVariantId?.trim() || null;
  const opSku = params.operationSku?.trim() || null;

  if (!selected || !opSku) {
    return {
      matched: false,
      matchType: 'missing_sku',
      selectedVariantId: selected,
      operationSku: opSku,
      notes: 'No se dispone de ambos identificadores (variante seleccionada y SKU de operación) para verificar correlación.',
    };
  }

  if (selected.toUpperCase() === opSku.toUpperCase()) {
    return {
      matched: true,
      matchType: 'exact_variant_sku',
      selectedVariantId: selected,
      operationSku: opSku,
      notes: `Correlación exacta verificada entre variante seleccionada (${selected}) y SKU de operación (${opSku}).`,
    };
  }

  const verifiedMapping = (params.verifiedBundleMappings ?? []).find(
    (m) =>
      m.verified === true &&
      m.commercialVariantId.toUpperCase() === selected.toUpperCase() &&
      m.internalSku.toUpperCase() === opSku.toUpperCase()
  );

  if (verifiedMapping) {
    return {
      matched: true,
      matchType: 'verified_bundle_mapping',
      selectedVariantId: selected,
      operationSku: opSku,
      notes: `Correlación de bundle verificada manualmente (${selected} -> ${opSku}).`,
    };
  }

  return {
    matched: false,
    matchType: 'uncorrelated',
    selectedVariantId: selected,
    operationSku: opSku,
    notes: `SKU de operación (${opSku}) no coincide con la variante investigada (${selected}) ni existe mapeo de bundle verificado.`,
  };
}

/**
 * Valida que un mensaje visual de agotamiento sea visible, posterior a la interacción
 * actual y perteneciente a la misma operación (descarta elementos ocultos, avisos previos
 * o secciones ajenas).
 */
export function validateOutOfStockUiFeedback(params: {
  feedback: UiFeedbackObservation | null | undefined;
  selectedVariantId: string | null;
  interactionStartedAtMs?: number;
}): {
  validExplicitOutOfStock: boolean;
  ignoredStaleOrUnrelated: boolean;
  matchedText: string | null;
  reason: string;
} {
  const fb = params.feedback;
  if (!fb || !fb.text || !containsOutOfStockMessage(fb.text)) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: false,
      matchedText: null,
      reason: 'Sin mensaje explícito de agotamiento en la interfaz.',
    };
  }

  if (!fb.isVisible) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: true,
      matchedText: null,
      reason: 'Texto de agotamiento encontrado en un elemento oculto; descartado.',
    };
  }

  if (!fb.observedAfterInteraction) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: true,
      matchedText: null,
      reason: 'Mensaje de agotamiento preexistente/anterior a la interacción actual; descartado.',
    };
  }

  if (!fb.belongsToCurrentInteraction) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: true,
      matchedText: null,
      reason: 'Mensaje de agotamiento perteneciente a una sección no relacionada; descartado.',
    };
  }

  if (
    params.interactionStartedAtMs !== undefined &&
    fb.observedAtMs !== undefined &&
    fb.observedAtMs < params.interactionStartedAtMs
  ) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: true,
      matchedText: null,
      reason: 'Marca de tiempo del mensaje anterior al inicio de la interacción actual; descartado.',
    };
  }

  if (
    fb.correlatedVariantId &&
    params.selectedVariantId &&
    fb.correlatedVariantId.toUpperCase() !== params.selectedVariantId.toUpperCase()
  ) {
    return {
      validExplicitOutOfStock: false,
      ignoredStaleOrUnrelated: true,
      matchedText: null,
      reason: `Mensaje asociado a otra variante (${fb.correlatedVariantId}); descartado.`,
    };
  }

  return {
    validExplicitOutOfStock: true,
    ignoredStaleOrUnrelated: false,
    matchedText: fb.text.trim(),
    reason: 'Mensaje explícito "Este producto se agotó" visible y correlacionado con la interacción actual.',
  };
}

/**
 * Inspecciona pasivamente una respuesta JSON de red observada por Playwright
 * y devuelve únicamente una señal sanitizada (sin cookies, tokens, sessionId ni reservationId).
 */
export function inspectStructuredNetworkPayload(params: {
  url: string;
  httpStatus: number;
  contentType: string;
  payload: unknown;
  observedAtMs?: number;
  isPreviousCartSync?: boolean;
}): StructuredNetworkSignal | null {
  if (!params.contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  let urlPathOnly = params.url;
  try {
    urlPathOnly = new URL(params.url).pathname;
  } catch {
    // Conserva string seguro si ya es relativo
  }

  const matchedSafeKeys: string[] = [];
  const state: {
    backendPathOnly: string | null;
    backendStatus: number | null;
    extractedSku: string | null;
    detectedCartItemCount: number | null;
    detectedOutOfStockMessage: string | null;
    explicitErrorText: string | null;
    explicitInStockBool: boolean | null;
    hasExplicitReservationSuccessKey: boolean;
    hasExplicitCartAddedKey: boolean;
  } = {
    backendPathOnly: null,
    backendStatus: null,
    extractedSku: extractSkuFromBackendPath(urlPathOnly),
    detectedCartItemCount: null,
    detectedOutOfStockMessage: null,
    explicitErrorText: null,
    explicitInStockBool: null,
    hasExplicitReservationSuccessKey: false,
    hasExplicitCartAddedKey: false,
  };

  const visit = (node: unknown, depth: number): void => {
    if (depth > 5 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (!state.detectedOutOfStockMessage && containsOutOfStockMessage(node)) {
        state.detectedOutOfStockMessage = node.slice(0, 240);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 25)) {
        visit(item, depth + 1);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const [rawKey, value] of Object.entries(node as Record<string, unknown>)) {
        const lowerKey = rawKey.toLowerCase();

        // Descarta estrictamente claves privadas o de sesión/reserva (ej. reservationId, cookies, tokens)
        if (FORBIDDEN_PRIVATE_KEYS.has(lowerKey)) {
          continue;
        }

        if (lowerKey === 'be_path' && typeof value === 'string') {
          matchedSafeKeys.push(rawKey);
          state.backendPathOnly = value.split('?')[0].slice(0, 240);
          const skuFromBe = extractSkuFromBackendPath(state.backendPathOnly);
          if (skuFromBe) state.extractedSku = skuFromBe;
          continue;
        }

        if (lowerKey === 'backendstatus' && typeof value === 'number') {
          matchedSafeKeys.push(rawKey);
          state.backendStatus = value;
          continue;
        }

        if ((lowerKey === 'sku' || lowerKey === 'skuid' || lowerKey === 'variantid') && typeof value === 'string') {
          matchedSafeKeys.push(rawKey);
          if (!state.extractedSku && value.trim()) {
            state.extractedSku = value.trim().slice(0, 128);
          }
          continue;
        }

        if (lowerKey === 'error' && typeof value === 'string') {
          matchedSafeKeys.push(rawKey);
          state.explicitErrorText = value.slice(0, 240);
          if (!state.detectedOutOfStockMessage && containsOutOfStockMessage(value)) {
            state.detectedOutOfStockMessage = value.slice(0, 240);
          }
          continue;
        }

        if (
          typeof value === 'boolean' &&
          [
            'instock',
            'in_stock',
            'available',
            'reserved',
            'reservationconfirmed',
            'added',
            'itemadded',
          ].includes(lowerKey)
        ) {
          matchedSafeKeys.push(rawKey);
          if (lowerKey === 'reserved' || lowerKey === 'reservationconfirmed') {
            if (value === true) state.hasExplicitReservationSuccessKey = true;
          }
          if (lowerKey === 'added' || lowerKey === 'itemadded') {
            if (value === true) state.hasExplicitCartAddedKey = true;
          }
          if (
            ['instock', 'in_stock', 'available', 'reserved', 'reservationconfirmed'].includes(
              lowerKey
            ) &&
            (state.explicitInStockBool === null || value === false)
          ) {
            state.explicitInStockBool = value;
          }
          continue;
        }

        if (
          typeof value === 'number' &&
          ['cartcount', 'itemcount', 'totalitems', 'cart_items_count'].includes(lowerKey)
        ) {
          matchedSafeKeys.push(rawKey);
          state.detectedCartItemCount = value;
          continue;
        }

        if (typeof value === 'string' && !state.detectedOutOfStockMessage && containsOutOfStockMessage(value)) {
          matchedSafeKeys.push(rawKey);
          state.detectedOutOfStockMessage = value.slice(0, 240);
          continue;
        }

        if (typeof value === 'object' && value !== null) {
          visit(value, depth + 1);
        }
      }
    }
  };

  visit(params.payload, 0);

  const combinedPath = `${urlPathOnly} ${state.backendPathOnly ?? ''}`.toLowerCase();
  const isReservePath =
    combinedPath.includes('/reserve') ||
    combinedPath.includes('stockmanagement') ||
    (state.explicitErrorText?.toLowerCase().includes('reserva de stock') ?? false);
  const isCartSyncPath =
    Boolean(params.isPreviousCartSync) ||
    combinedPath.includes('/cart/sync') ||
    combinedPath.includes('cartsync');
  const isCartPath = combinedPath.includes('/cart');

  const operationKind: StructuredNetworkSignal['operationKind'] = isCartSyncPath
    ? 'cart_sync'
    : isReservePath
      ? 'stock_reserve'
      : isCartPath
        ? 'cart_update'
        : 'catalog_or_other';

  const effectiveBackendStatus = state.backendStatus ?? params.httpStatus;
  const isReservationRejection =
    operationKind === 'stock_reserve' &&
    (effectiveBackendStatus === 422 ||
      effectiveBackendStatus === 409 ||
      Boolean(state.explicitErrorText && /rechaz|reserva/i.test(state.explicitErrorText)));

  // Regla estricta: un contador general (`cartCount`) por sí solo NO confirma reserva ni disponibilidad.
  const isReservationConfirmed =
    !isReservationRejection &&
    !isCartSyncPath &&
    Boolean(state.extractedSku) &&
    operationKind === 'stock_reserve' &&
    effectiveBackendStatus >= 200 &&
    effectiveBackendStatus < 300 &&
    (state.hasExplicitReservationSuccessKey || state.explicitInStockBool === true);

  // Confirmación de alta en carrito vinculada específicamente a un SKU identificado
  const confirmedVariantInCart =
    !isReservationRejection &&
    !isCartSyncPath &&
    Boolean(state.extractedSku) &&
    operationKind === 'cart_update' &&
    effectiveBackendStatus >= 200 &&
    effectiveBackendStatus < 300 &&
    (state.hasExplicitCartAddedKey ||
      state.explicitInStockBool === true ||
      (state.detectedCartItemCount !== null && state.detectedCartItemCount > 0));

  if (
    matchedSafeKeys.length === 0 &&
    !state.extractedSku &&
    !isReservePath &&
    state.detectedOutOfStockMessage === null &&
    state.detectedCartItemCount === null
  ) {
    return null;
  }

  return {
    urlPathOnly,
    backendPathOnly: state.backendPathOnly,
    extractedSku: state.extractedSku,
    operationKind,
    httpStatus: params.httpStatus,
    backendStatus: state.backendStatus,
    contentType: params.contentType,
    isReservationRejection,
    isReservationConfirmed,
    confirmedVariantInCart,
    detectedCartItemCount: state.detectedCartItemCount,
    detectedOutOfStockMessage: state.detectedOutOfStockMessage,
    observedAtMs: params.observedAtMs ?? Date.now(),
    isPreviousCartSync: isCartSyncPath,
    matchedSafeKeys: Array.from(new Set(matchedSafeKeys)),
  };
}

export interface ReadOnlyObservationInput {
  readonly productId?: string | null;
  readonly selectedVariantId?: string | null;
  readonly buttonState: AddToCartButtonState;
  readonly uiFeedback?: UiFeedbackObservation | null;
  readonly structuredSignals?: StructuredNetworkSignal[];
  readonly httpStatus?: number | null;
  readonly error?: {
    readonly status: Extract<ExtractionStatus, 'blocked' | 'timeout' | 'error'>;
    readonly code: string;
    readonly message: string;
  };
}

export interface AvailabilityAnalysisResult {
  readonly availabilityState: ScraperAvailabilityState;
  readonly classificationReason: AvailabilityClassificationReason;
  readonly correlatedSku: string | null;
  readonly shouldModifyStoredState: boolean;
  readonly evidence: AvailabilityEvidence;
  readonly extractionStatus: ExtractionStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Clasificación de solo lectura (sin interacción de carrito).
 * Reglas estrictas:
 * - Botón habilitado sin otra evidencia -> UNKNOWN (ENABLED_BUTTON_UNVERIFIED).
 * - Botón deshabilitado sin mensaje explícito de agotamiento -> UNKNOWN (DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE).
 * - Error de red, bloqueo HTTP o timeout -> UNKNOWN.
 */
export function analyzeReadOnlyAvailability(
  input: ReadOnlyObservationInput
): AvailabilityAnalysisResult {
  const signals = input.structuredSignals ?? [];
  const selectedVariantId = input.selectedVariantId ?? null;
  const emptyCorrelation: SkuCorrelationResult = {
    matched: false,
    matchType: 'missing_sku',
    selectedVariantId,
    operationSku: null,
    notes: 'Inspección de solo lectura sin operación de reserva.',
  };

  if (input.error) {
    const reason: AvailabilityClassificationReason =
      input.error.status === 'timeout'
        ? 'TIMEOUT'
        : input.error.status === 'blocked'
          ? 'ACCESS_BLOCKED'
          : 'NETWORK_OR_ACCESS_ERROR';
    return {
      availabilityState: 'UNKNOWN',
      classificationReason: reason,
      correlatedSku: null,
      shouldModifyStoredState: false,
      extractionStatus: input.error.status,
      errorCode: input.error.code,
      errorMessage: input.error.message,
      evidence: {
        method: 'error_handler',
        buttonState: input.buttonState,
        correlation: emptyCorrelation,
        matchedMessages: [],
        structuredSignals: signals,
        httpStatus: input.httpStatus ?? null,
        backendStatus: null,
        cartClearedAfterProbe: false,
        notes: `Clasificado como UNKNOWN por incidencia técnica (${input.error.status}): ${input.error.message}`,
      },
    };
  }

  if (input.httpStatus !== undefined && input.httpStatus !== null && input.httpStatus >= 400) {
    const blocked = input.httpStatus === 403 || input.httpStatus === 429;
    return {
      availabilityState: 'UNKNOWN',
      classificationReason: blocked ? 'ACCESS_BLOCKED' : 'NETWORK_OR_ACCESS_ERROR',
      correlatedSku: null,
      shouldModifyStoredState: false,
      extractionStatus: blocked ? 'blocked' : 'error',
      errorCode: `HTTP_${input.httpStatus}`,
      errorMessage: blocked
        ? 'Acceso bloqueado o limitado por control del sitio; no se evaden controles.'
        : `Respuesta HTTP no satisfactoria (${input.httpStatus}).`,
      evidence: {
        method: 'error_handler',
        buttonState: input.buttonState,
        correlation: emptyCorrelation,
        matchedMessages: [],
        structuredSignals: signals,
        httpStatus: input.httpStatus,
        backendStatus: null,
        cartClearedAfterProbe: false,
        notes: `Respuesta HTTP ${input.httpStatus}; clasificado como UNKNOWN.`,
      },
    };
  }

  // Botón deshabilitado sin mensaje explícito de agotamiento -> UNKNOWN (regla tabla sección 2)
  if (input.buttonState === 'disabled') {
    const fbCheck = validateOutOfStockUiFeedback({
      feedback: input.uiFeedback,
      selectedVariantId,
    });
    if (fbCheck.ignoredStaleOrUnrelated) {
      return {
        availabilityState: 'UNKNOWN',
        classificationReason: 'UNASSOCIATED_OR_STALE_MESSAGE_IGNORED',
        correlatedSku: null,
        shouldModifyStoredState: false,
        extractionStatus: 'ok',
        evidence: {
          method: 'read_only_dom',
          buttonState: 'disabled',
          correlation: emptyCorrelation,
          matchedMessages: [],
          structuredSignals: signals,
          httpStatus: input.httpStatus ?? 200,
          backendStatus: null,
          cartClearedAfterProbe: false,
          notes: fbCheck.reason,
        },
      };
    }

    return {
      availabilityState: 'UNKNOWN',
      classificationReason: 'DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE',
      correlatedSku: null,
      shouldModifyStoredState: false,
      extractionStatus: 'ok',
      evidence: {
        method: 'read_only_dom',
        buttonState: 'disabled',
        correlation: emptyCorrelation,
        matchedMessages: fbCheck.matchedText ? [fbCheck.matchedText] : [],
        structuredSignals: signals,
        httpStatus: input.httpStatus ?? 200,
        backendStatus: null,
        cartClearedAfterProbe: false,
        notes:
          'Botón deshabilitado sin rechazo de reserva correlacionado ni confirmación verificable; clasificado como UNKNOWN.',
      },
    };
  }

  // Botón habilitado sin otra evidencia -> UNKNOWN
  return {
    availabilityState: 'UNKNOWN',
    classificationReason: 'ENABLED_BUTTON_UNVERIFIED',
    correlatedSku: null,
    shouldModifyStoredState: false,
    extractionStatus: 'ok',
    evidence: {
      method: 'read_only_dom',
      buttonState: input.buttonState,
      correlation: emptyCorrelation,
      matchedMessages: [],
      structuredSignals: signals,
      httpStatus: input.httpStatus ?? 200,
      backendStatus: null,
      cartClearedAfterProbe: false,
      notes:
        'Botón "Agregar al carrito" habilitado sin evidencia verificable de reserva/carrito; clasificado como UNKNOWN.',
    },
  };
}

/**
 * Evalúa la limpieza posterior a una sonda de carrito.
 * Regla estricta: jamás marca `cartClearedAfterProbe=true` por el mero clic en eliminar;
 * exige confirmación verificable de que el artículo de la variante específica desapareció del carrito.
 */
export function verifyCartCleanupResult(params: {
  removalAttempted: boolean;
  variantPresentBeforeRemoval: boolean;
  variantPresentAfterRemoval: boolean | null;
  removalApiConfirmed?: boolean;
}): CartCleanupVerification {
  const removalApiConfirmed = Boolean(params.removalApiConfirmed);

  if (!params.removalAttempted) {
    return {
      removalAttempted: false,
      variantPresentBeforeRemoval: params.variantPresentBeforeRemoval,
      variantPresentAfterRemoval: params.variantPresentAfterRemoval,
      removalApiConfirmed,
      cartClearedAfterProbe: false,
      notes: 'No se ejecutó limpieza de carrito.',
    };
  }

  if (params.variantPresentAfterRemoval === null) {
    return {
      removalAttempted: true,
      variantPresentBeforeRemoval: params.variantPresentBeforeRemoval,
      variantPresentAfterRemoval: null,
      removalApiConfirmed,
      cartClearedAfterProbe: false,
      notes:
        'Se hizo clic en eliminar, pero no se verificó la desaparición del artículo específico en el carrito; cartClearedAfterProbe permanece false.',
    };
  }

  if (params.variantPresentAfterRemoval === true) {
    return {
      removalAttempted: true,
      variantPresentBeforeRemoval: params.variantPresentBeforeRemoval,
      variantPresentAfterRemoval: true,
      removalApiConfirmed,
      cartClearedAfterProbe: false,
      notes:
        'La variante seguía presente en el carrito tras intentar eliminarla; limpieza NO confirmada.',
    };
  }

  if (!params.variantPresentBeforeRemoval && !removalApiConfirmed) {
    return {
      removalAttempted: true,
      variantPresentBeforeRemoval: false,
      variantPresentAfterRemoval: false,
      removalApiConfirmed: false,
      cartClearedAfterProbe: false,
      notes:
        'No existía evidencia previa de presencia de la variante ni confirmación de eliminación en backend; limpieza no concluyente.',
    };
  }

  return {
    removalAttempted: true,
    variantPresentBeforeRemoval: params.variantPresentBeforeRemoval,
    variantPresentAfterRemoval: false,
    removalApiConfirmed,
    cartClearedAfterProbe: true,
    notes:
      'Eliminación verificada: se comprobó que el artículo de la variante específica desapareció del carrito.',
  };
}

export interface SupervisedCartProbeInput {
  readonly productId: string;
  readonly selectedVariantId: string;
  readonly interactionStartedAtMs: number;
  readonly buttonState: AddToCartButtonState;
  readonly uiFeedback: UiFeedbackObservation | null;
  /** Confirmación específica de que la variante/SKU investigada aparece en el detalle del carrito. */
  readonly cartContainsSelectedVariant: boolean;
  /** Indicador visual genérico de carrito (informativo; insuficiente por sí solo para IN_STOCK). */
  readonly cartSuccessConfirmedInUi?: boolean;
  /** Contadores generales del encabezado (informativos; NUNCA bastan como única evidencia). */
  readonly cartCountBefore: number | null;
  readonly cartCountAfter: number | null;
  /** Resultado verificado de limpieza del carrito (reemplaza el booleano ciego post-clic). */
  readonly cartCleanup?: CartCleanupVerification;
  readonly structuredSignals?: StructuredNetworkSignal[];
  readonly verifiedBundleMappings?: readonly VerifiedBundleSkuMapping[];
  readonly httpStatus?: number | null;
  readonly error?: {
    readonly status: Extract<ExtractionStatus, 'blocked' | 'timeout' | 'error'>;
    readonly code: string;
    readonly message: string;
  };
}

export function assertSupervisedProbeAuthorized(
  auth: SupervisedProbeAuthorization
): void {
  if (!auth.authorized) {
    throw new Error(
      'SUPERVISED_PROBE_UNAUTHORIZED: La prueba de interacción con carrito requiere autorización explícita.'
    );
  }
  if (
    !auth.authorizedBy.trim() ||
    !auth.productId.trim() ||
    !auth.selectedVariantId.trim() ||
    !auth.singleVariantUrl.trim() ||
    !auth.singleVariantKey.trim()
  ) {
    throw new Error(
      'SUPERVISED_PROBE_INVALID_SCOPE: Debes indicar responsable, productId, selectedVariantId, URL y variante única autorizada.'
    );
  }
  if (auth.maxAttempts !== 1 || auth.allowCheckout !== false || auth.allowPurchase !== false) {
    throw new Error(
      'SUPERVISED_PROBE_POLICY_VIOLATION: Solo se permite 1 intento sin checkout ni compra.'
    );
  }
}

/**
 * Evaluador de la interacción supervisada de 6 pasos:
 * 1. productId -> 2. selectedVariantId -> 3. operationSku -> 4. solicitud de reserva
 * -> 5. respuesta del backend -> 6. mensaje visual / presencia específica en carrito y limpieza verificada.
 */
export function evaluateSupervisedCartProbe(
  input: SupervisedCartProbeInput,
  verifiedAtIso: string = new Date().toISOString()
): CartVerificationResult {
  const allSignals = input.structuredSignals ?? [];
  const cleanupVerification = input.cartCleanup
    ? verifyCartCleanupResult({
        removalAttempted: input.cartCleanup.removalAttempted,
        variantPresentBeforeRemoval: input.cartCleanup.variantPresentBeforeRemoval,
        variantPresentAfterRemoval: input.cartCleanup.variantPresentAfterRemoval,
        removalApiConfirmed: input.cartCleanup.removalApiConfirmed,
      })
    : verifyCartCleanupResult({
        removalAttempted: false,
        variantPresentBeforeRemoval: false,
        variantPresentAfterRemoval: null,
        removalApiConfirmed: false,
      });

  const defaultCorrelation: SkuCorrelationResult = {
    matched: false,
    matchType: 'missing_sku',
    selectedVariantId: input.selectedVariantId,
    operationSku: null,
    notes: 'Sin operación de inventario correlacionada.',
  };

  // 1. Error de red, timeout o bloqueo HTTP -> UNKNOWN (sin modificar estado)
  if (input.error) {
    const reason: AvailabilityClassificationReason =
      input.error.status === 'timeout'
        ? 'TIMEOUT'
        : input.error.status === 'blocked'
          ? 'ACCESS_BLOCKED'
          : 'NETWORK_OR_ACCESS_ERROR';
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: reason,
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: defaultCorrelation,
      structuredSignals: allSignals,
      cartClearedAfterProbe: false,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: input.error.status,
      errorMessage: input.error.message,
    };
  }

  if (input.httpStatus !== undefined && input.httpStatus !== null && input.httpStatus >= 400) {
    const blocked = input.httpStatus === 403 || input.httpStatus === 429;
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: blocked ? 'ACCESS_BLOCKED' : 'NETWORK_OR_ACCESS_ERROR',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: defaultCorrelation,
      structuredSignals: allSignals,
      cartClearedAfterProbe: false,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: blocked ? 'blocked' : 'error',
      errorMessage: `HTTP ${input.httpStatus} durante la interacción.`,
    };
  }

  // 2. Botón deshabilitado sin mensaje explícito de agotamiento -> UNKNOWN
  if (input.buttonState === 'disabled') {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: null,
      buttonState: 'disabled',
      cartProbeOutcome: 'button_disabled_no_probe',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: defaultCorrelation,
      structuredSignals: allSignals,
      cartClearedAfterProbe: false,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'ok',
    };
  }

  // 3. Filtrar respuestas de sincronización de carrito previo o anteriores al clic
  const postClickSignals = allSignals.filter(
    (s) => !s.isPreviousCartSync && s.observedAtMs >= input.interactionStartedAtMs
  );
  const onlyStaleCartSyncSignals =
    allSignals.length > 0 && postClickSignals.length === 0;

  if (onlyStaleCartSyncSignals) {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'STALE_CART_SYNC_IGNORED',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: {
        matched: false,
        matchType: 'uncorrelated',
        selectedVariantId: input.selectedVariantId,
        operationSku: allSignals[0]?.extractedSku ?? null,
        notes: 'Se ignoraron respuestas de sincronización de un carrito previo; no se modifica el estado.',
      },
      structuredSignals: allSignals,
      cartClearedAfterProbe: false,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'ok',
    };
  }

  // 4. Validar mensaje visual en el contexto exacto de la interacción actual
  const uiValidation = validateOutOfStockUiFeedback({
    feedback: input.uiFeedback,
    selectedVariantId: input.selectedVariantId,
    interactionStartedAtMs: input.interactionStartedAtMs,
  });

  // 5. Evaluar correlación de SKU en operaciones de reserva / carrito posteriores al clic
  const inventorySignals = postClickSignals.filter(
    (s) => s.operationKind === 'stock_reserve' || s.operationKind === 'cart_update'
  );

  const matchedSignals: StructuredNetworkSignal[] = [];
  let bestCorrelation: SkuCorrelationResult = defaultCorrelation;

  for (const sig of inventorySignals) {
    const corr = correlateVariantWithSku({
      selectedVariantId: input.selectedVariantId,
      operationSku: sig.extractedSku,
      verifiedBundleMappings: input.verifiedBundleMappings,
    });
    if (corr.matched) {
      matchedSignals.push(sig);
      if (!bestCorrelation.matched) {
        bestCorrelation = corr;
      }
    } else if (bestCorrelation.matchType === 'missing_sku') {
      bestCorrelation = corr;
    }
  }

  const primaryMatchedSignal = matchedSignals[0] ?? null;
  const matchedRejectionSignal = matchedSignals.find((s) => s.isReservationRejection) ?? null;
  const matchedConfirmationSignal = matchedSignals.find((s) => s.isReservationConfirmed) ?? null;
  const matchedCartItemSignal = matchedSignals.find((s) => s.confirmedVariantInCart) ?? null;

  // 5a. Si hubo operaciones de reserva/carrito pero NINGUNA corresponde al SKU investigado -> UNKNOWN (no modifica estado)
  if (inventorySignals.length > 0 && matchedSignals.length === 0) {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'UNCORRELATED_SKU',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: bestCorrelation,
      structuredSignals: postClickSignals,
      cartClearedAfterProbe: false,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'ok',
      errorMessage: bestCorrelation.notes,
    };
  }

  // 5b. SKU coincidente + rechazo de reserva (ej. HTTP 422)
  if (matchedRejectionSignal) {
    const hasExplicitOutOfStockMessage =
      uiValidation.validExplicitOutOfStock ||
      containsOutOfStockMessage(matchedRejectionSignal.detectedOutOfStockMessage);

    if (hasExplicitOutOfStockMessage) {
      const detectedMsg =
        uiValidation.matchedText ??
        matchedRejectionSignal.detectedOutOfStockMessage ??
        'Este producto se agotó';
      return {
        productId: input.productId,
        selectedVariantId: input.selectedVariantId,
        correlatedSku: matchedRejectionSignal.extractedSku,
        buttonState: input.buttonState,
        cartProbeOutcome: 'false_positive_out_of_stock',
        effectiveAvailability: mapScraperStateToUiAvailability('OUT_OF_STOCK', input.buttonState),
        availabilityState: 'OUT_OF_STOCK',
        classificationReason: 'EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU',
        shouldModifyStoredState: true,
        detectedFeedbackMessage: detectedMsg,
        correlation: bestCorrelation,
        structuredSignals: postClickSignals,
        cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
        cartCleanupVerification: cleanupVerification,
        verifiedAtIso,
        extractionStatus: 'ok',
      };
    }

    // Regla crítica: HTTP 422 (u otro rechazo de reserva) SIN explicación explícita de agotamiento -> UNKNOWN (RESERVATION_REJECTED)
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: matchedRejectionSignal.extractedSku,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'RESERVATION_REJECTED',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: bestCorrelation,
      structuredSignals: postClickSignals,
      cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'partial',
      errorMessage:
        'Rechazo de reserva (HTTP 422) sin mensaje explícito de agotamiento; registrado como RESERVATION_REJECTED (UNKNOWN).',
    };
  }

  // 5c. SKU coincidente + confirmación positiva de reserva + confirmación ESPECÍFICA de la variante en el carrito -> IN_STOCK
  // IMPORTANTE: un incremento de contador general del carrito (cartCountBefore -> cartCountAfter)
  // o un indicador genérico SIN confirmar la variante específica NO basta para IN_STOCK.
  const variantConfirmedInCart =
    input.cartContainsSelectedVariant || Boolean(matchedCartItemSignal);

  if (matchedConfirmationSignal && variantConfirmedInCart) {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: matchedConfirmationSignal.extractedSku,
      buttonState: input.buttonState,
      cartProbeOutcome: 'confirmed_in_stock',
      effectiveAvailability: 'available_verified',
      availabilityState: 'IN_STOCK',
      classificationReason: 'CONFIRMED_RESERVATION_AND_CART',
      shouldModifyStoredState: true,
      detectedFeedbackMessage: null,
      correlation: bestCorrelation,
      structuredSignals: postClickSignals,
      cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'ok',
    };
  }

  // 5d. Contador general del carrito aumentó pero SIN evidencia de la variante específica -> UNKNOWN
  const onlyGenericCartCounterChanged =
    (input.cartCountBefore !== null &&
      input.cartCountAfter !== null &&
      input.cartCountAfter > input.cartCountBefore) ||
    Boolean(input.cartSuccessConfirmedInUi);

  if (onlyGenericCartCounterChanged && (!matchedConfirmationSignal || !variantConfirmedInCart)) {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: primaryMatchedSignal?.extractedSku ?? null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'CART_COUNTER_ONLY_UNVERIFIED',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: bestCorrelation,
      structuredSignals: postClickSignals,
      cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'partial',
      errorMessage:
        'Un contador general del carrito no es evidencia suficiente de disponibilidad para una variante específica; se requiere confirmación correlacionada de reserva y presencia de la variante.',
    };
  }

  // 6. Mensaje de agotamiento oculto, anterior o ajeno -> descartado, no modifica estado
  if (uiValidation.ignoredStaleOrUnrelated) {
    return {
      productId: input.productId,
      selectedVariantId: input.selectedVariantId,
      correlatedSku: primaryMatchedSignal?.extractedSku ?? null,
      buttonState: input.buttonState,
      cartProbeOutcome: 'not_executed',
      effectiveAvailability: 'unverified',
      availabilityState: 'UNKNOWN',
      classificationReason: 'UNASSOCIATED_OR_STALE_MESSAGE_IGNORED',
      shouldModifyStoredState: false,
      detectedFeedbackMessage: null,
      correlation: bestCorrelation,
      structuredSignals: postClickSignals,
      cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
      cartCleanupVerification: cleanupVerification,
      verifiedAtIso,
      extractionStatus: 'ok',
      errorMessage: uiValidation.reason,
    };
  }

  // 7. Botón habilitado sin confirmación de reserva/carrito -> UNKNOWN
  return {
    productId: input.productId,
    selectedVariantId: input.selectedVariantId,
    correlatedSku: primaryMatchedSignal?.extractedSku ?? null,
    buttonState: input.buttonState,
    cartProbeOutcome: 'not_executed',
    effectiveAvailability: 'unverified',
    availabilityState: 'UNKNOWN',
    classificationReason:
      postClickSignals.length === 0 ? 'ENABLED_BUTTON_UNVERIFIED' : 'INCONCLUSIVE_INTERACTION',
    shouldModifyStoredState: false,
    detectedFeedbackMessage: null,
    correlation: bestCorrelation,
    structuredSignals: postClickSignals,
    cartClearedAfterProbe: cleanupVerification.cartClearedAfterProbe,
    cartCleanupVerification: cleanupVerification,
    verifiedAtIso,
    extractionStatus: 'partial',
    errorMessage:
      'Sin evidencia verificable de reserva o agotamiento correlacionada con la variante seleccionada.',
  };
}

/**
 * Detecta productos previamente monitoreados que desaparecen temporalmente del catálogo.
 */
export function reconcileMissingCatalogProducts(params: {
  previousObservations: RealObservationRecord[];
  discoveredProductIds: Set<string>;
  observedAtIso?: string;
}): RealObservationRecord[] {
  const observedAtIso = params.observedAtIso ?? new Date().toISOString();
  const missingRecords: RealObservationRecord[] = [];

  for (const prev of params.previousObservations) {
    if (!params.discoveredProductIds.has(prev.productId)) {
      missingRecords.push({
        dataOrigin: prev.dataOrigin,
        productId: prev.productId,
        productName: prev.productName,
        brand: prev.brand,
        selectedVariantId: prev.selectedVariantId,
        correlatedSku: prev.correlatedSku,
        variantKey: prev.variantKey,
        variantLabel: prev.variantLabel,
        capacity: prev.capacity,
        color: prev.color,
        currentPriceMxn: prev.currentPriceMxn,
        productUrl: prev.productUrl,
        availabilityState: 'UNKNOWN',
        classificationReason: 'PRODUCT_TEMPORARILY_MISSING',
        uiAvailability: 'unverified',
        evidence: {
          method: 'catalog_reconciliation',
          buttonState: 'not_found',
          correlation: {
            matched: false,
            matchType: 'missing_sku',
            selectedVariantId: prev.selectedVariantId,
            operationSku: null,
            notes: 'Producto ausente temporalmente del listado de catálogo.',
          },
          matchedMessages: [],
          structuredSignals: [],
          httpStatus: null,
          backendStatus: null,
          cartClearedAfterProbe: false,
          notes:
            'El producto desapareció temporalmente del listado de catálogo; se marca UNKNOWN y se conserva el último precio conocido como referencia.',
        },
        observedAtIso,
        extractionResult: {
          status: 'temporarily_missing',
          errorCode: 'PRODUCT_MISSING_FROM_CATALOG',
          errorMessage: 'Producto no listado en la corrida actual del catálogo.',
        },
      });
    }
  }

  return missingRecords;
}
