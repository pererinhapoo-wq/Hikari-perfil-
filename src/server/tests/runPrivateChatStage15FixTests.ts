import assert from 'node:assert';
import type { PrivateConversation, PrivateMessage, ParticipantSummary } from '../../types/index.js';

console.log('========================================================================');
console.log('TESTES DE INTEGRIDADE E CORREÇÃO DE CHAT PRIVADO — ETAPA 1.5');
console.log('========================================================================\n');

// 1. Mock do ambiente global de navegador
const mockStorage = new Map<string, string>();
let currentVisibilityState: 'visible' | 'hidden' = 'visible';
const visibilityListeners = new Set<() => void>();

(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

(globalThis as any).document = {
  get visibilityState() {
    return currentVisibilityState;
  },
  addEventListener: (event: string, handler: () => void) => {
    if (event === 'visibilitychange') {
      visibilityListeners.add(handler);
    }
  },
  removeEventListener: (event: string, handler: () => void) => {
    if (event === 'visibilitychange') {
      visibilityListeners.delete(handler);
    }
  },
};

// Importa chatService após setup de mock global
import {
  subscribeToConversation,
  fetchUserConversations,
  readCachedConversations,
  writeCachedConversations,
  readCachedMessages,
  writeCachedMessages,
  isValidLegitimateConversation,
  configureChatServiceForTests,
  setActiveChatSessionUser,
  type ConversationUpdatePayload,
} from '../../services/chatService.js';

let passedTests = 0;
let failedTests = 0;

function runSyncTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failedTests++;
  }
}

async function runAsyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failedTests++;
  }
}

