import 'dotenv/config';
import {
  AttCrawleePlaywrightAdapter,
  isScraperLiveEnabled,
} from '../../src/scraper/crawlee-playwright-adapter.ts';
import {
  ATT_REFERENCE_PRODUCTS,
  DEFAULT_COMPLIANCE_POLICY,
  type RealObservationRecord,
} from '../../src/scraper/contracts.ts';
import {
  isCartProbeSelectorsReady,
  isCatalogSelectorsReady,
  isProductDetailSelectorsReady,
  listMissingCartProbeSelectors,
  listMissingCatalogSelectors,
  listMissingPriceSelectors,
  listMissingProductDetailSelectors,
  loadSelectorRegistry,
} from '../../src/scraper/selector-registry.ts';
import {
  analyzeReadOnlyAvailability,
  extractAttProductIdentifiersFromUrl,
} from '../../src/scraper/availability-analyzer.ts';
import {
  buildRealExtractionRunReport,
  buildRealObservationRecord,
  writeRealRunReportToDisk,
} from '../../src/scraper/result-store.ts';

function parseArg(flag: string): string | null {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function resolveProductTargetUrl(): string {
  const explicitUrl = parseArg('product-url');
  if (explicitUrl) return explicitUrl;

  const targetAlias = parseArg('target');
  if (targetAlias) {
    const matched = ATT_REFERENCE_PRODUCTS.find(
      (p) =>
        p.alias === targetAlias.toLowerCase() ||
        p.productId.toLowerCase() === targetAlias.toLowerCase() ||
        p.variantId.toLowerCase() === targetAlias.toLowerCase()
    );
    if (!matched) {
      throw new Error(
        `TARGET_NOT_FOUND: Alias "${targetAlias}" no reconocido. Usa --target=s23-ultra, --target=honor-magic6-pro o --product-url=<url>.`
      );
    }
    return matched.productUrl;
  }

  return ATT_REFERENCE_PRODUCTS[0].productUrl;
}

async function main() {
  const mode = parseArg('mode') || 'status';
  const selectorsFileArg = parseArg('selectors-file');
  const loaded = loadSelectorRegistry({ filePath: selectorsFileArg });

  const adapter = new AttCrawleePlaywrightAdapter(
    loaded.registry,
    DEFAULT_COMPLIANCE_POLICY,
    [],
    loaded.filePath ? `${loaded.source}:${loaded.filePath}` : loaded.source
  );

  if (mode === 'status') {
    console.log(
      JSON.stringify(
        {
          worker: 'att-price-monitor-worker',
          stage: 2,
          scraperLiveEnabled: isScraperLiveEnabled(),
          selectorConfig: {
            source: loaded.source,
            filePath: loaded.filePath,
            groups: {
              catalog: {
                ready: isCatalogSelectorsReady(loaded.registry),
                missing: listMissingCatalogSelectors(loaded.registry),
              },
              productDetail: {
                ready: isProductDetailSelectorsReady(loaded.registry),
                missing: listMissingProductDetailSelectors(loaded.registry),
              },
              cartProbe: {
                ready: isCartProbeSelectorsReady(loaded.registry),
                missing: listMissingCartProbeSelectors(loaded.registry),
              },
            },
            missingPriceCandidateSelectors: listMissingPriceSelectors(loaded.registry),
          },
          referenceProducts: ATT_REFERENCE_PRODUCTS.map((p) => ({
            alias: p.alias,
            productId: p.productId,
            productName: p.productName,
            variantId: p.variantId,
            productUrl: p.productUrl,
            verifiedSkuMappingStatus: p.verifiedSkuMappingStatus,
          })),
          diagnostics: adapter.getDiagnostics(),
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === 'inspect-product') {
    const productUrl = resolveProductTargetUrl();
    const result = await adapter.inspectSingleProductPriceReadOnly(productUrl);

    if (result.executedNetworkRequest) {
      const runId = `product_${Date.now()}`;
      const obs = buildRealObservationRecord({
        dataOrigin: 'real_extraction',
        productId: result.productId ?? 'unknown-product',
        productName: result.title ?? result.productId ?? 'Sin título confirmado',
        brand: null,
        selectedVariantId: result.selectedVariantId,
        correlatedSku: null,
        variantKey: [result.productId, result.selectedVariantId].filter(Boolean).join(':') || 'unknown',
        capacity: null,
        color: null,
        currentPriceMxn: result.currentPriceMxn,
        productUrl: result.productUrl,
        availabilityState: 'UNKNOWN',
        classificationReason: 'ENABLED_BUTTON_UNVERIFIED',
        evidence: {
          method: 'read_only_dom',
          buttonState: 'not_found',
          correlation: {
            matched: false,
            matchType: 'missing_sku',
            selectedVariantId: result.selectedVariantId,
            operationSku: null,
            notes: 'Inspección individual de solo lectura para precios; no evalúa inventario.',
          },
          matchedMessages: [],
          structuredSignals: [],
          httpStatus: null,
          backendStatus: null,
          cartClearedAfterProbe: false,
          notes: result.notes,
        },
        observedAtIso: result.observedAtIso,
        extractionStatus:
          result.hydrationStatus === 'elements_found'
            ? 'ok'
            : result.hydrationStatus === 'access_denied'
              ? 'blocked'
              : result.hydrationStatus === 'timeout'
                ? 'timeout'
                : result.hydrationStatus === 'network_error'
                  ? 'error'
                  : 'partial',
      });

      const report = buildRealExtractionRunReport({
        dataOrigin: 'real_extraction',
        runId,
        mode: 'read_only_single_product',
        targetCatalogUrl: DEFAULT_COMPLIANCE_POLICY.targetCatalogUrl,
        startedAtIso: result.observedAtIso,
        scraperLiveEnabled: isScraperLiveEnabled(),
        selectorsConfigured: isProductDetailSelectorsReady(loaded.registry),
        observations: [obs],
      });
      const reportPath = writeRealRunReportToDisk(report);
      console.log(JSON.stringify({ reportPath, inspection: result }, null, 2));
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (mode === 'inspect-hydration') {
    const productUrl = resolveProductTargetUrl();
    const report = await adapter.inspectProductHydrationReadOnly(productUrl);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const runId = `run_${Date.now()}`;
  const startedAtIso = new Date().toISOString();

  if (mode === 'discover-readonly') {
    const discovery = await adapter.discoverProducts(DEFAULT_COMPLIANCE_POLICY.targetCatalogUrl);
    const observations: RealObservationRecord[] = discovery.products.map((product) => {
      const primaryVariant = product.variants[0];
      const analysis = analyzeReadOnlyAvailability({
        productId: product.productId,
        selectedVariantId: primaryVariant?.variantId ?? null,
        buttonState: 'not_found',
        uiFeedback: null,
        httpStatus: discovery.status === 'ok' ? 200 : null,
      });

      return buildRealObservationRecord({
        dataOrigin: 'real_extraction',
        productId: product.productId,
        productName: product.modelName,
        brand: product.brand,
        selectedVariantId: primaryVariant?.variantId ?? null,
        correlatedSku: analysis.correlatedSku,
        variantKey: `${product.slug}-${primaryVariant?.capacity ?? 'base'}`.toLowerCase(),
        capacity: primaryVariant?.capacity ?? null,
        color: primaryVariant?.color ?? null,
        currentPriceMxn: product.priceMxn,
        productUrl: product.canonicalUrl,
        availabilityState: analysis.availabilityState,
        classificationReason: analysis.classificationReason,
        evidence: analysis.evidence,
        observedAtIso: product.discoveredAtIso,
        extractionStatus: discovery.status,
        errorCode: discovery.errorCode,
        errorMessage: discovery.errorMessage,
      });
    });

    const report = buildRealExtractionRunReport({
      dataOrigin: 'real_extraction',
      runId,
      mode: 'read_only_discovery',
      targetCatalogUrl: DEFAULT_COMPLIANCE_POLICY.targetCatalogUrl,
      startedAtIso,
      scraperLiveEnabled: isScraperLiveEnabled(),
      selectorsConfigured: isCatalogSelectorsReady(loaded.registry),
      observations,
    });

    const outputPath = writeRealRunReportToDisk(report);
    console.log(
      JSON.stringify(
        {
          status: discovery.status,
          productsExtracted: discovery.products.length,
          reportPath: outputPath,
          summary: report.summary,
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === 'supervised-cart-probe') {
    const variantUrl = parseArg('variant-url') || '';
    const parsedFromUrl = extractAttProductIdentifiersFromUrl(variantUrl);
    const productId = parseArg('product-id') || parsedFromUrl.productId || '';
    const selectedVariantId = parseArg('variant-id') || parsedFromUrl.variantId || '';
    const variantKey =
      parseArg('variant-key') ||
      [productId, selectedVariantId].filter(Boolean).join(':');
    const authorizedBy = parseArg('authorized-by') || '';
    const authorizedFlag = process.argv.includes('--authorize-single-probe');
    const envAuthorized =
      process.env.SCRAPER_SUPERVISED_PROBE_AUTH === 'ALLOW_SINGLE_VARIANT';

    const probeResult = await adapter.verifySingleVariantSupervised({
      authorized: authorizedFlag && envAuthorized,
      authorizedBy,
      reason: 'Verificación supervisada de una sola variante en Etapa 2',
      productId,
      selectedVariantId,
      singleVariantUrl: variantUrl,
      singleVariantKey: variantKey,
      maxAttempts: 1,
      allowCheckout: false,
      allowPurchase: false,
    });

    const primarySignal = probeResult.structuredSignals[0];
    const observation = buildRealObservationRecord({
      dataOrigin: 'real_extraction',
      productId: probeResult.productId,
      productName: probeResult.productId,
      brand: null,
      selectedVariantId: probeResult.selectedVariantId,
      correlatedSku: probeResult.correlatedSku,
      variantKey,
      capacity: null,
      color: null,
      currentPriceMxn: null,
      productUrl: variantUrl,
      availabilityState: probeResult.availabilityState,
      classificationReason: probeResult.classificationReason,
      evidence: {
        method: 'supervised_cart_probe',
        buttonState: probeResult.buttonState,
        correlation: probeResult.correlation,
        matchedMessages: probeResult.detectedFeedbackMessage
          ? [probeResult.detectedFeedbackMessage]
          : [],
        structuredSignals: probeResult.structuredSignals,
        httpStatus: primarySignal?.httpStatus ?? null,
        backendStatus: primarySignal?.backendStatus ?? null,
        cartClearedAfterProbe: probeResult.cartClearedAfterProbe,
        cartCleanupVerification: probeResult.cartCleanupVerification,
        notes:
          'Resultado de sonda supervisada sobre una única variante autorizada con correlación de SKU y limpieza verificada.',
      },
      observedAtIso: probeResult.verifiedAtIso,
      extractionStatus: probeResult.extractionStatus,
      errorMessage: probeResult.errorMessage,
    });

    const report = buildRealExtractionRunReport({
      dataOrigin: 'real_extraction',
      runId,
      mode: 'supervised_single_cart_probe',
      targetCatalogUrl: DEFAULT_COMPLIANCE_POLICY.targetCatalogUrl,
      startedAtIso,
      scraperLiveEnabled: isScraperLiveEnabled(),
      selectorsConfigured: isCartProbeSelectorsReady(loaded.registry),
      observations: [observation],
    });

    const outputPath = writeRealRunReportToDisk(report);
    console.log(JSON.stringify({ reportPath: outputPath, probeResult }, null, 2));
    return;
  }

  throw new Error(
    `Modo no reconocido: ${mode}. Usa status | inspect-product | inspect-hydration | discover-readonly | supervised-cart-probe.`
  );
}

main().catch((err) => {
  console.error('[worker]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
