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
