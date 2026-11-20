import { PlaywrightCrawler, Configuration } from 'crawlee';
import type { Page, Response } from 'playwright';
import {
  ATT_OUT_OF_STOCK_FULL_MESSAGE,
  ATT_OUT_OF_STOCK_PHRASE,
  DEFAULT_COMPLIANCE_POLICY,
  type CartAvailabilityVerifier,
  type CartCleanupVerification,
  type CartVerificationResult,
  type CatalogDiscoveryAdapter,
  type CatalogDiscoveryResult,
  type ComplianceGuardConfig,
  type DiscoveredProductRef,
  type ExtractionStatus,
  type HydrationOutcomeStatus,
  type SingleProductPriceInspectionReport,
  type StructuredNetworkSignal,
  type SupervisedProbeAuthorization,
  type UiFeedbackObservation,
  type VerifiedBundleSkuMapping,
} from './contracts.ts';
import {
  assertCartProbeSelectorsConfigured,
  assertCatalogSelectorsConfigured,
  assertProductDetailSelectorsConfigured,
  isCartProbeSelectorsReady,
  isCatalogSelectorsReady,
  isProductDetailSelectorsReady,
  listMissingCartProbeSelectors,
  listMissingCatalogSelectors,
  listMissingPriceSelectors,
  listMissingProductDetailSelectors,
  UNCONFIGURED_ATT_SELECTORS,
  type AttSelectorRegistry,
} from './selector-registry.ts';
import {
  assertSupervisedProbeAuthorized,
  evaluateSupervisedCartProbe,
  extractAttProductIdentifiersFromUrl,
  inspectStructuredNetworkPayload,
  verifyCartCleanupResult,
} from './availability-analyzer.ts';
import { parseMxnPrice } from './result-store.ts';
import type { AddToCartButtonState } from '../shared/types.ts';

/**
 * Adaptador real Crawlee + Playwright para Etapa 2 y Cloud Run Jobs.
 *
 * Controles estrictos:
 * - SCRAPER_LIVE_ENABLED tiene valor predeterminado false (process.env.SCRAPER_LIVE_ENABLED === 'true').
 * - No invoca endpoints internos de AT&T directamente ni evade controles de seguridad.
 * - No realiza compras, checkout ni reintentos repetitivos de carrito.
 * - Valida selectores en 3 grupos independientes: catalog, productDetail y cartProbe.
 * - Verifica explícitamente la desaparición de la variante antes de marcar cartClearedAfterProbe=true.
 */
export function isScraperLiveEnabled(): boolean {
  return process.env.SCRAPER_LIVE_ENABLED === 'true';
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function detectCapacityTokens(text: string): string[] {
  const matches = text.match(/\b(64|128|256|512)\s?GB\b|\b1\s?TB\b/gi) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/\s+/g, ' ').toUpperCase())));
}

export interface HydrationClassificationInput {
  readonly httpStatus: number | null;
  readonly pageTitle: string;
  readonly bodySnippet?: string;
  readonly navigationTimedOut?: boolean;
  readonly networkErrorMessage?: string | null;
  readonly titleVisible: boolean;
  readonly priceVisible: boolean;
  readonly pricingAreaVisible?: boolean;
  readonly skeletonOrLoadingVisible?: boolean;
  readonly nextRootEmpty?: boolean;
  readonly networkIdleTimedOut?: boolean;
}

/**
 * Clasifica de forma determinista el resultado del diagnóstico de hidratación de una ficha:
 * - `access_denied`: HTTP 403/429 o página de control de acceso ("Solicitud rechazada", etc.)
 * - `timeout`: timeout de navegación o espera
 * - `network_error`: error de red / conexión o HTTP >= 400 distinto de acceso rechazado
 * - `elements_found`: título Y precio ambos visibles
 * - `incomplete_hydration`: solo uno apareció, hay skeletons/loading visibles, __next vacío o networkidle expiró sin ambos elementos
 * - `loaded_no_matches`: página cargada e hidratada sin coincidencias visibles en los selectores
 */
