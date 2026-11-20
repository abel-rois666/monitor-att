import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Smartphone,
  XCircle,
} from 'lucide-react';
import type {
  AddToCartButtonState,
  EffectiveAvailability,
} from '../shared/types';

export function AvailabilityLabel({
  status,
  compact = false,
}: {
  status: EffectiveAvailability;
  compact?: boolean;
}) {
  if (status === 'available_verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{compact ? 'Disponible' : 'Disponible verificado'}</span>
      </span>
    );
  }

  if (status === 'out_of_stock_false_positive') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{compact ? 'Falso positivo' : 'Falso positivo (Agotado)'}</span>
      </span>
    );
  }

  if (status === 'out_of_stock_confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Agotado</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{compact ? 'Sin verificar' : 'Sin verificar en carrito'}</span>
    </span>
  );
}

export function formatButtonStateLabel(state: AddToCartButtonState): string {
  if (state === 'enabled') return 'Botón habilitado';
  if (state === 'disabled') return 'Botón deshabilitado';
  return 'Botón no detectado';
}

export function DeviceThumbnail({
  src,
  alt,
  size = 'md',
}: {
  src: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);

  const sizeClass =
    size === 'sm'
      ? 'w-10 h-10 rounded-lg'
      : size === 'lg'
        ? 'w-24 h-24 rounded-xl'
        : 'w-12 h-12 rounded-lg';

  if (failed || !src) {
    return (
      <div
        className={`${sizeClass} bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0`}
        aria-label={alt}
      >
        <Smartphone className={size === 'lg' ? 'w-8 h-8' : 'w-5 h-5'} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClass} object-cover border border-slate-200/80 bg-slate-100 shrink-0`}
    />
  );
}
