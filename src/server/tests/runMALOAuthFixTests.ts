import crypto from 'node:crypto';
import http from 'node:http';
import { getApps, deleteApp } from 'firebase-admin/app';
import { getFirebaseAdminApp, getFirebaseAdminStatus } from '../firebaseAdmin.js';
import {
  parseAndValidateKey,
  encryptData,
  decryptData,
  encryptMALTokens,
  decryptMALTokens,
} from '../crypto.js';
import {
  createOAuthHandshake,
  consumeOAuthHandshakeAtomic,
  saveUserMALIntegration,
  getUserMALIntegration,
  type MinimalFirestore,
  type MinimalFirestoreDocumentRef,
  type MinimalFirestoreDocumentSnapshot,
  type MinimalFirestoreTransaction,
} from '../malStore.js';
import app from '../../../api/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}`);
    failed++;
  }
}

// Simulador em memória compatível com MinimalFirestore para testes isolados
class MockInMemoryFirestore implements MinimalFirestore {
  private collections = new Map<string, Map<string, Record<string, unknown>>>();

  private getCollectionMap(name: string): Map<string, Record<string, unknown>> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  collection(colName: string) {
    const colMap = this.getCollectionMap(colName);
    return {
      doc: (docId: string): MinimalFirestoreDocumentRef => {
        return {
          id: docId,
          path: `${colName}/${docId}`,
          get: async (): Promise<MinimalFirestoreDocumentSnapshot> => {
            const data = colMap.get(docId);
            return {
              exists: Boolean(data),
              data: () => (data ? { ...data } : undefined),
            };
          },
          set: async (data: Record<string, unknown>): Promise<void> => {
            colMap.set(docId, { ...data });
          },
          delete: async (): Promise<void> => {
            colMap.delete(docId);
          },
        };
      },
    };
  }

