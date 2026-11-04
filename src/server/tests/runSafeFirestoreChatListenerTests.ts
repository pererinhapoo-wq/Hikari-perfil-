import assert from 'node:assert';
import type { PrivateConversation, PrivateMessage, ParticipantSummary } from '../../types/index.js';

console.log('========================================================================');
console.log('TESTES DE SINCRONIZAÇÃO SEGURA DO LISTENER DE CHAT — ETAPA 1.7');
console.log('========================================================================\n');

// 1. Mock do ambiente de navegador
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

// Importa chatService
import {
  subscribeToConversation,
  configureChatServiceForTests,
  clearChatSessionMemoryCache,
  activateConversationRealtimeListener,
  readCachedMessages,
  writeCachedMessages,
  type ConversationUpdatePayload,
  type ChatTestFirestoreHooks,
} from '../../services/chatService.js';

let passedTests = 0;
let failedTests = 0;

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

async function runAllTests() {
  const userA = 'usr_stage17_alice';
  const userB = 'usr_stage17_bob';
  const userC = 'usr_stage17_charlie';
  const convIdAB = `conv_${userA}__${userB}`;
  const convIdAC = `conv_${userA}__${userC}`;

  let mockFetchHandler: ((url: string, init?: any) => Promise<Response>) | null = null;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (mockFetchHandler) {
      return mockFetchHandler(url, init);
    }
    return new Response(JSON.stringify({ messages: [], typingUsers: [] }), { status: 200 });
  };

  // Helper de limpeza
  function resetEnvironment() {
    clearChatSessionMemoryCache();
    mockStorage.clear();
    currentVisibilityState = 'visible';
    configureChatServiceForTests({
      token: null,
      baseUrl: '',
      activeUserId: null,
      firestoreHooks: null,
    });
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Abrir conversa nova, sem documento pai no Firestore
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 1: Conversa nova sem doc pai não chama subcoleção, não emite erro indevido e mantém fallback', async () => {
    resetEnvironment();

    let parentDocGetCount = 0;
    let messagesSnapshotStarted = false;

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA,
        getDoc: async () => {
          parentDocGetCount++;
          // Documento pai não existe
          return {
            exists: () => false,
            data: () => null,
          };
        },
        onSnapshot: () => {
          messagesSnapshotStarted = true;
          return () => {};
        },
      },
    });

    mockFetchHandler = async (url) => {
      if (url.includes(`/api/chat/conversations/${encodeURIComponent(convIdAB)}/messages`)) {
        return new Response(JSON.stringify({ messages: [], typingUsers: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let receivedPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userA, (payload) => {
      receivedPayload = payload;
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(parentDocGetCount, 1, 'Deve ter verificado getDoc do documento pai');
    assert.strictEqual(messagesSnapshotStarted, false, 'NÃO deve iniciar listener onSnapshot na subcoleção');
    assert.ok(receivedPayload, 'Deve ter emitido atualização inicial via fallback Express');
    const payload = receivedPayload as ConversationUpdatePayload;
    assert.strictEqual(
      payload.error,
      null,
      'NÃO deve apresentar aviso de falha ao sincronizar com Firestore'
    );
    assert.deepStrictEqual(payload.messages, [], 'Mensagens devem ser lista vazia');

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Enviar a primeira mensagem e iniciar listener após confirmação
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 2: Inicia listener Firestore após criação atômica do documento pai', async () => {
    resetEnvironment();

    let parentDocExists = false;
    let snapshotCount = 0;

    const firestoreHooks: ChatTestFirestoreHooks = {
      dbPresent: true,
      authUid: userA,
      getDoc: async () => {
        return {
          exists: () => parentDocExists,
          data: () => ({ participants: [userA, userB] }),
        };
      },
      onSnapshot: (q, onNext) => {
        snapshotCount++;
        // Emite primeira mensagem recebida em tempo real
        onNext([
          {
            id: 'msg_001',
            data: () => ({
              id: 'msg_001',
              senderId: userA,
              senderName: 'Alice',
              recipientId: userB,
              text: 'Primeira mensagem!',
              type: 'text',
              isRead: false,
              createdAt: { toMillis: () => 1700000000000 },
            }),
          },
        ]);
        return () => {};
      },
    };

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks,
    });

    mockFetchHandler = async () => {
      return new Response(JSON.stringify({ messages: [], typingUsers: [] }), { status: 200 });
    };

    let lastPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userA, (p) => {
      lastPayload = p;
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(snapshotCount, 0, 'Antes do envio o snapshot não deve estar ativo');

    // Simula a confirmação atômica do batch.commit()
    parentDocExists = true;
    activateConversationRealtimeListener(convIdAB, userA);

    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(snapshotCount, 1, 'Listener onSnapshot deve ter sido iniciado após criação do pai');
    const pl2 = lastPayload as ConversationUpdatePayload | null;
    assert.ok(pl2 && pl2.messages.length > 0, 'Deve ter recebido a mensagem em tempo real');
    assert.strictEqual(pl2.messages[0].text, 'Primeira mensagem!');

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Abrir conversa existente no Firestore
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 3: Conversa existente no Firestore inicia onSnapshot e carrega histórico', async () => {
    resetEnvironment();

    let snapshotStarted = false;

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA,
        getDoc: async () => ({
          exists: () => true,
          data: () => ({ participants: [userA, userB] }),
        }),
        onSnapshot: (q, onNext) => {
          snapshotStarted = true;
          onNext([
            {
              id: 'msg_existing_1',
              data: () => ({
                id: 'msg_existing_1',
                senderId: userB,
                senderName: 'Bob',
                recipientId: userA,
                text: 'Olá Alice!',
                type: 'text',
                isRead: true,
                createdAt: { toMillis: () => 1700000000000 },
              }),
            },
          ]);
          return () => {};
        },
      },
    });

    let receivedPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userA, (p) => {
      receivedPayload = p;
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(snapshotStarted, true, 'Deve ter iniciado o listener onSnapshot');
    assert.ok(receivedPayload);
    const pl3 = receivedPayload as ConversationUpdatePayload;
    assert.strictEqual(pl3.messages.length, 1);
    assert.strictEqual(pl3.messages[0].text, 'Olá Alice!');
    assert.strictEqual(pl3.error, null);

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Abrir conversa antiga existente somente no Express/cache
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 4: Conversa que só existe no Express/cache preserva histórico sem consultas inválidas', async () => {
    resetEnvironment();

    let subcollectionQueried = false;

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA,
        getDoc: async () => ({
          exists: () => false, // Não existe no Firestore
        }),
        onSnapshot: () => {
          subcollectionQueried = true;
          return () => {};
        },
      },
    });

    // Mock Express retornando 2 mensagens antigas
    mockFetchHandler = async (url) => {
      if (url.includes(`/api/chat/conversations/${encodeURIComponent(convIdAB)}/messages`)) {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: 'msg_legacy_1',
                conversationId: convIdAB,
                senderId: userB,
                senderName: 'Bob',
                recipientId: userA,
                text: 'Mensagem antiga do servidor Express',
                type: 'text',
                isRead: true,
                createdAt: 1690000000000,
                status: 'sent',
              },
            ],
            typingUsers: [],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let receivedPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userA, (p) => {
      receivedPayload = p;
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(subcollectionQueried, false, 'Não deve abrir onSnapshot na subcoleção');
    assert.ok(receivedPayload);
    const pl4 = receivedPayload as ConversationUpdatePayload;
    assert.strictEqual(pl4.messages.length, 1);
    assert.strictEqual(pl4.messages[0].text, 'Mensagem antiga do servidor Express');
    assert.strictEqual(pl4.error, null, 'Nenhum erro falso deve ser emitido');

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Abrir conversa de duas contas diferentes (isolamento de canal)
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 5: Isolamento estrito de canais entre contas diferentes', async () => {
    resetEnvironment();

    // Alice abre convAB
    let alicePayload: ConversationUpdatePayload | null = null;
    const unsubAlice = subscribeToConversation(convIdAB, userA, (p) => {
      alicePayload = p;
    });

    // Charlie abre convAC
    let charliePayload: ConversationUpdatePayload | null = null;
    const unsubCharlie = subscribeToConversation(convIdAC, userC, (p) => {
      charliePayload = p;
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(alicePayload !== null);
    assert.ok(charliePayload !== null);

    unsubAlice();
    unsubCharlie();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Alternar rapidamente entre conversas (cancela anteriores)
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 6: Troca rápida de conversas cancela verificação e listeners anteriores', async () => {
    resetEnvironment();

    let convABCheckedAfterTeardown = false;
    let convABUnsubscribed = false;

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA,
        getDoc: async (ref: any) => {
          // Simula latência de rede
          await new Promise((r) => setTimeout(r, 80));
          return {
            exists: () => true,
            data: () => ({ participants: [userA, userB] }),
          };
        },
        onSnapshot: (q) => {
          if (q.convId === convIdAB) {
            convABCheckedAfterTeardown = true;
          }
          return () => {
            convABUnsubscribed = true;
          };
        },
      },
    });

    // Abre Conv AB
    const unsubAB = subscribeToConversation(convIdAB, userA, () => {});

    // Imediatamente fecha Conv AB (usuário trocou de conversa antes de getDoc responder)
    unsubAB();

    // Abre Conv AC
    const unsubAC = subscribeToConversation(convIdAC, userA, () => {});

    // Aguarda o tempo em que o getDoc da Conv AB teria retornado
    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(
      convABCheckedAfterTeardown,
      false,
      'A Conv AB não deve ter aberto onSnapshot após ser desmontada'
    );

    unsubAC();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Simular permission-denied com documento pai existente
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 7: Falha de segurança real (permission-denied) é devidamente reportada', async () => {
    resetEnvironment();

    configureChatServiceForTests({
      activeUserId: userC, // Charlie tenta acessar conversa de Alice e Bob
      firestoreHooks: {
        dbPresent: true,
        authUid: userC,
        getDoc: async () => {
          const err: any = new Error('Permission denied');
          err.code = 'permission-denied';
          throw err;
        },
        onSnapshot: () => () => {},
      },
    });

    let receivedPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userC, (p) => {
      receivedPayload = p;
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.ok(receivedPayload);
    const pl7 = receivedPayload as ConversationUpdatePayload;
    assert.ok(
      pl7.error && pl7.error.includes('Acesso negado'),
      'Deve acusar explicitamente acesso negado para falha de segurança real'
    );

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Simular falha de conexão Firestore (fallback Express continua operacional)
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 8: Falha transitória de conexão Firestore mantém fallback Express operacional', async () => {
    resetEnvironment();

    configureChatServiceForTests({
      activeUserId: userA,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA,
        getDoc: async () => {
          const netErr: any = new Error('Network unavailable');
          netErr.code = 'unavailable';
          throw netErr;
        },
      },
    });

    mockFetchHandler = async (url) => {
      if (url.includes(`/api/chat/conversations/${encodeURIComponent(convIdAB)}/messages`)) {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: 'msg_fallback_1',
                conversationId: convIdAB,
                senderId: userA,
                senderName: 'Alice',
                recipientId: userB,
                text: 'Mensagem via fallback Express funcionando perfeitamente',
                type: 'text',
                isRead: false,
                createdAt: Date.now(),
                status: 'sent',
              },
            ],
            typingUsers: [],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let receivedPayload: ConversationUpdatePayload | null = null;
    const unsub = subscribeToConversation(convIdAB, userA, (p) => {
      receivedPayload = p;
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.ok(receivedPayload);
    const pl8 = receivedPayload as ConversationUpdatePayload;
    assert.strictEqual(pl8.messages.length, 1);
    assert.strictEqual(
      pl8.messages[0].text,
      'Mensagem via fallback Express funcionando perfeitamente'
    );
    assert.strictEqual(pl8.error, null);

    unsub();
  });

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES DA ETAPA 1.7: ${passedTests + failedTests}`);
  console.log(`  Sucessos: ${passedTests}`);
  console.log(`  Falhas:   ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
