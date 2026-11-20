import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ChevronRight,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import { formatMxn, formatShortDate } from '../lib/validation';
import type {
  EffectiveAvailability,
  FavoriteRecord,
  SmartphoneVariant,
} from '../shared/types';
import {
  AvailabilityLabel,
  DeviceThumbnail,
  formatButtonStateLabel,
} from './AvailabilityLabel';

interface CatalogViewProps {
  variants: SmartphoneVariant[];
  loading: boolean;
  disclaimer: string;
  targetUrl: string;
  favorites: FavoriteRecord[];
  onToggleFavorite: (variant: SmartphoneVariant) => void;
  onSelectVariant: (variant: SmartphoneVariant) => void;
}

type AvailabilityFilter = 'all' | EffectiveAvailability;
type SortOption = 'biggest_drop' | 'price_asc' | 'price_desc' | 'brand';

export function CatalogView({
  variants,
  loading,
  disclaimer,
  targetUrl,
  favorites,
  onToggleFavorite,
  onSelectVariant,
}: CatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>('all');
  const [onlyDrops, setOnlyDrops] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('biggest_drop');

  const favoriteIds = useMemo(
    () => new Set(favorites.map((f) => f.variantId)),
    [favorites]
  );

  const brands = useMemo(() => {
    const unique = Array.from(new Set(variants.map((v) => v.brand)));
    return unique.sort();
  }, [variants]);

  const kpis = useMemo(() => {
    const verified = variants.filter(
      (v) => v.availability.effectiveAvailability === 'available_verified'
    ).length;
    const falsePositives = variants.filter(
      (v) => v.availability.effectiveAvailability === 'out_of_stock_false_positive'
    ).length;
    const drops = variants.filter((v) => v.priceChangePct < 0).length;
    return {
      total: variants.length,
      verified,
      falsePositives,
      drops,
    };
  }, [variants]);

  const filteredVariants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = variants.filter((v) => {
      if (brandFilter !== 'all' && v.brand !== brandFilter) return false;
      if (
        availabilityFilter !== 'all' &&
        v.availability.effectiveAvailability !== availabilityFilter
      ) {
        return false;
      }
      if (onlyDrops && v.priceChangePct >= 0) return false;
      if (onlyFavorites && !favoriteIds.has(v.id)) return false;
      if (q) {
        const haystack = `${v.brand} ${v.model} ${v.storage} ${v.color} ${v.skuSimulated}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'biggest_drop') return a.priceChangePct - b.priceChangePct;
      if (sortBy === 'price_asc') return a.currentPriceMxn - b.currentPriceMxn;
      if (sortBy === 'price_desc') return b.currentPriceMxn - a.currentPriceMxn;
      return `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`);
    });
  }, [
    variants,
    searchQuery,
    brandFilter,
    availabilityFilter,
    onlyDrops,
    onlyFavorites,
    sortBy,
    favoriteIds,
  ]);

  const resetFilters = () => {
    setSearchQuery('');
    setBrandFilter('all');
    setAvailabilityFilter('all');
    setOnlyDrops(false);
    setOnlyFavorites(false);
    setSortBy('biggest_drop');
  };

  const hasActiveFilters =
    searchQuery !== '' ||
    brandFilter !== 'all' ||
    availabilityFilter !== 'all' ||
    onlyDrops ||
    onlyFavorites;

  return (
    <div className="space-y-6">
      {/* Aviso explícito de simulación y regla crítica de carrito */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-slate-900">
              Entorno con datos simulados · Sin conexión activa a AT&amp;T México
            </p>
            <p className="text-slate-700 leading-relaxed">
              {disclaimer} Regla activa en el modelo: un botón{' '}
              <span className="font-medium text-slate-900">Agregar al carrito</span> habilitado
              nunca se marca como disponible sin descartar el mensaje{' '}
              <span className="font-mono text-xs text-amber-900">&quot;Este producto se agotó&quot;</span>.
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-600 font-mono shrink-0 lg:text-right">
          <div>Objetivo Etapa 2</div>
          <div className="text-slate-900">{targetUrl.replace('https://', '')}</div>
        </div>
      </div>

      {/* KPI Strip plano con divisores finos (sin tarjetas anidadas) */}
      <section
        aria-label="Resumen de catálogo simulado"
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200"
      >
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Variantes monitoreadas (simulado)</p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900 font-mono tabular-nums">
            {kpis.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">Modelos y combinaciones de capacidad</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Disponibles verificados</p>
          <p className="mt-1.5 text-2xl font-semibold text-emerald-700 font-mono tabular-nums">
            {kpis.verified}
          </p>
          <p className="mt-1 text-xs text-slate-500">Confirmados con sonda de carrito</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Falsos positivos en botón</p>
          <p className="mt-1.5 text-2xl font-semibold text-amber-700 font-mono tabular-nums">
            {kpis.falsePositives}
          </p>
          <p className="mt-1 text-xs text-slate-500">Botón activo, mensaje &quot;se agotó&quot;</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Rebajas registradas (30d)</p>
          <p className="mt-1.5 text-2xl font-semibold text-sky-700 font-mono tabular-nums">
            {kpis.drops}
          </p>
          <p className="mt-1 text-xs text-slate-500">Comparado frente a precio previo</p>
        </div>
      </section>

      {/* Barra de filtros y búsqueda */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar modelo, marca, almacenamiento o SKU simulado..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar por marca"
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
              >
                <option value="all">Todas las marcas</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>

              <select
                aria-label="Ordenar catálogo"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
              >
                <option value="biggest_drop">Mayor rebaja (%)</option>
                <option value="price_asc">Menor precio MXN</option>
                <option value="price_desc">Mayor precio MXN</option>
                <option value="brand">Marca A–Z</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Control segmentado interactivo de disponibilidad */}
            <div
              role="group"
              aria-label="Filtrar por estado de disponibilidad"
              className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
            >
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'available_verified', label: 'Disponible verificado' },
                  { id: 'out_of_stock_false_positive', label: 'Falso positivo' },
                  { id: 'out_of_stock_confirmed', label: 'Agotado' },
                  { id: 'unverified', label: 'Sin verificar' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAvailabilityFilter(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    availabilityFilter === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setOnlyDrops((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  onlyDrops
                    ? 'bg-sky-50 border-sky-300 text-sky-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Solo rebajas
              </button>
              <button
                type="button"
                onClick={() => setOnlyFavorites((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  onlyFavorites
                    ? 'bg-sky-50 border-sky-300 text-sky-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Solo favoritos ({favorites.length})
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Estado de carga (skeleton con geometría consistente) */}
        {loading ? (
          <div className="divide-y divide-slate-200">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-100" />
                  <div className="space-y-2">
                    <div className="h-4 w-44 bg-slate-100 rounded" />
                    <div className="h-3 w-32 bg-slate-100 rounded" />
                  </div>
                </div>
                <div className="h-5 w-24 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : filteredVariants.length === 0 ? (
          /* Estado vacío */
          <div className="py-14 px-6 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              No hay variantes que coincidan con los filtros seleccionados
            </p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Ajusta el criterio de búsqueda o restablece los filtros de disponibilidad para volver a
              ver el catálogo simulado completo.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Restablecer filtros
            </button>
          </div>
        ) : (
          /* Tabla de alta densidad en escritorio + filas limpias en móvil */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 pl-4 pr-3">Equipo y variante</th>
                  <th className="py-3 px-3 text-right">Precio simulado</th>
                  <th className="py-3 px-3 text-right hidden sm:table-cell">Mínimo 30d</th>
                  <th className="py-3 px-3">Disponibilidad real</th>
                  <th className="py-3 px-3 hidden xl:table-cell">Botón vs. sonda de carrito</th>
                  <th className="py-3 pl-3 pr-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredVariants.map((variant) => {
                  const isFav = favoriteIds.has(variant.id);
                  const favMeta = favorites.find((f) => f.variantId === variant.id);
                  const belowTarget =
                    favMeta &&
                    favMeta.targetPriceMxn > 0 &&
                    variant.currentPriceMxn <= favMeta.targetPriceMxn;

                  return (
                    <tr
                      key={variant.id}
                      className="hover:bg-slate-50/90 transition-colors group"
                    >
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex items-center gap-3 min-w-[230px]">
                          <DeviceThumbnail
                            src={variant.imageUrl}
                            alt={`${variant.brand} ${variant.model} ${variant.color}`}
                          />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onSelectVariant(variant)}
                              className="text-left font-semibold text-slate-900 hover:text-sky-700 transition-colors truncate block max-w-[260px]"
                            >
                              {variant.brand} {variant.model}
                            </button>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                              <span>{variant.storage}</span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className="w-2.5 h-2.5 rounded-full border border-slate-300 inline-block shrink-0"
                                  style={{ backgroundColor: variant.colorHex }}
                                  aria-hidden="true"
                                />
                                {variant.color}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] text-slate-400">
                                {variant.skuSimulated}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatMxn(variant.currentPriceMxn)}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 text-xs mt-0.5 font-mono tabular-nums">
                          {variant.priceChangePct < 0 ? (
                            <span className="inline-flex items-center text-emerald-700 font-medium">
                              <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                              {variant.priceChangePct}%
                            </span>
                          ) : (
                            <span className="text-slate-400">0.0%</span>
                          )}
                          <span className="text-slate-400 line-through">
                            {formatMxn(variant.previousPriceMxn)}
                          </span>
                        </div>
                        {belowTarget && (
                          <div className="text-[11px] text-sky-700 font-medium mt-0.5">
                            En precio objetivo
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap hidden sm:table-cell">
                        <div className="font-mono text-slate-700 tabular-nums">
                          {formatMxn(variant.lowestPrice30dMxn)}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Lista {formatMxn(variant.listPriceMxn)}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-middle">
                        <AvailabilityLabel status={variant.availability.effectiveAvailability} />
                        <div className="text-xs text-slate-500 mt-0.5">
                          {variant.availability.detectedMessage ? (
                            <span className="font-mono text-[11px] text-amber-800">
                              &quot;{variant.availability.detectedMessage}&quot;
                            </span>
                          ) : (
                            <span>
                              {formatButtonStateLabel(variant.availability.buttonState)} ·{' '}
                              {formatShortDate(variant.availability.checkedAt)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-middle hidden xl:table-cell">
                        <div className="text-xs text-slate-700">
                          {formatButtonStateLabel(variant.availability.buttonState)}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {variant.availability.cartProbeOutcome === 'confirmed_in_stock' &&
                            'Sonda aceptó alta y limpió carrito'}
                          {variant.availability.cartProbeOutcome === 'false_positive_out_of_stock' &&
                            'Clic disparó aviso de agotado'}
                          {variant.availability.cartProbeOutcome === 'button_disabled_no_probe' &&
                            'Botón inactivo; sin clic necesario'}
                          {variant.availability.cartProbeOutcome === 'not_executed' &&
                            'Sonda aún no ejecutada'}
                        </div>
                      </td>

                      <td className="py-3.5 pl-3 pr-4 text-right align-middle whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(variant)}
                            aria-label={
                              isFav
                                ? `Quitar ${variant.model} de favoritos`
                                : `Guardar ${variant.model} en favoritos`
                            }
                            aria-pressed={isFav}
                            className={`p-2 rounded-lg border transition-colors ${
                              isFav
                                ? 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
                                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <Star
                              className="w-4 h-4"
                              fill={isFav ? 'currentColor' : 'none'}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() => onSelectVariant(variant)}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            Historial
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
