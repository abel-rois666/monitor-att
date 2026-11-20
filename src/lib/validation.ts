// Constraints synchronized verbatim with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  idMaxLength: 128,
  displayNameMaxLength: 100,
  productNameMaxLength: 140,
  brandMaxLength: 60,
  storageMaxLength: 40,
  colorMaxLength: 60,
  notesMaxLength: 240,
  ruleNameMinLength: 2,
  ruleNameMaxLength: 120,
  chatIdPattern: /^(-?[0-9]{0,32}|@[a-zA-Z0-9_]{0,60})$/,
  chatIdMaxLength: 64,
  topicIdPattern: /^[0-9]{0,20}$/,
  topicIdMaxLength: 32,
  channelLabelMaxLength: 80,
  maxPriceMxn: 250000,
  minCooldownMinutes: 5,
  maxCooldownMinutes: 1440,
} as const;

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isValidTelegramChatId(chatId: string): boolean {
  return (
    chatId.length <= BLUEPRINT_LIMITS.chatIdMaxLength &&
    BLUEPRINT_LIMITS.chatIdPattern.test(chatId)
  );
}

export function isValidTelegramTopicId(topicId: string): boolean {
  return (
    topicId.length <= BLUEPRINT_LIMITS.topicIdMaxLength &&
    BLUEPRINT_LIMITS.topicIdPattern.test(topicId)
  );
}

export function formatMxn(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatShortDate(isoOrYmd: string): string {
  const normalized = isoOrYmd.length === 10 ? `${isoOrYmd}T12:00:00` : isoOrYmd;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoOrYmd;
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}
