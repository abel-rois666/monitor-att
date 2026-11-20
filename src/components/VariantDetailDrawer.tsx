import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellPlus,
  Check,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMxn, formatShortDate } from '../lib/validation';
import type { FavoriteRecord, SmartphoneVariant } from '../shared/types';
import {
  AvailabilityLabel,
  DeviceThumbnail,
  formatButtonStateLabel,
} from './AvailabilityLabel';

interface VariantDetailDrawerProps {
  variant: SmartphoneVariant | null;
  favorite?: FavoriteRecord;
  onClose: () => void;
  onToggleFavorite: (variant: SmartphoneVariant) => void;
  onSaveTargetPrice: (variantId: string, targetPriceMxn: number, notes: string) => void;
  onCreateAlertForVariant: (variant: SmartphoneVariant) => void;
}

export function VariantDetailDrawer({
  variant,
  favorite,
  onClose,
  onToggleFavorite,
  onSaveTargetPrice,
  onCreateAlertForVariant,
}: VariantDetailDrawerProps) {
  const [targetInput, setTargetInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!variant) return;
    setTargetInput(
      favorite?.targetPriceMxn ? String(favorite.targetPriceMxn) : ''
    );
    setNotesInput(favorite?.notes ?? '');
    setSavedNotice(false);
  }, [variant, favorite]);

  if (!variant) return null;

  const chartData = variant.history.map((h) => ({
    date: formatShortDate(h.date),
    rawDate: h.date,
    priceMxn: h.priceMxn,
    listPriceMxn: h.listPriceMxn,
    eventNote: h.eventNote,
  }));

  const handleSaveTarget = () => {
    const parsed = Number(targetInput.replace(/[^\d]/g, '')) || 0;
    onSaveTargetPrice(variant.id, parsed, notesInput);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de ${variant.brand} ${variant.model}`}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <aside className="relative w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-slate-200 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              Detalle de variante · Datos simulados (Etapa 1)
            </p>
            <h2 className="text-lg font-semibold text-slate-900 truncate">
              {variant.brand} {variant.model}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {/* Resumen del dispositivo */}
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <DeviceThumbnail
              src={variant.imageUrl}
              alt={`${variant.brand} ${variant.model}`}
              size="lg"
            />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{variant.storage}</span>
                <span aria-hidden="true">·</span>
                <span>{variant.color}</span>
                <span aria-hidden="true">·</span>
                <span>{variant.modality}</span>
              </div>
              <div className="font-mono text-xs text-slate-400">
                SKU simulado: {variant.skuSimulated}
              </div>

              <div className="pt-1 flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
                  {formatMxn(variant.currentPriceMxn)}
                </span>
                {variant.priceChangePct < 0 && (
                  <span className="text-sm font-mono font-medium text-emerald-700 tabular-nums">
                    {variant.priceChangePct}% vs. {formatMxn(variant.previousPriceMxn)}
                  </span>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleFavorite(variant)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    favorite
                      ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Star
                    className="w-3.5 h-3.5"
                    fill={favorite ? 'currentColor' : 'none'}
                  />
                  {favorite ? 'En favoritos' : 'Añadir a favoritos'}
                </button>

                <button
                  type="button"
                  onClick={() => onCreateAlertForVariant(variant)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap"
                >
                  <BellPlus className="w-3.5 h-3.5" />
                  Configurar alerta Telegram
                </button>
              </div>
            </div>
          </div>

          {/* Auditoría de verificación en carrito (Regla AT&T) */}
          <section className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/60">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-sky-700" aria-hidden="true" />
                Auditoría de disponibilidad (Regla anti-falso positivo)
              </div>
              <AvailabilityLabel status={variant.availability.effectiveAvailability} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
              <div>
                <div className="text-slate-500">Estado DOM del botón</div>
                <div className="font-medium text-slate-900 mt-0.5">
                  {formatButtonStateLabel(variant.availability.buttonState)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Mensaje tras clic permitido</div>
                <div className="font-mono text-slate-900 mt-0.5">
                  {variant.availability.detectedMessage
                    ? `"${variant.availability.detectedMessage}"`
                    : 'Sin mensaje de agotado'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Limpieza de carrito</div>
                <div className="font-medium text-slate-900 mt-0.5">
                  {variant.availability.probeClearedCart
                    ? 'Carrito vaciado (sin checkout)'
                    : 'No aplicó alta en carrito'}
                </div>
              </div>
            </div>

            {variant.availability.effectiveAvailability === 'out_of_stock_false_positive' && (
              <div className="pt-2 border-t border-slate-200 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  El botón <span className="font-medium">Agregar al carrito</span> aparecía
                  habilitado en la ficha, pero la sonda detectó{' '}
                  <span className="font-mono">&quot;Este producto se agotó&quot;</span>. El sistema
                  bloquea alertas de compra hasta confirmar stock real.
                </p>
              </div>
            )}
          </section>

          {/* Gráfica de historial de precios (30 días simulados) */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Historial de precios (30 días simulados)
              </h3>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                Mín {formatMxn(variant.lowestPrice30dMxn)} · Máx{' '}
                {formatMxn(variant.highestPrice30dMxn)}
              </div>
            </div>

            <div className="h-56 w-full border border-slate-200 rounded-xl p-3 bg-white">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0369a1" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#0369a1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    domain={['dataMin - 1000', 'dataMax + 1000']}
                    tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [formatMxn(Number(value)), 'Precio simulado']}
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="priceMxn"
                    stroke="#0369a1"
                    strokeWidth={2}
                    fill="url(#priceFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Eventos cronológicos de esta variante */}
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">
              Bitácora de observaciones simuladas
            </h3>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-200">
              {[...variant.history].reverse().map((point) => (
                <div
                  key={point.date}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-500">{point.date}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <AvailabilityLabel status={point.effectiveAvailability} compact />
                    </div>
                    {point.eventNote && (
                      <p className="text-slate-700">{point.eventNote}</p>
                    )}
                  </div>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                    {formatMxn(point.priceMxn)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Precio objetivo si está en favoritos */}
          {favorite && (
            <section className="border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Precio objetivo y nota personal
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-600 font-medium">Precio objetivo (MXN)</span>
                  <input
                    type="number"
                    min={0}
                    max={250000}
                    step={100}
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    placeholder="Ej. 25000"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-600 font-medium">Nota (máx. 240 caracteres)</span>
                  <input
                    type="text"
                    maxLength={240}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="Ej. Esperar rebaja en buen fin"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-500">
                  {savedNotice ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <Check className="w-3.5 h-3.5" /> Guardado
                    </span>
                  ) : (
                    'Se sincroniza automáticamente con Firestore al iniciar sesión.'
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleSaveTarget}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Guardar objetivo
                </button>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
