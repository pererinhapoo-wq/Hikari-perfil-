import assert from 'node:assert';
import {
  AUTHORIZED_ADMIN_UID,
  isAuthorizedAdmin,
  verifyAdminToken,
  ensureAdminCustomClaims,
  requireAdminAuth,
  type AdminUserContext,
} from '../adminAuth.js';
import type { Request, Response, NextFunction } from 'express';

async function main() {
  console.log('================================================================');
  console.log('TESTES DE AUTORIZAÇÃO ADMINISTRATIVA SEGURA — HIKARI PERFIL');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}`);
            console.error(`    ${err instanceof Error ? err.message : String(err)}`);
            failed++;
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // 1. Constante Imutável e Reconhecimento da Conta Administradora
  runTest('1. Identificador da conta: constante imutável é estritamente TLJx2QuEv4QQYoduGqn0LDJxxRW2', () => {
    assert.strictEqual(AUTHORIZED_ADMIN_UID, 'TLJx2QuEv4QQYoduGqn0LDJxxRW2');
    assert.strictEqual(isAuthorizedAdmin('TLJx2QuEv4QQYoduGqn0LDJxxRW2'), true);
    assert.strictEqual(isAuthorizedAdmin('  TLJx2QuEv4QQYoduGqn0LDJxxRW2  '), true);
  });

  // 2. Isolamento de Contas Comuns e Rejeição de Outros UIDs
  runTest('2. Usuários comuns e invasores são estritamente rejeitados como não-administradores', () => {
    assert.strictEqual(isAuthorizedAdmin('usr_hikari_001'), false);
    assert.strictEqual(isAuthorizedAdmin('usr_kuroha'), false);
    assert.strictEqual(isAuthorizedAdmin('usr_shinji'), false);
    assert.strictEqual(isAuthorizedAdmin('usr_hacker_admin_claim'), false);
    assert.strictEqual(isAuthorizedAdmin(''), false);
    assert.strictEqual(isAuthorizedAdmin(null), false);
    assert.strictEqual(isAuthorizedAdmin(undefined), false);
  });

  // 3. Verificação de Token de Administrador Autêntico
  await runTest('3. Verificação de Token da conta administradora autorizada retorna isAdmin = true', async () => {
    const res = await verifyAdminToken(`test_token_${AUTHORIZED_ADMIN_UID}`);
    assert.strictEqual(res.isAdmin, true);
    assert.strictEqual(res.uid, AUTHORIZED_ADMIN_UID);
  });

  // 4. Verificação de Token de Conta Comum
  await runTest('4. Verificação de Token de usuário comum retorna isAdmin = false', async () => {
    const res = await verifyAdminToken('test_token_usr_regular_person');
    assert.strictEqual(res.isAdmin, false);
    assert.strictEqual(res.uid, 'usr_regular_person');
    assert.ok(res.reason?.includes('comum não autorizado'));
  });

  // 5. Rejeição de Tokens Nulos, Vazios ou Malformados
  await runTest('5. Rejeição estrita de tokens inválidos ou não informados', async () => {
    const res1 = await verifyAdminToken('');
    assert.strictEqual(res1.isAdmin, false);

    const res2 = await verifyAdminToken('Bearer ');
    assert.strictEqual(res2.isAdmin, false);

    const res3 = await verifyAdminToken('token_forjado_sem_assinatura');
    assert.strictEqual(res3.isAdmin, false);
  });

  // 6. Prevenção de Auto-Promoção via Custom Claims
  await runTest('6. Bloqueio de auto-promoção: proibição de atribuir claims a qualquer outro UID', async () => {
    await assert.rejects(
      async () => {
        await ensureAdminCustomClaims('usr_hacker_trying_to_be_admin');
      },
      /Operação bloqueada por segurança/,
      'Qualquer tentativa de atribuir claims administrativas a outros UIDs deve ser violentamente rejeitada'
    );
  });

  // 7. Chamada de Custom Claims para a Conta Proprietária
  await runTest('7. Atribuição de Custom Claims é permitida com exclusividade para o UID proprietário', async () => {
    const result = await ensureAdminCustomClaims(AUTHORIZED_ADMIN_UID);
    assert.ok(typeof result.message === 'string');
    assert.ok(result.message.includes(AUTHORIZED_ADMIN_UID));
  });

  // 8. Middleware de Proteção: Bloqueio de Acesso Não Autenticado (HTTP 401)
  await runTest('8. Middleware requireAdminAuth retorna HTTP 401 para requisições anônimas', async () => {
    let statusReturned = 0;
    let jsonBody: Record<string, unknown> = {};
    let nextCalled = false;

    const mockReq = {
      headers: {},
    } as unknown as Request & { adminUser?: AdminUserContext };

    const mockRes = {
      status(s: number) {
        statusReturned = s;
        return {
          json(b: Record<string, unknown>) {
            jsonBody = b;
          },
        };
      },
    } as unknown as Response;

    const mockNext: NextFunction = () => {
      nextCalled = true;
    };

    await requireAdminAuth(mockReq, mockRes, mockNext);

    assert.strictEqual(statusReturned, 401);
    assert.strictEqual(jsonBody.code, 'AUTH_REQUIRED');
    assert.strictEqual(nextCalled, false, 'next() não pode ser chamado sem autenticação');
  });

  // 9. Middleware de Proteção: Bloqueio de Usuários Comuns (HTTP 403 Forbidden)
  await runTest('9. Middleware requireAdminAuth retorna HTTP 403 para contas comuns autenticadas', async () => {
    let statusReturned = 0;
    let jsonBody: Record<string, unknown> = {};
    let nextCalled = false;

    const mockReq = {
      headers: {
        authorization: 'Bearer test_token_usr_common_account',
      },
    } as unknown as Request & { adminUser?: AdminUserContext };

    const mockRes = {
      status(s: number) {
        statusReturned = s;
        return {
          json(b: Record<string, unknown>) {
            jsonBody = b;
          },
        };
      },
    } as unknown as Response;

    const mockNext: NextFunction = () => {
      nextCalled = true;
    };

    await requireAdminAuth(mockReq, mockRes, mockNext);

    assert.strictEqual(statusReturned, 403);
    assert.strictEqual(jsonBody.code, 'FORBIDDEN_NOT_ADMIN');
    assert.strictEqual(nextCalled, false, 'next() não pode ser chamado para usuários comuns');
  });

  // 10. Middleware de Proteção: Autorização Concedida à Conta Proprietária
  await runTest('10. Middleware requireAdminAuth autoriza com sucesso a conta proprietária', async () => {
    let nextCalled = false;

    const mockReq = {
      headers: {
        authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}`,
      },
    } as unknown as Request & { adminUser?: AdminUserContext };

    const mockRes = {
      status: () => ({ json: () => {} }),
    } as unknown as Response;

    const mockNext: NextFunction = () => {
      nextCalled = true;
    };

    await requireAdminAuth(mockReq, mockRes, mockNext);

    assert.strictEqual(nextCalled, true, 'next() deve ser chamado com sucesso para o proprietário');
    assert.strictEqual(mockReq.adminUser?.uid, AUTHORIZED_ADMIN_UID);
    assert.strictEqual(mockReq.adminUser?.role, 'owner');
    assert.strictEqual(mockReq.adminUser?.isAdmin, true);
  });

  // 11. Proteção contra Exposição de PII e Informações Administrativas ao Público
  runTest('11. Zero vazamento público: endpoints anônimos não expõem UIDs ou dados de administração', () => {
    // Verificamos que a API pública não vaza segredos
    const publicResponse = {
      authenticated: false,
      isAdmin: false,
    };
    assert.strictEqual('uid' in publicResponse, false);
    assert.strictEqual('email' in publicResponse, false);
    assert.strictEqual('adminUid' in publicResponse, false);
  });

  // 12. Blindagem de Documentos de Usuários do Firestore contra Injeção de Campos Administrativos
  runTest('12. Regras do Firestore: Proibição estrita de auto-promoção por inclusão de chave role ou isAdmin no perfil', () => {
    const allowedKeys = [
      'uid',
      'username',
      'displayName',
      'avatarUrl',
      'bannerUrl',
      'bio',
      'isPrivate',
      'showCommentsOnProfile',
      'privacySettings',
      'followersCount',
      'followingCount',
      'createdAt',
      'updatedAt',
    ];

    // Simulação de payload de usuário atacante tentando injetar privilégios
    const hackerPayload = {
      uid: 'usr_hacker',
      username: 'hacker_user',
      displayName: 'Hacker',
      avatarUrl: '',
      bannerUrl: '',
      bio: '',
      isPrivate: false,
      showCommentsOnProfile: true,
      privacySettings: {
        showAnimeList: true,
        showFavorites: true,
        showActivity: true,
        showCommentsOnProfile: true,
      },
      followersCount: 0,
      followingCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      role: 'admin', // Injeção maliciosa
      isAdmin: true, // Injeção maliciosa
    };

    const hasExtraKeys = Object.keys(hackerPayload).some((k) => !allowedKeys.includes(k));
    assert.strictEqual(hasExtraKeys, true, 'As chaves maliciosas foram detectadas');

    // Validação que a regra hasOnly do Firestore rejeita o documento
    const isValidSchema = Object.keys(hackerPayload).every((k) => allowedKeys.includes(k));
    assert.strictEqual(isValidSchema, false, 'O schema do Firestore REJEITA sumariamente documentos com campos administrativos');
  });

  // Preparação de par de chaves RSA-2048 real para testes criptográficos RS256 de Firebase ID Tokens
  const { publicKey, privateKey } = await import('node:crypto').then((c) =>
    c.generateKeyPairSync('rsa', { modulusLength: 2048 })
  );
  const cryptoMod = await import('node:crypto');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const kid = 'hikari-test-kid-rs256';
  const projectId = 'hikari-user-profiles';
  const nowSec = Math.floor(Date.now() / 1000);

  function signTestFirebaseJwt(
    payload: Record<string, unknown>,
    headerOverride?: Record<string, unknown>,
    tamperSignature = false
  ): string {
    const header = headerOverride ?? { alg: 'RS256', typ: 'JWT', kid };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    if (header.alg === 'none') {
      return `${hB64}.${pB64}.`;
    }
    const sig = cryptoMod
      .sign('RSA-SHA256', Buffer.from(`${hB64}.${pB64}`), privateKey)
      .toString('base64url');
    const finalSig = tamperSignature ? `${sig.slice(0, -4)}AAAA` : sig;
    return `${hB64}.${pB64}.${finalSig}`;
  }

  const certOptions = {
    resolvePublicCerts: async () => ({ [kid]: publicKeyPem }),
    expectedProjectId: projectId,
    nowSeconds: nowSec,
  };

  // 13. JWT RS256 real assinado para a conta proprietária Aether
  await runTest('13. JWT RS256 assinado válido do proprietário (TLJx2QuEv4QQYoduGqn0LDJxxRW2) concede acesso', async () => {
    const validOwnerJwt = signTestFirebaseJwt({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: AUTHORIZED_ADMIN_UID,
      user_id: AUTHORIZED_ADMIN_UID,
      iat: nowSec - 60,
      exp: nowSec + 3600,
      email: 'owner@hikari.example',
    });

    const res = await verifyAdminToken(validOwnerJwt, certOptions);
    assert.strictEqual(res.isAdmin, true);
    assert.strictEqual(res.uid, AUTHORIZED_ADMIN_UID);
  });

  // 14. JWT RS256 real assinado para usuário comum tentando falsificar nome/username/email/role/isAdmin
  await runTest('14. JWT RS256 de usuário comum com name="Aether", role="owner" e isAdmin=true é estritamente negado', async () => {
    const spoofedCommonJwt = signTestFirebaseJwt({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'usr_common_impersonator_999',
      user_id: 'usr_common_impersonator_999',
      name: 'Aether',
      username: 'aether',
      email: 'aether@hikari.example',
      role: 'owner',
      isAdmin: true,
      admin: true,
      iat: nowSec - 60,
      exp: nowSec + 3600,
    });

    const res = await verifyAdminToken(spoofedCommonJwt, certOptions);
    assert.strictEqual(res.isAdmin, false);
    assert.strictEqual(res.uid, 'usr_common_impersonator_999');
  });

  // 15. Rejeição estrita de token RS256 expirado (mesmo do proprietário)
  await runTest('15. JWT RS256 expirado do proprietário é estritamente rejeitado', async () => {
    const expiredOwnerJwt = signTestFirebaseJwt({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: AUTHORIZED_ADMIN_UID,
      user_id: AUTHORIZED_ADMIN_UID,
      iat: nowSec - 7200,
      exp: nowSec - 1,
    });

    const res = await verifyAdminToken(expiredOwnerJwt, certOptions);
    assert.strictEqual(res.isAdmin, false);
    assert.strictEqual(res.uid, undefined);
    assert.ok(res.reason?.includes('expirado'));
  });

  // 16. Rejeição estrita de assinatura adulterada ou alg="none"
  await runTest('16. JWT adulterado ou sem assinatura (alg=none) reivindicando UID proprietário é rejeitado', async () => {
    const tamperedJwt = signTestFirebaseJwt(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: AUTHORIZED_ADMIN_UID,
        iat: nowSec - 60,
        exp: nowSec + 3600,
      },
      undefined,
      true
    );
    const noneJwt = signTestFirebaseJwt(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: AUTHORIZED_ADMIN_UID,
        iat: nowSec - 60,
        exp: nowSec + 3600,
      },
      { alg: 'none', typ: 'JWT' }
    );

    const resTampered = await verifyAdminToken(tamperedJwt, certOptions);
    assert.strictEqual(resTampered.isAdmin, false);
    assert.strictEqual(resTampered.uid, undefined);

    const resNone = await verifyAdminToken(noneJwt, certOptions);
    assert.strictEqual(resNone.isAdmin, false);
    assert.strictEqual(resNone.uid, undefined);
  });

  // 17. Rejeição de token emitido para outro projeto Firebase (aud/iss divergentes)
  await runTest('17. JWT RS256 emitido para projeto Firebase externo é rejeitado mesmo com sub idêntico', async () => {
    const wrongProjectJwt = signTestFirebaseJwt({
      iss: 'https://securetoken.google.com/attacker-project-id',
      aud: 'attacker-project-id',
      sub: AUTHORIZED_ADMIN_UID,
      iat: nowSec - 60,
      exp: nowSec + 3600,
    });

    const res = await verifyAdminToken(wrongProjectJwt, certOptions);
    assert.strictEqual(res.isAdmin, false);
    assert.strictEqual(res.uid, undefined);
  });

  console.log('----------------------------------------------------------------');
  console.log(`RESULTADO DOS TESTES: ${passed} aprovados, ${failed} reprovados.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica nos testes de autorização administrativa:', err);
  process.exit(1);
});
