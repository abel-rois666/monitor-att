import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { getSimulatedCatalogDataset, SIMULATED_VARIANTS } from './src/shared/simulated-data.ts';
import { AttCrawleePlaywrightAdapter } from './src/scraper/crawlee-playwright-adapter.ts';
import { ATT_OUT_OF_STOCK_PHRASE, DEFAULT_COMPLIANCE_POLICY } from './src/scraper/contracts.ts';
import { buildTelegramAlertPreview } from './src/scraper/telegram-formatter.ts';
import { getBackendRuntimeConfig } from './src/server/runtime-config.ts';
import type { AlertTriggerType, ScraperStatusResponse } from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const scraperAdapter = new AttCrawleePlaywrightAdapter();
  const initialConfig = getBackendRuntimeConfig(false);
  const PORT = initialConfig.port;

  app.use(express.json({ limit: '100kb' }));

  // Healthcheck del backend Express (funciona sin credenciales de Telegram ni Cloud Run)
  app.get('/api/health', (_req, res) => {
    const config = getBackendRuntimeConfig(false);
    res.json({
      ok: true,
      service: 'att-price-monitor-api',
      stage: 1,
      demoModeActive: config.demoModeActive,
      liveMonitoringActive: false,
      scraperLiveEnabled: config.scraperLiveEnabled,
      telegramRealDispatchEnabled: config.telegramRealDispatchEnabled,
      cloudRunJobConfigured: config.cloudRunJob.configured,
      timestamp: new Date().toISOString(),
    });
  });

  // Catálogo simulado explícitamente identificado
  app.get('/api/catalog/simulated', (_req, res) => {
    res.json(getSimulatedCatalogDataset());
  });

  // Estado real del scraper, configuración opcional y hoja de ruta por etapas
  app.get('/api/scraper/status', (_req, res) => {
    const diagnostics = scraperAdapter.getDiagnostics();
    const config = getBackendRuntimeConfig(diagnostics.selectorsConfigured);

    const payload: ScraperStatusResponse = {
      demoModeActive: config.demoModeActive,
      liveMonitoringActive: false,
      scraperLiveEnabled: config.scraperLiveEnabled,
      targetCatalogUrl: DEFAULT_COMPLIANCE_POLICY.targetCatalogUrl,
      selectorsConfigured: false,
      telegramServerTokenConfigured: config.telegramBotTokenConfigured,
      telegramDefaultChatIdConfigured: config.telegramDefaultChatIdConfigured,
      telegramRealDispatchEnabled: config.telegramRealDispatchEnabled,
      cloudRunJob: {
        configured: config.cloudRunJob.configured,
        executionModel: config.cloudRunJob.executionModel,
        publicHttpUrlRequired: config.cloudRunJob.publicHttpUrlRequired,
        region: config.cloudRunJob.region,
        jobName: config.cloudRunJob.jobName,
        authenticatedRunApiEndpoint: config.cloudRunJob.authenticatedRunApiEndpoint,
      },
      compliancePolicy: {
        allowPurchases: DEFAULT_COMPLIANCE_POLICY.allowPurchases,
        allowCheckoutNavigation: DEFAULT_COMPLIANCE_POLICY.allowCheckoutNavigation,
        bypassSecurityControls: DEFAULT_COMPLIANCE_POLICY.bypassSecurityControls,
        requireCartProbeWhenButtonEnabled: true,
        outOfStockSignaturePhrase: ATT_OUT_OF_STOCK_PHRASE,
        clearCartAfterProbe: DEFAULT_COMPLIANCE_POLICY.clearCartImmediatelyAfterProbe,
        maxCartProbesPerVariantPerRun: DEFAULT_COMPLIANCE_POLICY.maxCartProbesPerVariantPerRun,
        noRepetitiveCartRetries: DEFAULT_COMPLIANCE_POLICY.noRepetitiveCartRetries,
        maxRequestsPerMinute: DEFAULT_COMPLIANCE_POLICY.maxRequestsPerMinute,
      },
      stages: [
        {
          stage: 1,
          title: 'Estructura Full-Stack, Firestore y Dashboard Funcional',
          status: 'completed',
          summary:
            'Interfaz React + TypeScript, API Express sin secretos obligatorios, esquema Firestore con aislamiento por usuario, catálogo simulado y contratos del scraper.',
          deliverables: [
            'Catálogo responsivo con estado de botón vs. verificación de carrito',
            'Historial de precios de 30 días y comparador interactivo (simulado)',
            'Favoritos, reglas y configuración de Telegram sincronizados en Firestore',
            'Contratos TypeScript para Crawlee + Playwright y manifiestos Cloud Run Jobs',
          ],
        },
        {
          stage: 2,
          title: 'Validación Manual de DOM y Extracción Crawlee + Playwright',
          status: 'planned',
          summary:
            'Inspección permitida de att.com.mx/market/destacados, registro real de selectores y sonda segura de carrito (máx. 1 intento por variante/corrida) para detectar "Este producto se agotó".',
          deliverables: [
            'Completar selector-registry.ts con selectores verificados manualmente',
            'Implementar discovery de variantes (capacidad, color, precio contado)',
            'Sonda de carrito con limpieza inmediata, sin reintentos repetitivos ni checkout',
          ],
        },
        {
          stage: 3,
          title: 'Worker Independiente en Cloud Run Jobs + Cloud Scheduler',
          status: 'planned',
          summary:
            'Contenedor Docker independiente (Crawlee + Playwright) sin URL HTTP pública, ejecutado vía Cloud Scheduler -> API autenticada de Cloud Run v2 (:run) con OAuth2/IAM.',
          deliverables: [
            'Construcción de imagen desde worker/Dockerfile en Artifact Registry',
            'Despliegue de Cloud Run Job con Service Account dedicada (roles/datastore.user + Secret Manager)',
            'Programación con Cloud Scheduler (roles/run.invoker) invocando Cloud Run Admin API v2',
          ],
        },
        {
          stage: 4,
          title: 'Despacho Real de Alertas Telegram y Observabilidad',
          status: 'planned',
          summary:
            'Evaluación de cambios de precio y reposiciones confirmadas con envío deduplicado a Telegram usando TELEGRAM_BOT_TOKEN en Secret Manager.',
          deliverables: [
            'Motor de diff de precios y enfriamiento (cooldown) por regla',
            'Integración Bot API solo cuando TELEGRAM_BOT_TOKEN esté configurado en el worker',
            'Bitácora de corridas y alertas despachadas en Firestore',
          ],
        },
      ],
    };

    res.json({
      ...payload,
      adapterDiagnostics: diagnostics,
    });
  });

  // Vista previa local de mensaje de alerta Telegram (funciona sin TELEGRAM_BOT_TOKEN; sin envío externo)
  app.post('/api/alerts/preview', (req, res) => {
    const config = getBackendRuntimeConfig(false);
    const body = req.body as {
      variantId?: string;
      ruleName?: string;
      triggerType?: AlertTriggerType;
      thresholdValue?: number;
      requireCartVerification?: boolean;
      chatId?: string;
      topicId?: string;
    };

    const variant =
      SIMULATED_VARIANTS.find((v) => v.id === body.variantId) ?? SIMULATED_VARIANTS[0];

    const allowedTriggers: AlertTriggerType[] = [
      'price_drop_percent',
      'target_price_mxn',
      'verified_restock',
      'false_positive_warning',
    ];
    const triggerType =
      body.triggerType && allowedTriggers.includes(body.triggerType)
        ? body.triggerType
        : 'price_drop_percent';

    const effectiveChatId = (
      body.chatId ||
      process.env.TELEGRAM_DEFAULT_CHAT_ID ||
      ''
    ).slice(0, 64);

    const preview = buildTelegramAlertPreview({
      variant,
      rule: {
        name: (body.ruleName || 'Regla de monitoreo').slice(0, 120),
        triggerType,
        thresholdValue: Number(body.thresholdValue) || 10,
        requireCartVerification: body.requireCartVerification !== false,
      },
      chatId: effectiveChatId,
      topicId: (body.topicId || '').slice(0, 32),
    });

    res.json({
      dispatchedToTelegram: false,
      telegramTokenConfigured: config.telegramBotTokenConfigured,
      telegramRealDispatchEnabled: config.telegramRealDispatchEnabled,
      mode: 'simulated_preview_only',
      notice: config.telegramBotTokenConfigured
        ? 'Vista previa generada en el backend (modo demostración). No se realizó ningún envío externo.'
        : 'Telegram no está configurado (TELEGRAM_BOT_TOKEN ausente): el envío real está desactivado, pero la simulación visual funciona con normalidad.',
      preview,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AT&T Price Monitor escuchando en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
