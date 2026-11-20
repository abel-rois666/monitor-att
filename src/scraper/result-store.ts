import fs from 'fs';
import path from 'path';
import {
  mapScraperStateToUiAvailability,
  type AvailabilityClassificationReason,
  type AvailabilityEvidence,
  type ExtractionStatus,
  type ObservationDataOrigin,
  type RealExtractionRunReport,
  type RealObservationRecord,
  type ScraperAvailabilityState,
} from './contracts.ts';

/**
 * Persistencia e historial de observaciones (Fase C / Sección 8).
 *
 * GARANTÍAS DE PRIVACIDAD Y SEPARACIÓN:
 * - Mantiene los registros reales (`real_extraction`) separados de simulados (`simulated_fixture`).
 * - Nunca persiste cookies, tokens, sessionId, reservationId ni información privada del carrito.
 * - Exporta tanto registros JSON locales como documentos preparados para Firestore (Etapa 3).
 */

export function parseMxnPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/mxn|mn|\$/gi, '')
    .replace(/\s+/g, '')
    .trim();

  const match = cleaned.match(/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/);
  if (!match) return null;

  const numeric = Number(cleaned.replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 250_000) {
    return null;
  }
  return Math.round(numeric * 100) / 100;
}

export function buildRealObservationRecord(params: {
  dataOrigin?: ObservationDataOrigin;
  productId: string;
  productName: string;
  brand: string | null;
  selectedVariantId: string | null;
  correlatedSku: string | null;
  variantKey: string;
  capacity: string | null;
  color: string | null;
  currentPriceMxn: number | null;
  productUrl: string;
  availabilityState: ScraperAvailabilityState;
  classificationReason: AvailabilityClassificationReason;
  evidence: AvailabilityEvidence;
  observedAtIso?: string;
  extractionStatus: ExtractionStatus;
  errorCode?: string;
  errorMessage?: string;
}): RealObservationRecord {
  const observedAtIso = params.observedAtIso ?? new Date().toISOString();
  const variantLabel = [params.capacity, params.color].filter(Boolean).join(' · ') || 'Base';

  return {
    dataOrigin: params.dataOrigin ?? 'real_extraction',
    productId: params.productId,
    productName: params.productName,
    brand: params.brand,
    selectedVariantId: params.selectedVariantId,
    correlatedSku: params.correlatedSku,
    variantKey: params.variantKey,
    variantLabel,
    capacity: params.capacity,
    color: params.color,
    currentPriceMxn: params.currentPriceMxn,
    productUrl: params.productUrl,
    availabilityState: params.availabilityState,
    classificationReason: params.classificationReason,
    uiAvailability: mapScraperStateToUiAvailability(
      params.availabilityState,
      params.evidence.buttonState
    ),
    evidence: {
      ...params.evidence,
      structuredSignals: params.evidence.structuredSignals.map((sig) => ({
        urlPathOnly: sig.urlPathOnly,
        backendPathOnly: sig.backendPathOnly,
        extractedSku: sig.extractedSku,
        operationKind: sig.operationKind,
        httpStatus: sig.httpStatus,
        backendStatus: sig.backendStatus,
        contentType: sig.contentType,
        isReservationRejection: sig.isReservationRejection,
        isReservationConfirmed: sig.isReservationConfirmed,
        confirmedVariantInCart: sig.confirmedVariantInCart,
        detectedCartItemCount: sig.detectedCartItemCount,
        detectedOutOfStockMessage: sig.detectedOutOfStockMessage,
        observedAtMs: sig.observedAtMs,
        isPreviousCartSync: sig.isPreviousCartSync,
        matchedSafeKeys: sig.matchedSafeKeys,
      })),
    },
    observedAtIso,
    extractionResult: {
      status: params.extractionStatus,
      ...(params.errorCode ? { errorCode: params.errorCode } : {}),
      ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
    },
  };
}

