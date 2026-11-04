import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  setPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Project ID padrão de Produção do ecossistema Hikari
 */
export const DEFAULT_PRODUCTION_PROJECT_ID = 'hikari-user-profiles';

/**
 * Projetos autorizados para os ecossistemas do Hikari.
 * Em produção o padrão é 'hikari-user-profiles'; em testes/Preview aceita-se 'hikari-perfil-testes'.
 */
export const ALLOWED_FIREBASE_PROJECT_IDS = [
  'hikari-user-profiles',
  'hikari-perfil-testes',
] as const;

export function isAuthorizedHikariProjectId(projectId: string | null | undefined): boolean {
  if (!projectId || typeof projectId !== 'string') return false;
  const clean = projectId.trim();
  if (ALLOWED_FIREBASE_PROJECT_IDS.includes(clean as (typeof ALLOWED_FIREBASE_PROJECT_IDS)[number])) {
    return true;
  }
  // Proteção contra conexão acidental a projetos alheios: exige o padrão de namespace 'hikari-*'
  return clean.startsWith('hikari-') && clean.length > 7;
}

function resolveExpectedProjectId(): string {
  const envVal = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_PROJECT_ID : undefined)
  )?.trim();

  if (envVal && isAuthorizedHikariProjectId(envVal)) {
    return envVal;
  }
  return DEFAULT_PRODUCTION_PROJECT_ID;
}

export const EXPECTED_FIREBASE_PROJECT_ID = resolveExpectedProjectId();

export const REQUIRED_FIREBASE_WEB_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export type FirebaseWebEnvKey = (typeof REQUIRED_FIREBASE_WEB_ENV_KEYS)[number];

export interface FirebaseConfigStatus {
  isConfigured: boolean;
  isInitialized: boolean;
  expectedProjectId: string;
  projectId: string | null;
  projectIdMatchesExpected: boolean;
  missingEnvVars: FirebaseWebEnvKey[];
  initializationError: string | null;
}

function readCleanEnv(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function evaluateFirebaseEnv(
  envSource: Partial<Record<FirebaseWebEnvKey | 'VITE_FIREBASE_MEASUREMENT_ID' | 'VITE_FIREBASE_FIRESTORE_DATABASE_ID', string | undefined>>
): {
  options: FirebaseOptions | null;
  firestoreDatabaseId?: string;
  missingEnvVars: FirebaseWebEnvKey[];
  projectId: string | null;
} {
  const missingEnvVars: FirebaseWebEnvKey[] = [];

  for (const key of REQUIRED_FIREBASE_WEB_ENV_KEYS) {
    if (!readCleanEnv(envSource[key])) {
      missingEnvVars.push(key);
    }
  }

  const projectId = readCleanEnv(envSource.VITE_FIREBASE_PROJECT_ID) ?? null;

  if (missingEnvVars.length > 0) {
    return {
      options: null,
      missingEnvVars,
      projectId,
    };
  }

  const measurementId = readCleanEnv(envSource.VITE_FIREBASE_MEASUREMENT_ID);
  const firestoreDatabaseId = readCleanEnv(envSource.VITE_FIREBASE_FIRESTORE_DATABASE_ID);

  return {
    options: {
      apiKey: readCleanEnv(envSource.VITE_FIREBASE_API_KEY),
      authDomain: readCleanEnv(envSource.VITE_FIREBASE_AUTH_DOMAIN),
      projectId: projectId ?? undefined,
      appId: readCleanEnv(envSource.VITE_FIREBASE_APP_ID),
      storageBucket: readCleanEnv(envSource.VITE_FIREBASE_STORAGE_BUCKET),
      messagingSenderId: readCleanEnv(envSource.VITE_FIREBASE_MESSAGING_SENDER_ID),
      ...(measurementId ? { measurementId } : {}),
    },
    firestoreDatabaseId,
    missingEnvVars: [],
    projectId,
  };
}

const clientMetaEnv = typeof import.meta !== 'undefined' && import.meta && import.meta.env ? import.meta.env : undefined;

const metaEnv: Record<string, string | undefined> = {
  VITE_FIREBASE_API_KEY:
    clientMetaEnv?.VITE_FIREBASE_API_KEY ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_API_KEY : undefined),
  VITE_FIREBASE_AUTH_DOMAIN:
    clientMetaEnv?.VITE_FIREBASE_AUTH_DOMAIN ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined),
  VITE_FIREBASE_PROJECT_ID:
    clientMetaEnv?.VITE_FIREBASE_PROJECT_ID ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_PROJECT_ID : undefined),
  VITE_FIREBASE_APP_ID:
    clientMetaEnv?.VITE_FIREBASE_APP_ID ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_APP_ID : undefined),
  VITE_FIREBASE_STORAGE_BUCKET:
    clientMetaEnv?.VITE_FIREBASE_STORAGE_BUCKET ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined),
  VITE_FIREBASE_MESSAGING_SENDER_ID:
    clientMetaEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined),
  VITE_FIREBASE_MEASUREMENT_ID:
    clientMetaEnv?.VITE_FIREBASE_MEASUREMENT_ID ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MEASUREMENT_ID : undefined),
  VITE_FIREBASE_FIRESTORE_DATABASE_ID:
    clientMetaEnv?.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    (typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_FIRESTORE_DATABASE_ID : undefined),
};

