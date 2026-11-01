import crypto from 'node:crypto';
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
  deleteUserMALIntegration,
  refreshUserMALTokens,
  getValidUserAccessToken,
  MinimalFirestore,
  MinimalFirestoreDocumentRef,
  MinimalFirestoreDocumentSnapshot,
  MinimalFirestoreTransaction,
} from '../malStore.js';

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

    // Commit da transação
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

async function runTests() {
  console.log('\n--- 1. Testes de Chave de Criptografia (parseAndValidateKey) ---');
  
  // 1.1 Chave ausente
  try {
    parseAndValidateKey('');
    assert(false, 'Deveria rejeitar chave vazia');
  } catch (err) {
    assert(err instanceof Error, 'Rejeita chave vazia');
  }

  // 1.2 Chave de tamanho insuficiente (16 bytes hex)
  try {
    parseAndValidateKey('0123456789abcdef0123456789abcdef');
    assert(false, 'Deveria rejeitar chave com menos de 32 bytes');
  } catch (err) {
    assert(err instanceof Error, 'Rejeita chave com menos de 32 bytes');
  }

  // 1.3 Chave válida em formato Hexadecimal (64 caracteres)
  const validHexKey = crypto.randomBytes(32).toString('hex');
  const parsedHex = parseAndValidateKey(validHexKey);
  assert(parsedHex.length === 32, 'Aceita e valida chave de 32 bytes em formato hexadecimal');

  // 1.4 Chave válida em formato Base64 (32 bytes)
  const validB64Key = crypto.randomBytes(32).toString('base64');
  const parsedB64 = parseAndValidateKey(validB64Key);
  assert(parsedB64.length === 32, 'Aceita e valida chave de 32 bytes em formato base64');

  console.log('\n--- 2. Testes de Criptografia e Descriptografia AES-256-GCM ---');
  
  const testKey = crypto.randomBytes(32);
  const secretData = 'mal_access_token_super_secreto_12345';
  
  const enc1 = encryptData(secretData, testKey);
  const enc2 = encryptData(secretData, testKey);

  assert(enc1.iv !== enc2.iv, 'Cada operação gera um IV criptograficamente aleatório diferente');
  assert(enc1.ciphertext !== enc2.ciphertext, 'Ciphertexts de mesma entrada são distintos devido a IVs únicos');

  const dec1 = decryptData(enc1, testKey);
  assert(dec1 === secretData, 'Descriptografia recupera exatamente o texto plano original');

  console.log('\n--- 3. Testes de Rejeição de Adulteração e Integridade ---');
  
  // 3.1 Adulterar o ciphertext
  const tamperedCiphertext = {
    ...enc1,
    ciphertext: Buffer.from(
      Buffer.from(enc1.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 0x01 : b))
    ).toString('base64'),
  };
  try {
    decryptData(tamperedCiphertext, testKey);
    assert(false, 'Deveria falhar com ciphertext adulterado');
  } catch (err) {
    assert(
      err instanceof Error && err.message.includes('autenticação criptográfica'),
      'Rejeita ciphertext adulterado com falha de integridade'
    );
  }

  // 3.2 Adulterar a tag de autenticação
  const tamperedTag = {
    ...enc1,
    tag: Buffer.from(
      Buffer.from(enc1.tag, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b))
    ).toString('base64'),
  };
  try {
    decryptData(tamperedTag, testKey);
    assert(false, 'Deveria falhar com auth tag adulterada');
  } catch (err) {
    assert(
      err instanceof Error && err.message.includes('autenticação criptográfica'),
      'Rejeita auth tag adulterada com falha de integridade'
    );
  }

  // 3.3 Chave errada
  const wrongKey = crypto.randomBytes(32);
  try {
    decryptData(enc1, wrongKey);
    assert(false, 'Deveria falhar com chave incorreta');
  } catch (err) {
    assert(
      err instanceof Error && err.message.includes('autenticação criptográfica'),
      'Rejeita descriptografia com chave incorreta'
    );
  }

  console.log('\n--- 4. Testes de Conjunto de Tokens MAL (encryptMALTokens / decryptMALTokens) ---');
  
  const tokenSet = {
    accessToken: 'token_acesso_oficial_mal_123',
    refreshToken: 'token_renovacao_oficial_mal_456',
  };
  const encTokens = encryptMALTokens(tokenSet, testKey);
  const decTokens = decryptMALTokens(encTokens, testKey);

  assert(decTokens.accessToken === tokenSet.accessToken, 'Token de acesso recuperado com integridade');
  assert(decTokens.refreshToken === tokenSet.refreshToken, 'Token de renovação recuperado com integridade');

  console.log('\n--- 5. Testes de Isolamento por UID no Armazenamento ---');
  
  const mockDb = new MockInMemoryFirestore();
  const uidA = 'firebase_user_alice';
  const uidB = 'firebase_user_bob';

  await saveUserMALIntegration(
    mockDb,
    uidA,
    { accessToken: 'alice_access_token', refreshToken: 'alice_refresh' },
    { username: 'alice_mal', expiresAt: Date.now() + 3600000 },
    testKey
  );

  await saveUserMALIntegration(
    mockDb,
    uidB,
    { accessToken: 'bob_access_token', refreshToken: 'bob_refresh' },
    { username: 'bob_mal', expiresAt: Date.now() + 3600000 },
    testKey
  );

  const integrationA = await getUserMALIntegration(mockDb, uidA, testKey);
  const integrationB = await getUserMALIntegration(mockDb, uidB, testKey);
  const integrationC = await getUserMALIntegration(mockDb, 'firebase_user_charlie', testKey);

  assert(integrationA?.tokens.accessToken === 'alice_access_token', 'Alice obtém estritamente seus próprios tokens');
  assert(integrationB?.tokens.accessToken === 'bob_access_token', 'Bob obtém estritamente seus próprios tokens');
  assert(integrationC === null, 'Usuário inexistente (Charlie) retorna null sem vazamento');

  await deleteUserMALIntegration(mockDb, uidA);
  const deletedA = await getUserMALIntegration(mockDb, uidA, testKey);
  const persistentB = await getUserMALIntegration(mockDb, uidB, testKey);

  assert(deletedA === null, 'Exclusão remove credenciais de Alice com sucesso');
  assert(persistentB?.tokens.accessToken === 'bob_access_token', 'Exclusão de Alice não afeta credenciais de Bob');

  console.log('\n--- 6. Testes de Consumo Atômico e Expiração de Handshake OAuth ---');
  
  const stateVal = 'oauth_state_aleatorio_789';
  const handshakeData = {
    state: stateVal,
    codeVerifier: 'pkce_code_verifier_seguro_rfc7636',
    uid: uidA,
    trustedOrigin: 'https://hikari-perfil.vercel.app',
  };

  await createOAuthHandshake(mockDb, handshakeData);

  // Primeiro consumo (Legítimo)
  const consumedFirst = await consumeOAuthHandshakeAtomic(mockDb, stateVal);
  assert(consumedFirst !== null && consumedFirst.codeVerifier === handshakeData.codeVerifier, 'Primeiro consumo resgata com sucesso o codeVerifier');

  // Segundo consumo (Tentativa de Replay Attack)
  const consumedSecond = await consumeOAuthHandshakeAtomic(mockDb, stateVal);
  assert(consumedSecond === null, 'Segundo consumo atômico rejeitado imediatamente (anti-replay)');

  // Handshake expirado (> 15 minutos)
  const expiredState = 'oauth_state_expirado_999';
  await mockDb.collection('mal_handshakes').doc(expiredState).set({
    state: expiredState,
    codeVerifier: 'verifier_antigo',
    uid: uidA,
    trustedOrigin: 'https://hikari-perfil.vercel.app',
    createdAt: Date.now() - 20 * 60 * 1000,
    expiresAt: Date.now() - 5 * 60 * 1000,
  });

  const consumedExpired = await consumeOAuthHandshakeAtomic(mockDb, expiredState);
  assert(consumedExpired === null, 'Handshake expirado rejeitado atomicamente');

  console.log('\n--- 7. Testes de Renovação de Tokens, Rotação e Prevenção de Concorrência ---');
  
  const renewalUid = 'firebase_user_renew_test';
  const initialTokens = {
    accessToken: 'old_expired_access_token',
    refreshToken: 'initial_refresh_token_xyz',
  };

  await saveUserMALIntegration(
    mockDb,
    renewalUid,
    initialTokens,
    { username: 'user_renew', expiresAt: Date.now() - 1000 }, // já expirado
    testKey
  );

  let malFetchCount = 0;
  const mockMALFetch: typeof fetch = async (url, init) => {
    malFetchCount++;
    const bodyStr = String(init?.body || '');
    if (!bodyStr.includes('grant_type=refresh_token')) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }

    // Simula resposta oficial do MyAnimeList com rotação do refresh token
    return new Response(
      JSON.stringify({
        token_type: 'Bearer',
        expires_in: 2678400,
        access_token: 'brand_new_access_token_' + malFetchCount,
        refresh_token: 'brand_new_rotated_refresh_token_' + malFetchCount,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const refreshConfig = {
    clientId: 'test_client_id',
    fetchFn: mockMALFetch,
  };

  // 7.1 Teste de renovação com rotação do refresh token
  const newAccessToken = await refreshUserMALTokens(mockDb, renewalUid, testKey, refreshConfig);
  assert(newAccessToken.startsWith('brand_new_access_token_'), 'Renovação bem-sucedida retornou novo access token');

  const reloaded = await getUserMALIntegration(mockDb, renewalUid, testKey);
  assert(reloaded?.tokens.accessToken === newAccessToken, 'Novo access token gravado com sucesso no Firestore');
  assert(
    reloaded?.tokens.refreshToken === 'brand_new_rotated_refresh_token_1',
    'Novo refresh token rotacionado gravado com sucesso no Firestore'
  );
  assert(
    reloaded?.expiresAt ? reloaded.expiresAt > Date.now() + 2000000 * 1000 : false,
    'Novo prazo de validade (~30 dias) calculado corretamente'
  );

  // 7.2 Teste de concorrência: duas chamadas simultâneas de refresh para o mesmo UID
  malFetchCount = 0;
  const [res1, res2] = await Promise.all([
    refreshUserMALTokens(mockDb, renewalUid, testKey, refreshConfig),
    refreshUserMALTokens(mockDb, renewalUid, testKey, refreshConfig),
  ]);

  assert(res1 === res2, 'Chamadas concorrentes recebem exatamente o mesmo token renovado');
  assert(malFetchCount === 1, 'Chamadas concorrentes deduplicadas com uma única requisição ao MAL');

  // 7.3 Teste de getValidUserAccessToken (Token válido não gera nova chamada)
  const priorFetchCount = malFetchCount;
  const validToken = await getValidUserAccessToken(mockDb, renewalUid, testKey, refreshConfig);
  assert(validToken === res1, 'Token ainda válido retornado sem necessidade de nova requisição ao MAL');
  assert(malFetchCount === priorFetchCount, 'Nenhuma requisição disparada quando o token está dentro da validade');

  // 7.4 Teste de falha na renovação com erro 401/400 (Token revogado no MAL)
  const revokedUid = 'firebase_user_revoked';
  await saveUserMALIntegration(
    mockDb,
    revokedUid,
    { accessToken: 'revoked_token', refreshToken: 'revoked_refresh' },
    { username: 'user_revoked', expiresAt: Date.now() - 5000 },
    testKey
  );

  const mockFailingMALFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ error: 'invalid_grant', message: 'Refresh token has been revoked' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    await refreshUserMALTokens(mockDb, revokedUid, testKey, {
      clientId: 'test_client_id',
      fetchFn: mockFailingMALFetch,
    });
    assert(false, 'Deveria falhar quando o MAL rejeita o refresh token');
  } catch (err) {
    assert(
      err instanceof Error && err.message.includes('revogada'),
      'Erro controlado e amigável emitido quando refresh token é revogado pelo MAL'
    );
  }

  console.log(`\n========================================`);
  console.log(`Resultados dos Testes: ${passed} passaram, ${failed} falharam.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro inesperado nos testes:', err);
  process.exit(1);
});