export interface FirestoreObservationDocument {
  readonly productId: string;
  readonly productName: string;
  readonly selectedVariantId: string | null;
  readonly correlatedSku: string | null;
  readonly currentPriceMxn: number | null;
  readonly productUrl: string;
  readonly availabilityState: ScraperAvailabilityState;
  readonly classificationReason: AvailabilityClassificationReason;
  readonly evidenceSummary: {
    readonly method: AvailabilityEvidence['method'];
    readonly buttonState: AvailabilityEvidence['buttonState'];
    readonly correlationMatched: boolean;
    readonly correlationMatchType: AvailabilityEvidence['correlation']['matchType'];
    readonly matchedMessages: string[];
    readonly httpStatus: number | null;
    readonly backendStatus: number | null;
    readonly cartClearedAfterProbe: boolean;
    readonly notes: string;
  };
  readonly observedAtIso: string;
  readonly dataOrigin: ObservationDataOrigin;
  readonly extractionStatus: ExtractionStatus;
  readonly errorCode: string | null;
}

/**
 * Proyecta una observación a un documento plano preparado para Firestore
 * (colección futura `catalog_variants/{variantKey}/observations/{observationId}`),
 * garantizando por lista blanca la ausencia de cookies, tokens, sessionId o reservationId.
 */
export function toFirestoreObservationDocument(
  record: RealObservationRecord
): FirestoreObservationDocument {
  return {
    productId: record.productId,
    productName: record.productName,
    selectedVariantId: record.selectedVariantId,
    correlatedSku: record.correlatedSku,
    currentPriceMxn: record.currentPriceMxn,
    productUrl: record.productUrl,
    availabilityState: record.availabilityState,
    classificationReason: record.classificationReason,
    evidenceSummary: {
      method: record.evidence.method,
      buttonState: record.evidence.buttonState,
      correlationMatched: record.evidence.correlation.matched,
      correlationMatchType: record.evidence.correlation.matchType,
      matchedMessages: record.evidence.matchedMessages,
      httpStatus: record.evidence.httpStatus,
      backendStatus: record.evidence.backendStatus,
      cartClearedAfterProbe: record.evidence.cartClearedAfterProbe,
      notes: record.evidence.notes,
    },
    observedAtIso: record.observedAtIso,
    dataOrigin: record.dataOrigin,
    extractionStatus: record.extractionResult.status,
    errorCode: record.extractionResult.errorCode ?? null,
  };
}

export function buildRealExtractionRunReport(params: {
  dataOrigin?: ObservationDataOrigin;
  runId: string;
  mode: RealExtractionRunReport['mode'];
  targetCatalogUrl: string;
  startedAtIso: string;
  finishedAtIso?: string;
  scraperLiveEnabled: boolean;
  selectorsConfigured: boolean;
  observations: RealObservationRecord[];
}): RealExtractionRunReport {
  const finishedAtIso = params.finishedAtIso ?? new Date().toISOString();
  let inStock = 0;
  let outOfStock = 0;
  let unknown = 0;
  let reservationRejected = 0;
  let temporarilyMissing = 0;
  let errors = 0;

  for (const obs of params.observations) {
    if (obs.availabilityState === 'IN_STOCK') inStock++;
    else if (obs.availabilityState === 'OUT_OF_STOCK') outOfStock++;
    else unknown++;

    if (obs.classificationReason === 'RESERVATION_REJECTED') reservationRejected++;
    if (obs.extractionResult.status === 'temporarily_missing') temporarilyMissing++;
    if (
      obs.extractionResult.status === 'error' ||
      obs.extractionResult.status === 'timeout' ||
      obs.extractionResult.status === 'blocked'
    ) {
      errors++;
    }
  }

  return {
    schemaVersion: '2.1',
    dataOrigin: params.dataOrigin ?? 'real_extraction',
    runId: params.runId,
    mode: params.mode,
    targetCatalogUrl: params.targetCatalogUrl,
    startedAtIso: params.startedAtIso,
    finishedAtIso,
    scraperLiveEnabled: params.scraperLiveEnabled,
    selectorsConfigured: params.selectorsConfigured,
    totalObserved: params.observations.length,
    summary: {
      inStock,
      outOfStock,
      unknown,
      reservationRejected,
      temporarilyMissing,
      errors,
    },
    observations: params.observations,
  };
}

export function writeRealRunReportToDisk(
  report: RealExtractionRunReport,
  outputDir: string = path.resolve(process.cwd(), 'worker', 'output')
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeRunId = report.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(outputDir, `real-observations-${safeRunId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
