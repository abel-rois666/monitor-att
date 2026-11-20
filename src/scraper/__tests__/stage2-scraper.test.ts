import fs from 'fs';
import os from 'os';
import path from 'path';
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
  verifyCartCleanupResult,
} from '../availability-analyzer.ts';
import {
  buildRealExtractionRunReport,
  buildRealObservationRecord,
  parseMxnPrice,
  toFirestoreObservationDocument,
} from '../result-store.ts';
import {
  AttCrawleePlaywrightAdapter,
  classifyHydrationOutcome,
  isScraperLiveEnabled,
} from '../crawlee-playwright-adapter.ts';
import {
  ATT_PRICE_CANDIDATE_SELECTORS,
  assertCartProbeSelectorsConfigured,
  assertCatalogSelectorsConfigured,
  assertProductDetailSelectorsConfigured,
  buildSelectorRegistryFromJson,
  isCartProbeSelectorsReady,
  isCatalogSelectorsReady,
  isProductDetailSelectorsReady,
  listMissingPriceSelectors,
  loadSelectorRegistry,
  UNCONFIGURED_ATT_SELECTORS,
} from '../selector-registry.ts';

/**
 * Pruebas unitarias con datos simulados (fixtures) basados en la evidencia confirmada.
 * NOTA: Estas pruebas validan la lógica del motor de disponibilidad, selectores, hidratación
 * y configuración Docker; NO ejecutan tráfico real contra AT&T México ni representan existencias actuales.
 */