export function classifyHydrationOutcome(
  input: HydrationClassificationInput
): { status: HydrationOutcomeStatus; reason: string } {
  const combinedText = `${input.pageTitle} ${input.bodySnippet ?? ''}`;
  const looksBlockedByText =
    /solicitud rechazada|access denied|request rejected|forbidden|bot protection/i.test(
      combinedText
    );

  if (
    input.httpStatus === 403 ||
    input.httpStatus === 429 ||
    looksBlockedByText
  ) {
    return {
      status: 'access_denied',
      reason: `Acceso rechazado por el sitio (HTTP ${input.httpStatus ?? 'N/A'}, título: "${input.pageTitle || 'vacío'}"). No se eluden controles de acceso.`,
    };
  }

  if (input.navigationTimedOut) {
    return {
      status: 'timeout',
      reason: input.networkErrorMessage || 'Tiempo de espera agotado durante la carga o hidratación.',
    };
  }

  if (input.networkErrorMessage) {
    return {
      status: 'network_error',
      reason: input.networkErrorMessage,
    };
  }

  if (input.httpStatus !== null && input.httpStatus >= 400) {
    return {
      status: 'network_error',
      reason: `Respuesta HTTP no satisfactoria (${input.httpStatus}).`,
    };
  }

  // Exige AMBOS: título visible Y precio visible (no basta que aparezca solo un candidato)
  if (input.titleVisible && input.priceVisible) {
    return {
      status: 'elements_found',
      reason: 'Navegación exitosa con título y precio visibles confirmados en el DOM hidratado.',
    };
  }

  const partialMatch =
    input.titleVisible !== input.priceVisible || Boolean(input.pricingAreaVisible);

  if (
    partialMatch ||
    input.skeletonOrLoadingVisible ||
    input.nextRootEmpty ||
    input.networkIdleTimedOut
  ) {
    const details: string[] = [];
    if (input.titleVisible && !input.priceVisible) details.push('título visible pero precio ausente');
    if (!input.titleVisible && input.priceVisible) details.push('precio visible pero título ausente');
    if (input.pricingAreaVisible && (!input.titleVisible || !input.priceVisible)) {
      details.push('pricingArea presente sin título y precio completos');
    }
    if (input.skeletonOrLoadingVisible) details.push('indicadores skeleton/loading activos');
    if (input.nextRootEmpty) details.push('contenedor raíz hidratado vacío');
    if (input.networkIdleTimedOut) details.push('networkidle agotado');

    return {
      status: 'incomplete_hydration',
      reason: `Hidratación incompleta: ${details.join('; ')}.`,
    };
  }

  return {
    status: 'loaded_no_matches',
    reason:
      'Página cargada sin bloqueo ni skeletons activos, pero los selectores de título y precio no produjeron coincidencias visibles.',
  };
}

export interface HydrationDiagnosticReport {
  readonly productUrl: string;
  readonly outcomeStatus: HydrationOutcomeStatus;
  readonly outcomeReason: string;
  readonly httpStatus: number | null;
  readonly pageTitle: string;
  readonly blockedByAccessControl: boolean;
  readonly titleVisible: boolean;
  readonly priceVisible: boolean;
  readonly extractedTitle: string | null;
  readonly extractedRawPrice: string | null;
  readonly extractedPriceMxn: number | null;
  readonly skeletonOrLoadingDetected: boolean;
  readonly networkIdleTimedOut: boolean;
  readonly candidateMatches: {
    readonly title: { selector: string; count: number; visible: boolean; sampleText: string | null };
    readonly currentPrice: {
      selector: string;
      count: number;
      visible: boolean;
      sampleText: string | null;
    };
    readonly pricingArea: {
      selector: string;
      count: number;
      visible: boolean;
      sampleText: string | null;
    };
  };
  readonly iframeCount: number;
  readonly observedAtIso: string;
}