const evaluated = evaluateFirebaseEnv({
  VITE_FIREBASE_API_KEY: metaEnv.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: metaEnv.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_APP_ID: metaEnv.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_STORAGE_BUCKET: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_MEASUREMENT_ID: metaEnv.VITE_FIREBASE_MEASUREMENT_ID,
  VITE_FIREBASE_FIRESTORE_DATABASE_ID: metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
});

const isConfigured = evaluated.options !== null;

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let initializationError: string | null = null;

if (isConfigured && evaluated.options) {
  try {
    // Prevent duplicate Firebase App initialization across HMR / module reloads
    const alreadyInitialized = getApps().length > 0;
    firebaseApp = alreadyInitialized ? getApp() : initializeApp(evaluated.options);
    if (typeof window !== 'undefined') {
      if (!alreadyInitialized) {
        // Isolamento estrito de sessão por aba (sessionStorage):
        // - Atualizar a página (F5) ou abrir URL direta na mesma aba preserva 100% a conta autenticada.
        // - Criar ou entrar em uma segunda conta em outra aba NUNCA sobrescreve a conta desta aba no IndexedDB global.
        auth = initializeAuth(firebaseApp, {
          persistence: [browserSessionPersistence, inMemoryPersistence],
          popupRedirectResolver: browserPopupRedirectResolver,
        });
      } else {
        auth = getAuth(firebaseApp);
        void setPersistence(auth, browserSessionPersistence).catch(() => {});
      }
    } else {
      auth = getAuth(firebaseApp);
    }
    auth.useDeviceLanguage();
    db = evaluated.firestoreDatabaseId
      ? getFirestore(firebaseApp, evaluated.firestoreDatabaseId)
      : getFirestore(firebaseApp);
  } catch (err) {
    initializationError = err instanceof Error ? err.message : String(err);
    firebaseApp = null;
    auth = null;
    db = null;
  }
}

export function createGoogleAuthProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

const isProjectAuthorized = isAuthorizedHikariProjectId(evaluated.projectId);
const projectIdMatchesExpected = Boolean(
  evaluated.projectId &&
  isProjectAuthorized &&
  evaluated.projectId === EXPECTED_FIREBASE_PROJECT_ID
);

export const firebaseConfigStatus: FirebaseConfigStatus = {
  isConfigured,
  isInitialized: Boolean(firebaseApp && auth && db && !initializationError),
  expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
  projectId: evaluated.projectId,
  projectIdMatchesExpected,
  missingEnvVars: evaluated.missingEnvVars,
  initializationError,
};

export { firebaseApp, auth, db };
