import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ATT_OUT_OF_STOCK_FULL_MESSAGE,
  ATT_OUT_OF_STOCK_PHRASE,
  ATT_REFERENCE_PRODUCTS,
  containsOutOfStockMessage,
  resolveEffectiveAvailability,
} from '../contracts.ts';
import {
  analyzeReadOnlyAvailability,
  assertSupervisedProbeAuthorized,
  correlateVariantWithSku,
  evaluateSupervisedCartProbe,
  extractAttProductIdentifiersFromUrl,
  extractSkuFromBackendPath,
  inspectStructuredNetworkPayload,
  reconcileMissingCatalogProducts,
} from '../availability-analyzer.ts';
import {
  buildRealExtractionRunReport,
  buildRealObservationRecord,
  parseMxnPrice,
  toFirestoreObservationDocument,
} from '../result-store.ts';
import {
  AttCrawleePlaywrightAdapter,
  isScraperLiveEnabled,
} from '../crawlee-playwright-adapter.ts';
import {
  ATT_PRICE_CANDIDATE_SELECTORS,
  assertDiscoverySelectorsConfigured,
  listMissingPriceSelectors,
  UNCONFIGURED_ATT_SELECTORS,
} from '../selector-registry.ts';

/**
 * Pruebas unitarias con datos simulados (fixtures) basados en la evidencia confirmada.
 * NOTA: Estas pruebas validan la lógica del motor de disponibilidad y NO representan
 * verificaciones en vivo ni existencias actuales en AT&T México.
 */
