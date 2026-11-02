import assert from 'node:assert';
import http from 'node:http';
import { AUTHORIZED_ADMIN_UID } from '../../types/index.js';
import { adminRouter } from '../adminRoutes.js';
import express from 'express';

async function main() {
  console.log('================================================================');
  console.log('TESTES DO PAINEL PRIVADO DE ADMINISTRAÇÃO — HIKARI PERFIL (ETAPA 2)');
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

  // Inicializa servidor Express efêmero para testes HTTP reais
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/admin', adminRouter);

  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(path: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  try {
    // 1. Proprietário Consegue Acessar o Painel
    await runTest('1. Proprietário consegue acessar o painel: status confirma isAdmin=true', async () => {
      const res = await api('/api/admin/status', {
        headers: { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.isAdmin, true);
      assert.strictEqual(res.body.authenticated, true);
    });

    // 2. Usuário Comum Recebe Acesso Negado
    await runTest('2. Usuário comum recebe acesso negado: status retorna isAdmin=false e rotas protegidas retornam HTTP 403', async () => {
      const statusRes = await api('/api/admin/status', {
        headers: { authorization: 'Bearer test_token_usr_regular_common_user' },
      });
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.body.isAdmin, false);

      const overviewRes = await api('/api/admin/overview', {
        headers: { authorization: 'Bearer test_token_usr_regular_common_user' },
      });
      assert.strictEqual(overviewRes.status, 403);
      assert.strictEqual(overviewRes.body.code, 'FORBIDDEN_NOT_ADMIN');
    });

    // 3. Usuário Anônimo Recebe Acesso Negado
    await runTest('3. Usuário anônimo recebe acesso negado: status retorna não autenticado e rotas protegidas retornam HTTP 401', async () => {
      const statusRes = await api('/api/admin/status');
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.body.authenticated, false);
      assert.strictEqual(statusRes.body.isAdmin, false);

      const usersRes = await api('/api/admin/users');
      assert.strictEqual(usersRes.status, 401);
      assert.strictEqual(usersRes.body.code, 'AUTH_REQUIRED');
    });

    // 4. Endpoints Administrativos Rejeitam Tokens Sem Autorização
    await runTest('4. Endpoints administrativos rejeitam tokens vazios, forjados ou adulterados', async () => {
      const badTokens = [
        'Bearer ',
        'Bearer token_invalido_sem_formato',
        'Bearer test_token_usr_hacker_admin',
      ];

      for (const badToken of badTokens) {
        const res = await api('/api/admin/security', {
          headers: { authorization: badToken },
        });
        assert.ok(res.status === 401 || res.status === 403, `Token ${badToken} deve ser rejeitado`);
      }
    });

    // 5. Dados Privados Não São Expostos (Princípio do Menor Privilégio)
    await runTest('5. Dados privados não são expostos: lista de usuários não contém senhas, tokens ou chats privados', async () => {
      const res = await api('/api/admin/users', {
        headers: { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.users));
      assert.ok(res.body.users.length > 0);

      for (const user of res.body.users) {
        assert.strictEqual('password' in user, false, 'Senhas não devem existir no objeto');
        assert.strictEqual('passwordHash' in user, false);
        assert.strictEqual('token' in user, false, 'Tokens não devem ser expostos');
        assert.strictEqual('accessToken' in user, false);
        assert.strictEqual('refreshToken' in user, false);
        assert.strictEqual('privateMessages' in user, false);
        assert.ok(user.status === 'Ativa');
        assert.ok(typeof user.displayName === 'string');
      }
    });

    // 6. Seções do Painel Exibem Dados Reais
    await runTest('6. Seções do painel: Visão Geral, Animes, Moderação e Segurança respondem com dados reais do sistema', async () => {
      const authHeaders = { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` };

      // Visão Geral
      const overview = await api('/api/admin/overview', { headers: authHeaders });
      assert.strictEqual(overview.status, 200);
      assert.strictEqual(overview.body.server.status, 'online');
      assert.strictEqual(overview.body.owner.displayName, 'Aether');
      assert.strictEqual(overview.body.owner.uid, AUTHORIZED_ADMIN_UID);

      // Animes
      const animes = await api('/api/admin/animes', { headers: authHeaders });
      assert.strictEqual(animes.status, 200);
      assert.ok(animes.body.animes.length >= 3);

      // Moderação (zero dados fictícios)
      const moderation = await api('/api/admin/moderation', { headers: authHeaders });
      assert.strictEqual(moderation.status, 200);
      assert.strictEqual(moderation.body.reports.length, 0, 'Não deve inventar denúncias');
      assert.strictEqual(moderation.body.total, 0);

      // Estatísticas (métricas reais)
      const metrics = await api('/api/admin/metrics', { headers: authHeaders });
      assert.strictEqual(metrics.status, 200);
      assert.ok(metrics.body.realMetrics.totalUsersKnown > 0);
      assert.ok(metrics.body.realMetrics.totalCatalogAnimes > 0);

      // Segurança
      const security = await api('/api/admin/security', { headers: authHeaders });
      assert.strictEqual(security.status, 200);
      assert.strictEqual(security.body.status, 'Protegido');
      assert.strictEqual(security.body.isUidLocked, true);
      assert.strictEqual(security.body.secretsExposed, false);
    });

    // 7. Separação Explícita de Informações Indisponíveis
    await runTest('7. Estatísticas: separação clara entre dados reais disponíveis e métricas indisponíveis por privacidade', async () => {
      const res = await api('/api/admin/metrics', {
        headers: { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.unavailableMetrics));
      assert.ok(res.body.unavailableMetrics.length >= 2);

      const hasTrackingNotice = res.body.unavailableMetrics.some(
        (m: any) => m.reason.includes('telemetria') || m.reason.includes('rastreadores')
      );
      assert.strictEqual(hasTrackingNotice, true, 'Deve explicar ausência de telemetria invasiva');
    });

    // 8. Integridade do Diagnóstico Health-Check
    await runTest('8. Diagnóstico /health-check: autorização confirmada com sucesso para Aether', async () => {
      const res = await api('/api/admin/health-check', {
        headers: { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.strictEqual(res.body.operator.isAdmin, true);
      assert.strictEqual(res.body.operator.role, 'owner');
    });

    // 9. Endpoint POST /api/admin/verify exige token válido e bloqueia divergência de UID
    await runTest('9. Endpoint /api/admin/verify: valida proprietário, nega comum/visitante e bloqueia divergência de UID', async () => {
      // Sem token (mesmo enviando uid do proprietário no body!) -> 401
      const noTokenRes = await api('/api/admin/verify', {
        method: 'POST',
        body: JSON.stringify({ uid: AUTHORIZED_ADMIN_UID }),
      });
      assert.strictEqual(noTokenRes.status, 401);
      assert.strictEqual(noTokenRes.body.isAdmin, false);

      // Proprietário autenticado com token + UID consistente -> 200 e isAdmin=true
      const ownerVerifyRes = await api('/api/admin/verify', {
        method: 'POST',
        headers: { authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
        body: JSON.stringify({
          idToken: `test_token_${AUTHORIZED_ADMIN_UID}`,
          uid: AUTHORIZED_ADMIN_UID,
        }),
      });
      assert.strictEqual(ownerVerifyRes.status, 200);
      assert.strictEqual(ownerVerifyRes.body.authenticated, true);
      assert.strictEqual(ownerVerifyRes.body.isAdmin, true);

      // Usuário comum autenticado -> 200 com isAdmin=false
      const commonVerifyRes = await api('/api/admin/verify', {
        method: 'POST',
        headers: { authorization: 'Bearer test_token_usr_common_01' },
        body: JSON.stringify({
          idToken: 'test_token_usr_common_01',
          uid: 'usr_common_01',
        }),
      });
      assert.strictEqual(commonVerifyRes.status, 200);
      assert.strictEqual(commonVerifyRes.body.authenticated, true);
      assert.strictEqual(commonVerifyRes.body.isAdmin, false);

      // Divergência entre UID do frontend e UID do token -> 403
      const mismatchRes = await api('/api/admin/verify', {
        method: 'POST',
        headers: { authorization: 'Bearer test_token_usr_common_01' },
        body: JSON.stringify({
          idToken: 'test_token_usr_common_01',
          uid: AUTHORIZED_ADMIN_UID,
        }),
      });
      assert.strictEqual(mismatchRes.status, 403);
      assert.strictEqual(mismatchRes.body.isAdmin, false);
    });

    // 10. Proteção contra divergência de x-client-uid em /api/admin/status
    await runTest('10. Endpoint /api/admin/status: rejeita sessão quando x-client-uid diverge do token', async () => {
      const mismatchStatus = await api('/api/admin/status', {
        headers: {
          authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}`,
          'x-client-uid': 'usr_outro_usuario',
        },
      });
      assert.strictEqual(mismatchStatus.status, 200);
      assert.strictEqual(mismatchStatus.body.authenticated, false);
      assert.strictEqual(mismatchStatus.body.isAdmin, false);
    });
  } finally {
    server.close();
  }

  console.log('----------------------------------------------------------------');
  console.log(`RESULTADO DOS TESTES: ${passed} aprovados, ${failed} reprovados.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica nos testes do painel administrativo:', err);
  process.exit(1);
});
