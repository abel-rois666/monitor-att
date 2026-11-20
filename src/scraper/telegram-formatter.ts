import type { AlertRuleRecord, SmartphoneVariant } from '../shared/types.ts';

function formatMxn(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

export interface TelegramAlertPreview {
  triggerLabel: string;
  plainText: string;
  metadata: {
    chatId: string;
    topicId: string;
    isSimulatedPreview: true;
    cartVerificationStatus: string;
  };
}

export function buildTelegramAlertPreview(params: {
  variant: SmartphoneVariant;
  rule: Pick<AlertRuleRecord, 'name' | 'triggerType' | 'thresholdValue' | 'requireCartVerification'>;
  chatId: string;
  topicId?: string;
}): TelegramAlertPreview {
  const { variant, rule, chatId, topicId = '' } = params;

  const availabilityText =
    variant.availability.effectiveAvailability === 'available_verified'
      ? 'Disponible (verificado con carrito)'
      : variant.availability.effectiveAvailability === 'out_of_stock_false_positive'
        ? 'Agotado — Falso positivo en botón ("Este producto se agotó")'
        : variant.availability.effectiveAvailability === 'out_of_stock_confirmed'
          ? 'Agotado (botón deshabilitado)'
          : 'Sin verificar en carrito (no confirmado)';

  const triggerHeaders: Record<AlertRuleRecord['triggerType'], string> = {
    price_drop_percent: 'REBAJA DETECTADA',
    target_price_mxn: 'PRECIO OBJETIVO ALCANZADO',
    verified_restock: 'REPOSICIÓN VERIFICADA EN CARRITO',
    false_positive_warning: 'FALSO POSITIVO DE INVENTARIO DETECTADO',
  };

  const triggerLabel = triggerHeaders[rule.triggerType];
  const deltaMxn = variant.currentPriceMxn - variant.previousPriceMxn;
  const deltaSign = deltaMxn > 0 ? '+' : '';

  const lines = [
    `[VISTA PREVIA SIMULADA] ${triggerLabel}`,
    `Regla: ${rule.name}`,
    '',
    `Equipo: ${variant.brand} ${variant.model}`,
    `Variante: ${variant.storage} · ${variant.color}`,
    `Precio actual: ${formatMxn(variant.currentPriceMxn)} (${deltaSign}${formatMxn(deltaMxn)} / ${variant.priceChangePct > 0 ? '+' : ''}${variant.priceChangePct}%)`,
    `Precio anterior: ${formatMxn(variant.previousPriceMxn)} · Lista: ${formatMxn(variant.listPriceMxn)}`,
    `Estado real: ${availabilityText}`,
    `Botón en ficha: ${variant.availability.buttonState === 'enabled' ? 'Habilitado' : 'Deshabilitado'}`,
    variant.availability.detectedMessage
      ? `Mensaje detectado: "${variant.availability.detectedMessage}"`
      : 'Mensaje detectado: Ninguno',
    `Verificación obligatoria de carrito: ${rule.requireCartVerification ? 'Activa' : 'Opcional'}`,
    '',
    `Fuente objetivo: ${variant.targetCatalogUrl}`,
    'Nota: Este es un formato de vista previa basado en datos simulados (Etapa 1).',
  ];

  return {
    triggerLabel,
    plainText: lines.join('\n'),
    metadata: {
      chatId: chatId || '(sin Chat ID configurado)',
      topicId,
      isSimulatedPreview: true,
      cartVerificationStatus: availabilityText,
    },
  };
}