describe('AT&T Price Monitor — Etapa 2: Motor de Disponibilidad, Correlación SKU y Guardas', () => {
  const originalLiveEnv = process.env.SCRAPER_LIVE_ENABLED;

  const S23_URL =
    'https://www.att.com.mx/market/destacados/products/BF_GALAXY_S23_ULTRA?variant=BF_N.S23U512BK';
  const S23_PRODUCT_ID = 'BF_GALAXY_S23_ULTRA';
  const S23_VARIANT_ID = 'BF_N.S23U512BK';

  const HONOR_URL =
    'https://www.att.com.mx/market/destacados/products/BF_BUNDLE_HONOR_MAGIC6_PRO?variant=BF_N.M6PBPX9B';
  const HONOR_PRODUCT_ID = 'BF_BUNDLE_HONOR_MAGIC6_PRO';
  const HONOR_VARIANT_ID = 'BF_N.M6PBPX9B';

  const S23_REAL_EVIDENCE_422_PAYLOAD = {
    error: 'El backend rechazó la solicitud de reserva de stock',
    BE_Path: '/PROD_ATT_MX/stockManagement/v1/stockKeepingUnits/BF_N.S23U512BK/reserve',
    backendStatus: 422,
    backendStatusText: '',
    backendBody: '',
  };

  beforeEach(() => {
    delete process.env.SCRAPER_LIVE_ENABLED;
  });

  afterEach(() => {
    if (originalLiveEnv === undefined) {
      delete process.env.SCRAPER_LIVE_ENABLED;
    } else {
      process.env.SCRAPER_LIVE_ENABLED = originalLiveEnv;
    }
  });

  it('Escenario 1: SKU correcto + HTTP 422 + mensaje explícito de agotamiento -> OUT_OF_STOCK', () => {
    const interactionStartedAtMs = 1_700_000_000_000;
    const reserveSignal = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/stock-reserve-fixture',
      httpStatus: 422,
      contentType: 'application/json; charset=utf-8',
      payload: S23_REAL_EVIDENCE_422_PAYLOAD,
      observedAtMs: interactionStartedAtMs + 450,
    });

    expect(reserveSignal).not.toBeNull();
    expect(reserveSignal?.extractedSku).toBe(S23_VARIANT_ID);
    expect(reserveSignal?.backendStatus).toBe(422);
    expect(reserveSignal?.operationKind).toBe('stock_reserve');
    expect(reserveSignal?.isReservationRejection).toBe(true);

    const probe = evaluateSupervisedCartProbe(
      {
        productId: S23_PRODUCT_ID,
        selectedVariantId: S23_VARIANT_ID,
        interactionStartedAtMs,
        buttonState: 'enabled',
        uiFeedback: {
          text: ATT_OUT_OF_STOCK_FULL_MESSAGE,
          isVisible: true,
          observedAfterInteraction: true,
          belongsToCurrentInteraction: true,
          observedAtMs: interactionStartedAtMs + 600,
          correlatedVariantId: S23_VARIANT_ID,
        },
        cartSuccessConfirmedInUi: false,
        cartCountBefore: 0,
        cartCountAfter: 0,
        cartClearedAfterProbe: false,
        structuredSignals: reserveSignal ? [reserveSignal] : [],
        httpStatus: 200,
      },
      '2026-11-20T10:00:00.000Z'
    );

    expect(probe.availabilityState).toBe('OUT_OF_STOCK');
    expect(probe.classificationReason).toBe('EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU');
    expect(probe.shouldModifyStoredState).toBe(true);
    expect(probe.correlatedSku).toBe(S23_VARIANT_ID);
    expect(probe.correlation.matched).toBe(true);
    expect(probe.correlation.matchType).toBe('exact_variant_sku');
    expect(probe.effectiveAvailability).toBe('out_of_stock_false_positive');
    expect(probe.detectedFeedbackMessage).toBe(ATT_OUT_OF_STOCK_FULL_MESSAGE);

    // También debe detectar "Este producto se agotó" aunque cambie el texto promocional circundante
    expect(containsOutOfStockMessage('Lo sentimos: este producto se agoto por el momento.')).toBe(
      true
    );
    expect(
      resolveEffectiveAvailability('enabled', 'false_positive_out_of_stock', ATT_OUT_OF_STOCK_PHRASE)
    ).toBe('out_of_stock_false_positive');
  });

  it('Escenario 2: SKU correcto + HTTP 422 sin motivo adicional -> UNKNOWN con motivo RESERVATION_REJECTED', () => {
    const interactionStartedAtMs = 1_700_000_010_000;
    const reserveSignal = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/stock-reserve-fixture',
      httpStatus: 422,
      contentType: 'application/json',
      payload: S23_REAL_EVIDENCE_422_PAYLOAD,
      observedAtMs: interactionStartedAtMs + 300,
    });

    const probe = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      cartClearedAfterProbe: false,
      structuredSignals: reserveSignal ? [reserveSignal] : [],
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('UNKNOWN');
    expect(probe.classificationReason).toBe('RESERVATION_REJECTED');
    expect(probe.shouldModifyStoredState).toBe(false);
    expect(probe.correlatedSku).toBe(S23_VARIANT_ID);
    expect(probe.effectiveAvailability).toBe('unverified');
  });

  it('Escenario 3: SKU diferente sin mapeo verificado (HONOR Magic6 Pro bundle) -> UNKNOWN y sin persistir reservationId', () => {
    const interactionStartedAtMs = 1_700_000_020_000;
    const otherSkuSignal = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/stock-reserve-fixture',
      httpStatus: 200,
      contentType: 'application/json',
      payload: {
        BE_Path: '/PROD_ATT_MX/stockManagement/v1/stockKeepingUnits/OTRO_SKU_NO_VERIFICADO/reserve',
        backendStatus: 200,
        reserved: true,
        reservationId: 'res_secret_123456',
        sessionId: 'sess_secret_987654',
        cookie: 'private_cookie_value',
        token: 'jwt_secret_token',
      },
      observedAtMs: interactionStartedAtMs + 250,
    });

    expect(otherSkuSignal).not.toBeNull();
    expect(otherSkuSignal?.extractedSku).toBe('OTRO_SKU_NO_VERIFICADO');

    // Garantía de privacidad: jamás retiene reservationId, sessionId, cookie ni token
    const serializedSignal = JSON.stringify(otherSkuSignal);
    expect(serializedSignal).not.toContain('res_secret_123456');
    expect(serializedSignal).not.toContain('sess_secret_987654');
    expect(serializedSignal).not.toContain('private_cookie_value');
    expect(serializedSignal).not.toContain('jwt_secret_token');

    const probe = evaluateSupervisedCartProbe({
      productId: HONOR_PRODUCT_ID,
      selectedVariantId: HONOR_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: true,
      cartCountBefore: 0,
      cartCountAfter: 1,
      cartClearedAfterProbe: false,
      structuredSignals: otherSkuSignal ? [otherSkuSignal] : [],
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('UNKNOWN');
    expect(probe.classificationReason).toBe('UNCORRELATED_SKU');
    expect(probe.shouldModifyStoredState).toBe(false);
    expect(probe.correlatedSku).toBeNull();
    expect(probe.correlation.matched).toBe(false);
    expect(probe.correlation.matchType).toBe('uncorrelated');

    // Solo si existe un mapeo de bundle verificado explícitamente se acepta la correlación
    const verifiedCorr = correlateVariantWithSku({
      selectedVariantId: HONOR_VARIANT_ID,
      operationSku: 'OTRO_SKU_VERIFICADO',
      verifiedBundleMappings: [
        {
          commercialVariantId: HONOR_VARIANT_ID,
          internalSku: 'OTRO_SKU_VERIFICADO',
          verified: true,
          verifiedAtIso: '2026-11-20T10:00:00.000Z',
          verificationNotes: 'Fixture de prueba unitaria para validar el mecanismo de mapeo.',
        },
      ],
    });
    expect(verifiedCorr.matched).toBe(true);
    expect(verifiedCorr.matchType).toBe('verified_bundle_mapping');
  });

  it('Escenario 4: Reserva confirmada + carrito actualizado para la variante coincidente -> IN_STOCK', () => {
    const interactionStartedAtMs = 1_700_000_030_000;
    const reserveOk = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/stock-reserve-fixture',
      httpStatus: 200,
      contentType: 'application/json',
      payload: {
        BE_Path: `/PROD_ATT_MX/stockManagement/v1/stockKeepingUnits/${S23_VARIANT_ID}/reserve`,
        backendStatus: 200,
        reserved: true,
      },
      observedAtMs: interactionStartedAtMs + 220,
    });

    const cartUpdateOk = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/cart/items-fixture',
      httpStatus: 200,
      contentType: 'application/json',
      payload: {
        sku: S23_VARIANT_ID,
        cartCount: 1,
      },
      observedAtMs: interactionStartedAtMs + 420,
    });

    const probe = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: true,
      cartCountBefore: 0,
      cartCountAfter: 1,
      cartClearedAfterProbe: true,
      structuredSignals: [reserveOk, cartUpdateOk].filter((s): s is NonNullable<typeof s> => s !== null),
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('IN_STOCK');
    expect(probe.classificationReason).toBe('CONFIRMED_RESERVATION_AND_CART');
    expect(probe.shouldModifyStoredState).toBe(true);
    expect(probe.correlatedSku).toBe(S23_VARIANT_ID);
    expect(probe.effectiveAvailability).toBe('available_verified');
    expect(probe.cartClearedAfterProbe).toBe(true);
  });

  it('Escenario 5: Botón "Agregar al carrito" habilitado sin confirmación -> UNKNOWN', () => {
    const readOnly = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'enabled',
      uiFeedback: null,
      httpStatus: 200,
    });
    expect(readOnly.availabilityState).toBe('UNKNOWN');
    expect(readOnly.classificationReason).toBe('ENABLED_BUTTON_UNVERIFIED');
    expect(readOnly.shouldModifyStoredState).toBe(false);

    const probeNoSignals = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs: 1_700_000_040_000,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      cartClearedAfterProbe: false,
      structuredSignals: [],
      httpStatus: 200,
    });
    expect(probeNoSignals.availabilityState).toBe('UNKNOWN');
    expect(probeNoSignals.classificationReason).toBe('ENABLED_BUTTON_UNVERIFIED');
    expect(probeNoSignals.shouldModifyStoredState).toBe(false);
  });

  it('Escenario 6: Botón deshabilitado sin mensaje explícito de agotamiento -> UNKNOWN', () => {
    const readOnly = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'disabled',
      uiFeedback: null,
      httpStatus: 200,
    });
    expect(readOnly.availabilityState).toBe('UNKNOWN');
    expect(readOnly.classificationReason).toBe('DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE');
    expect(readOnly.shouldModifyStoredState).toBe(false);

    const probeDisabled = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs: 1_700_000_050_000,
      buttonState: 'disabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: false,
      cartCountBefore: null,
      cartCountAfter: null,
      cartClearedAfterProbe: false,
      structuredSignals: [],
      httpStatus: 200,
    });
    expect(probeDisabled.availabilityState).toBe('UNKNOWN');
    expect(probeDisabled.classificationReason).toBe('DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE');
    expect(probeDisabled.shouldModifyStoredState).toBe(false);
  });

  it('Escenario 7: Producto ausente temporalmente del catálogo -> UNKNOWN / temporarily_missing', () => {
    const previousRecord = buildRealObservationRecord({
      dataOrigin: 'simulated_fixture',
      productId: S23_PRODUCT_ID,
      productName: 'Samsung Galaxy S23 Ultra 512 GB',
      brand: 'Samsung',
      selectedVariantId: S23_VARIANT_ID,
      correlatedSku: S23_VARIANT_ID,
      variantKey: `${S23_PRODUCT_ID}:${S23_VARIANT_ID}`,
      capacity: '512 GB',
      color: 'Negro',
      currentPriceMxn: parseMxnPrice('$24,999.00 MXN'),
      productUrl: S23_URL,
      availabilityState: 'OUT_OF_STOCK',
      classificationReason: 'EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU',
      evidence: {
        method: 'supervised_cart_probe',
        buttonState: 'enabled',
        correlation: {
          matched: true,
          matchType: 'exact_variant_sku',
          selectedVariantId: S23_VARIANT_ID,
          operationSku: S23_VARIANT_ID,
          notes: 'Fixture previa de prueba.',
        },
        matchedMessages: [ATT_OUT_OF_STOCK_FULL_MESSAGE],
        structuredSignals: [],
        httpStatus: 422,
        backendStatus: 422,
        cartClearedAfterProbe: false,
        notes: 'Fixture previa.',
      },
      extractionStatus: 'ok',
    });

    const missing = reconcileMissingCatalogProducts({
      previousObservations: [previousRecord],
      discoveredProductIds: new Set([HONOR_PRODUCT_ID]),
      observedAtIso: '2026-11-20T11:00:00.000Z',
    });

    expect(missing).toHaveLength(1);
    expect(missing[0]?.productId).toBe(S23_PRODUCT_ID);
    expect(missing[0]?.availabilityState).toBe('UNKNOWN');
    expect(missing[0]?.classificationReason).toBe('PRODUCT_TEMPORARILY_MISSING');
    expect(missing[0]?.extractionResult.status).toBe('temporarily_missing');
    expect(missing[0]?.currentPriceMxn).toBe(24999);

    const report = buildRealExtractionRunReport({
      dataOrigin: 'simulated_fixture',
      runId: 'unit_test_missing_01',
      mode: 'read_only_discovery',
      targetCatalogUrl: 'https://www.att.com.mx/market/destacados',
      startedAtIso: '2026-11-20T11:00:00.000Z',
      scraperLiveEnabled: false,
      selectorsConfigured: false,
      observations: missing,
    });
    expect(report.schemaVersion).toBe('2.1');
    expect(report.summary.unknown).toBe(1);
    expect(report.summary.temporarilyMissing).toBe(1);
  });

  it('Escenario 8: Respuesta de sincronización de carrito previo -> ignorada y no modifica disponibilidad', () => {
    const interactionStartedAtMs = 1_700_000_060_000;
    const staleCartSync = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/cart/sync',
      httpStatus: 200,
      contentType: 'application/json',
      payload: {
        sku: S23_VARIANT_ID,
        inStock: true,
        cartCount: 2,
      },
      observedAtMs: interactionStartedAtMs - 1_500,
      isPreviousCartSync: true,
    });

    expect(staleCartSync?.operationKind).toBe('cart_sync');
    expect(staleCartSync?.isPreviousCartSync).toBe(true);

    const probe = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 2,
      cartCountAfter: 2,
      cartClearedAfterProbe: false,
      structuredSignals: staleCartSync ? [staleCartSync] : [],
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('UNKNOWN');
    expect(probe.classificationReason).toBe('STALE_CART_SYNC_IGNORED');
    expect(probe.shouldModifyStoredState).toBe(false);
  });

  it('Escenario 9: Error de red, timeout o bloqueo HTTP 403/429 -> UNKNOWN sin modificar estado', () => {
    const timeoutReadOnly = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'not_found',
      error: {
        status: 'timeout',
        code: 'NAVIGATION_TIMEOUT',
        message: 'page.goto: Timeout 25000ms exceeded',
      },
    });
    expect(timeoutReadOnly.availabilityState).toBe('UNKNOWN');
    expect(timeoutReadOnly.classificationReason).toBe('TIMEOUT');
    expect(timeoutReadOnly.shouldModifyStoredState).toBe(false);

    const blocked403 = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'not_found',
      httpStatus: 403,
    });
    expect(blocked403.availabilityState).toBe('UNKNOWN');
    expect(blocked403.classificationReason).toBe('ACCESS_BLOCKED');
    expect(blocked403.extractionStatus).toBe('blocked');
    expect(blocked403.shouldModifyStoredState).toBe(false);

    const probeNetworkError = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs: 1_700_000_070_000,
      buttonState: 'enabled',
      uiFeedback: null,
      cartSuccessConfirmedInUi: false,
      cartCountBefore: null,
      cartCountAfter: null,
      cartClearedAfterProbe: false,
      error: {
        status: 'error',
        code: 'NET_ERR_CONNECTION_RESET',
        message: 'Error de red durante la carga',
      },
    });
    expect(probeNetworkError.availabilityState).toBe('UNKNOWN');
    expect(probeNetworkError.classificationReason).toBe('NETWORK_OR_ACCESS_ERROR');
    expect(probeNetworkError.shouldModifyStoredState).toBe(false);
  });

  it('Escenario 10: Mensaje de agotamiento previo, oculto o de otra sección -> descartado, no modifica estado', () => {
    const interactionStartedAtMs = 1_700_000_080_000;

    // 10a. Mensaje preexistente antes del clic
    const preExisting = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: {
        text: ATT_OUT_OF_STOCK_FULL_MESSAGE,
        isVisible: true,
        observedAfterInteraction: false,
        belongsToCurrentInteraction: true,
        observedAtMs: interactionStartedAtMs - 500,
      },
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      cartClearedAfterProbe: false,
      structuredSignals: [],
    });
    expect(preExisting.availabilityState).toBe('UNKNOWN');
    expect(preExisting.classificationReason).toBe('UNASSOCIATED_OR_STALE_MESSAGE_IGNORED');
    expect(preExisting.shouldModifyStoredState).toBe(false);

    // 10b. Elemento oculto en el DOM
    const hiddenMessage = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: {
        text: ATT_OUT_OF_STOCK_PHRASE,
        isVisible: false,
        observedAfterInteraction: true,
        belongsToCurrentInteraction: true,
        observedAtMs: interactionStartedAtMs + 200,
      },
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      cartClearedAfterProbe: false,
      structuredSignals: [],
    });
    expect(hiddenMessage.availabilityState).toBe('UNKNOWN');
    expect(hiddenMessage.classificationReason).toBe('UNASSOCIATED_OR_STALE_MESSAGE_IGNORED');
    expect(hiddenMessage.shouldModifyStoredState).toBe(false);

    // 10c. Mensaje en sección no relacionada o de otra variante
    const unrelatedSection = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: {
        text: ATT_OUT_OF_STOCK_FULL_MESSAGE,
        isVisible: true,
        observedAfterInteraction: true,
        belongsToCurrentInteraction: false,
        observedAtMs: interactionStartedAtMs + 300,
        correlatedVariantId: HONOR_VARIANT_ID,
      },
      cartSuccessConfirmedInUi: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      cartClearedAfterProbe: false,
      structuredSignals: [],
    });
    expect(unrelatedSection.availabilityState).toBe('UNKNOWN');
    expect(unrelatedSection.classificationReason).toBe('UNASSOCIATED_OR_STALE_MESSAGE_IGNORED');
    expect(unrelatedSection.shouldModifyStoredState).toBe(false);
  });

  it('Persistencia preparada para Firestore, identificadores de URL, selectores candidatos y guardas de ejecución', async () => {
    // 1. Extracción de productId y variantId de las URLs de referencia reales
    expect(extractAttProductIdentifiersFromUrl(S23_URL)).toEqual({
      productId: S23_PRODUCT_ID,
      variantId: S23_VARIANT_ID,
    });
    expect(extractAttProductIdentifiersFromUrl(HONOR_URL)).toEqual({
      productId: HONOR_PRODUCT_ID,
      variantId: HONOR_VARIANT_ID,
    });
    expect(
      extractSkuFromBackendPath(S23_REAL_EVIDENCE_422_PAYLOAD.BE_Path)
    ).toBe(S23_VARIANT_ID);
    expect(ATT_REFERENCE_PRODUCTS).toHaveLength(2);

    // 2. Selectores candidatos preservados pero marcados como no validados
    expect(UNCONFIGURED_ATT_SELECTORS.configured).toBe(false);
    expect(UNCONFIGURED_ATT_SELECTORS.priceCandidates.title.selector).toBe(
      ATT_PRICE_CANDIDATE_SELECTORS.title
    );
    expect(UNCONFIGURED_ATT_SELECTORS.priceCandidates.currentPrice.selector).toBe(
      ATT_PRICE_CANDIDATE_SELECTORS.currentPrice
    );
    expect(UNCONFIGURED_ATT_SELECTORS.priceCandidates.pricingArea.selector).toBe(
      ATT_PRICE_CANDIDATE_SELECTORS.pricingArea
    );
    expect(listMissingPriceSelectors(UNCONFIGURED_ATT_SELECTORS)).toHaveLength(3);

    // 3. Documento listo para Firestore sin datos privados
    const obs = buildRealObservationRecord({
      dataOrigin: 'simulated_fixture',
      productId: S23_PRODUCT_ID,
      productName: 'Samsung Galaxy S23 Ultra 512 GB',
      brand: 'Samsung',
      selectedVariantId: S23_VARIANT_ID,
      correlatedSku: S23_VARIANT_ID,
      variantKey: `${S23_PRODUCT_ID}:${S23_VARIANT_ID}`,
      capacity: '512 GB',
      color: 'Negro',
      currentPriceMxn: null,
      productUrl: S23_URL,
      availabilityState: 'OUT_OF_STOCK',
      classificationReason: 'EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU',
      evidence: {
        method: 'supervised_cart_probe',
        buttonState: 'enabled',
        correlation: {
          matched: true,
          matchType: 'exact_variant_sku',
          selectedVariantId: S23_VARIANT_ID,
          operationSku: S23_VARIANT_ID,
          notes: 'Correlación exacta verificada en prueba unitaria.',
        },
        matchedMessages: [ATT_OUT_OF_STOCK_FULL_MESSAGE],
        structuredSignals: [],
        httpStatus: 422,
        backendStatus: 422,
        cartClearedAfterProbe: false,
        notes: 'Fixture basada en evidencia confirmada.',
      },
      observedAtIso: '2026-11-20T12:00:00.000Z',
      extractionStatus: 'ok',
    });

    const firestoreDoc = toFirestoreObservationDocument(obs);
    expect(firestoreDoc.productId).toBe(S23_PRODUCT_ID);
    expect(firestoreDoc.selectedVariantId).toBe(S23_VARIANT_ID);
    expect(firestoreDoc.correlatedSku).toBe(S23_VARIANT_ID);
    expect(firestoreDoc.availabilityState).toBe('OUT_OF_STOCK');
    expect(firestoreDoc.classificationReason).toBe('EXPLICIT_OUT_OF_STOCK_WITH_MATCHED_SKU');
    expect(firestoreDoc.dataOrigin).toBe('simulated_fixture');
    expect(JSON.stringify(firestoreDoc)).not.toMatch(/cookie|token|sessionId|reservationId/i);

    // 4. Guardas de cumplimiento: SCRAPER_LIVE_ENABLED=false por defecto
    expect(isScraperLiveEnabled()).toBe(false);
    const adapter = new AttCrawleePlaywrightAdapter();
    await expect(adapter.discoverProducts()).rejects.toThrow('LIVE_SCRAPING_DISABLED');
    await expect(adapter.inspectProductHydrationReadOnly(S23_URL)).rejects.toThrow(
      'LIVE_SCRAPING_DISABLED'
    );
    expect(() => assertDiscoverySelectorsConfigured(UNCONFIGURED_ATT_SELECTORS)).toThrow(
      'SCRAPER_SELECTORS_PENDING'
    );
    expect(() =>
      assertSupervisedProbeAuthorized({
        authorized: false,
        authorizedBy: 'qa',
        reason: 'sin autorizar',
        productId: S23_PRODUCT_ID,
        selectedVariantId: S23_VARIANT_ID,
        singleVariantUrl: S23_URL,
        singleVariantKey: `${S23_PRODUCT_ID}:${S23_VARIANT_ID}`,
        maxAttempts: 1,
        allowCheckout: false,
        allowPurchase: false,
      })
    ).toThrow('SUPERVISED_PROBE_UNAUTHORIZED');
  });
});
