import app from '../../../api/index.js';
import http from 'node:http';

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

async function runTests() {
  console.log('\n--- 1. Testes de Roteamento Serverless Vercel (api/index.ts) ---');

  // 1.1 Health check endpoint
  const healthRes = await simulateRequest('GET', '/api/health');
  assert(healthRes.status === 200, 'GET /api/health responde status 200');
  const healthJson = JSON.parse(healthRes.body);
  assert(healthJson.status === 'ok', 'GET /api/health retorna status "ok"');

  // 1.2 GET /api/mal/config (com configurações ausentes)
  const configRes = await simulateRequest('GET', '/api/mal/config');
  assert(configRes.status === 200, 'GET /api/mal/config responde status 200');
  const configJson = JSON.parse(configRes.body);
  assert(typeof configJson.configured === 'boolean', 'Retorna flag booleana "configured"');
  assert(configJson.storageConfigured === false, 'Detecta com precisão que o armazenamento seguro não está configurado');
  assert(
    typeof configJson.storageError === 'string' && configJson.storageError.includes('FIREBASE_SERVICE_ACCOUNT_KEY'),
    'Reporta mensagem explicativa informando a ausência de FIREBASE_SERVICE_ACCOUNT_KEY sem vazar segredos'
  );

  // 1.3 GET /mal/config (teste de compatibilidade com prefixo alternativo do proxy)
  const altConfigRes = await simulateRequest('GET', '/mal/config');
  assert(altConfigRes.status === 200, 'GET /mal/config (prefixo sem /api) responde status 200 com paridade');

  // 1.4 GET /api/mal/auth-url sem cabeçalho Authorization
  const authUrlNoHeader = await simulateRequest('GET', '/api/mal/auth-url');
  assert(authUrlNoHeader.status === 401, 'GET /api/mal/auth-url sem token retorna status 401');
  const noHeaderJson = JSON.parse(authUrlNoHeader.body);
  assert(noHeaderJson.error === 'UNAUTHORIZED', 'Retorna erro UNAUTHORIZED controlado');

  // 1.5 GET /api/mal/auth-url com token inválido
  const authUrlBadToken = await simulateRequest('GET', '/api/mal/auth-url', {
    Authorization: 'Bearer token_invalido_jwt',
  });
  assert(authUrlBadToken.status === 401, 'GET /api/mal/auth-url com token forjado retorna status 401');
  const badTokenJson = JSON.parse(authUrlBadToken.body);
  assert(badTokenJson.error === 'INVALID_TOKEN', 'Retorna erro INVALID_TOKEN rejeitado criptograficamente');

  // 1.6 GET /api/mal/callback com configuração de banco ausente
  const callbackRes = await simulateRequest('GET', '/api/mal/callback?code=mock_code&state=mock_state');
  assert(callbackRes.status === 200, 'GET /api/mal/callback responde 200 renderizando página de popup');
  assert(
    callbackRes.body.includes('MAL_AUTH_ERROR'),
    'Callback despacha mensagem do tipo MAL_AUTH_ERROR para a janela principal quando storage não está configurado'
  );
  assert(
    !callbackRes.body.includes('stack') && !callbackRes.body.includes('node_modules'),
    'Callback não expõe stack traces ou caminhos internos de arquivos'
  );

  // 1.7 GET /api/mal/animelist sem autenticação
  const listNoAuth = await simulateRequest('GET', '/api/mal/animelist');
  assert(listNoAuth.status === 401, 'GET /api/mal/animelist sem token retorna status 401');

  // 1.8 POST /api/mal/disconnect sem autenticação
  const discNoAuth = await simulateRequest('POST', '/api/mal/disconnect');
  assert(discNoAuth.status === 401, 'POST /api/mal/disconnect sem token retorna status 401');

  // 1.9 Verificação de não-colisão com SPA
  assert(
    !healthRes.body.includes('<!doctype html>') && !healthRes.body.includes('<div id="root"></div>'),
    'Rotas da API nunca retornam o index.html do frontend SPA'
  );

  // 1.10 Verificação crítica do rewrite da Vercel (/api/(.*) -> /api?__hikari_route=$1) para /api/admin/*
  const ownerUid = 'TLJx2QuEv4QQYoduGqn0LDJxxRW2';
  const rewrittenOwnerStatus = await simulateRequest(
    'GET',
    '/api?__hikari_route=admin/status',
    {
      Authorization: `Bearer test_token_${ownerUid}`,
      'x-client-uid': ownerUid,
    }
  );
  assert(rewrittenOwnerStatus.status === 200, 'Rewrite Vercel /api?__hikari_route=admin/status responde 200');
  const rewrittenOwnerJson = JSON.parse(rewrittenOwnerStatus.body);
  assert(
    rewrittenOwnerJson.authenticated === true && rewrittenOwnerJson.isAdmin === true,
    'Rewrite Vercel encaminha /api/admin/status ao adminRouter e confirma isAdmin=true para Aether'
  );

  const rewrittenVisitorStatus = await simulateRequest('GET', '/api?__hikari_route=admin/status');
  const rewrittenVisitorJson = JSON.parse(rewrittenVisitorStatus.body);
  assert(
    rewrittenVisitorJson.authenticated === false && rewrittenVisitorJson.isAdmin === false,
    'Rewrite Vercel /api/admin/status nega visitante anônimo (isAdmin=false)'
  );

  const rewrittenCommonOverview = await simulateRequest(
    'GET',
    '/api?__hikari_route=admin/overview',
    { Authorization: 'Bearer test_token_usr_common' }
  );
  assert(
    rewrittenCommonOverview.status === 403,
    'Rewrite Vercel /api/admin/overview bloqueia usuário comum com HTTP 403'
  );

  const rewrittenOwnerVerify = await simulateRequest(
    'POST',
    '/api?__hikari_route=admin/verify',
    { Authorization: `Bearer test_token_${ownerUid}` },
    JSON.stringify({ idToken: `test_token_${ownerUid}`, uid: ownerUid })
  );
  assert(rewrittenOwnerVerify.status === 200, 'Rewrite Vercel POST /api/admin/verify responde 200 para Aether');
  const rewrittenVerifyJson = JSON.parse(rewrittenOwnerVerify.body);
  assert(
    rewrittenVerifyJson.isAdmin === true,
    'Rewrite Vercel POST /api/admin/verify confirma isAdmin=true para Aether'
  );

  console.log(`\n========================================`);
  console.log(`Resultados dos Testes Vercel: ${passed} passaram, ${failed} falharam.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes da Vercel:', err);
  process.exit(1);
});
