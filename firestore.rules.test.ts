import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

/**
 * Suite ejecutable de pruebas de reglas Firestore con Firebase Emulator Suite
 * (`@firebase/rules-unit-testing`).
 *
 * Ejecutar con:
 *   npm run test:rules
 * (requiere Firebase Emulator Suite y Java 11+ JRE instalado en el entorno).
 */

const PROJECT_ID = 'att-price-monitor-rules-test';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(rulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedOwnerWorkspace(uid: string) {
  const ctx = testEnv.authenticatedContext(uid, { email_verified: true });
  const db = ctx.firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users', uid), {
      uid,
      displayName: `Usuario ${uid}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  return db;
}

describe('Firestore Security Rules — Aislamiento por propietario y Dirty Dozen', () => {
  it('Permite al propietario verificado crear, leer, actualizar y borrar sus propios datos', async () => {
    const dbAlpha = await seedOwnerWorkspace('user_alpha');

    // Leer perfil propio
    await assertSucceeds(getDoc(doc(dbAlpha, 'users', 'user_alpha')));

    // Crear y actualizar favorito propio
    const favRef = doc(dbAlpha, 'users', 'user_alpha', 'favorites', 'sim-apple-ip16pm-256-tit');
    await assertSucceeds(
      setDoc(favRef, {
        ownerId: 'user_alpha',
        variantId: 'sim-apple-ip16pm-256-tit',
        productName: 'iPhone 16 Pro Max',
        brand: 'Apple',
        storage: '256 GB',
        color: 'Titanio Natural',
        targetPriceMxn: 27000,
        notes: 'Vigilar stock verificado',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(favRef, {
        targetPriceMxn: 26500,
        notes: 'Nuevo objetivo',
        updatedAt: serverTimestamp(),
      })
    );

    // Listar favoritos propios filtrados por ownerId
    await assertSucceeds(
      getDocs(
        query(
          collection(dbAlpha, 'users', 'user_alpha', 'favorites'),
          where('ownerId', '==', 'user_alpha')
        )
      )
    );

    // Crear y pausar regla de alerta propia
    const ruleRef = doc(dbAlpha, 'users', 'user_alpha', 'alertRules', 'rule_drop_10');
    await assertSucceeds(
      setDoc(ruleRef, {
        ownerId: 'user_alpha',
        name: 'Rebaja 10%',
        scope: 'all_favorites',
        variantId: '',
        triggerType: 'price_drop_percent',
        thresholdValue: 10,
        enabled: true,
        cooldownMinutes: 60,
        requireCartVerification: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(ruleRef, {
        enabled: false,
        updatedAt: serverTimestamp(),
      })
    );

    // Crear configuración no secreta de Telegram (singleton default)
    const tgRef = doc(dbAlpha, 'users', 'user_alpha', 'telegramSettings', 'default');
    await assertSucceeds(
      setDoc(tgRef, {
        ownerId: 'user_alpha',
        chatId: '-1001234567890',
        topicId: '',
        channelLabel: 'Canal Ofertas AT&T',
        quietHoursEnabled: true,
        quietStartHour: 23,
        quietEndHour: 7,
        dispatchMode: 'preview_only',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Eliminar favorito y regla propios
    await assertSucceeds(deleteDoc(favRef));
    await assertSucceeds(deleteDoc(ruleRef));
  });

  it('Bloquea completamente acceso anónimo y acceso cruzado entre usuarios', async () => {
    const dbAlpha = await seedOwnerWorkspace('user_alpha');
    const favRefAlpha = doc(dbAlpha, 'users', 'user_alpha', 'favorites', 'var_1');
    await assertSucceeds(
      setDoc(favRefAlpha, {
        ownerId: 'user_alpha',
        variantId: 'var_1',
        productName: 'Galaxy S25 Ultra',
        brand: 'Samsung',
        storage: '512 GB',
        color: 'Negro',
        targetPriceMxn: 25000,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const dbAnon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(dbAnon, 'users', 'user_alpha')));
    await assertFails(getDoc(doc(dbAnon, 'users', 'user_alpha', 'favorites', 'var_1')));

    const dbBeta = testEnv
      .authenticatedContext('user_beta', { email_verified: true })
      .firestore();
    await assertFails(getDoc(doc(dbBeta, 'users', 'user_alpha')));
    await assertFails(getDoc(doc(dbBeta, 'users', 'user_alpha', 'favorites', 'var_1')));
    await assertFails(
      getDocs(
        query(
          collection(dbBeta, 'users', 'user_alpha', 'favorites'),
          where('ownerId', '==', 'user_alpha')
        )
      )
    );
    await assertFails(deleteDoc(doc(dbBeta, 'users', 'user_alpha', 'favorites', 'var_1')));
  });

  it('Bloquea ataques de Dirty Dozen: campos fantasma, botToken, email no verificado y huérfanos', async () => {
    // 1. Campo fantasma (role: admin) en perfil
    const dbGamma = testEnv
      .authenticatedContext('user_gamma', { email_verified: true })
      .firestore();
    await assertFails(
      setDoc(doc(dbGamma, 'users', 'user_gamma'), {
        uid: 'user_gamma',
        displayName: 'Gamma',
        role: 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Escritura huérfana en subcolección sin documento padre /users/{uid}
    await assertFails(
      setDoc(doc(dbGamma, 'users', 'user_gamma', 'favorites', 'orphan_var'), {
        ownerId: 'user_gamma',
        variantId: 'orphan_var',
        productName: 'Test',
        brand: 'Test',
        storage: '128 GB',
        color: 'Negro',
        targetPriceMxn: 10000,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 3. Usuario con email_verified=false rechazado en escrituras
    const dbUnverified = testEnv
      .authenticatedContext('user_unverified', { email_verified: false })
      .firestore();
    await assertFails(
      setDoc(doc(dbUnverified, 'users', 'user_unverified'), {
        uid: 'user_unverified',
        displayName: 'Sin verificar',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 4. Intento de inyectar botToken o usar ID distinto de 'default' en telegramSettings
    const dbAlpha = await seedOwnerWorkspace('user_alpha');
    await assertFails(
      setDoc(doc(dbAlpha, 'users', 'user_alpha', 'telegramSettings', 'default'), {
        ownerId: 'user_alpha',
        chatId: '-100123456',
        topicId: '',
        channelLabel: 'Canal',
        botToken: 'SECRET_MUST_NEVER_BE_STORED',
        quietHoursEnabled: false,
        quietStartHour: 23,
        quietEndHour: 7,
        dispatchMode: 'preview_only',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(doc(dbAlpha, 'users', 'user_alpha', 'telegramSettings', 'other_doc'), {
        ownerId: 'user_alpha',
        chatId: '-100123456',
        topicId: '',
        channelLabel: 'Canal',
        quietHoursEnabled: false,
        quietStartHour: 23,
        quietEndHour: 7,
        dispatchMode: 'preview_only',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 5. Precio negativo o notas sobredimensionadas (> 240 chars)
    await assertFails(
      setDoc(doc(dbAlpha, 'users', 'user_alpha', 'favorites', 'bad_price'), {
        ownerId: 'user_alpha',
        variantId: 'bad_price',
        productName: 'Test',
        brand: 'Test',
        storage: '128 GB',
        color: 'Negro',
        targetPriceMxn: -100,
        notes: 'x'.repeat(500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});