async function runAllStage15Tests() {
  const userA = 'usr_stage15_alpha';
  const userB = 'usr_stage15_beta';
  const userC = 'usr_stage15_gamma';
  const convId = `conv_${userA}__${userB}`;

  // Helper para simular mock fetch responses
  let mockFetchHandler: ((url: string, init?: any) => Promise<Response>) | null = null;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (mockFetchHandler) {
      return mockFetchHandler(url, init);
    }
    return new Response(JSON.stringify({ error: 'Endpoint não mockado' }), { status: 404 });
  };

  // --------------------------------------------------------------------------
  // CENÁRIO 1 & 3: Histórico vazio emite resolução inicial e encerra carregamento
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 1 & 3: Primeira atualização é emitida mesmo quando histórico é vazio ([]), permitindo encerrar carregamento', async () => {
    mockStorage.clear();
    mockFetchHandler = async (url) => {
      if (url.includes(`/api/chat/conversations/${encodeURIComponent(convId)}/messages`)) {
        return new Response(JSON.stringify({ messages: [], typingUsers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let receivedPayload: ConversationUpdatePayload | null = null;
    let updateCallCount = 0;

    const unsubscribe = subscribeToConversation(convId, userA, (payload) => {
      receivedPayload = payload;
      updateCallCount++;
    });

    // Aguarda a resolução assíncrona do pollChannelOnce
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(receivedPayload !== null, 'Deveria ter recebido payload de atualização inicial');
    assert.strictEqual(Array.isArray((receivedPayload as ConversationUpdatePayload).messages), true);
    assert.strictEqual((receivedPayload as ConversationUpdatePayload).messages.length, 0, 'Histórico deve ser array vazio');
    assert.strictEqual((receivedPayload as ConversationUpdatePayload).error, null, 'Não deve conter erro');
    assert.strictEqual(updateCallCount, 1, 'Deve emitir exatamente uma resolução inicial sem loops');

    unsubscribe();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Histórico com mensagens continua funcionando e reconciliando
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 2: Histórico com mensagens persistidas emite corretamente os dados', async () => {
    const existingMsg: PrivateMessage = {
      id: 'msg_001',
      conversationId: convId,
      senderId: userB,
      senderName: 'Beta',
      senderUsername: 'beta',
      senderAvatarUrl: '',
      recipientId: userA,
      text: 'Olá Alpha!',
      type: 'text',
      isRead: false,
      createdAt: Date.now() - 5000,
      status: 'sent',
    };

    mockFetchHandler = async (url) => {
      if (url.includes(`/api/chat/conversations/${encodeURIComponent(convId)}/messages`)) {
        return new Response(JSON.stringify({ messages: [existingMsg], typingUsers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let payloadReceived: ConversationUpdatePayload | null = null;
    const unsubscribe = subscribeToConversation(convId, userA, (payload) => {
      payloadReceived = payload;
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(payloadReceived !== null, 'Deveria ter recebido mensagens');
    assert.strictEqual((payloadReceived as ConversationUpdatePayload).messages.length, 1);
    assert.strictEqual((payloadReceived as ConversationUpdatePayload).messages[0].text, 'Olá Alpha!');

    unsubscribe();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Múltiplos listeners recebem a atualização inicial corretamente
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 4: Múltiplos listeners recebem a atualização inicial de forma independente', async () => {
    let listener1Count = 0;
    let listener2Count = 0;

    const unsubs1 = subscribeToConversation(convId, userA, () => {
      listener1Count++;
    });

    // Segundo listener se inscreve logo depois
    const unsubs2 = subscribeToConversation(convId, userA, () => {
      listener2Count++;
    });

    await new Promise((r) => setTimeout(r, 80));

    assert.ok(listener1Count >= 1, 'Listener 1 deveria ter sido notificado');
    assert.ok(listener2Count >= 1, 'Listener 2 deveria ter sido notificado');

    unsubs1();
    unsubs2();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Conversa recém-criada não desaparece após 60 segundos
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 5: Conversa local não desaparece mesmo se updatedAt tiver mais de 60 segundos', async () => {
    const oldTimestamp = Date.now() - 120_000; // 2 minutos atrás (ultrapassa limite antigo de 60s)
    const pendingConv: PrivateConversation = {
      id: convId,
      participants: [userA, userB],
      participantDetails: {
        [userA]: { id: userA, displayName: 'Alpha', username: 'alpha', avatarUrl: '' },
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
      },
      unreadCounts: { [userA]: 0, [userB]: 0 },
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    };

    // Escreve no cache local do usuário A
    writeCachedConversations([pendingConv], userA);

    // Mock backend retorna vazio (como no Firestore quando ainda não há doc criado)
    mockFetchHandler = async () => {
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const convs = await fetchUserConversations(userA);

    assert.strictEqual(convs.length, 1, 'A conversa pendente não deve ser descartada');
    assert.strictEqual(convs[0].id, convId);
    assert.strictEqual(convs[0].participants.includes(userA), true);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Consulta remota vazia não apaga uma conversa legítima pendente
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 6: Resposta de servidor vazia ([] ) preserva conversa legítima local', async () => {
    const freshConv: PrivateConversation = {
      id: convId,
      participants: [userA, userB],
      participantDetails: {
        [userA]: { id: userA, displayName: 'Alpha', username: 'alpha', avatarUrl: '' },
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
      },
      unreadCounts: { [userA]: 0, [userB]: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeCachedConversations([freshConv], userA);

    mockFetchHandler = async (url) => {
      if (url.includes('/api/chat/conversations')) {
        return new Response(JSON.stringify({ conversations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    };

    const result = await fetchUserConversations(userA);
    assert.strictEqual(result.length, 1, 'Conversa legítima deve ser preservada');
    assert.strictEqual(result[0].id, convId);

    // Confirma que o cache em disco também manteve a conversa
    const cachedAfter = readCachedConversations(userA);
    assert.strictEqual(cachedAfter.length, 1, 'Cache local não pode ser sobrescrito com array vazio');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Falha de conexão não é confundida com resposta remota vazia
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 7: Falha de conexão (500 ou rede) não é tratada como lista vazia nem apaga cache', async () => {
    const existingConv: PrivateConversation = {
      id: convId,
      participants: [userA, userB],
      participantDetails: {
        [userA]: { id: userA, displayName: 'Alpha', username: 'alpha', avatarUrl: '' },
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
      },
      unreadCounts: { [userA]: 0, [userB]: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeCachedConversations([existingConv], userA);

    // Mock falha de rede
    mockFetchHandler = async () => {
      throw new Error('Falha de conexão DNS/Offline');
    };

    const convs = await fetchUserConversations(userA);
    assert.strictEqual(convs.length, 1, 'Cache local deve ser retornado como fallback seguro');
    assert.strictEqual(convs[0].id, convId);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Conversa sincronizada continua aparecendo após reabrir
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 8: Conversa confirmada no servidor é mantida e mesclada ao reabrir', async () => {
    const remoteConv: PrivateConversation = {
      id: convId,
      participants: [userA, userB],
      participantDetails: {
        [userA]: { id: userA, displayName: 'Alpha', username: 'alpha', avatarUrl: '' },
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
      },
      lastMessage: {
        id: 'msg_999',
        senderId: userB,
        senderName: 'Beta',
        text: 'Mensagem sincronizada',
        type: 'text',
        isRead: false,
        createdAt: Date.now(),
      },
      unreadCounts: { [userA]: 1, [userB]: 0 },
      createdAt: Date.now() - 10000,
      updatedAt: Date.now(),
    };

    mockFetchHandler = async () => {
      return new Response(JSON.stringify({ conversations: [remoteConv] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const convs = await fetchUserConversations(userA);
    assert.strictEqual(convs.length, 1);
    assert.strictEqual(convs[0].lastMessage?.text, 'Mensagem sincronizada');
    assert.strictEqual(convs[0].unreadCounts[userA], 1);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 9: Alternar entre contas não mistura conversas ou caches
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 9: Alternância entre contas mantém isolamento estrito de cache por UID', async () => {
    const convUserC = `conv_${userB}__${userC}`;
    const convForC: PrivateConversation = {
      id: convUserC,
      participants: [userB, userC],
      participantDetails: {
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
        [userC]: { id: userC, displayName: 'Gamma', username: 'gamma', avatarUrl: '' },
      },
      unreadCounts: { [userB]: 0, [userC]: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeCachedConversations([convForC], userC);

    const cachedA = readCachedConversations(userA);
    const cachedC = readCachedConversations(userC);

    assert.strictEqual(cachedA.every((c) => c.participants.includes(userA)), true, 'Cache de A deve conter apenas conversas de A');
    assert.strictEqual(cachedC.every((c) => c.participants.includes(userC)), true, 'Cache de C deve conter apenas conversas de C');
    assert.strictEqual(cachedA.some((c) => c.id === convUserC), false, 'Conversa de C não pode vazar para cache de A');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 10: Eventos de visibilidade no Android não causam exclusões
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 10: Alternância de visibilidade (Android background/foreground) não apaga conversas', async () => {
    const validConv: PrivateConversation = {
      id: convId,
      participants: [userA, userB],
      participantDetails: {
        [userA]: { id: userA, displayName: 'Alpha', username: 'alpha', avatarUrl: '' },
        [userB]: { id: userB, displayName: 'Beta', username: 'beta', avatarUrl: '' },
      },
      unreadCounts: { [userA]: 0, [userB]: 0 },
      createdAt: Date.now() - 300_000, // 5 minutos atrás
      updatedAt: Date.now() - 300_000,
    };
    writeCachedConversations([validConv], userA);

    // Simula transição para background (oculta)
    currentVisibilityState = 'hidden';
    for (const h of visibilityListeners) h();

    // Simula retorno para foreground (visível no Android)
    currentVisibilityState = 'visible';
    for (const h of visibilityListeners) h();

    mockFetchHandler = async () => {
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const convs = await fetchUserConversations(userA);
    assert.strictEqual(convs.length, 1, 'Conversa deve persistir intacta após ciclos de visibilidade no Android');
    assert.strictEqual(convs[0].id, convId);
  });

  // --------------------------------------------------------------------------
  // VALIDAÇÃO: isValidLegitimateConversation descarta dados corrompidos
  // --------------------------------------------------------------------------
  runSyncTest('Validador de integridade rejeita objetos corrompidos ou com participantes insuficientes', () => {
    assert.strictEqual(isValidLegitimateConversation(null, userA), false);
    assert.strictEqual(isValidLegitimateConversation({}, userA), false);
    assert.strictEqual(isValidLegitimateConversation({ id: 'invalid_id' }, userA), false);
    assert.strictEqual(isValidLegitimateConversation({ id: 'conv_123', participants: [userA] }, userA), false);
    assert.strictEqual(isValidLegitimateConversation({ id: 'conv_123', participants: [userB, userC] }, userA), false);
    assert.strictEqual(
      isValidLegitimateConversation(
        {
          id: 'conv_a__b',
          participants: [userA, userB],
          participantDetails: {},
          unreadCounts: {},
        },
        userA
      ),
      true
    );
  });

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES DA ETAPA 1.5: ${passedTests + failedTests}`);
  console.log(`  Sucessos: ${passedTests}`);
  console.log(`  Falhas:   ${failedTests}`);
  console.log('========================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

void runAllStage15Tests();
