/**
 * Configuración de ejecución del backend (Node.js / Express).
 *
 * - Todas las credenciales de Telegram y parámetros de Cloud Run son opcionales en desarrollo.
 * - SCRAPER_LIVE_ENABLED se interpreta estrictamente como process.env.SCRAPER_LIVE_ENABLED === 'true'.
 * - Nunca expone valores de secretos al frontend: únicamente banderas booleanas de estado.
 */

export interface BackendRuntimeConfig {
  readonly port: number;
  readonly scraperLiveEnabled: boolean;
  readonly telegramBotTokenConfigured: boolean;
  readonly telegramDefaultChatIdConfigured: boolean;
  readonly telegramRealDispatchEnabled: boolean;
  readonly cloudRunJob: {
    readonly configured: boolean;
    readonly projectIdConfigured: boolean;
    readonly region: string;
    readonly jobName: string;
    readonly executionModel: 'cloud_scheduler_authenticated_run_api';
    readonly publicHttpUrlRequired: false;
    readonly authenticatedRunApiEndpoint: string;
    readonly legacyWorkerUrlProvided: boolean;
  };
  readonly demoModeActive: boolean;
}

function hasNonEmptyEnv(key: string): boolean {
  const val = process.env[key];
  return typeof val === 'string' && val.trim().length > 0;
}

export function getBackendRuntimeConfig(selectorsConfigured: boolean): BackendRuntimeConfig {
  const port = Number(process.env.PORT) || 3000;
  const scraperLiveEnabled = process.env.SCRAPER_LIVE_ENABLED === 'true';

  const telegramBotTokenConfigured = hasNonEmptyEnv('TELEGRAM_BOT_TOKEN');
  const telegramDefaultChatIdConfigured = hasNonEmptyEnv('TELEGRAM_DEFAULT_CHAT_ID');
  const telegramRealDispatchEnabled = telegramBotTokenConfigured && scraperLiveEnabled;

  const projectId = (process.env.CLOUD_RUN_PROJECT_ID || '').trim();
  const region = (process.env.CLOUD_RUN_REGION || 'us-central1').trim() || 'us-central1';
  const jobName =
    (process.env.CLOUD_RUN_JOB_NAME || 'att-price-monitor-worker').trim() ||
    'att-price-monitor-worker';
  const legacyWorkerUrlProvided = hasNonEmptyEnv('CLOUD_RUN_WORKER_URL');

  const cloudRunJobConfigured = projectId.length > 0 && region.length > 0 && jobName.length > 0;

  const authenticatedRunApiEndpoint = `https://${region}-run.googleapis.com/v2/projects/${projectId || 'PROJECT_ID'}/locations/${region}/jobs/${jobName}:run`;

  // Modo demostración activo mientras no haya worker desplegado, selectores validados y bandera explícita en true
  const demoModeActive = !scraperLiveEnabled || !selectorsConfigured || !cloudRunJobConfigured;

  return {
    port,
    scraperLiveEnabled,
    telegramBotTokenConfigured,
    telegramDefaultChatIdConfigured,
    telegramRealDispatchEnabled,
    cloudRunJob: {
      configured: cloudRunJobConfigured,
      projectIdConfigured: projectId.length > 0,
      region,
      jobName,
      executionModel: 'cloud_scheduler_authenticated_run_api',
      publicHttpUrlRequired: false,
      authenticatedRunApiEndpoint,
      legacyWorkerUrlProvided,
    },
    demoModeActive,
  };
}
