import assert from 'node:assert';
import {
  chatStore,
  getDeterministicConversationId,
  canUserMessageRecipient,
  validateMediaPayload,
  extractHikariLinkPreview,
  type UserCheckContext,
} from '../chatStore.js';
import type { ParticipantSummary } from '../../types/index.js';

console.log('================================================================');
console.log('TESTES DO SISTEMA DE MENSAGENS PRIVADAS — HIKARI PERFIL (ETAPA 2)');
console.log('================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('Testes assíncronos devem ser aguardados.');
    }
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

async function main() {
  // Setup users
  const userRen: UserCheckContext = {
    id: 'usr_hikari_001',
    username: 'ren_hikari',
    displayName: 'Ren Amano',
    avatarUrl: '/avatar-ren.jpg',
    allowDirectMessages: true,
    directMessagesFrom: 'everyone',
    followingIds: ['usr_kuroha', 'usr_shinji'],
    followerIds: ['usr_kuroha', 'usr_maya'],
    blockedIds: [],
  };

  const userKuroha: UserCheckContext = {
    id: 'usr_kuroha',
    username: 'kuroha_void',
    displayName: 'Kuroha ✦',
    avatarUrl: '/avatar-kuroha.jpg',
    allowDirectMessages: true,
    directMessagesFrom: 'followers',
    followingIds: ['usr_hikari_001'],
    followerIds: ['usr_hikari_001', 'usr_shinji'],
    blockedIds: [],
  };

  const userMaya: UserCheckContext = {
    id: 'usr_maya',
    username: 'maya_sakura',
    displayName: 'Maya Sakura',
    avatarUrl: '/avatar-maya.jpg',
    allowDirectMessages: true,
    directMessagesFrom: 'mutual',
    followingIds: ['usr_hikari_001'],
    followerIds: ['usr_hikari_001'],
    blockedIds: [],
  };

  const userDaiki: UserCheckContext = {
    id: 'usr_daiki',
    username: 'daiki_sub',
    displayName: 'Daiki Tanaka',
    avatarUrl: '/avatar-daiki.jpg',
    allowDirectMessages: false, // DMs disabled
    directMessagesFrom: 'everyone',
    followingIds: [],
    followerIds: [],
    blockedIds: [],
  };

  const userStranger: UserCheckContext = {
    id: 'usr_stranger',
    username: 'stranger_x',
    displayName: 'Stranger X',
    avatarUrl: '',
    allowDirectMessages: true,
    directMessagesFrom: 'everyone',
    followingIds: [],
    followerIds: [],
    blockedIds: [],
  };

  // 1. Teste de ID Determinístico e Prevenção de Conversas Duplicadas
  runTest('1. Prevenção de duplicatas: IDs determinísticos entre pares de participantes ordenados', () => {
    const id1 = getDeterministicConversationId('usr_hikari_001', 'usr_kuroha');
    const id2 = getDeterministicConversationId('usr_kuroha', 'usr_hikari_001');
    assert.strictEqual(id1, id2, 'IDs de conversa gerados em ordem inversa devem ser exatamente idênticos');
    assert.strictEqual(id1, 'conv_usr_hikari_001__usr_kuroha');

    const senderSummary: ParticipantSummary = {
      id: userRen.id,
      displayName: userRen.displayName,
      username: userRen.username,
      avatarUrl: userRen.avatarUrl,
    };
    const recipientSummary: ParticipantSummary = {
      id: userKuroha.id,
      displayName: userKuroha.displayName,
      username: userKuroha.username,
      avatarUrl: userKuroha.avatarUrl,
    };

    const res1 = chatStore.createOrGetConversation(senderSummary, recipientSummary);
    const res2 = chatStore.createOrGetConversation(recipientSummary, senderSummary);

    assert.strictEqual(res1.conversation.id, res2.conversation.id);
    assert.strictEqual(res2.isNew, false, 'A segunda chamada com os mesmos participantes deve reutilizar a conversa existente');
  });

  // 2. Envio e recebimento de mensagens de texto
  runTest('2. Envio e recuperação de mensagem de texto com atualização de unreadCounts e lastMessage', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const sent = chatStore.addMessage({
      conversationId: convId,
      senderId: userRen.id,
      senderName: userRen.displayName,
      senderUsername: userRen.username,
      senderAvatarUrl: userRen.avatarUrl,
      recipientId: userKuroha.id,
      text: 'Olá Kuroha! Adorei a trilha sonora.',
      type: 'text',
    });

    assert.ok(sent.message.id);
    assert.strictEqual(sent.message.text, 'Olá Kuroha! Adorei a trilha sonora.');
    assert.strictEqual(sent.message.isRead, false);
    assert.strictEqual(sent.conversation.lastMessage?.text, 'Olá Kuroha! Adorei a trilha sonora.');
    assert.ok(sent.conversation.unreadCounts[userKuroha.id] >= 1);
  });

  // 3. Envio de Imagens e GIFs com validação de segurança
  runTest('3. Envio e validação de mídia: imagens seguras HTTPS e Base64 vs esquemas perigosos', () => {
    // URL HTTPS válida
    const validHttps = validateMediaPayload('https://hikari.tv/images/frieren-cover.jpg', 'image');
    assert.strictEqual(validHttps.valid, true);

    // Data URL de imagem válida
    const validBase64 = validateMediaPayload('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'image');
    assert.strictEqual(validBase64.valid, true);

    // GIF animado
    const validGif = validateMediaPayload('https://media.tenor.com/7i2r0v_zGqEAAAAM/anya.gif', 'gif');
    assert.strictEqual(validGif.valid, true);

    // Rejeição estrita de esquemas perigosos (XSS injection prevention)
    const dangerousJs = validateMediaPayload('javascript:alert(1)', 'image');
    assert.strictEqual(dangerousJs.valid, false);

    const dangerousHtml = validateMediaPayload('data:text/html;base64,PHNjcmlwdD4=', 'image');
    assert.strictEqual(dangerousHtml.valid, false);

    const nonHttps = validateMediaPayload('ftp://server/image.png', 'image');
    assert.strictEqual(nonHttps.valid, false);
  });

  // 4. Detecção e Prévia de Links do Hikari (Cards Ricos)
  runTest('4. Prévia inteligente de links do Hikari com pôster, notas, episódios e título', () => {
    const textWithHikariUrl = 'Olha esse anime que terminei: https://hikari.app/anime/solo_leveling';
    const preview = extractHikariLinkPreview(textWithHikariUrl);

    assert.ok(preview, 'Deve extrair preview para URL do Hikari');
    assert.strictEqual(preview.type, 'anime');
    assert.ok(preview.title.includes('Solo Leveling'));
    assert.ok(preview.imageUrl && preview.imageUrl.startsWith('http'));
    assert.ok(preview.extraInfo?.rating && preview.extraInfo.rating > 9);

    // Detecção por título no catálogo oficial
    const textWithTitle = 'Você precisa assistir Frieren: Beyond Journey\'s End agora mesmo!';
    const previewTitle = extractHikariLinkPreview(textWithTitle);
    assert.ok(previewTitle);
    assert.strictEqual(previewTitle.title, "Frieren: Beyond Journey's End");
    assert.strictEqual(previewTitle.extraInfo?.status, 'completed');
  });

  // 5. Persistência e Recuperação do Histórico e Marcar como Lido
  runTest('5. Histórico de mensagens e sincronização de status de leitura (isRead)', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const history = chatStore.getConversationMessages(convId, userRen.id, { limit: 10 });
    assert.ok(history.messages.length >= 1, 'Deve retornar as mensagens da conversa');

    // Leitor marca como lido
    const readResult = chatStore.markAsRead(convId, userKuroha.id);
    assert.ok(readResult.updatedCount >= 0);

    const updatedConv = chatStore.getConversationById(convId, userRen.id);
    assert.strictEqual(updatedConv?.unreadCounts[userKuroha.id], 0, 'Contador de não lidas deve zerar após leitura');
  });

  // 6. Testes das Configurações de Privacidade: Everyone, Followers, Mutual, Disabled
  runTest('6. Regras de Privacidade: Configurações de recebimento de mensagens', () => {
    // 6.1. Destinatário com privacidade 'everyone': qualquer um pode enviar
    const checkEveryone = canUserMessageRecipient(userStranger, userRen);
    assert.strictEqual(checkEveryone.allowed, true, 'Privacidade "everyone" deve permitir contato');

    // 6.2. Destinatário com privacidade 'followers': apenas quem segue o destinatário pode enviar
    // Ren segue Kuroha -> permitido
    const checkFollowerAllowed = canUserMessageRecipient(userRen, userKuroha);
    assert.strictEqual(checkFollowerAllowed.allowed, true, 'Seguidor de Kuroha deve ter permissão');

    // Stranger NÃO segue Kuroha -> bloqueado
    const checkStrangerBlocked = canUserMessageRecipient(userStranger, userKuroha);
    assert.strictEqual(checkStrangerBlocked.allowed, false, 'Não-seguidor deve ser bloqueado na privacidade "followers"');
    assert.ok(checkStrangerBlocked.reason?.includes('apenas de usuários que o seguem'));

    // 6.3. Destinatário com privacidade 'mutual': ambos precisam se seguir
    // Ren e Maya se seguem mutuamente -> permitido
    const checkMutualAllowed = canUserMessageRecipient(userRen, userMaya);
    assert.strictEqual(checkMutualAllowed.allowed, true, 'Seguidores mútuos devem ter permissão');

    // Stranger não é seguidor mútuo -> bloqueado
    const checkMutualBlocked = canUserMessageRecipient(userStranger, userMaya);
    assert.strictEqual(checkMutualBlocked.allowed, false, 'Não-mútuo deve ser bloqueado na privacidade "mutual"');

    // 6.4. Destinatário com mensagens desativadas ('allowDirectMessages: false')
    const checkDisabled = canUserMessageRecipient(userRen, userDaiki);
    assert.strictEqual(checkDisabled.allowed, false, 'Mensagens desativadas devem barrar envios');
    assert.ok(checkDisabled.reason?.includes('desativou o recebimento'));
  });

  // 7. Teste de Bloqueio de Usuários (Prevenção total de contorno)
  runTest('7. Bloqueio de usuário: usuário bloqueado não pode enviar mensagens nem criar conversa', () => {
    const userBlocked: UserCheckContext = {
      ...userStranger,
      id: 'usr_troll',
      username: 'troll_user',
    };

    const userProtect: UserCheckContext = {
      ...userRen,
      blockedIds: ['usr_troll'],
    };

    // Tentativa do usuário bloqueado enviar para quem o bloqueou
    const checkBlockedSending = canUserMessageRecipient(userBlocked, userProtect);
    assert.strictEqual(checkBlockedSending.allowed, false);
    assert.ok(checkBlockedSending.reason?.includes('bloqueado'));

    // Tentativa do usuário que bloqueou tentar enviar sem antes desbloquear
    const checkBlockerSending = canUserMessageRecipient(userProtect, userBlocked);
    assert.strictEqual(checkBlockerSending.allowed, false);
    assert.ok(checkBlockerSending.reason?.includes('Você bloqueou este usuário'));
  });

  // 8. Proteção contra acesso de terceiros (Zero-Trust)
  runTest('8. Segurança Zero-Trust: terceiros não conseguem ler nem acessar mensagens de outras conversas', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const thirdPartyId = 'usr_third_party';

    // Tentativa de obter detalhes da conversa
    const thirdPartyConv = chatStore.getConversationById(convId, thirdPartyId);
    assert.strictEqual(thirdPartyConv, null, 'Terceiros não devem obter a conversa');

    // Tentativa de listar mensagens da conversa alheia
    const thirdPartyMessages = chatStore.getConversationMessages(convId, thirdPartyId);
    assert.strictEqual(thirdPartyMessages.messages.length, 0, 'Terceiros não devem ver nenhuma mensagem');
  });

  // 9. Paginação e desempenho com conversas longas
  runTest('9. Paginação progressiva e desempenho: carregamento em blocos com before timestamp', () => {
    const sender = 'usr_alice';
    const recipient = 'usr_bob';

    const { conversation } = chatStore.createOrGetConversation(
      { id: sender, displayName: 'Alice', username: 'alice', avatarUrl: '' },
      { id: recipient, displayName: 'Bob', username: 'bob', avatarUrl: '' }
    );
    const testConvId = conversation.id;

    const baseTime = 1700000000000;
    // Adiciona 50 mensagens
    for (let i = 0; i < 50; i++) {
      chatStore.addMessage({
        id: `perf_msg_${i}`,
        conversationId: testConvId,
        senderId: i % 2 === 0 ? sender : recipient,
        senderName: i % 2 === 0 ? 'Alice' : 'Bob',
        senderAvatarUrl: '',
        recipientId: i % 2 === 0 ? recipient : sender,
        text: `Mensagem teste de performance número ${i + 1}`,
        type: 'text',
        createdAt: baseTime + i * 1000,
      });
    }

    // Busca primeiro lote (mais recentes, limite 20)
    const batch1 = chatStore.getConversationMessages(testConvId, sender, { limit: 20 });
    assert.strictEqual(batch1.messages.length, 20);
    assert.strictEqual(batch1.hasMore, true);
    assert.strictEqual(batch1.messages[batch1.messages.length - 1].id, 'perf_msg_49');

    // Busca segundo lote anterior ao primeiro
    const oldestInBatch1 = batch1.messages[0].createdAt;
    const batch2 = chatStore.getConversationMessages(testConvId, sender, { limit: 20, before: oldestInBatch1 });
    assert.strictEqual(batch2.messages.length, 20);
    assert.strictEqual(batch2.hasMore, true);
    assert.strictEqual(batch2.messages[batch2.messages.length - 1].id, 'perf_msg_29');

    // Busca lote final
    const oldestInBatch2 = batch2.messages[0].createdAt;
    const batch3 = chatStore.getConversationMessages(testConvId, sender, { limit: 20, before: oldestInBatch2 });
    assert.strictEqual(batch3.messages.length, 10);
    assert.strictEqual(batch3.hasMore, false, 'Não deve haver mais mensagens após esgotar o histórico');
  });

  // 10. Listagem de conversas do usuário ordenadas por updatedAt
  runTest('10. Listagem de conversas do usuário ordenadas cronologicamente pela última mensagem', () => {
    const list = chatStore.getUserConversations(userRen.id);
    assert.ok(list.length >= 2);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1].updatedAt >= list[i].updatedAt, 'Lista deve estar ordenada descendentemente por updatedAt');
    }
  });

  console.log('----------------------------------------------------------------');
  console.log(`RESULTADO DOS TESTES: ${passedTests} aprovados, ${failedTests} reprovados.`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica nos testes:', err);
  process.exit(1);
});
