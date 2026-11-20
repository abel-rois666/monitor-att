import { PlaywrightCrawler, Configuration } from 'crawlee';
import type { Page, Response } from 'playwright';
import {
  ATT_OUT_OF_STOCK_FULL_MESSAGE,
  ATT_OUT_OF_STOCK_PHRASE,
  DEFAULT_COMPLIANCE_POLICY,
  type CartAvailabilityVerifier,
  type CartVerificationResult,
  type CatalogDiscoveryAdapter,
  type CatalogDiscoveryResult,
  type ComplianceGuardConfig,
  type DiscoveredProductRef,
  type ExtractionStatus,
  type StructuredNetworkSignal,
  type SupervisedProbeAuthorization,
  type UiFeedbackObservation,
  type VerifiedBundleSkuMapping,
} from './contracts.ts';
import {
  assertCartProbeSelectorsConfigured,
  assertDiscoverySelectorsConfigured,
  listMissingPriceSelectors,
  UNCONFIGURED_ATT_SELECTORS,
  type AttSelectorRegistry,
} from './selector-registry.ts';
import {
  assertSupervisedProbeAuthorized,
  evaluateSupervisedCartProbe,
  extractAttProductIdentifiersFromUrl,
  inspectStructuredNetworkPayload,
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
 * - Correlaciona variante, SKU, marca temporal posterior al clic y mensaje visible de la misma interacción.
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

export interface HydrationDiagnosticReport {
  readonly productUrl: string;
  readonly httpStatus: number | null;
  readonly pageTitle: string;
  readonly blockedByAccessControl: boolean;
  readonly candidateMatches: {
    readonly title: { selector: string; count: number; sampleText: string | null };
    readonly currentPrice: { selector: string; count: number; sampleText: string | null };
    readonly pricingArea: { selector: string; count: number; sampleText: string | null };
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

  constructor(
    selectors: AttSelectorRegistry = UNCONFIGURED_ATT_SELECTORS,
    policy: ComplianceGuardConfig = DEFAULT_COMPLIANCE_POLICY,
    verifiedBundleMappings: readonly VerifiedBundleSkuMapping[] = []
  ) {
    this.selectors = selectors;
    this.policy = policy;
    this.verifiedBundleMappings = verifiedBundleMappings;
  }

  public getDiagnostics() {
    const liveFlag = isScraperLiveEnabled();
    return {
      adapterName: 'AttCrawleePlaywrightAdapter',
      executionRuntime: 'Cloud Run Job (Crawlee + Playwright)',
      scraperLiveEnabled: liveFlag,
      readyForLiveExecution: this.selectors.configured && liveFlag,
      selectorsConfigured: this.selectors.configured,
      priceSelectorsPendingValidation: listMissingPriceSelectors(this.selectors),
      priceCandidateSelectors: this.selectors.priceCandidates,
      policy: this.policy,
      outOfStockSignaturePhrase: ATT_OUT_OF_STOCK_PHRASE,
      outOfStockFullMessage: ATT_OUT_OF_STOCK_FULL_MESSAGE,
    };
  }

  /**
   * Inspección de solo lectura de selectores candidatos de precio tras hidratación de Next.js
   * (sin reservas de carrito ni llamadas directas a endpoints internos).
   * Requiere SCRAPER_LIVE_ENABLED === 'true' cuando se autorice su ejecución en un entorno con Chromium.
   */
  public async inspectProductHydrationReadOnly(
    productUrl: string
  ): Promise<HydrationDiagnosticReport> {
    this.ensureLiveExecutionAllowed();

    const candidates = this.selectors.priceCandidates;
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
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          // Espera conservadora para hidratación del árbol cliente de Next.js (sin bucles agresivos)
          await page
            .waitForSelector(
              `${candidates.title.selector}, ${candidates.currentPrice.selector}, ${candidates.pricingArea.selector}`,
              { state: 'attached', timeout: 8_000 }
            )
            .catch(() => {});

          const pageTitle = await page.title().catch(() => '');
          const blocked =
            (httpStatus !== null && (httpStatus === 403 || httpStatus === 429)) ||
            /solicitud rechazada|access denied/i.test(pageTitle);

          const inspectCandidate = async (selector: string) => {
            const loc = page.locator(selector);
            const count = await loc.count().catch(() => 0);
            const sampleText =
              count > 0
                ? (await loc.first().textContent().catch(() => null))?.trim().slice(0, 120) ?? null
                : null;
            return { selector, count, sampleText };
          };

          report = {
            productUrl,
            httpStatus,
            pageTitle,
            blockedByAccessControl: blocked,
            candidateMatches: {
              title: await inspectCandidate(candidates.title.selector),
              currentPrice: await inspectCandidate(candidates.currentPrice.selector),
              pricingArea: await inspectCandidate(candidates.pricingArea.selector),
            },
            iframeCount: page.frames().length - 1,
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
        httpStatus: null,
        pageTitle: '',
        blockedByAccessControl: false,
        candidateMatches: {
          title: { selector: candidates.title.selector, count: 0, sampleText: null },
          currentPrice: { selector: candidates.currentPrice.selector, count: 0, sampleText: null },
          pricingArea: { selector: candidates.pricingArea.selector, count: 0, sampleText: null },
        },
        iframeCount: 0,
        observedAtIso: new Date().toISOString(),
      }
    );
  }

  /**
   * Fase A: Descubrimiento de solo lectura sobre https://www.att.com.mx/market/destacados.
   */
  public async discoverProducts(
    catalogUrl: string = this.policy.targetCatalogUrl
  ): Promise<CatalogDiscoveryResult> {
    const startedAtIso = new Date().toISOString();
    this.ensureLiveExecutionAllowed();
    assertDiscoverySelectorsConfigured(this.selectors);

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
   * aislamiento temporal (ignora sincronizaciones de carrito previo) y validación contextual
   * del mensaje "Este producto se agotó".
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
              cartSuccessConfirmedInUi: false,
              cartCountBefore: null,
              cartCountAfter: null,
              cartClearedAfterProbe: false,
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
              cartSuccessConfirmedInUi: false,
              cartCountBefore: null,
              cartCountAfter: null,
              cartClearedAfterProbe: false,
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

          // Verifica si el texto ya existía visible ANTES del clic para no confundirlo con un aviso nuevo
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

          let cartClearedAfterProbe = false;
          if (
            (cartSuccessConfirmedInUi ||
              (cartCountBefore !== null &&
                cartCountAfter !== null &&
                cartCountAfter > cartCountBefore)) &&
            selectors.cartProbe.removeFromCartButton
          ) {
            const removeBtn = page.locator(selectors.cartProbe.removeFromCartButton).first();
            if (await removeBtn.isVisible().catch(() => false)) {
              await removeBtn.click({ timeout: 5_000 }).catch(() => {});
              cartClearedAfterProbe = true;
            }
          }

          result = evaluateSupervisedCartProbe({
            productId: authorization.productId,
            selectedVariantId: authorization.selectedVariantId,
            interactionStartedAtMs,
            buttonState: 'enabled',
            uiFeedback,
            cartSuccessConfirmedInUi,
            cartCountBefore,
            cartCountAfter,
            cartClearedAfterProbe,
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
            cartSuccessConfirmedInUi: false,
            cartCountBefore: null,
            cartCountAfter: null,
            cartClearedAfterProbe: false,
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
        cartSuccessConfirmedInUi: false,
        cartCountBefore: null,
        cartCountAfter: null,
        cartClearedAfterProbe: false,
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
