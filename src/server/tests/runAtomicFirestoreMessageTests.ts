import assert from 'node:assert';
import type { ParticipantSummary, PrivateConversation, PrivateMessage } from '../../types/index.js';

console.log('========================================================================');
console.log('TESTES DE GRAVAÇÃO ATÔMICA DE MENSAGENS NO FIRESTORE — ETAPA 1.10');
console.log('========================================================================\n');

// Mock do ambiente do navegador
const mockStorage = new Map<string, string>();
let currentVisibilityState: 'visible' | 'hidden' = 'visible';

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
  addEventListener: () => {},
  removeEventListener: () => {},
};

import {
  sendPrivateMessage,
  subscribeToConversation,
  configureChatServiceForTests,
  clearChatSessionMemoryCache,
  isConversationConfirmedInFirestore,
  readCachedMessages,
  writeCachedMessages,
  type ConversationUpdatePayload,
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

interface MockBatchOp {
  type: 'set' | 'update';
  refPath: string;
  data: any;
}

function createBatchTracker(commitBehavior?: () => Promise<void>) {
  const operations: MockBatchOp[] = [];
  let commitCount = 0;

  const batch = {
    set(docRef: any, data: any) {
      operations.push({
        type: 'set',
        refPath: docRef?.path || docRef?.id || String(docRef),
        data,
      });
      return batch;
    },
    update(docRef: any, data: any) {
      operations.push({
        type: 'update',
        refPath: docRef?.path || docRef?.id || String(docRef),
        data,
      });
      return batch;
    },
    async commit() {
      commitCount++;
      if (commitBehavior) {
        await commitBehavior();
      }
    },
  };

  return { batch, operations, getCommitCount: () => commitCount };
}

async function runAllTests() {
  const userA: ParticipantSummary = {
    id: 'firebase_uid_alice_110',
    displayName: 'Alice Inaba',
    username: 'alice',
    avatarUrl: 'https://hikari.local/avatars/alice.png',
  };
  const userB: ParticipantSummary = {
    id: 'firebase_uid_bob_110',
    displayName: 'Bob Tanaka',
    username: 'bob',
    avatarUrl: 'https://hikari.local/avatars/bob.png',
  };
  const userC: ParticipantSummary = {
    id: 'firebase_uid_charlie_110',
    displayName: 'Charlie Sato',
    username: 'charlie',
    avatarUrl: 'https://hikari.local/avatars/charlie.png',
  };

  const convIdAB = `conv_${userA.id}__${userB.id}`;

  let mockFetchHandler: ((url: string, init?: any) => Promise<Response>) | null = null;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (mockFetchHandler) {
      return mockFetchHandler(url, init);
    }
    // Express fallback default: sucesso
    const body = init?.body ? JSON.parse(init.body) : {};
    return new Response(
      JSON.stringify({
        success: true,
        message: {
          id: body.id || 'msg_mock_server',
          conversationId: body.conversationId || convIdAB,
          senderId: body.senderId || userA.id,
          senderName: body.senderName || userA.displayName,
          senderUsername: body.senderUsername || userA.username,
          senderAvatarUrl: body.senderAvatarUrl || userA.avatarUrl,
          recipientId: body.recipientId || userB.id,
          text: body.text || 'Fallback OK',
          type: body.type || 'text',
          isRead: false,
          createdAt: Date.now(),
          status: 'sent',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  function resetEnvironment() {
    clearChatSessionMemoryCache();
    mockStorage.clear();
    mockFetchHandler = null;
    configureChatServiceForTests({
      token: null,
      baseUrl: '',
      activeUserId: null,
      firestoreHooks: null,
    });
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Envio de primeira mensagem cria doc pai e mensagem sem getDoc
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 1: Primeira mensagem cria documento pai e mensagem no mesmo batch sem getDoc prévio', async () => {
    resetEnvironment();

    let getDocCalls = 0;
    const { batch, operations, getCommitCount } = createBatchTracker();

    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        getDoc: async () => {
          getDocCalls++;
          return { exists: () => false };
        },
        writeBatch: () => batch,
      },
    });

    // Confirma que antes do envio a conversa não está marcada como confirmada no Firestore
    assert.strictEqual(
      isConversationConfirmedInFirestore(convIdAB, userA.id),
      false,
      'Conversa não deve estar confirmada antes do primeiro envio'
    );

    const sent = await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Oii, primeira mensagem atômica!',
    });

    assert.strictEqual(sent.status, 'sent');
    assert.strictEqual(getDocCalls, 0, 'NENHUM getDoc deve ser invocado em sendPrivateMessage()');
    assert.strictEqual(getCommitCount(), 1, 'writeBatch.commit() deve ser executado exatamente uma vez');

    // Validação da criação atômica Caso B:
    assert.strictEqual(operations.length, 2, 'Batch deve conter exatamente 2 operações (pai e mensagem)');
    
    // Operação 1: batch.set no documento pai da conversa
    const parentOp = operations[0];
    assert.strictEqual(parentOp.type, 'set', 'Doc pai deve ser criado via set');
    assert.ok(parentOp.refPath.includes(convIdAB), 'Ref deve apontar para /conversations/{convId}');
    assert.deepStrictEqual(parentOp.data.participants, [userA.id, userB.id], 'Participantes devem ser Alice e Bob');
    assert.strictEqual(parentOp.data.unreadCounts[userA.id], 0, 'UnreadCount do remetente deve ser 0');
    assert.strictEqual(parentOp.data.unreadCounts[userB.id], 1, 'UnreadCount do destinatário deve ser 1');
    assert.strictEqual(parentOp.data.lastMessage.senderId, userA.id);
    assert.strictEqual(parentOp.data.lastMessage.text, 'Oii, primeira mensagem atômica!');
    assert.strictEqual(parentOp.data.lastMessage.isRead, false);

    // Operação 2: batch.set na subcoleção de mensagens
    const msgOp = operations[1];
    assert.strictEqual(msgOp.type, 'set', 'Mensagem deve ser criada via set');
    assert.ok(msgOp.refPath.includes('messages'), 'Ref deve apontar para subcoleção /messages');
    assert.strictEqual(msgOp.data.senderId, userA.id);
    assert.strictEqual(msgOp.data.recipientId, userB.id);
    assert.strictEqual(msgOp.data.text, 'Oii, primeira mensagem atômica!');

    // Pós-condição: a conversa agora está confirmada no Firestore
    assert.strictEqual(
      isConversationConfirmedInFirestore(convIdAB, userA.id),
      true,
      'Conversa deve ser marcada como confirmada no Firestore após commit'
    );
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Envio em conversa existente atualiza apenas campos permitidos
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 2: Envio em conversa existente atualiza apenas lastMessage, unreadCounts e updatedAt (Operação 1)', async () => {
    resetEnvironment();

    // 1. Primeira mensagem cria a conversa
    const { batch: batch1 } = createBatchTracker();
    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch1,
      },
    });

    await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Primeira mensagem',
    });

    // 2. Segunda mensagem: a conversa já está confirmada!
    const { batch: batch2, operations: ops2, getCommitCount: commits2 } = createBatchTracker();
    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch2,
      },
    });

    const msg2 = await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Segunda mensagem em conversa existente',
    });

    assert.strictEqual(msg2.status, 'sent');
    assert.strictEqual(commits2(), 1);
    assert.strictEqual(ops2.length, 2);

    // Operação 1: update no documento pai
    const updateOp = ops2[0];
    assert.strictEqual(updateOp.type, 'update', 'Deve usar batch.update para conversa existente');
    assert.ok(updateOp.refPath.includes(convIdAB));

    // Valida que apenas campos permitidos por Operação 1 das regras estão sendo atualizados:
    const updateKeys = Object.keys(updateOp.data);
    assert.ok(
      updateKeys.every((k) => k === 'lastMessage' || k.startsWith('unreadCounts.') || k === 'updatedAt'),
      `Update só pode conter lastMessage, unreadCounts e updatedAt. Contém: ${updateKeys.join(', ')}`
    );

    // Garante que participants NÃO são substituídos
    assert.strictEqual(updateOp.data.participants, undefined, 'Participants NÃO devem ser modificados no update');
    assert.strictEqual(updateOp.data.id, undefined, 'ID NÃO deve ser modificado no update');
    assert.strictEqual(updateOp.data.createdAt, undefined, 'createdAt NÃO deve ser modificado no update');
    assert.strictEqual(updateOp.data.lastReadAtByUser, undefined, 'lastReadAtByUser NÃO deve ser modificado no update');
    assert.strictEqual(updateOp.data[`unreadCounts.${userB.id}`] !== undefined, true, 'Deve incrementar unreadCount do destinatário');
    assert.strictEqual(updateOp.data.lastMessage.text, 'Segunda mensagem em conversa existente');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 3: permission-denied interrompe gravação sem tentar criação alternativa
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 3: permission-denied interrompe gravação no Firestore sem tentar criação alternativa', async () => {
    resetEnvironment();

    let attemptsCount = 0;
    const { batch } = createBatchTracker(async () => {
      attemptsCount++;
      const err: any = new Error('Missing or insufficient permissions');
      err.code = 'permission-denied';
      throw err;
    });

    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch,
      },
    });

    // Envio deve prosseguir com fallback Express sem travar nem tentar criação alternativa
    const result = await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Tentativa sob permission-denied',
    });

    assert.strictEqual(result.status, 'sent', 'Deve confirmar via backend Express');
    assert.strictEqual(attemptsCount, 1, 'Deve tentar EXATAMENTE 1 vez. NUNCA tentar criação alternativa após permission-denied');
    assert.strictEqual(
      isConversationConfirmedInFirestore(convIdAB, userA.id),
      false,
      'Conversa NÃO deve ser marcada como confirmada no Firestore em caso de permission-denied'
    );
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Falha de conexão preserva funcionamento local/Express
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 4: Falha transitória de conexão preserva fallback local/Express', async () => {
    resetEnvironment();

    const { batch } = createBatchTracker(async () => {
      const err: any = new Error('Network unavailable');
      err.code = 'unavailable';
      throw err;
    });

    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch,
      },
    });

    const result = await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Mensagem com Firestore offline',
    });

    assert.strictEqual(result.status, 'sent');
    assert.strictEqual(result.text, 'Mensagem com Firestore offline');

    const cached = readCachedMessages(convIdAB, userA.id);
    assert.ok(cached.some((m) => m.id === result.id && m.status === 'sent'), 'Mensagem deve estar em cache local como sent');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Falha no commit não marca conversa como confirmada no Firestore
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 5: Falha no commit não marca mensagem nem conversa como confirmada no Firestore', async () => {
    resetEnvironment();

    const { batch } = createBatchTracker(async () => {
      const err: any = new Error('Deadline exceeded in commit');
      err.code = 'deadline-exceeded';
      throw err;
    });

    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch,
      },
    });

    await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Commit vai falhar',
    });

    assert.strictEqual(
      isConversationConfirmedInFirestore(convIdAB, userA.id),
      false,
      'Conversa NÃO pode ser considerada confirmada quando commit falha'
    );
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Listener em tempo real só é ativado após confirmação do commit
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 6: Listener em tempo real só é ativado após confirmação do commit', async () => {
    resetEnvironment();

    let commitFinished = false;
    let listenerActivatedBeforeCommit = false;
    let onSnapshotRegistered = false;

    // Assina a conversa antes do envio
    let channelReceivedUpdate = false;
    const unsub = subscribeToConversation(convIdAB, userA.id, () => {
      channelReceivedUpdate = true;
    });

    const { batch } = createBatchTracker(async () => {
      // Simula latência no commit
      await new Promise((r) => setTimeout(r, 40));
      if (onSnapshotRegistered) {
        listenerActivatedBeforeCommit = true;
      }
      commitFinished = true;
    });

    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch,
        getDoc: async () => ({ exists: () => false }),
        onSnapshot: (_q, onNext) => {
          onSnapshotRegistered = true;
          onNext({ docs: [], forEach: () => {} });
          return () => {};
        },
      },
    });

    await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Mensagem para testar ordem do listener',
    });

    assert.strictEqual(commitFinished, true, 'Commit deve ter concluído');
    assert.strictEqual(
      listenerActivatedBeforeCommit,
      false,
      'Listener NÃO pode ser iniciado antes da confirmação do commit'
    );
    assert.strictEqual(onSnapshotRegistered, true, 'Listener deve ser iniciado após o commit');

    unsub();
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Duas contas distintas operam cada uma apenas sobre suas conversas
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 7: Duas contas distintas operam cada uma apenas sobre suas conversas', async () => {
    resetEnvironment();

    // Alice autenticada
    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => createBatchTracker().batch,
      },
    });

    // Alice tenta enviar fingindo ser Bob -> Rejeição imediata por Zero-Trust
    let rejectedUnauthorized = false;
    try {
      await sendPrivateMessage({
        conversationId: convIdAB,
        sender: userB, // Bob não é o usuário autenticado!
        recipient: userA,
        text: 'Tentativa de spoofing',
      });
    } catch {
      rejectedUnauthorized = true;
    }
    assert.strictEqual(rejectedUnauthorized, true, 'Remetente divergente de auth.currentUser deve ser rejeitado');

    // Charlie autenticado tenta enviar na conversa de Alice e Bob
    configureChatServiceForTests({
      activeUserId: userC.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userC.id,
        writeBatch: () => createBatchTracker().batch,
      },
    });

    // O ID determinístico da conversa entre Charlie e Bob é conv_usr_stage110_bob__usr_stage110_charlie
    // Se Charlie enviar para Bob, targetConvId gerado NÃO é a conversa de Alice
    const charlieMsg = await sendPrivateMessage({
      sender: userC,
      recipient: userB,
      text: 'Oi Bob, aqui é o Charlie',
    });

    assert.notStrictEqual(charlieMsg.conversationId, convIdAB, 'Conversa de Charlie e Bob é completamente isolada da conversa de Alice e Bob');
    assert.ok(charlieMsg.conversationId.includes(userC.id));
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Histórico de mensagens anteriores não é sobrescrito nem corrompido
  // --------------------------------------------------------------------------
  await runAsyncTest('Cenário 8: Histórico de mensagens anteriores não é sobrescrito nem corrompido por novo envio', async () => {
    resetEnvironment();

    // Preenche cache com mensagem prévia
    const priorMsg: PrivateMessage = {
      id: 'msg_prior_001',
      conversationId: convIdAB,
      senderId: userB.id,
      senderName: userB.displayName,
      senderUsername: userB.username,
      senderAvatarUrl: userB.avatarUrl,
      recipientId: userA.id,
      text: 'Mensagem histórica já existente no chat',
      type: 'text',
      isRead: true,
      createdAt: Date.now() - 60000,
      status: 'sent',
    };
    writeCachedMessages(convIdAB, [priorMsg], userA.id);

    const { batch } = createBatchTracker();
    configureChatServiceForTests({
      activeUserId: userA.id,
      firestoreHooks: {
        dbPresent: true,
        authUid: userA.id,
        writeBatch: () => batch,
      },
    });

    const newMsg = await sendPrivateMessage({
      conversationId: convIdAB,
      sender: userA,
      recipient: userB,
      text: 'Nova resposta que não deve apagar a mensagem anterior',
    });

    const finalMessages = readCachedMessages(convIdAB, userA.id);
    assert.strictEqual(finalMessages.length, 2, 'Histórico deve conter as 2 mensagens (a antiga e a nova)');
    assert.strictEqual(finalMessages[0].id, 'msg_prior_001', 'Mensagem antiga deve ser preservada intacta');
    assert.strictEqual(finalMessages[0].text, 'Mensagem histórica já existente no chat');
    assert.strictEqual(finalMessages[1].id, newMsg.id, 'Nova mensagem deve ser adicionada');
    assert.strictEqual(finalMessages[1].text, 'Nova resposta que não deve apagar a mensagem anterior');
  });

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES DA ETAPA 1.10: ${passedTests + failedTests}`);
  console.log(`  Sucessos: ${passedTests}`);
  console.log(`  Falhas:   ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Erro fatal executando suíte de testes da Etapa 1.10:', err);
  process.exit(1);
});
