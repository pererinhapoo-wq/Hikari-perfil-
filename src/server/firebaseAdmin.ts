import dotenv from 'dotenv';
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

try {
  dotenv.config({ quiet: true });
  dotenv.config({ path: '.env.local', quiet: true });
} catch {
  // Ambientes serverless somente-leitura utilizam variáveis injetadas diretamente em process.env
}

let adminApp: App | null = null;
let initializationError: string | null = null;

export interface FirebaseAdminStatus {
  isConfigured: boolean;
  projectId?: string;
  errorMessage?: string;
}

/**
 * Tenta inicializar o Firebase Admin SDK utilizando credenciais de Conta de Serviço seguras do ambiente.
 * Suporta:
 * 1. FIREBASE_SERVICE_ACCOUNT_KEY: JSON string direto ou codificado em Base64 da Service Account.
 * 2. GOOGLE_APPLICATION_CREDENTIALS: Caminho de arquivo do Service Account JSON.
 * 3. Default Application Credentials do Google Cloud (se executando no Cloud Run / GCP com IAM federado).
 */
export function getFirebaseAdminApp(): App {
  if (adminApp) {
    return adminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    adminApp = existingApps[0];
    return adminApp;
  }

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  const envProjectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim();

  try {
    if (rawServiceAccount) {
      let parsedServiceAccount: ServiceAccount & { project_id?: string };

      if (rawServiceAccount.startsWith('{')) {
        parsedServiceAccount = JSON.parse(rawServiceAccount);
      } else {
        const decoded = Buffer.from(rawServiceAccount, 'base64').toString('utf-8');
        parsedServiceAccount = JSON.parse(decoded);
      }

      const saProjectId =
        (typeof parsedServiceAccount.project_id === 'string' && parsedServiceAccount.project_id.trim()) ||
        (typeof parsedServiceAccount.projectId === 'string' && parsedServiceAccount.projectId.trim()) ||
        undefined;

      const resolvedProjectId = envProjectId || saProjectId || 'hikari-user-profiles';

      adminApp = initializeApp({
        credential: cert(parsedServiceAccount),
        projectId: resolvedProjectId,
      });

      return adminApp;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      adminApp = initializeApp({
        credential: applicationDefault(),
        projectId: envProjectId || 'hikari-user-profiles',
      });
      return adminApp;
    }

    const errorMsg =
      'Credenciais do Firebase Admin SDK ausentes. A variável de ambiente FIREBASE_SERVICE_ACCOUNT_KEY (ou GOOGLE_APPLICATION_CREDENTIALS) é necessária no backend para acesso administrativo ao Firestore.';
    initializationError = errorMsg;
    throw new Error(errorMsg);
  } catch (err) {
    initializationError = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Falha na inicialização do Firebase Admin SDK: ${initializationError}`
    );
  }
}

/**
 * Retorna a instância administrativa do Firestore do Firebase Admin.
 * Lança erro claro se as credenciais administrativas não estiverem configuradas.
 */
export function getAdminFirestore(): Firestore {
  const app = getFirebaseAdminApp();
  return getFirestore(app);
}

/**
 * Retorna a instância administrativa do Firebase Auth do Firebase Admin SDK.
 * Lança erro claro se as credenciais administrativas não estiverem configuradas.
 */
export function getAdminAuth(): Auth {
  const app = getFirebaseAdminApp();
  return getAuth(app);
}

/**
 * Consulta o status da configuração administrativa sem lançar exceções.
 */
export function getFirebaseAdminStatus(): FirebaseAdminStatus {
  try {
    const app = getFirebaseAdminApp();
    return {
      isConfigured: true,
      projectId: app.options.projectId,
    };
  } catch {
    return {
      isConfigured: false,
      projectId:
        process.env.FIREBASE_PROJECT_ID?.trim() ||
        process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
        'hikari-user-profiles',
      errorMessage:
        initializationError ||
        'FIREBASE_SERVICE_ACCOUNT_KEY não configurada no ambiente do servidor.',
    };
  }
}

/**
 * Retorna o Project ID esperado do Firebase para validação consistente entre frontend e backend.
 */
export function getConfiguredFirebaseProjectId(): string {
  const status = getFirebaseAdminStatus();
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    status.projectId?.trim() ||
    'hikari-user-profiles'
  );
}
