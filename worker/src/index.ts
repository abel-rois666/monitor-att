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
  listMissingCartProbeSelectors,
  listMissingDiscoverySelectors,
  listMissingPriceSelectors,
  UNCONFIGURED_ATT_SELECTORS,
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

async function main() {
  const mode = parseArg('mode') || 'status';
  const adapter = new AttCrawleePlaywrightAdapter(
    UNCONFIGURED_ATT_SELECTORS,
    DEFAULT_COMPLIANCE_POLICY
  );

  if (mode === 'status') {
    console.log(
      JSON.stringify(
        {
          worker: 'att-price-monitor-worker',
          stage: 2,
          scraperLiveEnabled: isScraperLiveEnabled(),
          missingDiscoverySelectors: listMissingDiscoverySelectors(UNCONFIGURED_ATT_SELECTORS),
          missingPriceSelectors: listMissingPriceSelectors(UNCONFIGURED_ATT_SELECTORS),
          missingCartProbeSelectors: listMissingCartProbeSelectors(UNCONFIGURED_ATT_SELECTORS),
          referenceProducts: ATT_REFERENCE_PRODUCTS.map((p) => ({
            productId: p.productId,
            productName: p.productName,
            variantId: p.variantId,
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

  if (mode === 'inspect-hydration') {
    const productUrl = parseArg('product-url') || ATT_REFERENCE_PRODUCTS[0].productUrl;
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
      // En modo solo lectura jamás se clasifica IN_STOCK ni OUT_OF_STOCK sin evidencia correlacionada
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
      selectorsConfigured: UNCONFIGURED_ATT_SELECTORS.configured,
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
        notes:
          'Resultado de sonda supervisada sobre una única variante autorizada con correlación de SKU.',
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
      selectorsConfigured: UNCONFIGURED_ATT_SELECTORS.configured,
      observations: [observation],
    });

    const outputPath = writeRealRunReportToDisk(report);
    console.log(JSON.stringify({ reportPath: outputPath, probeResult }, null, 2));
    return;
  }

  throw new Error(
    `Modo no reconocido: ${mode}. Usa status | inspect-hydration | discover-readonly | supervised-cart-probe.`
  );
}

main().catch((err) => {
  console.error('[worker]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