export class AttCrawleePlaywrightAdapter
  implements CatalogDiscoveryAdapter, CartAvailabilityVerifier
{
  private readonly selectors: AttSelectorRegistry;
  private readonly policy: ComplianceGuardConfig;
  private readonly verifiedBundleMappings: readonly VerifiedBundleSkuMapping[];
  private readonly selectorSourceLabel: string;

  constructor(
    selectors: AttSelectorRegistry = UNCONFIGURED_ATT_SELECTORS,
    policy: ComplianceGuardConfig = DEFAULT_COMPLIANCE_POLICY,
    verifiedBundleMappings: readonly VerifiedBundleSkuMapping[] = [],
    selectorSourceLabel: string = 'default_unconfigured'
  ) {
    this.selectors = selectors;
    this.policy = policy;
    this.verifiedBundleMappings = verifiedBundleMappings;
    this.selectorSourceLabel = selectorSourceLabel;
  }

  public getDiagnostics() {
    const liveFlag = isScraperLiveEnabled();
    const catalogReady = isCatalogSelectorsReady(this.selectors);
    const productDetailReady = isProductDetailSelectorsReady(this.selectors);
    const cartProbeReady = isCartProbeSelectorsReady(this.selectors);

    return {
      adapterName: 'AttCrawleePlaywrightAdapter',
      executionRuntime: 'Cloud Run Job (Crawlee + Playwright)',
      scraperLiveEnabled: liveFlag,
      selectorSource: this.selectorSourceLabel,
      readyForLiveExecution: catalogReady && liveFlag,
      readyForSingleProductInspection: productDetailReady && liveFlag,
      readyForSupervisedCartProbe: cartProbeReady && liveFlag,
      selectorsConfigured: this.selectors.configured,
      selectorGroups: {
        catalog: {
          ready: catalogReady,
          validation: this.selectors.groups.catalog,
          missing: listMissingCatalogSelectors(this.selectors),
        },
        productDetail: {
          ready: productDetailReady,
          validation: this.selectors.groups.productDetail,
          missing: listMissingProductDetailSelectors(this.selectors),
        },
        cartProbe: {
          ready: cartProbeReady,
          validation: this.selectors.groups.cartProbe,
          missing: listMissingCartProbeSelectors(this.selectors),
        },
      },
      priceSelectorsPendingValidation: listMissingPriceSelectors(this.selectors),
      priceCandidateSelectors: this.selectors.priceCandidates,
      policy: this.policy,
      outOfStockSignaturePhrase: ATT_OUT_OF_STOCK_PHRASE,
      outOfStockFullMessage: ATT_OUT_OF_STOCK_FULL_MESSAGE,
    };
  }

  /**
   * Preflight sin tráfico de red para una inspección individual de ficha y precio.
   * Valida únicamente el grupo `productDetail` (independiente de `catalog` y `cartProbe`).
   */
  public preflightSingleProductInspection(
    productUrl: string
  ): SingleProductPriceInspectionReport {
    const ids = extractAttProductIdentifiersFromUrl(productUrl);
    const missingDetail = listMissingProductDetailSelectors(this.selectors);
    const liveEnabled = isScraperLiveEnabled();

    if (missingDetail.length > 0) {
      return {
        mode: 'read_only_single_product',
        executedNetworkRequest: false,
        productUrl,
        productId: ids.productId,
        selectedVariantId: ids.variantId,
        title: null,
        rawPriceText: null,
        currentPriceMxn: null,
        availabilityState: 'UNKNOWN',
        hydrationStatus: 'not_executed',
        blockedByConfiguration: true,
        blockedReason: 'PRODUCT_DETAIL_SELECTORS_PENDING',
        missingProductDetailSelectors: missingDetail,
        selectorSource: this.selectorSourceLabel,
        observedAtIso: new Date().toISOString(),
        notes: `Inspección bloqueada antes de consultar AT&T: faltan selectores validados del grupo "productDetail" (${missingDetail.join(', ')}). El grupo "catalog" NO es requerido para esta prueba.`,
      };
    }

    if (!liveEnabled) {
      return {
        mode: 'read_only_single_product',
        executedNetworkRequest: false,
        productUrl,
        productId: ids.productId,
        selectedVariantId: ids.variantId,
        title: null,
        rawPriceText: null,
        currentPriceMxn: null,
        availabilityState: 'UNKNOWN',
        hydrationStatus: 'not_executed',
        blockedByConfiguration: true,
        blockedReason: 'LIVE_SCRAPING_DISABLED',
        missingProductDetailSelectors: [],
        selectorSource: this.selectorSourceLabel,
        observedAtIso: new Date().toISOString(),
        notes:
          'Los selectores del grupo "productDetail" están configurados, pero SCRAPER_LIVE_ENABLED es false. No se ejecutó tráfico real.',
      };
    }

    return {
      mode: 'read_only_single_product',
      executedNetworkRequest: false,
      productUrl,
      productId: ids.productId,
      selectedVariantId: ids.variantId,
      title: null,
      rawPriceText: null,
      currentPriceMxn: null,
      availabilityState: 'UNKNOWN',
      hydrationStatus: 'not_executed',
      blockedByConfiguration: false,
      blockedReason: null,
      missingProductDetailSelectors: [],
      selectorSource: this.selectorSourceLabel,
      observedAtIso: new Date().toISOString(),
      notes: 'Preflight aprobado para ejecutar inspección de solo lectura en ficha individual.',
    };
  }

  /**
   * Diagnóstico de hidratación de solo lectura en una ficha individual.
   * Espera explícitamente a que TANTO el título COMO el precio sean visibles (`state: 'visible'`),
   * y clasifica el resultado en los 6 estados definidos por `HydrationOutcomeStatus`.
   * Requiere SCRAPER_LIVE_ENABLED === 'true'.
   */
  public async inspectProductHydrationReadOnly(
    productUrl: string
  ): Promise<HydrationDiagnosticReport> {
    this.ensureLiveExecutionAllowed();

    const titleSelector =
      this.selectors.productDetail.titleElement ?? this.selectors.priceCandidates.title.selector;
    const priceSelector =
      this.selectors.productDetail.priceElement ??
      this.selectors.priceCandidates.currentPrice.selector;
    const pricingAreaSelector = this.selectors.priceCandidates.pricingArea.selector;

    let report: HydrationDiagnosticReport | null = null;
    const crawlerConfig = new Configuration({ persistStorage: false });

    const crawler = new PlaywrightCrawler(
      {
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
        maxRequestRetries: 0,
        navigationTimeoutSecs: Math.ceil(this.policy.navigationTimeoutMs / 1000),
        requestHandler: async ({ page, response }) => {
          const httpStatus = response?.status() ?? null;
          let networkIdleTimedOut = false;

          await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
            networkIdleTimedOut = true;
          });

          const pageTitle = await page.title().catch(() => '');
          const bodySnippet = (
            await page.evaluate(() => (document.body?.innerText || '').slice(0, 600)).catch(() => '')
          ).trim();

          // Si el sitio ya devolvió bloqueo o error HTTP, detener inmediatamente sin eludir controles
          const preCheck = classifyHydrationOutcome({
            httpStatus,
            pageTitle,
            bodySnippet,
            titleVisible: false,
            priceVisible: false,
          });

          if (preCheck.status === 'access_denied' || preCheck.status === 'network_error') {
            report = {
              productUrl,
              outcomeStatus: preCheck.status,
              outcomeReason: preCheck.reason,
              httpStatus,
              pageTitle,
              blockedByAccessControl: preCheck.status === 'access_denied',
              titleVisible: false,
              priceVisible: false,
              extractedTitle: null,
              extractedRawPrice: null,
              extractedPriceMxn: null,
              skeletonOrLoadingDetected: false,
              networkIdleTimedOut,
              candidateMatches: {
                title: { selector: titleSelector, count: 0, visible: false, sampleText: null },
                currentPrice: { selector: priceSelector, count: 0, visible: false, sampleText: null },
                pricingArea: {
                  selector: pricingAreaSelector,
                  count: 0,
                  visible: false,
                  sampleText: null,
                },
              },
              iframeCount: Math.max(0, page.frames().length - 1),
              observedAtIso: new Date().toISOString(),
            };
            return;
          }

          // Esperar ESPECÍFICAMENTE a que TANTO el título COMO el precio sean visibles
          await Promise.allSettled([
            page.locator(titleSelector).first().waitFor({ state: 'visible', timeout: 8_000 }),
            page.locator(priceSelector).first().waitFor({ state: 'visible', timeout: 8_000 }),
          ]);

          const inspectLocator = async (selector: string) => {
            const loc = page.locator(selector);
            const count = await loc.count().catch(() => 0);
            const visible = count > 0 ? await loc.first().isVisible().catch(() => false) : false;
            const sampleText =
              count > 0 && visible
                ? (await loc.first().textContent().catch(() => null))?.trim().slice(0, 160) ?? null
                : null;
            return { selector, count, visible, sampleText };
          };

          const titleMatch = await inspectLocator(titleSelector);
          const priceMatch = await inspectLocator(priceSelector);
          const pricingAreaMatch = await inspectLocator(pricingAreaSelector);

          const domSignals = await page
            .evaluate(() => {
              const nextRoot = document.querySelector('#__next, main');
              const nextRootEmpty = nextRoot ? (nextRoot.textContent || '').trim().length < 20 : false;
              const skeletonNodes = document.querySelectorAll(
                '[class*="skeleton" i], [class*="shimmer" i], [aria-busy="true"]'
              );
              const skeletonOrLoadingVisible = Array.from(skeletonNodes).some((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              return { nextRootEmpty, skeletonOrLoadingVisible };
            })
            .catch(() => ({ nextRootEmpty: false, skeletonOrLoadingVisible: false }));

          const outcome = classifyHydrationOutcome({
            httpStatus,
            pageTitle,
            bodySnippet,
            titleVisible: titleMatch.visible && Boolean(titleMatch.sampleText),
            priceVisible: priceMatch.visible && Boolean(priceMatch.sampleText),
            pricingAreaVisible: pricingAreaMatch.visible,
            skeletonOrLoadingVisible: domSignals.skeletonOrLoadingVisible,
            nextRootEmpty: domSignals.nextRootEmpty,
            networkIdleTimedOut,
          });

          report = {
            productUrl,
            outcomeStatus: outcome.status,
            outcomeReason: outcome.reason,
            httpStatus,
            pageTitle,
            blockedByAccessControl: outcome.status === 'access_denied',
            titleVisible: titleMatch.visible,
            priceVisible: priceMatch.visible,
            extractedTitle: titleMatch.visible ? titleMatch.sampleText : null,
            extractedRawPrice: priceMatch.visible ? priceMatch.sampleText : null,
            extractedPriceMxn: priceMatch.visible ? parseMxnPrice(priceMatch.sampleText) : null,
            skeletonOrLoadingDetected: domSignals.skeletonOrLoadingVisible,
            networkIdleTimedOut,
            candidateMatches: {
              title: titleMatch,
              currentPrice: priceMatch,
              pricingArea: pricingAreaMatch,
            },
            iframeCount: Math.max(0, page.frames().length - 1),
            observedAtIso: new Date().toISOString(),
          };
        },
        failedRequestHandler: async ({ error }) => {
          const msg = error instanceof Error ? error.message : String(error);
          const timedOut = /timeout/i.test(msg);
          const outcome = classifyHydrationOutcome({
            httpStatus: null,
            pageTitle: '',
            navigationTimedOut: timedOut,
            networkErrorMessage: msg,
            titleVisible: false,
            priceVisible: false,
          });
          report = {
            productUrl,
            outcomeStatus: outcome.status,
            outcomeReason: outcome.reason,
            httpStatus: null,
            pageTitle: '',
            blockedByAccessControl: false,
            titleVisible: false,
            priceVisible: false,
            extractedTitle: null,
            extractedRawPrice: null,
            extractedPriceMxn: null,
            skeletonOrLoadingDetected: false,
            networkIdleTimedOut: timedOut,
            candidateMatches: {
              title: { selector: titleSelector, count: 0, visible: false, sampleText: null },
              currentPrice: { selector: priceSelector, count: 0, visible: false, sampleText: null },
              pricingArea: {
                selector: pricingAreaSelector,
                count: 0,
                visible: false,
                sampleText: null,
              },
            },
            iframeCount: 0,
            observedAtIso: new Date().toISOString(),
          };
        },
      },
      crawlerConfig
    );

    await crawler.run([productUrl]);

    return (
      report ?? {
        productUrl,
        outcomeStatus: 'network_error',
        outcomeReason: 'La inspección de hidratación finalizó sin respuesta de navegador.',
        httpStatus: null,
        pageTitle: '',
        blockedByAccessControl: false,
        titleVisible: false,
        priceVisible: false,
        extractedTitle: null,
        extractedRawPrice: null,
        extractedPriceMxn: null,
        skeletonOrLoadingDetected: false,
        networkIdleTimedOut: false,
        candidateMatches: {
          title: { selector: titleSelector, count: 0, visible: false, sampleText: null },
          currentPrice: { selector: priceSelector, count: 0, visible: false, sampleText: null },
          pricingArea: {
            selector: pricingAreaSelector,
            count: 0,
            visible: false,
            sampleText: null,
          },
        },
        iframeCount: 0,
        observedAtIso: new Date().toISOString(),
      }
    );
  }

  /**
   * Inspección individual de solo lectura para extraer título, precio actual, variante y URL.
   * Requiere ÚNICAMENTE el grupo `productDetail` validado (no requiere `catalog` ni `cartProbe`)
   * y `SCRAPER_LIVE_ENABLED === 'true'`.
   */
  public async inspectSingleProductPriceReadOnly(
    productUrl: string
  ): Promise<SingleProductPriceInspectionReport> {
    const preflight = this.preflightSingleProductInspection(productUrl);
    if (preflight.blockedByConfiguration) {
      return preflight;
    }

    assertProductDetailSelectorsConfigured(this.selectors);
    this.ensureLiveExecutionAllowed();

    const hydration = await this.inspectProductHydrationReadOnly(productUrl);
    const ids = extractAttProductIdentifiersFromUrl(productUrl);

    return {
      mode: 'read_only_single_product',
      executedNetworkRequest: true,
      productUrl,
      productId: ids.productId,
      selectedVariantId: ids.variantId,
      title: hydration.outcomeStatus === 'elements_found' ? hydration.extractedTitle : null,
      rawPriceText: hydration.outcomeStatus === 'elements_found' ? hydration.extractedRawPrice : null,
      currentPriceMxn:
        hydration.outcomeStatus === 'elements_found' ? hydration.extractedPriceMxn : null,
      availabilityState: 'UNKNOWN',
      hydrationStatus: hydration.outcomeStatus,
      blockedByConfiguration: false,
      blockedReason: hydration.blockedByAccessControl ? 'ACCESS_DENIED' : null,
      missingProductDetailSelectors: [],
      selectorSource: this.selectorSourceLabel,
      observedAtIso: hydration.observedAtIso,
      notes: hydration.outcomeReason,
    };
  }

  /**
   * Fase A: Descubrimiento de solo lectura sobre https://www.att.com.mx/market/destacados.
   * Valida únicamente el grupo `catalog`.
   */
  public async discoverProducts(
    catalogUrl: string = this.policy.targetCatalogUrl
  ): Promise<CatalogDiscoveryResult> {
    const startedAtIso = new Date().toISOString();
    this.ensureLiveExecutionAllowed();
    assertCatalogSelectorsConfigured(this.selectors);

    const discovered: DiscoveredProductRef[] = [];
    const warnings: string[] = [];
    let finalStatus: ExtractionStatus = 'ok';
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    const selectors = this.selectors;
    const crawlerConfig = new Configuration({ persistStorage: false });

    const crawler = new PlaywrightCrawler(
      {
        maxRequestsPerCrawl: 5,
        maxConcurrency: 1,
        maxRequestsPerMinute: this.policy.maxRequestsPerMinute,
        maxRequestRetries: 0,
        navigationTimeoutSecs: Math.ceil(this.policy.navigationTimeoutMs / 1000),
        requestHandler: async ({ page, request, response }) => {
          const httpStatus = response?.status() ?? null;
          if (httpStatus !== null && httpStatus >= 400) {
            finalStatus = httpStatus === 403 || httpStatus === 429 ? 'blocked' : 'error';
            errorCode = `HTTP_${httpStatus}`;
            errorMessage = `Respuesta HTTP ${httpStatus} al consultar el catálogo.`;
            return;
          }

          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
            warnings.push('networkidle agotado; se inspeccionó el DOM renderizado disponible.');
          });

          const pageTitle = await page.title().catch(() => '');
          if (/solicitud rechazada|access denied/i.test(pageTitle)) {
            finalStatus = 'blocked';
            errorCode = 'ACCESS_CONTROL_BLOCKED';
            errorMessage =
              'El sitio devolvió una página de control de acceso; se detiene la corrida sin evasión.';
            return;
          }

          const cardLocator = page.locator(selectors.catalog.productCardContainer!);
          const cardCount = await cardLocator.count();
          if (cardCount === 0) {
            finalStatus = 'partial';
            warnings.push(
              'No se encontraron tarjetas con catalog.productCardContainer; verifica los selectores validados tras hidratación de Next.js.'
            );
            return;
          }

          const nowIso = new Date().toISOString();
          for (let i = 0; i < cardCount; i++) {
            const card = cardLocator.nth(i);
            const titleText = (
              await card
                .locator(selectors.catalog.productCardTitle!)
                .first()
                .textContent()
                .catch(() => null)
            )?.trim();

            const rawHref = await card
              .locator(selectors.catalog.productDetailLink!)
              .first()
              .getAttribute('href')
              .catch(() => null);

            if (!titleText || !rawHref) continue;

            const canonicalUrl = new URL(rawHref, request.loadedUrl || catalogUrl).toString();
            const extractedIds = extractAttProductIdentifiersFromUrl(canonicalUrl);
            const rawPriceText = selectors.catalog.productCardPrice
              ? (
                  await card
                    .locator(selectors.catalog.productCardPrice)
                    .first()
                    .textContent()
                    .catch(() => null)
                )?.trim() ?? null
              : null;

            const brandText = selectors.catalog.productCardBrand
              ? (
                  await card
                    .locator(selectors.catalog.productCardBrand)
                    .first()
                    .textContent()
                    .catch(() => null)
                )?.trim() ?? null
              : null;

            const priceMxn = parseMxnPrice(rawPriceText);
            const capacities = detectCapacityTokens(titleText);
            const slug = slugify(`${brandText ?? ''} ${titleText}`);

            discovered.push({
              productId: extractedIds.productId || slug || `att-item-${i + 1}`,
              canonicalUrl,
              slug,
              brand: brandText,
              modelName: titleText,
              priceMxn,
              rawPriceText,
              capacities,
              colors: [],
              variants:
                capacities.length > 0
                  ? capacities.map((capacity) => ({
                      variantId: extractedIds.variantId,
                      capacity,
                      color: null,
                      priceMxn,
                      variantUrl: canonicalUrl,
                    }))
                  : [
                      {
                        variantId: extractedIds.variantId,
                        capacity: null,
                        color: null,
                        priceMxn,
                        variantUrl: canonicalUrl,
                      },
                    ],
              discoveredAtIso: nowIso,
            });
          }
        },
        failedRequestHandler: async ({ error }) => {
          const msg = error instanceof Error ? error.message : String(error);
          finalStatus = /timeout/i.test(msg) ? 'timeout' : 'error';
          errorCode = finalStatus === 'timeout' ? 'NAVIGATION_TIMEOUT' : 'DISCOVERY_FAILED';
          errorMessage = msg;
        },
      },
      crawlerConfig
    );

    await crawler.run([catalogUrl]);

    return {
      dataOrigin: 'real_extraction',
      catalogUrl,
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      status: finalStatus,
      products: discovered,
      warnings,
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  /**
   * Fase B: Prueba supervisada sobre UNA única variante autorizada con correlación de SKU,
   * confirmación específica de variante en carrito (no solo contador general) y verificación
   * obligatoria de desaparición de la variante antes de reportar `cartClearedAfterProbe=true`.
   */
  public async verifySingleVariantSupervised(
    authorization: SupervisedProbeAuthorization
  ): Promise<CartVerificationResult> {
    this.ensureLiveExecutionAllowed();
    assertSupervisedProbeAuthorized(authorization);
    assertCartProbeSelectorsConfigured(this.selectors);

    const selectors = this.selectors;
    const verifiedMappings = this.verifiedBundleMappings;
    const structuredSignals: StructuredNetworkSignal[] = [];
    let interactionStartedAtMs = Number.MAX_SAFE_INTEGER;
    let result: CartVerificationResult | null = null;
    const crawlerConfig = new Configuration({ persistStorage: false });

    const crawler = new PlaywrightCrawler(
      {
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
        maxRequestRetries: 0,
        navigationTimeoutSecs: Math.ceil(this.policy.navigationTimeoutMs / 1000),
        requestHandler: async ({ page, response }) => {
          const navStatus = response?.status() ?? null;
          if (navStatus !== null && navStatus >= 400) {
            result = evaluateSupervisedCartProbe({
              productId: authorization.productId,
              selectedVariantId: authorization.selectedVariantId,
              interactionStartedAtMs: Date.now(),
              buttonState: 'not_found',
              uiFeedback: null,
              cartContainsSelectedVariant: false,
              cartSuccessConfirmedInUi: false,
              cartCountBefore: null,
              cartCountAfter: null,
              structuredSignals,
              verifiedBundleMappings: verifiedMappings,
              httpStatus: navStatus,
            });
            return;
          }

          const attachPassiveListener = (targetPage: Page) => {
            targetPage.on('response', async (res: Response) => {
              try {
                const observedAtMs = Date.now();
                const ct = res.headers()['content-type'] || '';
                if (!ct.toLowerCase().includes('application/json')) return;
                const json = await res.json().catch(() => null);
                if (!json) return;
                const signal = inspectStructuredNetworkPayload({
                  url: res.url(),
                  httpStatus: res.status(),
                  contentType: ct,
                  payload: json,
                  observedAtMs,
                  isPreviousCartSync: observedAtMs < interactionStartedAtMs,
                });
                if (signal) structuredSignals.push(signal);
              } catch {
                // Observación pasiva: ignora cuerpos no JSON o cerrados
              }
            });
          };

          attachPassiveListener(page);
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

          const addBtn = page.locator(selectors.productDetail.addToCartButton!).first();
          const btnVisible = await addBtn.isVisible().catch(() => false);
          let buttonState: AddToCartButtonState = 'not_found';
          if (btnVisible) {
            const isDisabled = await addBtn.isDisabled().catch(() => true);
            buttonState = isDisabled ? 'disabled' : 'enabled';
          }

          if (buttonState !== 'enabled') {
            result = evaluateSupervisedCartProbe({
              productId: authorization.productId,
              selectedVariantId: authorization.selectedVariantId,
              interactionStartedAtMs: Date.now(),
              buttonState,
              uiFeedback: null,
              cartContainsSelectedVariant: false,
              cartSuccessConfirmedInUi: false,
              cartCountBefore: null,
              cartCountAfter: null,
              structuredSignals,
              verifiedBundleMappings: verifiedMappings,
              httpStatus: navStatus ?? 200,
            });
            return;
          }

          const readCartCounter = async (): Promise<number | null> => {
            if (!selectors.cartProbe.cartCounterBadge) return null;
            const raw = await page
              .locator(selectors.cartProbe.cartCounterBadge)
              .first()
              .textContent()
              .catch(() => null);
            const digits = raw?.match(/\d+/)?.[0];
            return digits ? Number(digits) : null;
          };

          const checkVariantPresentInCart = async (): Promise<boolean> => {
            if (!selectors.cartProbe.cartItemVariantLocator) return false;
            const loc = page.locator(selectors.cartProbe.cartItemVariantLocator);
            const count = await loc.count().catch(() => 0);
            if (count === 0) return false;
            for (let i = 0; i < count; i++) {
              const item = loc.nth(i);
              const visible = await item.isVisible().catch(() => false);
              if (!visible) continue;
              const text = (await item.textContent().catch(() => '')) || '';
              const dataAttr = (await item.getAttribute('data-variant-id').catch(() => '')) || '';
              const dataSku = (await item.getAttribute('data-sku').catch(() => '')) || '';
              const hay = `${text} ${dataAttr} ${dataSku}`.toUpperCase();
              if (
                hay.includes(authorization.selectedVariantId.toUpperCase()) ||
                hay.includes(authorization.productId.toUpperCase())
              ) {
                return true;
              }
            }
            return false;
          };

          const preClickPhraseVisible = await page
            .getByText(ATT_OUT_OF_STOCK_PHRASE, { exact: false })
            .first()
            .isVisible()
            .catch(() => false);

          const cartCountBefore = await readCartCounter();
          interactionStartedAtMs = Date.now();

          // ÚNICO clic permitido sobre "Agregar al carrito" (sin checkout ni reintentos)
          await addBtn.click({ timeout: 8_000 });
          await page.waitForTimeout(2_500);

          let uiFeedback: UiFeedbackObservation | null = null;
          if (selectors.cartProbe.outOfStockToastOrModal) {
            const toastLoc = page.locator(selectors.cartProbe.outOfStockToastOrModal).first();
            const isVisible = await toastLoc.isVisible().catch(() => false);
            const text = (await toastLoc.textContent().catch(() => null))?.trim() ?? null;
            if (text) {
              uiFeedback = {
                text,
                isVisible,
                observedAfterInteraction: !preClickPhraseVisible,
                belongsToCurrentInteraction: true,
                observedAtMs: Date.now(),
                correlatedVariantId: authorization.selectedVariantId,
              };
            }
          } else {
            const phraseLoc = page.getByText(ATT_OUT_OF_STOCK_PHRASE, { exact: false }).first();
            const isVisible = await phraseLoc.isVisible().catch(() => false);
            const text = (await phraseLoc.textContent().catch(() => null))?.trim() ?? null;
            if (text) {
              uiFeedback = {
                text,
                isVisible,
                observedAfterInteraction: !preClickPhraseVisible,
                belongsToCurrentInteraction: !preClickPhraseVisible,
                observedAtMs: Date.now(),
                correlatedVariantId: authorization.selectedVariantId,
              };
            }
          }

          const cartCountAfter = await readCartCounter();
          const cartSuccessConfirmedInUi = selectors.cartProbe.cartSuccessIndicator
            ? await page
                .locator(selectors.cartProbe.cartSuccessIndicator)
                .first()
                .isVisible()
                .catch(() => false)
            : false;

          const variantPresentBeforeRemoval = await checkVariantPresentInCart();

          // Limpieza verificada: jamás se marca cartClearedAfterProbe=true por el mero clic;
          // se comprueba explícitamente que la variante desapareció del carrito tras eliminarla.
          let cartCleanup: CartCleanupVerification = verifyCartCleanupResult({
            removalAttempted: false,
            variantPresentBeforeRemoval,
            variantPresentAfterRemoval: null,
            removalApiConfirmed: false,
          });

          if (variantPresentBeforeRemoval && selectors.cartProbe.removeFromCartButton) {
            const removeBtn = page.locator(selectors.cartProbe.removeFromCartButton).first();
            if (await removeBtn.isVisible().catch(() => false)) {
              await removeBtn.click({ timeout: 5_000 }).catch(() => {});
              await page.waitForTimeout(2_000);
              const stillPresent = await checkVariantPresentInCart();
              cartCleanup = verifyCartCleanupResult({
                removalAttempted: true,
                variantPresentBeforeRemoval,
                variantPresentAfterRemoval: stillPresent,
                removalApiConfirmed: false,
              });
            }
          }

          result = evaluateSupervisedCartProbe({
            productId: authorization.productId,
            selectedVariantId: authorization.selectedVariantId,
            interactionStartedAtMs,
            buttonState: 'enabled',
            uiFeedback,
            cartContainsSelectedVariant: variantPresentBeforeRemoval,
            cartSuccessConfirmedInUi,
            cartCountBefore,
            cartCountAfter,
            cartCleanup,
            structuredSignals,
            verifiedBundleMappings: verifiedMappings,
            httpStatus: navStatus ?? 200,
          });
        },
        failedRequestHandler: async ({ error }) => {
          const msg = error instanceof Error ? error.message : String(error);
          result = evaluateSupervisedCartProbe({
            productId: authorization.productId,
            selectedVariantId: authorization.selectedVariantId,
            interactionStartedAtMs: Date.now(),
            buttonState: 'not_found',
            uiFeedback: null,
            cartContainsSelectedVariant: false,
            cartSuccessConfirmedInUi: false,
            cartCountBefore: null,
            cartCountAfter: null,
            structuredSignals,
            verifiedBundleMappings: verifiedMappings,
            error: {
              status: /timeout/i.test(msg) ? 'timeout' : 'error',
              code: /timeout/i.test(msg) ? 'PROBE_TIMEOUT' : 'PROBE_ERROR',
              message: msg,
            },
          });
        },
      },
      crawlerConfig
    );

    await crawler.run([authorization.singleVariantUrl]);

    return (
      result ??
      evaluateSupervisedCartProbe({
        productId: authorization.productId,
        selectedVariantId: authorization.selectedVariantId,
        interactionStartedAtMs: Date.now(),
        buttonState: 'not_found',
        uiFeedback: null,
        cartContainsSelectedVariant: false,
        cartSuccessConfirmedInUi: false,
        cartCountBefore: null,
        cartCountAfter: null,
        structuredSignals,
        verifiedBundleMappings: verifiedMappings,
        error: {
          status: 'error',
          code: 'NO_PROBE_RESULT',
          message: 'La sonda supervisada finalizó sin resultado concluyente.',
        },
      })
    );
  }

  private ensureLiveExecutionAllowed(): void {
    if (!isScraperLiveEnabled()) {
      throw new Error(
        'LIVE_SCRAPING_DISABLED: SCRAPER_LIVE_ENABLED es false por defecto y debe establecerse explícitamente en "true" únicamente tras validar pruebas y autorización.'
      );
    }
  }
}
