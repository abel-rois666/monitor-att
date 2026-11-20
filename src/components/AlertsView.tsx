import React, { useEffect, useState } from 'react';
import {
  Check,
  Lock,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  AlertRuleRecord,
  AlertScope,
  AlertTriggerType,
  ScraperStatusResponse,
  SmartphoneVariant,
  TelegramSettingsRecord,
} from '../shared/types';
import { buildTelegramAlertPreview } from '../scraper/telegram-formatter';

interface AlertsViewProps {
  variants: SmartphoneVariant[];
  alertRules: AlertRuleRecord[];
  telegramSettings: TelegramSettingsRecord;
  scraperStatus: ScraperStatusResponse | null;
  firestoreSynced: boolean;
  preselectedVariantId: string | null;
  onClearPreselectedVariant: () => void;
  onCreateRule: (
    rule: Omit<AlertRuleRecord, 'id' | 'updatedAtIso'>
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onDeleteRule: (ruleId: string) => void;
  onSaveTelegramSettings: (
    settings: TelegramSettingsRecord
  ) => Promise<{ ok: boolean; error?: string }>;
}

const TRIGGER_LABELS: Record<AlertTriggerType, string> = {
  price_drop_percent: 'Rebaja porcentual (%)',
  target_price_mxn: 'Precio objetivo (MXN)',
  verified_restock: 'Reposición verificada en carrito',
  false_positive_warning: 'Aviso de falso positivo ("Este producto se agotó")',
};

const SCOPE_LABELS: Record<AlertScope, string> = {
  all_favorites: 'Todos mis favoritos',
  specific_variant: 'Variante específica',
  entire_catalog: 'Todo el catálogo',
};

export function AlertsView({
  variants,
  alertRules,
  telegramSettings,
  scraperStatus,
  firestoreSynced,
  preselectedVariantId,
  onClearPreselectedVariant,
  onCreateRule,
  onToggleRule,
  onDeleteRule,
  onSaveTelegramSettings,
}: AlertsViewProps) {
  const telegramTokenConfigured = scraperStatus?.telegramServerTokenConfigured ?? false;
  const telegramRealDispatchEnabled = scraperStatus?.telegramRealDispatchEnabled ?? false;
  // Formulario de configuración Telegram
  const [tgForm, setTgForm] = useState<TelegramSettingsRecord>(telegramSettings);
  const [tgMessage, setTgMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingTg, setSavingTg] = useState(false);

  // Formulario de nueva regla
  const [ruleName, setRuleName] = useState('');
  const [ruleScope, setRuleScope] = useState<AlertScope>('all_favorites');
  const [ruleVariantId, setRuleVariantId] = useState(variants[0]?.id ?? '');
  const [ruleTrigger, setRuleTrigger] = useState<AlertTriggerType>('price_drop_percent');
  const [ruleThreshold, setRuleThreshold] = useState('10');
  const [ruleCooldown, setRuleCooldown] = useState('60');
  const [requireCart, setRequireCart] = useState(true);
  const [ruleFeedback, setRuleFeedback] = useState<string | null>(null);

  // Vista previa de mensaje Telegram
  const [previewVariantId, setPreviewVariantId] = useState(variants[1]?.id ?? variants[0]?.id ?? '');
  const [previewRuleId, setPreviewRuleId] = useState(alertRules[0]?.id ?? '');
  const [serverPreviewText, setServerPreviewText] = useState<string | null>(null);
  const [serverPreviewNotice, setServerPreviewNotice] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    setTgForm(telegramSettings);
  }, [telegramSettings]);

  useEffect(() => {
    if (preselectedVariantId) {
      const target = variants.find((v) => v.id === preselectedVariantId);
      setRuleScope('specific_variant');
      setRuleVariantId(preselectedVariantId);
      if (target) {
        setRuleName(`Alerta ${target.model} (${target.storage})`);
        setPreviewVariantId(target.id);
      }
      onClearPreselectedVariant();
    }
  }, [preselectedVariantId, variants, onClearPreselectedVariant]);

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTg(true);
    setTgMessage(null);
    try {
      const res = await onSaveTelegramSettings(tgForm);
      if (res.ok) {
        setTgMessage({
          type: 'ok',
          text: firestoreSynced
            ? 'Configuración guardada en Firestore.'
            : 'Configuración guardada en sesión local.',
        });
      } else {
        setTgMessage({ type: 'err', text: res.error || 'Verifica los campos ingresados.' });
      }
    } finally {
      setSavingTg(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setRuleFeedback(null);
    const needsThreshold =
      ruleTrigger === 'price_drop_percent' || ruleTrigger === 'target_price_mxn';

    const res = await onCreateRule({
      name: ruleName,
      scope: ruleScope,
      variantId: ruleScope === 'specific_variant' ? ruleVariantId : '',
      triggerType: ruleTrigger,
      thresholdValue: needsThreshold ? Number(ruleThreshold) || 0 : 0,
      enabled: true,
      cooldownMinutes: Number(ruleCooldown) || 60,
      requireCartVerification: requireCart,
    });

    if (!res.ok) {
      setRuleFeedback(res.error || 'No se pudo crear la regla.');
      return;
    }

    setRuleName('');
    setRuleFeedback('Regla añadida.');
    setTimeout(() => setRuleFeedback(null), 2500);
  };

  const activePreviewVariant =
    variants.find((v) => v.id === previewVariantId) ?? variants[0];
  const activePreviewRule =
    alertRules.find((r) => r.id === previewRuleId) ??
    alertRules[0] ?? {
      name: 'Regla de ejemplo',
      triggerType: 'price_drop_percent' as AlertTriggerType,
      thresholdValue: 10,
      requireCartVerification: true,
    };

  const instantPreview = activePreviewVariant
    ? buildTelegramAlertPreview({
        variant: activePreviewVariant,
        rule: activePreviewRule,
        chatId: tgForm.chatId,
        topicId: tgForm.topicId,
      })
    : null;

  const handleBackendPreview = async () => {
    if (!activePreviewVariant) return;
    setLoadingPreview(true);
    setServerPreviewNotice(null);
    try {
      const res = await fetch('/api/alerts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: activePreviewVariant.id,
          ruleName: activePreviewRule.name,
          triggerType: activePreviewRule.triggerType,
          thresholdValue: activePreviewRule.thresholdValue,
          requireCartVerification: activePreviewRule.requireCartVerification,
          chatId: tgForm.chatId,
          topicId: tgForm.topicId,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          notice: string;
          preview: { plainText: string };
        };
        setServerPreviewText(data.preview.plainText);
        setServerPreviewNotice(data.notice);
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Columna izquierda: Destino Telegram + Nueva regla */}
        <div className="xl:col-span-7 space-y-6">
          {/* Configuración del canal destino */}
          <form
            onSubmit={handleSaveTelegram}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Destino de alertas Telegram
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Define el Chat ID destino y horario silencioso. Ningún envío externo ocurre en
                  Etapa 1.
                </p>
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {firestoreSynced ? 'Firestore activo' : 'Vista previa local'}
              </span>
            </div>

            <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-3 space-y-1 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">
                {telegramRealDispatchEnabled
                  ? 'Envío real habilitado en el servidor'
                  : 'Envío real de Telegram desactivado (simulación visual activa)'}
              </div>
              <p className="leading-relaxed">
                {telegramTokenConfigured
                  ? 'TELEGRAM_BOT_TOKEN está presente en el entorno del servidor, pero SCRAPER_LIVE_ENABLED sigue en false: no se despachan alertas reales.'
                  : 'TELEGRAM_BOT_TOKEN es opcional en desarrollo y actualmente no está configurado. Puedes guardar reglas, editar tu Chat ID y probar la vista previa sin credenciales reales.'}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-start gap-2.5 text-xs text-slate-700">
              <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                Por seguridad, el <span className="font-mono text-slate-900">TELEGRAM_BOT_TOKEN</span>{' '}
                nunca se ingresa ni se almacena en el navegador ni en Firestore. Se configura
                únicamente como secreto de servidor / Cloud Run Secret Manager en Etapa 4.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Nombre del canal o grupo</span>
                <input
                  type="text"
                  maxLength={80}
                  value={tgForm.channelLabel}
                  onChange={(e) => setTgForm({ ...tgForm, channelLabel: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Telegram Chat ID o @canal</span>
                <input
                  type="text"
                  maxLength={64}
                  value={tgForm.chatId}
                  onChange={(e) => setTgForm({ ...tgForm, chatId: e.target.value })}
                  placeholder="Ej. -1001982345678 o @ofertas_att"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Topic / Thread ID (opcional)</span>
                <input
                  type="text"
                  maxLength={32}
                  value={tgForm.topicId}
                  onChange={(e) => setTgForm({ ...tgForm, topicId: e.target.value })}
                  placeholder="Solo para supergrupos con temas"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Modo de despacho</span>
                <select
                  value={tgForm.dispatchMode}
                  onChange={(e) =>
                    setTgForm({
                      ...tgForm,
                      dispatchMode:
                        e.target.value === 'cloud_run_worker'
                          ? 'cloud_run_worker'
                          : 'preview_only',
                    })
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                >
                  <option value="preview_only">Solo vista previa local (Etapa 1)</option>
                  <option value="cloud_run_worker">
                    Worker Cloud Run (pendiente de Etapa 3/4)
                  </option>
                </select>
              </label>
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tgForm.quietHoursEnabled}
                  onChange={(e) =>
                    setTgForm({ ...tgForm, quietHoursEnabled: e.target.checked })
                  }
                  className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span>Horario silencioso (America/Mexico_City)</span>
              </label>

              {tgForm.quietHoursEnabled && (
                <div className="flex items-center gap-2 text-xs font-mono">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    aria-label="Hora inicio silenciosa"
                    value={tgForm.quietStartHour}
                    onChange={(e) =>
                      setTgForm({ ...tgForm, quietStartHour: Number(e.target.value) })
                    }
                    className="w-16 px-2 py-1 border border-slate-200 rounded text-center"
                  />
                  <span className="text-slate-400">a</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    aria-label="Hora fin silenciosa"
                    value={tgForm.quietEndHour}
                    onChange={(e) =>
                      setTgForm({ ...tgForm, quietEndHour: Number(e.target.value) })
                    }
                    className="w-16 px-2 py-1 border border-slate-200 rounded text-center"
                  />
                  <span className="text-slate-500">hrs</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-xs">
                {tgMessage && (
                  <span
                    className={
                      tgMessage.type === 'ok'
                        ? 'text-emerald-700 inline-flex items-center gap-1 font-medium'
                        : 'text-red-700 font-medium'
                    }
                  >
                    {tgMessage.type === 'ok' && <Check className="w-3.5 h-3.5" />}
                    {tgMessage.text}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={savingTg}
                className="px-4 py-2 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {savingTg ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </form>

          {/* Crear nueva regla */}
          <form
            onSubmit={handleCreateRule}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">Nueva regla de alerta</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-xs sm:col-span-2">
                <span className="font-medium text-slate-700">Nombre descriptivo</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Ej. Rebaja mayor a 12% en gama alta"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                />
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Condición disparadora</span>
                <select
                  value={ruleTrigger}
                  onChange={(e) => setRuleTrigger(e.target.value as AlertTriggerType)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                >
                  {(Object.keys(TRIGGER_LABELS) as AlertTriggerType[]).map((key) => (
                    <option key={key} value={key}>
                      {TRIGGER_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Alcance</span>
                <select
                  value={ruleScope}
                  onChange={(e) => setRuleScope(e.target.value as AlertScope)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                >
                  {(Object.keys(SCOPE_LABELS) as AlertScope[]).map((key) => (
                    <option key={key} value={key}>
                      {SCOPE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>

              {ruleScope === 'specific_variant' && (
                <label className="block space-y-1 text-xs sm:col-span-2">
                  <span className="font-medium text-slate-700">Variante específica</span>
                  <select
                    value={ruleVariantId}
                    onChange={(e) => setRuleVariantId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                  >
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.brand} {v.model} · {v.storage} · {v.color}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {(ruleTrigger === 'price_drop_percent' || ruleTrigger === 'target_price_mxn') && (
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-700">
                    {ruleTrigger === 'price_drop_percent'
                      ? 'Porcentaje mínimo de rebaja (%)'
                      : 'Precio máximo objetivo (MXN)'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={ruleTrigger === 'price_drop_percent' ? 90 : 250000}
                    value={ruleThreshold}
                    onChange={(e) => setRuleThreshold(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                  />
                </label>
              )}

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">
                  Enfriamiento entre avisos (minutos)
                </span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={ruleCooldown}
                  onChange={(e) => setRuleCooldown(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                />
              </label>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-700 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={requireCart}
                onChange={(e) => setRequireCart(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>
                <span className="font-medium text-slate-900">
                  Exigir verificación real de carrito (recomendado):
                </span>{' '}
                descarta avisos si el botón aparece habilitado pero devuelve &quot;Este producto se
                agotó&quot;.
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-600">{ruleFeedback}</span>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar regla
              </button>
            </div>
          </form>

          {/* Lista de reglas configuradas */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Reglas configuradas ({alertRules.length})
              </h3>
            </div>
            {alertRules.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No hay reglas creadas todavía. Usa el formulario superior para agregar tu primera
                regla de Telegram.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {alertRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            rule.enabled ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {rule.enabled ? 'Activa' : 'Pausada'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span>{TRIGGER_LABELS[rule.triggerType]}</span>
                        {rule.thresholdValue > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-700">
                              {rule.triggerType === 'price_drop_percent'
                                ? `-${rule.thresholdValue}%`
                                : `$${rule.thresholdValue.toLocaleString('es-MX')} MXN`}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{SCOPE_LABELS[rule.scope]}</span>
                        <span aria-hidden="true">·</span>
                        <span>Cooldown {rule.cooldownMinutes}m</span>
                        {rule.requireCartVerification && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-sky-700">
                              <ShieldCheck className="w-3.5 h-3.5" /> Sonda carrito obligatoria
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleRule(rule.id, !rule.enabled)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {rule.enabled ? 'Pausar' : 'Activar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRule(rule.id)}
                        aria-label={`Eliminar regla ${rule.name}`}
                        className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Columna derecha: Vista previa del formato Telegram */}
        <aside className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Vista previa de payload Telegram
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Valida cómo el worker de Etapa 4 formateará la notificación para cada escenario
              (incluyendo falsos positivos).
            </p>
          </div>

          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-slate-700">Variante simulada de prueba</span>
              <select
                value={previewVariantId}
                onChange={(e) => {
                  setPreviewVariantId(e.target.value);
                  setServerPreviewText(null);
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.storage}) —{' '}
                    {v.availability.effectiveAvailability === 'out_of_stock_false_positive'
                      ? 'Falso positivo'
                      : v.availability.effectiveAvailability === 'available_verified'
                        ? 'Disponible verificado'
                        : 'Otro estado'}
                  </option>
                ))}
              </select>
            </label>

            {alertRules.length > 0 && (
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Regla aplicada</span>
                <select
                  value={previewRuleId}
                  onChange={(e) => {
                    setPreviewRuleId(e.target.value);
                    setServerPreviewText(null);
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                >
                  {alertRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto">
            {serverPreviewText ?? instantPreview?.plainText ?? ''}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleBackendPreview}
              disabled={loadingPreview}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {loadingPreview
                ? 'Validando en /api/alerts/preview...'
                : 'Validar formato en backend Express (sin envío real)'}
            </button>
            {serverPreviewNotice && (
              <p className="text-xs text-slate-600">{serverPreviewNotice}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
