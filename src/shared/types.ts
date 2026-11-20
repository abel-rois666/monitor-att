export type EffectiveAvailability =
  | 'available_verified'
  | 'out_of_stock_false_positive'
  | 'out_of_stock_confirmed'
  | 'unverified';

export type AddToCartButtonState = 'enabled' | 'disabled' | 'not_found';

export type CartProbeOutcome =
  | 'confirmed_in_stock'
  | 'false_positive_out_of_stock'
  | 'button_disabled_no_probe'
  | 'not_executed';

export interface AvailabilityProbeRecord {
  checkedAt: string;
  buttonState: AddToCartButtonState;
  cartProbeOutcome: CartProbeOutcome;
  effectiveAvailability: EffectiveAvailability;
  detectedMessage: string | null;
  probeClearedCart: boolean;
  isSimulated: true;
}

export interface PriceHistoryPoint {
  date: string; // YYYY-MM-DD
  priceMxn: number;
  listPriceMxn: number;
  effectiveAvailability: EffectiveAvailability;
  buttonState: AddToCartButtonState;
  eventTag?: 'price_drop' | 'verified_restock' | 'false_positive' | 'price_increase';
  eventNote?: string;
}

export interface SmartphoneVariant {
  id: string;
  productId: string;
  skuSimulated: string;
  brand: string;
  model: string;
  storage: string;
  color: string;
  colorHex: string;
  modality: 'Equipo libre / Contado' | 'AT&T Ármalo (referencia)';
  imageUrl: string;
  currentPriceMxn: number;
  previousPriceMxn: number;
  listPriceMxn: number;
  lowestPrice30dMxn: number;
  highestPrice30dMxn: number;
  priceChangePct: number;
  lastChangeLabel: string;
  availability: AvailabilityProbeRecord;
  history: PriceHistoryPoint[];
  targetCatalogUrl: string;
  isSimulated: true;
}

export interface CatalogDatasetResponse {
  dataSource: 'simulated_fixture';
  liveMonitoringActive: false;
  targetUrl: string;
  disclaimer: string;
  generatedAt: string;
  variants: SmartphoneVariant[];
}

export interface FavoriteRecord {
  variantId: string;
  productName: string;
  brand: string;
  storage: string;
  color: string;
  targetPriceMxn: number;
  notes: string;
  updatedAtIso?: string;
}

export type AlertScope = 'all_favorites' | 'specific_variant' | 'entire_catalog';

export type AlertTriggerType =
  | 'price_drop_percent'
  | 'target_price_mxn'
  | 'verified_restock'
  | 'false_positive_warning';

export interface AlertRuleRecord {
  id: string;
  name: string;
  scope: AlertScope;
  variantId: string;
  triggerType: AlertTriggerType;
  thresholdValue: number;
  enabled: boolean;
  cooldownMinutes: number;
  requireCartVerification: boolean;
  updatedAtIso?: string;
}

export interface TelegramSettingsRecord {
  chatId: string;
  topicId: string;
  channelLabel: string;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  dispatchMode: 'preview_only' | 'cloud_run_worker';
  updatedAtIso?: string;
}

export interface ScraperStatusResponse {
  demoModeActive: boolean;
  liveMonitoringActive: boolean;
  scraperLiveEnabled: boolean;
  targetCatalogUrl: string;
  selectorsConfigured: false;
  telegramServerTokenConfigured: boolean;
  telegramDefaultChatIdConfigured: boolean;
  telegramRealDispatchEnabled: boolean;
  cloudRunJob: {
    configured: boolean;
    executionModel: 'cloud_scheduler_authenticated_run_api';
    publicHttpUrlRequired: false;
    region: string;
    jobName: string;
    authenticatedRunApiEndpoint: string;
  };
  compliancePolicy: {
    allowPurchases: false;
    allowCheckoutNavigation: false;
    bypassSecurityControls: false;
    requireCartProbeWhenButtonEnabled: true;
    outOfStockSignaturePhrase: string;
    clearCartAfterProbe: true;
    maxCartProbesPerVariantPerRun: 1;
    noRepetitiveCartRetries: true;
    maxRequestsPerMinute: number;
  };
  stages: Array<{
    stage: number;
    title: string;
    status: 'completed' | 'in_progress' | 'planned';
    summary: string;
    deliverables: string[];
  }>;
}
