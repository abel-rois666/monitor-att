import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  clampNumber,
  isValidTelegramChatId,
  isValidTelegramTopicId,
  sanitizeText,
} from '../lib/validation';
import { useAuth } from '../context/AuthContext';
import { getSimulatedCatalogDataset } from '../shared/simulated-data';
import type {
  AlertRuleRecord,
  CatalogDatasetResponse,
  FavoriteRecord,
  ScraperStatusResponse,
  SmartphoneVariant,
  TelegramSettingsRecord,
} from '../shared/types';

const INITIAL_LOCAL_FAVORITES: FavoriteRecord[] = [
  {
    variantId: 'sim-apple-ip16pm-256-tit',
    productName: 'iPhone 16 Pro Max',
    brand: 'Apple',
    storage: '256 GB',
    color: 'Titanio Natural',
    targetPriceMxn: 27999,
    notes: 'Vigilar si baja de $28,000 MXN con stock confirmado en carrito.',
  },
  {
    variantId: 'sim-samsung-s25u-512-blk',
    productName: 'Galaxy S25 Ultra',
    brand: 'Samsung',
    storage: '512 GB',
    color: 'Negro Obsidiana',
    targetPriceMxn: 26500,
    notes: 'Actualmente muestra falso positivo en botón; esperar reposición real.',
  },
];

const INITIAL_LOCAL_RULES: AlertRuleRecord[] = [
  {
    id: 'rule-drop-10pct',
    name: 'Rebaja >= 10% en favoritos',
    scope: 'all_favorites',
    variantId: '',
    triggerType: 'price_drop_percent',
    thresholdValue: 10,
    enabled: true,
    cooldownMinutes: 60,
    requireCartVerification: true,
  },
  {
    id: 'rule-restock-verified',
    name: 'Reposición confirmada en carrito',
    scope: 'all_favorites',
    variantId: '',
    triggerType: 'verified_restock',
    thresholdValue: 0,
    enabled: true,
    cooldownMinutes: 30,
    requireCartVerification: true,
  },
  {
    id: 'rule-false-positive-watch',
    name: 'Aviso de falso positivo ("Este producto se agotó")',
    scope: 'entire_catalog',
    variantId: '',
    triggerType: 'false_positive_warning',
    thresholdValue: 0,
    enabled: false,
    cooldownMinutes: 120,
    requireCartVerification: true,
  },
];

const DEFAULT_TELEGRAM_SETTINGS: TelegramSettingsRecord = {
  chatId: '',
  topicId: '',
  channelLabel: 'Canal Alertas AT&T MX',
  quietHoursEnabled: true,
  quietStartHour: 23,
  quietEndHour: 7,
  dispatchMode: 'preview_only',
};