  async runTransaction<T>(
    updateFunction: (transaction: MinimalFirestoreTransaction) => Promise<T>
  ): Promise<T> {
    const stagedDeletes = new Set<string>();
    const stagedSets = new Map<string, { col: string; id: string; data: Record<string, unknown> }>();

    const transaction: MinimalFirestoreTransaction = {
      get: async (ref: MinimalFirestoreDocumentRef): Promise<MinimalFirestoreDocumentSnapshot> => {
        const parts = ref.path.split('/');
        const col = parts[0];
        const id = parts[1];
        if (stagedDeletes.has(ref.path)) {
          return { exists: false, data: () => undefined };
        }
        const stagedSet = stagedSets.get(ref.path);
        if (stagedSet) {
          return { exists: true, data: () => ({ ...stagedSet.data }) };
        }
        const colMap = this.getCollectionMap(col);
        const data = colMap.get(id);
        return {
          exists: Boolean(data),
          data: () => (data ? { ...data } : undefined),
        };
      },
      set: (ref: MinimalFirestoreDocumentRef, data: Record<string, unknown>) => {
        const parts = ref.path.split('/');
        stagedDeletes.delete(ref.path);
        stagedSets.set(ref.path, { col: parts[0], id: parts[1], data: { ...data } });
        return transaction;
      },
      delete: (ref: MinimalFirestoreDocumentRef) => {
        stagedSets.delete(ref.path);
        stagedDeletes.add(ref.path);
        return transaction;
      },
    };

    const result = await updateFunction(transaction);

    for (const path of stagedDeletes) {
      const parts = path.split('/');
      this.getCollectionMap(parts[0]).delete(parts[1]);
    }
    for (const [, item] of stagedSets) {
      this.getCollectionMap(item.col).set(item.id, { ...item.data });
    }

    return result;
  }
}

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function simulateRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  bodyData?: string
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      app(req, res);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Falha ao obter porta do servidor de teste'));
      }

      const reqHeaders = { ...headers };
      if (bodyData) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyData).toString();
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          method,
          path: url,
          headers: reqHeaders,
        },
        (res) => {
          let chunks = '';
          res.on('data', (chunk) => {
            chunks += chunk;
          });
          res.on('end', () => {
            server.close(() => {
              resolve({
                status: res.statusCode || 500,
                headers: res.headers,
                body: chunks,
              });
            });
          });
        }
      );

      req.on('error', (err) => {
        server.close(() => reject(err));
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  });
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('--- TESTES DA CORREÇÃO DE INTEGRAÇÃO MYANIMELIST ---');
  console.log('======================================================\n');

  // 1. Gerar chave RSA válida para testes de Service Account
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const baseSa = {
    type: 'service_account',
    project_id: 'hikari-oauth-test',
    private_key_id: 'test_pk_id',
    private_key: privateKey,
    client_email: 'firebase-adminsdk@hikari-oauth-test.iam.gserviceaccount.com',
  };

  // Helper para resetar apps do Firebase Admin entre testes
  async function resetFirebaseApps() {
    for (const app of getApps()) {
      await deleteApp(app);
    }
  }

  console.log('--- 1. Testes de Parsing e Inicialização da Service Account do Firebase Admin ---');

  // 1.1 JSON com quebras de linha reais (\n)
  await resetFirebaseApps();
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify(baseSa);
  try {
    const adminApp = getFirebaseAdminApp();
    assert(Boolean(adminApp), '1.1 Inicializa Firebase Admin com quebras de linha reais (\\n)');
  } catch (err: any) {
    assert(false, `1.1 Falha com quebras reais: ${err.message}`);
  }

  // 1.2 JSON com quebras de linha escapadas ("\\n") — cenário real no Vercel
  await resetFirebaseApps();
  const escapedSa = {
    ...baseSa,
    private_key: privateKey.replace(/\n/g, '\\n'),
  };
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify(escapedSa);
  try {
    const adminApp = getFirebaseAdminApp();
    assert(Boolean(adminApp), '1.2 Inicializa com quebras escapadas ("\\\\n") corrigidas com sucesso');
  } catch (err: any) {
    assert(false, `1.2 Falha com quebras escapadas: ${err.message}`);
  }

  // 1.3 JSON com aspas simples externas ('{"type": ...}')
  await resetFirebaseApps();
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = `'${JSON.stringify(escapedSa)}'`;
  try {
    const adminApp = getFirebaseAdminApp();
    assert(Boolean(adminApp), '1.3 Inicializa com aspas simples externas no valor da variável');
  } catch (err: any) {
    assert(false, `1.3 Falha com aspas simples: ${err.message}`);
  }

  // 1.4 JSON com aspas duplas externas ("{...}")
  await resetFirebaseApps();
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = `"${JSON.stringify(escapedSa)}"`;
  try {
    const adminApp = getFirebaseAdminApp();
    assert(Boolean(adminApp), '1.4 Inicializa com aspas duplas externas no valor da variável');
  } catch (err: any) {
    assert(false, `1.4 Falha com aspas duplas: ${err.message}`);
  }

  // 1.5 JSON codificado em Base64
  await resetFirebaseApps();
  const b64Sa = Buffer.from(JSON.stringify(escapedSa)).toString('base64');
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = b64Sa;
  try {
    const adminApp = getFirebaseAdminApp();
    assert(Boolean(adminApp), '1.5 Inicializa com JSON codificado em Base64');
  } catch (err: any) {
    assert(false, `1.5 Falha com Base64: ${err.message}`);
  }

  // 1.6 Não vazamento da chave privada em caso de erro
  await resetFirebaseApps();
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"type":"service_account","private_key":"invalida"}';
  const statusBad = getFirebaseAdminStatus();
  assert(statusBad.isConfigured === false, '1.6 Rejeita chave malformada com isConfigured=false');
  assert(
    typeof statusBad.errorMessage === 'string' && !statusBad.errorMessage.includes('BEGIN PRIVATE KEY'),
    '1.6 Mensagem de erro não expõe a chave privada'
  );

  console.log('\n--- 2. Testes de Validação e Preservação da Chave AES-256-GCM ---');

  // 2.1 Chave hexadecimal de 64 caracteres
  const hex32 = crypto.randomBytes(32).toString('hex');
  const bufHex = parseAndValidateKey(hex32);
  assert(bufHex.length === 32, '2.1 Valida e preserva chave Hexadecimal de 32 bytes (64 caracteres)');

  // 2.2 Chave hexadecimal com aspas externas seguras
  const bufHexQuoted = parseAndValidateKey(`"${hex32}"`);
  assert(
    bufHexQuoted.length === 32 && bufHexQuoted.equals(bufHex),
    '2.2 Desencapsula com segurança aspas externas em chave Hexadecimal preservando bytes exatos'
  );

  // 2.3 Chave Base64 de 44 caracteres
  const b64_32 = crypto.randomBytes(32).toString('base64');
  const bufB64 = parseAndValidateKey(b64_32);
  assert(bufB64.length === 32, '2.3 Valida e preserva chave Base64 de 32 bytes (44 caracteres)');

  // 2.4 Chave Base64 com aspas externas
  const bufB64Quoted = parseAndValidateKey(`'${b64_32}'`);
  assert(
    bufB64Quoted.length === 32 && bufB64Quoted.equals(bufB64),
    '2.4 Desencapsula com segurança aspas externas em chave Base64 preservando bytes exatos'
  );

  // 2.5 Rejeição de chave de tamanho incorreto (não permitindo fallbacks ambíguos)
  try {
    parseAndValidateKey('chave_curta_16b');
    assert(false, '2.5 Deveria rejeitar chave de tamanho incorreto');
  } catch (err: any) {
    assert(err.message.includes('Chave de criptografia inválida'), '2.5 Rejeita chave com tamanho incorreto sem fallback ambíguo');
  }

  // 2.6 Preservação da capacidade de descriptografar tokens existentes gravados anteriormente
  const testKey = crypto.randomBytes(32);
  const existingTokens = {
    accessToken: 'mal_access_token_existente_987654321',
    refreshToken: 'mal_refresh_token_existente_123456789',
  };
  const encryptedPayload = encryptMALTokens(existingTokens, testKey);
  const decrypted = decryptMALTokens(encryptedPayload, testKey);
  assert(
    decrypted.accessToken === existingTokens.accessToken &&
      decrypted.refreshToken === existingTokens.refreshToken,
    '2.6 Descriptografa com exatidão dados existentes criptografados com AES-256-GCM'
  );

  console.log('\n--- 3. Testes do Fluxo de Armazenamento Seguro e Handshake PKCE ---');

  const mockDb = new MockInMemoryFirestore();
  const state = 'test_state_' + crypto.randomBytes(12).toString('hex');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const uid = 'test_uid_hikari_123';

  // 3.1 Criação de Handshake PKCE
  const handshake = await createOAuthHandshake(mockDb, {
    state,
    codeVerifier,
    uid,
    trustedOrigin: 'https://ais-dev-6mbpowi2thva4iisypkjqo-875945009084.us-east1.run.app',
    redirectUri: 'https://ais-dev-6mbpowi2thva4iisypkjqo-875945009084.us-east1.run.app/api/mal/callback',
  });
  assert(handshake.state === state && handshake.codeVerifier === codeVerifier, '3.1 Registra handshake PKCE no Firestore');

  // 3.2 Consumo atômico do Handshake (anti-replay)
  const consumed = await consumeOAuthHandshakeAtomic(mockDb, state);
  assert(consumed !== null && consumed.uid === uid, '3.2 Consome handshake atomicamente');

  const secondAttempt = await consumeOAuthHandshakeAtomic(mockDb, state);
  assert(secondAttempt === null, '3.2 Segundo consumo retorna null (proteção anti-replay ativa)');

  // 3.3 Salvamento e recuperação de integração criptografada
  await saveUserMALIntegration(
    mockDb,
    uid,
    { accessToken: 'novo_access_token_123', refreshToken: 'novo_refresh_123' },
    { username: 'HikariFan', joinedAt: '2023-01-01', expiresAt: Date.now() + 3600000 },
    testKey
  );
  const stored = await getUserMALIntegration(mockDb, uid, testKey);
  assert(
    stored !== null &&
      stored.username === 'HikariFan' &&
      stored.tokens.accessToken === 'novo_access_token_123',
    '3.3 Salva e recupera integração do usuário no Firestore com criptografia AES-256-GCM'
  );

  console.log('\n--- 4. Testes dos Endpoints HTTP (/api/mal/config e Diagnóstico) ---');

  // 4.1 GET /api/mal/config sem credenciais
  delete process.env.MAL_CLIENT_ID;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  delete process.env.MAL_TOKEN_ENCRYPTION_KEY;
  await resetFirebaseApps();

  const configResNoEnv = await simulateRequest('GET', '/api/mal/config');
  assert(configResNoEnv.status === 200, '4.1 GET /api/mal/config responde status 200');
  const jsonNoEnv = JSON.parse(configResNoEnv.body);
  assert(jsonNoEnv.configured === false, '4.1 configured é false quando variáveis estão ausentes');
  assert(jsonNoEnv.clientIdConfigured === false, '4.1 clientIdConfigured é false');
  assert(jsonNoEnv.storageConfigured === false, '4.1 storageConfigured é false');
  assert(typeof jsonNoEnv.storageError === 'string', '4.1 storageError reporta mensagem explicativa');

  // 4.2 GET /api/mal/config com MAL_CLIENT_ID presente mas storage ausente
  process.env.MAL_CLIENT_ID = 'test_client_id_12345';
  const configResClientOnly = await simulateRequest('GET', '/api/mal/config');
  const jsonClientOnly = JSON.parse(configResClientOnly.body);
  assert(jsonClientOnly.clientIdConfigured === true, '4.2 Detecta que clientIdConfigured é true');
  assert(jsonClientOnly.storageConfigured === false, '4.2 Detecta com precisão que storageConfigured é false');
  assert(jsonClientOnly.configured === false, '4.2 configured permanece false com segurança enquanto storage não estiver pronto');
  assert(
    jsonClientOnly.storageError.includes('FIREBASE_SERVICE_ACCOUNT_KEY') ||
      jsonClientOnly.storageError.includes('MAL_TOKEN_ENCRYPTION_KEY'),
    '4.2 Reporta diagnóstico real de armazenamento (não mascarando com erro de Client ID)'
  );

  // 4.3 GET /api/mal/config com todas as credenciais válidas e quebras escapadas
  process.env.MAL_CLIENT_ID = 'test_client_id_12345';
  process.env.MAL_TOKEN_ENCRYPTION_KEY = hex32;
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify(escapedSa);
  await resetFirebaseApps();

  const configResAllOk = await simulateRequest('GET', '/api/mal/config');
  const jsonAllOk = JSON.parse(configResAllOk.body);
  assert(jsonAllOk.clientIdConfigured === true, '4.3 clientIdConfigured é true');
  assert(jsonAllOk.storageConfigured === true, '4.3 storageConfigured é true com quebras escapadas na Service Account');
  assert(jsonAllOk.configured === true, '4.3 configured é true quando Client ID e Storage estão ambos prontos');
  assert(jsonAllOk.storageError === undefined, '4.3 storageError é undefined');

  console.log('\n--- 5. Teste de Endpoint /api/mal/auth-url ---');
  // 5.1 Sem token
  const authUrlNoToken = await simulateRequest('GET', '/api/mal/auth-url');
  assert(authUrlNoToken.status === 401, '5.1 /api/mal/auth-url rejeita requisição sem token com 401 UNAUTHORIZED');

  console.log('\n======================================================');
  console.log(`Resultado Final: ${passed} passaram, ${failed} falharam.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
