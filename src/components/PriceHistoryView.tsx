import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMxn, formatShortDate } from '../lib/validation';
import type { SmartphoneVariant } from '../shared/types';
import { AvailabilityLabel } from './AvailabilityLabel';

interface PriceHistoryViewProps {
  variants: SmartphoneVariant[];
  onSelectVariant: (variant: SmartphoneVariant) => void;
}

const SERIES_COLORS = ['#0369a1', '#0f766e', '#b45309'];

export function PriceHistoryView({
  variants,
  onSelectVariant,
}: PriceHistoryViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    variants.slice(0, 3).map((v) => v.id)
  );
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(30);

  const toggleSeries = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((item) => item !== id) : prev;
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const activeVariants = useMemo(
    () => variants.filter((v) => selectedIds.includes(v.id)),
    [variants, selectedIds]
  );

  const mergedChartData = useMemo(() => {
    const cutoff = new Date('2026-11-19T12:00:00-06:00');
    cutoff.setDate(cutoff.getDate() - rangeDays);

    const allDates = new Set<string>();
    for (const variant of activeVariants) {
      for (const h of variant.history) {
        if (new Date(`${h.date}T12:00:00-06:00`) >= cutoff) {
          allDates.add(h.date);
        }
      }
    }

    const sortedDates = Array.from(allDates).sort();
    return sortedDates.map((date) => {
      const row: Record<string, string | number | null> = {
        date: formatShortDate(date),
        rawDate: date,
      };
      for (const v of activeVariants) {
        // Carry forward last known price on or before date
        const validPoints = v.history.filter((p) => p.date <= date);
        const latest = validPoints[validPoints.length - 1];
        row[v.id] = latest ? latest.priceMxn : null;
      }
      return row;
    });
  }, [activeVariants, rangeDays]);

  const timelineEvents = useMemo(() => {
    const events: Array<{
      date: string;
      variant: SmartphoneVariant;
      priceMxn: number;
      eventTag: string;
      eventNote: string;
      availability: SmartphoneVariant['availability']['effectiveAvailability'];
    }> = [];

    for (const variant of variants) {
      for (const point of variant.history) {
        if (point.eventTag && point.eventNote) {
          events.push({
            date: point.date,
            variant,
            priceMxn: point.priceMxn,
            eventTag: point.eventTag,
            eventNote: point.eventNote,
            availability: point.effectiveAvailability,
          });
        }
      }
    }

    return events.sort((a, b) => b.date.localeCompare(a.date));
  }, [variants]);

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Comparador histórico de precios (datos simulados)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Selecciona hasta 3 variantes para contrastar evolución de precios en MXN.
            </p>
          </div>

          <div
            role="group"
            aria-label="Rango temporal"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
          >
            {([7, 14, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rangeDays === days
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Últimos {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Selector interactivo de variantes */}
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => {
            const idx = selectedIds.indexOf(v.id);
            const active = idx !== -1;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggleSeries(v.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {active && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                    aria-hidden="true"
                  />
                )}
                <span>
                  {v.model} ({v.storage})
                </span>
              </button>
            );
          })}
        </div>

        <div className="h-80 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedChartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
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
                width={68}
                tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const matched = variants.find((v) => v.id === String(name));
                  const label = matched
                    ? `${matched.model} (${matched.storage})`
                    : String(name);
                  return [formatMxn(Number(value)), label];
                }}
                contentStyle={{
                  fontSize: '12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Legend
                formatter={(value) => {
                  const matched = variants.find((v) => v.id === String(value));
                  return matched ? `${matched.model} · ${matched.storage}` : String(value);
                }}
                wrapperStyle={{ fontSize: '12px' }}
              />
              {activeVariants.map((v, idx) => (
                <Line
                  key={v.id}
                  type="monotone"
                  dataKey={v.id}
                  stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                  strokeWidth={2.2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Registro cronológico de eventos relevantes */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Eventos detectados de precio y existencia (simulados)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Incluye rebajas, reposiciones confirmadas en carrito y falsos positivos del botón.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {timelineEvents.map((ev, index) => (
            <div
              key={`${ev.variant.id}-${ev.date}-${index}`}
              className="px-5 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm hover:bg-slate-50/70 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{ev.date}</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onSelectVariant(ev.variant)}
                    className="font-semibold text-slate-900 hover:text-sky-700 transition-colors"
                  >
                    {ev.variant.brand} {ev.variant.model} ({ev.variant.storage})
                  </button>
                  <span aria-hidden="true">·</span>
                  <AvailabilityLabel status={ev.availability} compact />
                </div>
                <p className="text-xs text-slate-700">{ev.eventNote}</p>
              </div>
              <div className="font-mono font-semibold text-slate-900 tabular-nums text-sm shrink-0">
                {formatMxn(ev.priceMxn)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