describe('AT&T Price Monitor — Etapa 2: Motor de Disponibilidad, Selectores, Hidratación y Docker', () => {
  const originalLiveEnv = process.env.SCRAPER_LIVE_ENABLED;
  const originalSelectorsEnv = process.env.ATT_SELECTORS_FILE;

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
    delete process.env.ATT_SELECTORS_FILE;
  });

  afterEach(() => {
    if (originalLiveEnv === undefined) {
      delete process.env.SCRAPER_LIVE_ENABLED;
    } else {
      process.env.SCRAPER_LIVE_ENABLED = originalLiveEnv;
    }
    if (originalSelectorsEnv === undefined) {
      delete process.env.ATT_SELECTORS_FILE;
    } else {
      process.env.ATT_SELECTORS_FILE = originalSelectorsEnv;
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
        cartContainsSelectedVariant: false,
        cartCountBefore: 0,
        cartCountAfter: 0,
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
    expect(probe.effectiveAvailability).toBe('out_of_stock_false_positive');
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
      cartContainsSelectedVariant: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      structuredSignals: reserveSignal ? [reserveSignal] : [],
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('UNKNOWN');
    expect(probe.classificationReason).toBe('RESERVATION_REJECTED');
    expect(probe.shouldModifyStoredState).toBe(false);
    expect(probe.correlatedSku).toBe(S23_VARIANT_ID);
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
      cartContainsSelectedVariant: false,
      cartSuccessConfirmedInUi: true,
      cartCountBefore: 0,
      cartCountAfter: 1,
      structuredSignals: otherSkuSignal ? [otherSkuSignal] : [],
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('UNKNOWN');
    expect(probe.classificationReason).toBe('UNCORRELATED_SKU');
    expect(probe.shouldModifyStoredState).toBe(false);

    const verifiedCorr = correlateVariantWithSku({
      selectedVariantId: HONOR_VARIANT_ID,
      operationSku: 'OTRO_SKU_VERIFICADO',
      verifiedBundleMappings: [
        {
          commercialVariantId: HONOR_VARIANT_ID,
          internalSku: 'OTRO_SKU_VERIFICADO',
          verified: true,
          verifiedAtIso: '2026-11-20T10:00:00.000Z',
          verificationNotes: 'Fixture de prueba unitaria.',
        },
      ],
    });
    expect(verifiedCorr.matched).toBe(true);
    expect(verifiedCorr.matchType).toBe('verified_bundle_mapping');
  });

  it('Escenario 4: Reserva confirmada + presencia específica en carrito + limpieza verificada -> IN_STOCK', () => {
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
        added: true,
      },
      observedAtMs: interactionStartedAtMs + 420,
    });

    const verifiedCleanup = verifyCartCleanupResult({
      removalAttempted: true,
      variantPresentBeforeRemoval: true,
      variantPresentAfterRemoval: false,
      removalApiConfirmed: true,
    });

    const probe = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartContainsSelectedVariant: true,
      cartCountBefore: 0,
      cartCountAfter: 1,
      cartCleanup: verifiedCleanup,
      structuredSignals: [reserveOk, cartUpdateOk].filter(
        (s): s is NonNullable<typeof s> => s !== null
      ),
      httpStatus: 200,
    });

    expect(probe.availabilityState).toBe('IN_STOCK');
    expect(probe.classificationReason).toBe('CONFIRMED_RESERVATION_AND_CART');
    expect(probe.shouldModifyStoredState).toBe(true);
    expect(probe.cartClearedAfterProbe).toBe(true);
    expect(probe.cartCleanupVerification.variantPresentAfterRemoval).toBe(false);
  });

  it('Escenario 4b (Regla carrito): Limpieza sin verificar desaparición -> cartClearedAfterProbe=false; contador general solo -> UNKNOWN', () => {
    // 1. Clic en eliminar sin verificar si el artículo desapareció -> false
    const unverifiedClick = verifyCartCleanupResult({
      removalAttempted: true,
      variantPresentBeforeRemoval: true,
      variantPresentAfterRemoval: null,
    });
    expect(unverifiedClick.cartClearedAfterProbe).toBe(false);

    // 2. Clic en eliminar pero la variante sigue en el carrito -> false
    const stillInCart = verifyCartCleanupResult({
      removalAttempted: true,
      variantPresentBeforeRemoval: true,
      variantPresentAfterRemoval: true,
    });
    expect(stillInCart.cartClearedAfterProbe).toBe(false);

    // 3. Contador general del carrito sube (0 -> 1) sin confirmación de la variante específica -> UNKNOWN
    const interactionStartedAtMs = 1_700_000_035_000;
    const genericCartSignal = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/cart/summary-fixture',
      httpStatus: 200,
      contentType: 'application/json',
      payload: {
        cartCount: 1,
      },
      observedAtMs: interactionStartedAtMs + 200,
    });
    expect(genericCartSignal?.isReservationConfirmed).toBe(false);
    expect(genericCartSignal?.confirmedVariantInCart).toBe(false);

    const probeCounterOnly = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartContainsSelectedVariant: false,
      cartSuccessConfirmedInUi: true,
      cartCountBefore: 0,
      cartCountAfter: 1,
      cartCleanup: unverifiedClick,
      structuredSignals: [],
      httpStatus: 200,
    });

    expect(probeCounterOnly.availabilityState).toBe('UNKNOWN');
    expect(probeCounterOnly.classificationReason).toBe('CART_COUNTER_ONLY_UNVERIFIED');
    expect(probeCounterOnly.shouldModifyStoredState).toBe(false);
    expect(probeCounterOnly.cartClearedAfterProbe).toBe(false);
  });

  it('Escenario 5 y 6: Botón habilitado sin confirmación y botón deshabilitado sin mensaje -> UNKNOWN', () => {
    const readOnlyEnabled = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'enabled',
      uiFeedback: null,
      httpStatus: 200,
    });
    expect(readOnlyEnabled.availabilityState).toBe('UNKNOWN');
    expect(readOnlyEnabled.classificationReason).toBe('ENABLED_BUTTON_UNVERIFIED');

    const readOnlyDisabled = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'disabled',
      uiFeedback: null,
      httpStatus: 200,
    });
    expect(readOnlyDisabled.availabilityState).toBe('UNKNOWN');
    expect(readOnlyDisabled.classificationReason).toBe(
      'DISABLED_BUTTON_WITHOUT_OUT_OF_STOCK_MESSAGE'
    );
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
          notes: 'Fixture previa.',
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
    expect(missing[0]?.availabilityState).toBe('UNKNOWN');
    expect(missing[0]?.classificationReason).toBe('PRODUCT_TEMPORARILY_MISSING');
    expect(missing[0]?.extractionResult.status).toBe('temporarily_missing');

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
    expect(report.summary.temporarilyMissing).toBe(1);
  });

  it('Escenario 8, 9 y 10: Carrito previo, errores de red/bloqueo y mensajes ajenos/ocultos -> UNKNOWN sin modificar estado', () => {
    const interactionStartedAtMs = 1_700_000_060_000;

    // 8. Carrito previo
    const staleCartSync = inspectStructuredNetworkPayload({
      url: 'https://www.att.com.mx/api/bff/cart/sync',
      httpStatus: 200,
      contentType: 'application/json',
      payload: { sku: S23_VARIANT_ID, inStock: true, cartCount: 2 },
      observedAtMs: interactionStartedAtMs - 1_500,
      isPreviousCartSync: true,
    });
    const probeStale = evaluateSupervisedCartProbe({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      interactionStartedAtMs,
      buttonState: 'enabled',
      uiFeedback: null,
      cartContainsSelectedVariant: false,
      cartCountBefore: 2,
      cartCountAfter: 2,
      structuredSignals: staleCartSync ? [staleCartSync] : [],
      httpStatus: 200,
    });
    expect(probeStale.classificationReason).toBe('STALE_CART_SYNC_IGNORED');
    expect(probeStale.shouldModifyStoredState).toBe(false);

    // 9. Error de red y HTTP 403
    const blocked = analyzeReadOnlyAvailability({
      productId: S23_PRODUCT_ID,
      selectedVariantId: S23_VARIANT_ID,
      buttonState: 'not_found',
      httpStatus: 403,
    });
    expect(blocked.classificationReason).toBe('ACCESS_BLOCKED');
    expect(blocked.shouldModifyStoredState).toBe(false);

    // 10. Mensaje oculto / previo / ajeno
    const hiddenMsg = evaluateSupervisedCartProbe({
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
      cartContainsSelectedVariant: false,
      cartCountBefore: 0,
      cartCountAfter: 0,
      structuredSignals: [],
    });
    expect(hiddenMsg.classificationReason).toBe('UNASSOCIATED_OR_STALE_MESSAGE_IGNORED');
    expect(hiddenMsg.shouldModifyStoredState).toBe(false);
  });

  it('Hidratación: distingue los 6 estados y exige TANTO título COMO precio visibles', () => {
    expect(
      classifyHydrationOutcome({
        httpStatus: 200,
        pageTitle: 'Samsung Galaxy S23 Ultra | AT&T',
        titleVisible: true,
        priceVisible: true,
      }).status
    ).toBe('elements_found');

    // Solo título visible sin precio -> hidratación incompleta (NO elements_found)
    expect(
      classifyHydrationOutcome({
        httpStatus: 200,
        pageTitle: 'Samsung Galaxy S23 Ultra | AT&T',
        titleVisible: true,
        priceVisible: false,
      }).status
    ).toBe('incomplete_hydration');

    // Skeleton visible -> hidratación incompleta
    expect(
      classifyHydrationOutcome({
        httpStatus: 200,
        pageTitle: 'AT&T Market',
        titleVisible: false,
        priceVisible: false,
        skeletonOrLoadingVisible: true,
      }).status
    ).toBe('incomplete_hydration');

    // Cargada sin skeletons ni bloqueo pero sin coincidencias -> loaded_no_matches
    expect(
      classifyHydrationOutcome({
        httpStatus: 200,
        pageTitle: 'AT&T Market',
        titleVisible: false,
        priceVisible: false,
        skeletonOrLoadingVisible: false,
      }).status
    ).toBe('loaded_no_matches');

    // Timeout
    expect(
      classifyHydrationOutcome({
        httpStatus: null,
        pageTitle: '',
        navigationTimedOut: true,
        networkErrorMessage: 'page.goto: Timeout 25000ms exceeded',
        titleVisible: false,
        priceVisible: false,
      }).status
    ).toBe('timeout');

    // Error de red
    expect(
      classifyHydrationOutcome({
        httpStatus: 502,
        pageTitle: 'Bad Gateway',
        titleVisible: false,
        priceVisible: false,
      }).status
    ).toBe('network_error');

    // Acceso rechazado
    expect(
      classifyHydrationOutcome({
        httpStatus: 200,
        pageTitle: 'Solicitud rechazada',
        titleVisible: false,
        priceVisible: false,
      }).status
    ).toBe('access_denied');
  });

  it('Selectores independientes en 3 grupos + carga JSON externa + preflight ficha individual sin requerir catálogo', async () => {
    // 1. Por defecto ningún grupo está validado
    expect(isCatalogSelectorsReady(UNCONFIGURED_ATT_SELECTORS)).toBe(false);
    expect(isProductDetailSelectorsReady(UNCONFIGURED_ATT_SELECTORS)).toBe(false);
    expect(isCartProbeSelectorsReady(UNCONFIGURED_ATT_SELECTORS)).toBe(false);
    expect(listMissingPriceSelectors(UNCONFIGURED_ATT_SELECTORS)).toHaveLength(3);

    // 2. Archivo JSON externo con SOLO productDetail validado (catalog y cartProbe siguen en false)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-selectors-test-'));
    const tmpFile = path.join(tmpDir, 'selectors.fixture.json');
    try {
      fs.writeFileSync(
        tmpFile,
        JSON.stringify({
          groups: {
            catalog: { validated: false, validatedAtIso: null, validatedBy: null },
            productDetail: {
              validated: true,
              validatedAtIso: '2026-11-20T12:00:00.000Z',
              validatedBy: 'qa-fixture',
            },
            cartProbe: { validated: false, validatedAtIso: null, validatedBy: null },
          },
          priceCandidates: {
            // Intento inválido de marcar como validated_playwright con 0 coincidencias debe rechazarse
            currentPrice: {
              selector: ATT_PRICE_CANDIDATE_SELECTORS.currentPrice,
              status: 'validated_playwright',
              lastPlaywrightMatchCount: 0,
            },
          },
          productDetail: {
            titleElement: '[data-fixture="title"]',
            priceElement: '[data-fixture="price"]',
          },
        }),
        'utf8'
      );

      const loaded = loadSelectorRegistry({ filePath: tmpFile });
      expect(loaded.source).toBe('cli_arg');
      expect(isProductDetailSelectorsReady(loaded.registry)).toBe(true);
      expect(isCatalogSelectorsReady(loaded.registry)).toBe(false);
      expect(isCartProbeSelectorsReady(loaded.registry)).toBe(false);
      expect(loaded.registry.priceCandidates.currentPrice.status).toBe('unvalidated_candidate');

      expect(() => assertProductDetailSelectorsConfigured(loaded.registry)).not.toThrow();
      expect(() => assertCatalogSelectorsConfigured(loaded.registry)).toThrow(
        'SCRAPER_SELECTORS_PENDING'
      );
      expect(() => assertCartProbeSelectorsConfigured(loaded.registry)).toThrow(
        'CART_PROBE_SELECTORS_PENDING'
      );

      // Preflight de ficha individual: NO bloquea por catálogo faltante, solo por SCRAPER_LIVE_ENABLED=false
      const adapterWithDetail = new AttCrawleePlaywrightAdapter(loaded.registry);
      const preflight = await adapterWithDetail.inspectSingleProductPriceReadOnly(S23_URL);
      expect(preflight.executedNetworkRequest).toBe(false);
      expect(preflight.blockedByConfiguration).toBe(true);
      expect(preflight.blockedReason).toBe('LIVE_SCRAPING_DISABLED');
      expect(preflight.missingProductDetailSelectors).toHaveLength(0);

      // Preflight con selectores sin configurar (para ambas fichas de referencia) -> explica bloqueo claro
      const unconfiguredAdapter = new AttCrawleePlaywrightAdapter(UNCONFIGURED_ATT_SELECTORS);
      const s23Blocked = await unconfiguredAdapter.inspectSingleProductPriceReadOnly(S23_URL);
      const honorBlocked = await unconfiguredAdapter.inspectSingleProductPriceReadOnly(HONOR_URL);
      expect(s23Blocked.executedNetworkRequest).toBe(false);
      expect(s23Blocked.blockedReason).toBe('PRODUCT_DETAIL_SELECTORS_PENDING');
      expect(s23Blocked.missingProductDetailSelectors).toContain('productDetail.titleElement');
      expect(s23Blocked.missingProductDetailSelectors).toContain('productDetail.priceElement');
      expect(honorBlocked.productId).toBe(HONOR_PRODUCT_ID);
      expect(honorBlocked.selectedVariantId).toBe(HONOR_VARIANT_ID);
      expect(honorBlocked.blockedReason).toBe('PRODUCT_DETAIL_SELECTORS_PENDING');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 3. Archivo inexistente debe fallar de forma explícita
    expect(() =>
      loadSelectorRegistry({ filePath: '/ruta/inexistente/selectors.json' })
    ).toThrow('SELECTOR_CONFIG_NOT_FOUND');

    // 4. JSON inválido (no objeto) debe fallar explícitamente
    expect(() => buildSelectorRegistryFromJson([])).toThrow('SELECTOR_CONFIG_INVALID');
  });

  it('Docker, dependencias, Firestore limpio y guardas de cumplimiento (SCRAPER_LIVE_ENABLED=false)', async () => {
    // 1. Verificar coherencia de Dockerfile y worker/package.json (resolución ESM + versión exacta Playwright)
    const dockerfile = fs.readFileSync(path.resolve(process.cwd(), 'worker', 'Dockerfile'), 'utf8');
    const workerPkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'worker', 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> };

    const imageMatch = dockerfile.match(/FROM\s+mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/);
    expect(imageMatch).not.toBeNull();
    const dockerPlaywrightVersion = imageMatch?.[1];
    // Versión exacta sin prefijo ^ ni ~ para garantizar compatibilidad con /ms-playwright
    expect(workerPkg.dependencies.playwright).toBe(dockerPlaywrightVersion);
    expect(dockerfile).toContain('COPY worker/package.json ./package.json');
    expect(dockerfile).toContain('ENV SCRAPER_LIVE_ENABLED=false');
    expect(dockerfile).toContain('--mode=status');

    // 2. Identificadores URL y Firestore sanitizado
    expect(extractAttProductIdentifiersFromUrl(S23_URL)).toEqual({
      productId: S23_PRODUCT_ID,
      variantId: S23_VARIANT_ID,
    });
    expect(extractSkuFromBackendPath(S23_REAL_EVIDENCE_422_PAYLOAD.BE_Path)).toBe(S23_VARIANT_ID);
    expect(ATT_REFERENCE_PRODUCTS).toHaveLength(2);

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
          notes: 'Fixture.',
        },
        matchedMessages: [ATT_OUT_OF_STOCK_FULL_MESSAGE],
        structuredSignals: [],
        httpStatus: 422,
        backendStatus: 422,
        cartClearedAfterProbe: false,
        notes: 'Fixture.',
      },
      observedAtIso: '2026-11-20T12:00:00.000Z',
      extractionStatus: 'ok',
    });
    const firestoreDoc = toFirestoreObservationDocument(obs);
    expect(JSON.stringify(firestoreDoc)).not.toMatch(/cookie|token|sessionId|reservationId/i);

    // 3. Guardas de ejecución en vivo
    expect(isScraperLiveEnabled()).toBe(false);
    const adapter = new AttCrawleePlaywrightAdapter();
    await expect(adapter.discoverProducts()).rejects.toThrow('LIVE_SCRAPING_DISABLED');
    await expect(adapter.inspectProductHydrationReadOnly(S23_URL)).rejects.toThrow(
      'LIVE_SCRAPING_DISABLED'
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
