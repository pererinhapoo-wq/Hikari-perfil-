import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export const EXPECTED_FIREBASE_PROJECT_ID = 'hikari-user-profiles';

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

const metaEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

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
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(evaluated.options);
    auth = getAuth(firebaseApp);
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

export const firebaseConfigStatus: FirebaseConfigStatus = {
  isConfigured,
  isInitialized: Boolean(firebaseApp && auth && db && !initializationError),
  expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
  projectId: evaluated.projectId,
  projectIdMatchesExpected: evaluated.projectId === EXPECTED_FIREBASE_PROJECT_ID,
  missingEnvVars: evaluated.missingEnvVars,
  initializationError,
};

export { firebaseApp, auth, db };
