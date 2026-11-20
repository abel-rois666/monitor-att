import { useState } from 'react';
import { Check, ChevronRight, Star, Trash2 } from 'lucide-react';
import { formatMxn } from '../lib/validation';
import type { FavoriteRecord, SmartphoneVariant } from '../shared/types';
import { AvailabilityLabel, DeviceThumbnail } from './AvailabilityLabel';

interface FavoritesViewProps {
  favorites: FavoriteRecord[];
  variants: SmartphoneVariant[];
  firestoreSynced: boolean;
  onUpdateFavorite: (variantId: string, targetPriceMxn: number, notes: string) => void;
  onRemoveFavorite: (variant: SmartphoneVariant) => void;
  onSelectVariant: (variant: SmartphoneVariant) => void;
  onGoToCatalog: () => void;
}

export function FavoritesView({
  favorites,
  variants,
  firestoreSynced,
  onUpdateFavorite,
  onRemoveFavorite,
  onSelectVariant,
  onGoToCatalog,
}: FavoritesViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  const startEdit = (fav: FavoriteRecord) => {
    setEditingId(fav.variantId);
    setDraftPrice(fav.targetPriceMxn > 0 ? String(fav.targetPriceMxn) : '');
    setDraftNotes(fav.notes);
  };

  const commitEdit = (variantId: string) => {
    const parsed = Number(draftPrice.replace(/[^\d]/g, '')) || 0;
    onUpdateFavorite(variantId, parsed, draftNotes);
    setEditingId(null);
    setSavedId(variantId);
    setTimeout(() => setSavedId((curr) => (curr === variantId ? null : curr)), 2000);
  };

  if (favorites.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl py-16 px-6 text-center space-y-3">
        <Star className="w-8 h-8 text-slate-300 mx-auto" />
        <h2 className="text-base font-semibold text-slate-900">
          Aún no tienes celulares en favoritos
        </h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Marca variantes desde el catálogo para fijar precios objetivo en MXN y priorizar
          notificaciones cuando haya rebajas o reposiciones confirmadas en carrito.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onGoToCatalog}
            className="px-4 py-2 text-sm font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors"
          >
            Explorar catálogo simulado
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
        <span>
          {favorites.length}{' '}
          {favorites.length === 1 ? 'variante vigilada' : 'variantes vigiladas'}
        </span>
        <span>
          {firestoreSynced
            ? 'Sincronizado en tiempo real con Firestore'
            : 'Guardado localmente · Inicia sesión con Google para persistir en Firestore'}
        </span>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {favorites.map((fav) => {
          const variant = variants.find((v) => v.id === fav.variantId);
          if (!variant) return null;

          const isEditing = editingId === fav.variantId;
          const metTarget =
            fav.targetPriceMxn > 0 && variant.currentPriceMxn <= fav.targetPriceMxn;
          const deltaToTarget =
            fav.targetPriceMxn > 0 ? variant.currentPriceMxn - fav.targetPriceMxn : null;

          return (
            <div key={fav.variantId} className="p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <DeviceThumbnail
                    src={variant.imageUrl}
                    alt={`${variant.brand} ${variant.model}`}
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectVariant(variant)}
                        className="text-sm font-semibold text-slate-900 hover:text-sky-700 transition-colors text-left"
                      >
                        {variant.brand} {variant.model}
                      </button>
                      <span className="text-xs text-slate-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs text-slate-600">
                        {variant.storage} · {variant.color}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <AvailabilityLabel status={variant.availability.effectiveAvailability} />
                      {variant.availability.detectedMessage && (
                        <>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-amber-800">
                            &quot;{variant.availability.detectedMessage}&quot;
                          </span>
                        </>
                      )}
                    </div>

                    {fav.notes && !isEditing && (
                      <p className="text-xs text-slate-600 pt-0.5">{fav.notes}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5 shrink-0">
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Precio actual</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatMxn(variant.currentPriceMxn)}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Precio objetivo</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900">
                      {fav.targetPriceMxn > 0 ? formatMxn(fav.targetPriceMxn) : 'Sin definir'}
                    </div>
                    {deltaToTarget !== null && (
                      <div
                        className={`text-[11px] font-mono tabular-nums ${
                          metTarget ? 'text-emerald-700 font-medium' : 'text-slate-500'
                        }`}
                      >
                        {metTarget
                          ? 'Objetivo alcanzado'
                          : `Faltan ${formatMxn(deltaToTarget)}`}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(fav))}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {isEditing ? 'Cancelar' : 'Editar objetivo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectVariant(variant)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Historial
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveFavorite(variant)}
                      aria-label={`Quitar ${variant.model} de favoritos`}
                      className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {savedId === fav.variantId && !isEditing && (
                <p className="text-xs text-emerald-700 inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Objetivo actualizado.
                </p>
              )}

              {isEditing && (
                <div className="pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-slate-700">Precio objetivo (MXN)</span>
                    <input
                      type="number"
                      min={0}
                      max={250000}
                      step={100}
                      value={draftPrice}
                      onChange={(e) => setDraftPrice(e.target.value)}
                      placeholder="Ej. 24000"
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-slate-700">Nota de seguimiento</span>
                    <input
                      type="text"
                      maxLength={240}
                      value={draftNotes}
                      onChange={(e) => setDraftNotes(e.target.value)}
                      placeholder="Ej. Comprar solo si es Titanio Natural"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => commitEdit(fav.variantId)}
                      className="px-4 py-2 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Guardar cambios
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
