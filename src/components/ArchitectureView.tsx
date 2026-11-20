import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Layers,
  Shield,
} from 'lucide-react';
import type { ScraperStatusResponse } from '../shared/types';

interface ArchitectureViewProps {
  scraperStatus: ScraperStatusResponse | null;
}

export function ArchitectureView({ scraperStatus }: ArchitectureViewProps) {
  const policy = scraperStatus?.compliancePolicy;
  const stages = scraperStatus?.stages ?? [];

  return (
    <div className="space-y-6">
      {/* Mapa de arquitectura full-stack */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Arquitectura modular preparada para GitHub y Cloud Run
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Separación estricta entre interfaz web, almacenamiento histórico en Firestore y servicio
            independiente de extracción programada.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Layers className="w-4 h-4 text-sky-700" aria-hidden="true" />
              <span>1. Frontend React + TS</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Dashboard responsivo con catálogo, filtros, comparador histórico de precios, favoritos
              y configuración de reglas Telegram.
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Database className="w-4 h-4 text-sky-700" aria-hidden="true" />
              <span>2. Firestore + Reglas</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Persistencia real de favoritos, reglas y destino Telegram bajo aislamiento por usuario
              (y snapshots históricos en Etapa 3).
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Cloud className="w-4 h-4 text-sky-700" aria-hidden="true" />
              <span>3. Cloud Run Job</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Contenedor independiente (Crawlee + Playwright) sin URL HTTP pública: se invoca vía
              Cloud Scheduler y API autenticada de Cloud Run v2 (:run) con OAuth2/IAM.
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Shield className="w-4 h-4 text-sky-700" aria-hidden="true" />
              <span>4. Despacho Telegram</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Opcional en desarrollo. Cuando se configure en Etapa 4, usa{' '}
              <span className="font-mono">TELEGRAM_BOT_TOKEN</span> en Secret Manager y solo avisa
              stock confirmado en carrito.
            </p>
          </div>
        </div>
      </section>

      {/* Máquina de estados anti-falso positivo de AT&T */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Máquina de estados: Verificación de carrito en AT&amp;T México
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Implementada en <span className="font-mono">resolveEffectiveAvailability()</span>. El
              botón habilitado nunca equivale a disponibilidad real; se permite como máximo 1 sonda
              por variante y corrida (sin reintentos repetitivos ni checkout).
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Estado DOM del botón</th>
                <th className="py-2.5 px-4 font-medium">Resultado de sonda permitida</th>
                <th className="py-2.5 px-4 font-medium">Estado efectivo resuelto</th>
                <th className="py-2.5 pl-4 font-medium">¿Dispara alerta de stock?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-2.5 pr-4 font-mono">disabled / not_found</td>
                <td className="py-2.5 px-4">Sin clic (omitido)</td>
                <td className="py-2.5 px-4 font-medium text-red-700">out_of_stock_confirmed</td>
                <td className="py-2.5 pl-4">No</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono">enabled</td>
                <td className="py-2.5 px-4">
                  Muestra <span className="font-mono text-amber-800">&quot;Este producto se agotó&quot;</span>
                </td>
                <td className="py-2.5 px-4 font-medium text-amber-700">
                  out_of_stock_false_positive
                </td>
                <td className="py-2.5 pl-4">No (opcional aviso de falso positivo)</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono">enabled</td>
                <td className="py-2.5 px-4">Sonda no ejecutada o bloqueada</td>
                <td className="py-2.5 px-4 font-medium text-slate-600">unverified</td>
                <td className="py-2.5 pl-4">No (nunca asumir stock)</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono">enabled</td>
                <td className="py-2.5 px-4">Acepta alta y limpia carrito inmediatamente</td>
                <td className="py-2.5 px-4 font-medium text-emerald-700">available_verified</td>
                <td className="py-2.5 pl-4 font-medium text-emerald-700">Sí (confirmado)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Estado actual del scraper y controles de cumplimiento */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Estado actual, IAM y guardas de cumplimiento
          </h3>
          <dl className="divide-y divide-slate-200 text-xs">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Modo demostración</dt>
              <dd className="font-mono font-medium text-amber-700">
                {scraperStatus?.demoModeActive !== false ? 'true (sin worker desplegado)' : 'false'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">SCRAPER_LIVE_ENABLED</dt>
              <dd className="font-mono font-medium text-slate-900">
                {String(scraperStatus?.scraperLiveEnabled ?? false)} (default false)
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Selectores DOM validados</dt>
              <dd className="font-mono font-medium text-slate-900">
                {scraperStatus?.selectorsConfigured ? 'true' : 'false (sin inventar)'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Disparador Cloud Run Job</dt>
              <dd className="font-mono font-medium text-slate-900 text-right">
                Cloud Scheduler → Run API v2 (sin URL pública)
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Worker Cloud Run desplegado</dt>
              <dd className="font-mono font-medium text-slate-900">
                {scraperStatus?.cloudRunJob.configured ? 'Configurado' : 'No desplegado (Etapa 3)'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Envío real Telegram</dt>
              <dd className="font-mono font-medium text-slate-900">
                {scraperStatus?.telegramRealDispatchEnabled
                  ? 'Habilitado'
                  : 'Desactivado (solo vista previa)'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Compras / checkout / evasión</dt>
              <dd className="font-mono font-medium text-emerald-700">
                false / false / false
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Sondas de carrito por variante/corrida</dt>
              <dd className="font-mono font-medium text-slate-900 tabular-nums">
                máx. {policy?.maxCartProbesPerVariantPerRun ?? 1} · {policy?.maxRequestsPerMinute ?? 6} req/min
              </dd>
            </div>
          </dl>

          <div className="pt-2 border-t border-slate-200 text-xs text-slate-600 space-y-1 leading-relaxed">
            <p className="font-medium text-slate-800">Modelo de acceso Firestore e IAM:</p>
            <p>
              El frontend accede a Firestore con SDK cliente bajo <span className="font-mono">firestore.rules</span> (aislamiento estricto por <span className="font-mono">request.auth.uid</span>). El backend Express actual no usa <span className="font-mono">firebase-admin</span> ni requiere roles IAM. En Etapa 3, el Cloud Run Job requerirá un proyecto GCP propio con Service Accounts dedicadas (<span className="font-mono">roles/run.invoker</span> en Scheduler y <span className="font-mono">roles/datastore.user</span> en el worker).
            </p>
          </div>
        </section>

        {/* Hoja de ruta por etapas */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Implementación por etapas
          </h3>
          <div className="divide-y divide-slate-200">
            {stages.map((stage) => (
              <div key={stage.stage} className="py-3.5 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Etapa {stage.stage}. {stage.title}
                  </h4>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                      stage.status === 'completed' ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {stage.status === 'completed' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Implementada
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5" /> Planificada
                      </>
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{stage.summary}</p>
                <ul className="text-xs text-slate-500 space-y-1 pl-4 list-disc">
                  {stage.deliverables.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
