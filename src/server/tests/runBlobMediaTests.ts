import assert from 'node:assert';
import {
  detectImageFormat,
  getStoragePrefix,
  generateSecureFilename,
  uploadUserMedia,
  deleteUserMedia,
  validateAndNormalizeBlobUrlForDeletion,
  checkUploadRateLimit,
  pruneRateLimiter,
  resetRateLimiter,
  getRateLimiterSize,
  MAX_FILE_SIZE_BYTES,
  VERCEL_BLOB_HOST_REGEX,
} from '../blobStorage.js';
import {
  verifyUserSession,
  extractSessionToken,
  createRequireUserAuthMiddleware,
  type AuthenticatedRequest,
} from '../blobAuth.js';
import type { Response } from 'express';

// Helper: buffers válidos para testes
function createSampleJpegBuffer(size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

function createSamplePngBuffer(size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
}

function createSampleWebpBuffer(size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(size - 8, 4);
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

function createFakeTextBuffer(): Buffer {
  return Buffer.from('malicious_executable_or_script_payload', 'utf-8');
}

async function main() {
  console.log('================================================================');
  console.log('SUÍTE DE TESTES DE SEGURANÇA REFORÇADA — VERCEL BLOB ETAPA 2');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // GIF deve ser aceito sem conversão para preservar quadros e animação.
  await runTest('GIF87a e GIF89a são reconhecidos como image/gif', () => {
    const gif87 = Buffer.alloc(16);
    gif87.write('GIF87a', 0, 'ascii');
    const gif89 = Buffer.alloc(16);
    gif89.write('GIF89a', 0, 'ascii');
    assert.deepStrictEqual(detectImageFormat(gif87), { ext: 'gif', mime: 'image/gif' });
    assert.deepStrictEqual(detectImageFormat(gif89), { ext: 'gif', mime: 'image/gif' });
  });

  // ==========================================================================
  // GRUPO 1: FIREBASE AUTH VIA FIREBASE ADMIN COM CHECK REVOKED
  // ==========================================================================
  console.log('--- 1. Validação Firebase Auth (Firebase Admin & Revogação) ---');

  await runTest('1.1. Firebase Token Válido: verificado pelo Firebase Admin extrai UID com segurança', async () => {
    const mockAdminAuth = {
      async verifyIdToken(token: string, checkRevoked?: boolean) {
        assert.strictEqual(checkRevoked, true, 'O parâmetro checkRevoked DEVE ser true');
        if (token === 'firebase.valid.token') {
          return { uid: 'usr_firebase_123', email: 'user@hikari.test' };
        }
        throw new Error('Token inválido');
      },
    };

    const res = await verifyUserSession('firebase.valid.token', {
      adminAuthOverride: mockAdminAuth,
    });

    assert.ok(res);
    assert.strictEqual(res.uid, 'usr_firebase_123');
    assert.strictEqual(res.provider, 'firebase');
  });

  await runTest('1.2. Firebase Token Inválido: rejeitado categoricamente', async () => {
    const mockAdminAuth = {
      async verifyIdToken(_token: string, _checkRevoked?: boolean) {
        const err = new Error('Decoding Firebase ID token failed') as any;
        err.code = 'auth/invalid-id-token';
        throw err;
      },
    };

    const res = await verifyUserSession('firebase.invalid.token', {
      adminAuthOverride: mockAdminAuth,
    });

    assert.strictEqual(res, null, 'Token inválido deve retornar null sem fallback');
  });

  await runTest('1.3. Firebase Token Revogado: rejeitado com verificação checkRevoked = true', async () => {
    const mockAdminAuth = {
      async verifyIdToken(_token: string, checkRevoked?: boolean) {
        assert.strictEqual(checkRevoked, true);
        const err = new Error('Firebase ID token has been revoked') as any;
        err.code = 'auth/id-token-revoked';
        throw err;
      },
    };

    const res = await verifyUserSession('firebase.revoked.token', {
      adminAuthOverride: mockAdminAuth,
    });

    assert.strictEqual(res, null, 'Token revogado DEVE ser estritamente rejeitado');
  });

  await runTest('1.4. Firebase Admin Indisponível: sem credenciais rejeita sem fallback permissivo', async () => {
    // Sem mock e sem credenciais de service account
    const originalKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const originalApp = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    try {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const res = await verifyUserSession('header.payload.signature_jwt');
      assert.strictEqual(res, null, 'Sem Firebase Admin configurado, JWTs não podem ser aceitos');
    } finally {
      if (originalKey) process.env.FIREBASE_SERVICE_ACCOUNT_KEY = originalKey;
      if (originalApp) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalApp;
    }
  });

  // ==========================================================================
  // GRUPO 2: BETTER AUTH COM CONSULTA ATIVA DE SESSÃO
  // ==========================================================================
  console.log('\n--- 2. Validação Better Auth (Consulta Ativa de Sessão) ---');

  await runTest('2.1. Better Auth: Sessão ativa válida com cookie opaco é aprovada', async () => {
    const mockFetch = async (url: string, init?: RequestInit) => {
      assert.ok(url.includes('/api/auth/get-session'));
      assert.ok((init?.headers as any)?.Cookie?.includes('better-auth.session_token=opaque_session_xyz789'));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            user: { id: 'usr_better_auth_456', email: 'better@hikari.test' },
            session: { expiresAt: Date.now() + 100_000 },
          };
        },
      };
    };

    const originalUrl = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = 'https://auth.hikari.test';

      const res = await verifyUserSession('opaque_session_xyz789', {
        betterAuthFetchOverride: mockFetch as any,
      });

      assert.ok(res);
      assert.strictEqual(res.uid, 'usr_better_auth_456');
      assert.strictEqual(res.provider, 'better-auth');
    } finally {
      if (originalUrl) process.env.BETTER_AUTH_URL = originalUrl;
      else delete process.env.BETTER_AUTH_URL;
    }
  });

  await runTest('2.2. Better Auth: Sessão expirada é rejeitada', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          user: { id: 'usr_better_expired' },
          session: { expiresAt: Date.now() - 5000 }, // Expirado há 5 segundos!
        };
      },
    });

    const originalUrl = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = 'https://auth.hikari.test';

      const res = await verifyUserSession('opaque_session_expired', {
        betterAuthFetchOverride: mockFetch as any,
      });

      assert.strictEqual(res, null, 'Sessão com expiresAt no passado DEVE ser rejeitada');
    } finally {
      if (originalUrl) process.env.BETTER_AUTH_URL = originalUrl;
      else delete process.env.BETTER_AUTH_URL;
    }
  });

  await runTest('2.3. Better Auth: Sessão revogada (HTTP 401 retornado) é rejeitada', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: 'Session revoked' };
      },
    });

    const originalUrl = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = 'https://auth.hikari.test';

      const res = await verifyUserSession('opaque_session_revoked', {
        betterAuthFetchOverride: mockFetch as any,
      });

      assert.strictEqual(res, null, 'Sessão revogada DEVE ser rejeitada');
    } finally {
      if (originalUrl) process.env.BETTER_AUTH_URL = originalUrl;
      else delete process.env.BETTER_AUTH_URL;
    }
  });

  await runTest('2.4. Better Auth: Se BETTER_AUTH_URL estiver ausente, rejeita com segurança', async () => {
    const originalUrl = process.env.BETTER_AUTH_URL;
    const originalNextUrl = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
    try {
      delete process.env.BETTER_AUTH_URL;
      delete process.env.NEXT_PUBLIC_BETTER_AUTH_URL;

      const res = await verifyUserSession('opaque_cookie_unverifiable');
      assert.strictEqual(res, null, 'Sem BETTER_AUTH_URL configurada, não pode aceitar cookies opacos');
    } finally {
      if (originalUrl) process.env.BETTER_AUTH_URL = originalUrl;
      if (originalNextUrl) process.env.NEXT_PUBLIC_BETTER_AUTH_URL = originalNextUrl;
    }
  });

  // ==========================================================================
  // GRUPO 3: VALIDAÇÃO DE HOSTNAME E URL DO VERCEL BLOB
  // ==========================================================================
  console.log('\n--- 3. Validação de Hostname e URL da Vercel Blob ---');

  await runTest('3.1. Expressão Regular aceita domínios legítimos do Vercel Blob', () => {
    const legitimate = [
      'hikari-perfil-media.public.blob.vercel-storage.com',
      'hikari-perfil-media.blob.vercel-storage.com',
      'public.blob.vercel-storage.com',
      'blob.vercel-storage.com',
      'mock.blob.vercel-storage.com',
    ];

    for (const host of legitimate) {
      assert.strictEqual(
        VERCEL_BLOB_HOST_REGEX.test(host),
        true,
        `Host legítimo deve ser aceito: ${host}`
      );
    }
  });

  await runTest('3.2. Expressão Regular REJEITA domínios falsos, parecidos ou manipulados', () => {
    const malicious = [
      'evil-blob.vercel-storage.com', // hífen antes de blob
      'attacker.blob.vercel-storage.com.attacker.com', // sufixado com domínio do atacante
      'blob.vercel-storage.com.evil.io',
      'attacker.com',
      'notblob.vercel-storage.com',
      'fake-vercel-storage.com',
    ];

    for (const host of malicious) {
      assert.strictEqual(
        VERCEL_BLOB_HOST_REGEX.test(host),
        false,
        `Host malicioso DEVE ser rejeitado: ${host}`
      );
    }
  });

  await runTest('3.3. Rejeição de URLs com protocolo não-HTTPS (ex.: HTTP)', () => {
    assert.throws(
      () => {
        validateAndNormalizeBlobUrlForDeletion(
          'usr_test_1',
          'http://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_test_1/avatar.png'
        );
      },
      /Apenas HTTPS é permitido/,
      'URLs HTTP inseguras devem ser rejeitadas'
    );
  });

  // ==========================================================================
  // GRUPO 4: PARSING, NORMALIZAÇÃO E PREVENÇÃO DE PATH TRAVERSAL
  // ==========================================================================
  console.log('\n--- 4. Normalização de Caminho e Prevenção de Path Traversal ---');

  await runTest('4.1. Rejeição de Path Traversal explícito ("..")', () => {
    assert.throws(
      () => {
        validateAndNormalizeBlobUrlForDeletion(
          'usr_test_1',
          'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_test_1/../../animes/capa.jpg'
        );
      },
      /Acesso negado|path traversal|não autorizado/,
      'Tentativa de traversal com .. deve ser bloqueada'
    );
  });

  await runTest('4.2. Rejeição de Travessia com Percent-Encoding (%2e%2e)', () => {
    assert.throws(
      () => {
        validateAndNormalizeBlobUrlForDeletion(
          'usr_test_1',
          'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_test_1/%2e%2e/%2e%2e/animes/capa.jpg'
        );
      },
      /ofuscamento|path traversal|Acesso negado/,
      'Percent-encoding de .. deve ser bloqueado'
    );
  });

  await runTest('4.3. Rejeição de URLs com Caracteres Nulos (%00)', () => {
    assert.throws(
      () => {
        validateAndNormalizeBlobUrlForDeletion(
          'usr_test_1',
          'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_test_1/avatar.png%00.exe'
        );
      },
      /caracteres nulos inválidos|formato inválido/,
      'URLs com null bytes devem ser bloqueadas'
    );
  });

  await runTest('4.4. Rejeição de Subpastas Arbitrárias dentro do diretório do usuário', () => {
    assert.throws(
      () => {
        validateAndNormalizeBlobUrlForDeletion(
          'usr_test_1',
          'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_test_1/subpasta/arbitraria/avatar.png'
        );
      },
      /não autorizado dentro do diretório do usuário/,
      'Não deve aceitar caminhos aninhados arbitrários'
    );
  });

  // ==========================================================================
  // GRUPO 5: EXCLUSÃO DE ARQUIVOS (PRÓPRIO, TERCEIROS E HIKARI PRINCIPAL)
  // ==========================================================================
  console.log('\n--- 5. Exclusão Segura de Imagens ---');

  await runTest('5.1. Exclusão de arquivo próprio é autorizada com caminho canônico validado', async () => {
    const validUrl =
      'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_owner_789/1700000000-foto.jpg';

    const res = await deleteUserMedia('usr_owner_789', validUrl, 'mock_token');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.deletedUrl, validUrl);
  });

  await runTest('5.2. Bloqueio de exclusão de arquivo de OUTRO usuário (Acesso Negado)', async () => {
    const victimUrl =
      'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-perfil/avatars/usr_victim_999/1700000000-foto.jpg';

    await assert.rejects(
      async () => {
        // Atacante 'usr_attacker' tenta deletar mídia de 'usr_victim_999'
        await deleteUserMedia('usr_attacker', victimUrl, 'mock_token');
      },
      /Acesso negado: a imagem informada não pertence ao seu perfil/,
      'Usuário não pode deletar arquivo de outro UID'
    );
  });

  await runTest('5.3. Bloqueio categórico de exclusão de arquivos do HIKARI PRINCIPAL', async () => {
    const mainHikariUrls = [
      'https://hikari-perfil-media.public.blob.vercel-storage.com/hikari-main/animes/capa.jpg',
      'https://hikari-perfil-media.public.blob.vercel-storage.com/animes/episodes/ep01.mp4',
      'https://hikari-perfil-media.public.blob.vercel-storage.com/main/branding/logo.png',
    ];

    for (const url of mainHikariUrls) {
      await assert.rejects(
        async () => {
          await deleteUserMedia('usr_owner_789', url, 'mock_token');
        },
        /não é permitido excluir mídias do sistema principal Hikari/,
        'Tentativa de deletar mídias do Hikari principal deve ser impedida'
      );
    }
  });

  // ==========================================================================
  // GRUPO 6: RATE LIMITING E LIMPEZA DE ENTRADAS ANTIGAS (PREVENÇÃO DE VAZAMENTO)
  // ==========================================================================
  console.log('\n--- 6. Rate Limiting e Limpeza de Entradas Antigas ---');

  await runTest('6.1. Rate Limiting bloqueia rajada após exceder o limite de 20 uploads', () => {
    resetRateLimiter();
    const uid = 'usr_burst_test';

    for (let i = 0; i < 20; i++) {
      const allowed = checkUploadRateLimit(uid, 20, 60_000);
      assert.strictEqual(allowed, true, `Requisição ${i + 1} deve ser permitida`);
    }

    // A 21ª requisição deve ser bloqueada
    const blocked = checkUploadRateLimit(uid, 20, 60_000);
    assert.strictEqual(blocked, false, 'Requisição além do teto de 20 deve ser bloqueada');
  });

  await runTest('6.2. Limpeza de Entradas Antigas (prune) remove UIDs expirados do Map', () => {
    resetRateLimiter();
    const now = Date.now();

    // Insere registros simulando usuários ativos há 70 segundos atrás (já expirados)
    checkUploadRateLimit('usr_expired_1', 20, 60_000);
    checkUploadRateLimit('usr_expired_2', 20, 60_000);
    assert.strictEqual(getRateLimiterSize(), 2);

    // Executa expurgo considerando que o tempo avançou 70 segundos
    pruneRateLimiter(now + 70_000, 60_000);

    // O tamanho do Map deve ser 0 (todas as entradas expiradas foram removidas)
    assert.strictEqual(
      getRateLimiterSize(),
      0,
      'Entradas antigas devem ser completamente eliminadas do Map para evitar vazamentos de memória'
    );
  });

  // ==========================================================================
  // GRUPO 7: MOCK E AUSÊNCIA DE TOKEN EM PRODUÇÃO
  // ==========================================================================
  console.log('\n--- 7. Mock e Ausência de Token em Produção ---');

  await runTest('7.1. Em produção, ausência do token falha com HTTP 503 e rejeita mocks', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalToken = process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN;
    const originalFallback = process.env.BLOB_READ_WRITE_TOKEN;

    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN;
      delete process.env.BLOB_READ_WRITE_TOKEN;

      await assert.rejects(
        async () => {
          await uploadUserMedia({
            userId: 'usr_test_prod',
            purpose: 'avatar',
            buffer: createSamplePngBuffer(),
            tokenOverride: 'mock_fake_token', // Mesmo passando mock_ em produção, DEVE falhar!
          });
        },
        /Armazenamento de mídia indisponível no servidor/,
        'Em produção, tokens mock_ NÃO são aceitos e o erro deve ser seguro'
      );
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
      if (originalToken) process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN = originalToken;
      if (originalFallback) process.env.BLOB_READ_WRITE_TOKEN = originalFallback;
    }
  });

  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES REFORÇADOS: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha geral na execução dos testes de segurança reforçados:', err);
  process.exit(1);
});