export function useMonitorStore() {
  const { user, authReady, workspaceReady } = useAuth();

  const [catalog, setCatalog] = useState<CatalogDatasetResponse>(() =>
    getSimulatedCatalogDataset()
  );
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [scraperStatus, setScraperStatus] = useState<ScraperStatusResponse | null>(null);

  const [favorites, setFavorites] = useState<FavoriteRecord[]>(INITIAL_LOCAL_FAVORITES);
  const [alertRules, setAlertRules] = useState<AlertRuleRecord[]>(INITIAL_LOCAL_RULES);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettingsRecord>(
    DEFAULT_TELEGRAM_SETTINGS
  );
  const [firestoreSynced, setFirestoreSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Cargar datos simulados y estado del scraper desde el backend Express
  useEffect(() => {
    let active = true;
    async function loadBackendData() {
      setCatalogLoading(true);
      try {
        const [catalogRes, statusRes] = await Promise.all([
          fetch('/api/catalog/simulated'),
          fetch('/api/scraper/status'),
        ]);
        if (active && catalogRes.ok) {
          const data = (await catalogRes.json()) as CatalogDatasetResponse;
          setCatalog(data);
        }
        if (active && statusRes.ok) {
          const status = (await statusRes.json()) as ScraperStatusResponse;
          setScraperStatus(status);
        }
      } catch {
        // Mantiene fixture local si el backend tarda en responder
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    void loadBackendData();
    return () => {
      active = false;
    };
  }, []);

  // Suscripción en tiempo real a Firestore cuando el usuario inicia sesión con Google
  useEffect(() => {
    if (!authReady || !user || !workspaceReady) {
      setFirestoreSynced(false);
      if (authReady && !user) {
        setFavorites(INITIAL_LOCAL_FAVORITES);
        setAlertRules(INITIAL_LOCAL_RULES);
        setTelegramSettings(DEFAULT_TELEGRAM_SETTINGS);
      }
      return;
    }

    const uid = user.uid;
    const favPath = `users/${uid}/favorites`;
    const rulesPath = `users/${uid}/alertRules`;
    const tgPath = `users/${uid}/telegramSettings/default`;

    const favQuery = query(collection(db, favPath), where('ownerId', '==', uid));
    const unsubFavs = onSnapshot(
      favQuery,
      (snap) => {
        const items: FavoriteRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            variantId: String(data.variantId ?? d.id),
            productName: String(data.productName ?? ''),
            brand: String(data.brand ?? ''),
            storage: String(data.storage ?? ''),
            color: String(data.color ?? ''),
            targetPriceMxn: Number(data.targetPriceMxn ?? 0),
            notes: String(data.notes ?? ''),
            updatedAtIso: data.updatedAt?.toDate?.()?.toISOString?.(),
          };
        });
        setFavorites(items);
        setFirestoreSynced(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, favPath);
      }
    );

    const rulesQuery = query(collection(db, rulesPath), where('ownerId', '==', uid));
    const unsubRules = onSnapshot(
      rulesQuery,
      (snap) => {
        const items: AlertRuleRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name ?? ''),
            scope: (data.scope as AlertRuleRecord['scope']) ?? 'all_favorites',
            variantId: String(data.variantId ?? ''),
            triggerType:
              (data.triggerType as AlertRuleRecord['triggerType']) ?? 'price_drop_percent',
            thresholdValue: Number(data.thresholdValue ?? 0),
            enabled: Boolean(data.enabled),
            cooldownMinutes: Number(data.cooldownMinutes ?? 60),
            requireCartVerification: Boolean(data.requireCartVerification),
            updatedAtIso: data.updatedAt?.toDate?.()?.toISOString?.(),
          };
        });
        setAlertRules(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, rulesPath);
      }
    );

    const unsubTg = onSnapshot(
      doc(db, 'users', uid, 'telegramSettings', 'default'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setTelegramSettings({
            chatId: String(data.chatId ?? ''),
            topicId: String(data.topicId ?? ''),
            channelLabel: String(data.channelLabel ?? 'Canal Alertas AT&T MX'),
            quietHoursEnabled: Boolean(data.quietHoursEnabled),
            quietStartHour: Number(data.quietStartHour ?? 23),
            quietEndHour: Number(data.quietEndHour ?? 7),
            dispatchMode:
              data.dispatchMode === 'cloud_run_worker' ? 'cloud_run_worker' : 'preview_only',
            updatedAtIso: data.updatedAt?.toDate?.()?.toISOString?.(),
          });
        } else {
          setTelegramSettings(DEFAULT_TELEGRAM_SETTINGS);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, tgPath);
      }
    );

    return () => {
      unsubFavs();
      unsubRules();
      unsubTg();
    };
  }, [authReady, user, workspaceReady]);

  const toggleFavorite = useCallback(
    async (variant: SmartphoneVariant) => {
      setSyncError(null);
      const exists = favorites.some((f) => f.variantId === variant.id);

      if (!user || !workspaceReady) {
        setFavorites((prev) =>
          exists
            ? prev.filter((f) => f.variantId !== variant.id)
            : [
                ...prev,
                {
                  variantId: variant.id,
                  productName: variant.model,
                  brand: variant.brand,
                  storage: variant.storage,
                  color: variant.color,
                  targetPriceMxn: Math.max(0, variant.currentPriceMxn - 1500),
                  notes: '',
                },
              ]
        );
        return;
      }

      const path = `users/${user.uid}/favorites/${variant.id}`;
      const ref = doc(db, 'users', user.uid, 'favorites', variant.id);
      try {
        if (exists) {
          await deleteDoc(ref);
        } else {
          await setDoc(ref, {
            ownerId: user.uid,
            variantId: variant.id,
            productName: sanitizeText(variant.model, BLUEPRINT_LIMITS.productNameMaxLength),
            brand: sanitizeText(variant.brand, BLUEPRINT_LIMITS.brandMaxLength),
            storage: sanitizeText(variant.storage, BLUEPRINT_LIMITS.storageMaxLength),
            color: sanitizeText(variant.color, BLUEPRINT_LIMITS.colorMaxLength),
            targetPriceMxn: clampNumber(
              Math.max(0, variant.currentPriceMxn - 1500),
              0,
              BLUEPRINT_LIMITS.maxPriceMxn
            ),
            notes: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        setSyncError('No se pudo actualizar el favorito en Firestore.');
        handleFirestoreError(err, exists ? OperationType.DELETE : OperationType.CREATE, path);
      }
    },
    [favorites, user, workspaceReady]
  );

  const updateFavoriteDetails = useCallback(
    async (variantId: string, targetPriceMxn: number, notes: string) => {
      setSyncError(null);
      const cleanPrice = clampNumber(targetPriceMxn, 0, BLUEPRINT_LIMITS.maxPriceMxn);
      const cleanNotes = sanitizeText(notes, BLUEPRINT_LIMITS.notesMaxLength);

      if (!user || !workspaceReady) {
        setFavorites((prev) =>
          prev.map((f) =>
            f.variantId === variantId
              ? { ...f, targetPriceMxn: cleanPrice, notes: cleanNotes }
              : f
          )
        );
        return;
      }

      const path = `users/${user.uid}/favorites/${variantId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'favorites', variantId), {
          targetPriceMxn: cleanPrice,
          notes: cleanNotes,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        setSyncError('No se pudo guardar el precio objetivo en Firestore.');
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user, workspaceReady]
  );

  const createAlertRule = useCallback(
    async (
      input: Omit<AlertRuleRecord, 'id' | 'updatedAtIso'>
    ): Promise<{ ok: boolean; error?: string }> => {
      setSyncError(null);
      const cleanName = sanitizeText(input.name, BLUEPRINT_LIMITS.ruleNameMaxLength);
      if (cleanName.length < BLUEPRINT_LIMITS.ruleNameMinLength) {
        return { ok: false, error: 'El nombre de la regla debe tener al menos 2 caracteres.' };
      }
      if (input.scope === 'specific_variant' && !BLUEPRINT_LIMITS.idPattern.test(input.variantId)) {
        return { ok: false, error: 'Selecciona una variante válida.' };
      }

      const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const cleanRule: AlertRuleRecord = {
        id: ruleId,
        name: cleanName,
        scope: input.scope,
        variantId: input.scope === 'specific_variant' ? input.variantId : '',
        triggerType: input.triggerType,
        thresholdValue: clampNumber(input.thresholdValue, 0, BLUEPRINT_LIMITS.maxPriceMxn),
        enabled: input.enabled,
        cooldownMinutes: clampNumber(
          input.cooldownMinutes,
          BLUEPRINT_LIMITS.minCooldownMinutes,
          BLUEPRINT_LIMITS.maxCooldownMinutes
        ),
        requireCartVerification: input.requireCartVerification,
      };

      if (!user || !workspaceReady) {
        setAlertRules((prev) => [cleanRule, ...prev]);
        return { ok: true };
      }

      const path = `users/${user.uid}/alertRules/${ruleId}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'alertRules', ruleId), {
          ownerId: user.uid,
          name: cleanRule.name,
          scope: cleanRule.scope,
          variantId: cleanRule.variantId,
          triggerType: cleanRule.triggerType,
          thresholdValue: cleanRule.thresholdValue,
          enabled: cleanRule.enabled,
          cooldownMinutes: cleanRule.cooldownMinutes,
          requireCartVerification: cleanRule.requireCartVerification,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return { ok: true };
      } catch (err) {
        setSyncError('No se pudo crear la regla en Firestore.');
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user, workspaceReady]
  );

  const toggleAlertRule = useCallback(
    async (ruleId: string, nextEnabled: boolean) => {
      setSyncError(null);
      if (!user || !workspaceReady) {
        setAlertRules((prev) =>
          prev.map((r) => (r.id === ruleId ? { ...r, enabled: nextEnabled } : r))
        );
        return;
      }

      const path = `users/${user.uid}/alertRules/${ruleId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'alertRules', ruleId), {
          enabled: nextEnabled,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        setSyncError('No se pudo actualizar el estado de la regla.');
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user, workspaceReady]
  );

  const deleteAlertRule = useCallback(
    async (ruleId: string) => {
      setSyncError(null);
      if (!user || !workspaceReady) {
        setAlertRules((prev) => prev.filter((r) => r.id !== ruleId));
        return;
      }

      const path = `users/${user.uid}/alertRules/${ruleId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'alertRules', ruleId));
      } catch (err) {
        setSyncError('No se pudo eliminar la regla.');
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user, workspaceReady]
  );

  const saveTelegramSettings = useCallback(
    async (next: TelegramSettingsRecord): Promise<{ ok: boolean; error?: string }> => {
      setSyncError(null);
      const chatId = next.chatId.trim();
      const topicId = next.topicId.trim();
      const channelLabel =
        sanitizeText(next.channelLabel, BLUEPRINT_LIMITS.channelLabelMaxLength) ||
        'Canal Alertas AT&T MX';

      if (!isValidTelegramChatId(chatId)) {
        return {
          ok: false,
          error: 'El Chat ID debe ser numérico (ej. -1001234567890) o un @canal válido.',
        };
      }
      if (!isValidTelegramTopicId(topicId)) {
        return {
          ok: false,
          error: 'El Topic ID opcional debe contener únicamente dígitos.',
        };
      }

      const cleanSettings: TelegramSettingsRecord = {
        chatId,
        topicId,
        channelLabel,
        quietHoursEnabled: Boolean(next.quietHoursEnabled),
        quietStartHour: clampNumber(next.quietStartHour, 0, 23),
        quietEndHour: clampNumber(next.quietEndHour, 0, 23),
        dispatchMode: next.dispatchMode === 'cloud_run_worker' ? 'cloud_run_worker' : 'preview_only',
      };

      if (!user || !workspaceReady) {
        setTelegramSettings(cleanSettings);
        return { ok: true };
      }

      const path = `users/${user.uid}/telegramSettings/default`;
      const ref = doc(db, 'users', user.uid, 'telegramSettings', 'default');
      try {
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          await setDoc(ref, {
            ownerId: user.uid,
            ...cleanSettings,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            chatId: cleanSettings.chatId,
            topicId: cleanSettings.topicId,
            channelLabel: cleanSettings.channelLabel,
            quietHoursEnabled: cleanSettings.quietHoursEnabled,
            quietStartHour: cleanSettings.quietStartHour,
            quietEndHour: cleanSettings.quietEndHour,
            dispatchMode: cleanSettings.dispatchMode,
            updatedAt: serverTimestamp(),
          });
        }
        return { ok: true };
      } catch (err) {
        setSyncError('No se pudo guardar la configuración de Telegram en Firestore.');
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user, workspaceReady]
  );

  return {
    catalog,
    catalogLoading,
    scraperStatus,
    favorites,
    alertRules,
    telegramSettings,
    firestoreSynced,
    syncError,
    toggleFavorite,
    updateFavoriteDetails,
    createAlertRule,
    toggleAlertRule,
    deleteAlertRule,
    saveTelegramSettings,
  };
}
