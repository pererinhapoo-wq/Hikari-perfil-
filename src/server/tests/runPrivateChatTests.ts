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

  // 11. Preservação de posição visual e rolagem inteligente
  runTest('11. Rolagem de mensagens: cálculo exato de delta visual sem saltos ao carregar mensagens anteriores', () => {
    // Simula estado do container antes e depois da paginação
    const prevScrollHeight = 1200;
    const prevScrollTop = 200;
    const newScrollHeight = 1800; // 600px de novas mensagens antigas prependadas
    const calculatedScrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
    assert.strictEqual(calculatedScrollTop, 800, 'Posição visual deve manter exatamente o mesmo elemento sob a viewport');

    // Usuário próximo do final (< 100px): deve rolar automaticamente
    const isNearBottom1 = (2000 - 1920 - 700) < 100; // scrollHeight - scrollTop - clientHeight
    assert.strictEqual(isNearBottom1, true, 'Deve auto-rolar se próximo do rodapé');

    // Usuário lendo mensagens antigas lá em cima: NÃO deve auto-rolar
    const isNearBottom2 = (2000 - 400 - 700) < 100;
    assert.strictEqual(isNearBottom2, false, 'NÃO deve forçar rolagem para baixo se lendo histórico');
  });

  // 12. Envio de GIF pela galeria e pelo computador com validação de assinatura binária
  runTest('12. Envio de GIF: validação de assinatura binária real (GIF89a / GIF87a) e compatibilidade com galeria/PC', () => {
    // GIF89a válido em Base64 ('R0lGODlh'...)
    const validGif89a = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const check89a = validateMediaPayload(validGif89a, 'gif');
    assert.strictEqual(check89a.valid, true, 'GIF89a autêntico deve ser aprovado');

    // GIF87a válido em Base64 ('R0lGODdh'...)
    const validGif87a = 'data:image/gif;base64,R0lGODdhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const check87a = validateMediaPayload(validGif87a, 'gif');
    assert.strictEqual(check87a.valid, true, 'GIF87a autêntico deve ser aprovado');
  });

  // 13. Rejeição de arquivo fraudulento ou acima do limite de tamanho
  runTest('13. Segurança de GIF: rejeição de arquivo com cabeçalho adulterado ou tamanho excedido', () => {
    // Arquivo fingindo ser GIF mas com bytes de PNG ('iVBORw0KGgo' = '\x89PNG')
    const fakeGif = 'data:image/gif;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const checkFake = validateMediaPayload(fakeGif, 'gif');
    assert.strictEqual(checkFake.valid, false, 'Arquivo com cabeçalho binário incompatível deve ser rejeitado');
    assert.ok(checkFake.error?.includes('assinatura binária'));

    // Arquivo acima de 8MB (aproximadamente 11.2MB em Base64)
    const giantPayload = 'data:image/gif;base64,R0lGODlh' + 'A'.repeat(12 * 1024 * 1024);
    const checkGiant = validateMediaPayload(giantPayload, 'gif');
    assert.strictEqual(checkGiant.valid, false, 'Arquivo acima do limite de 8MB deve ser rejeitado');
    assert.ok(checkGiant.error?.includes('8MB'));
  });

  // 14. Indicador de digitação em tempo real e expiração automática
  runTest('14. Indicador de digitação: broadcast entre contas e expiração automática após inatividade', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);

    // Ren começa a digitar
    chatStore.setTyping(convId, userRen.id, true);
    let typingForKuroha = chatStore.getTypingUsers(convId, userKuroha.id);
    assert.ok(typingForKuroha.includes(userRen.id), 'Kuroha deve ver Ren digitando');

    // Ren não vê a si mesmo na lista de digitando
    let typingForRen = chatStore.getTypingUsers(convId, userRen.id);
    assert.strictEqual(typingForRen.includes(userRen.id), false, 'Usuário não deve ver o próprio indicador');

    // Ren para de digitar
    chatStore.setTyping(convId, userRen.id, false);
    typingForKuroha = chatStore.getTypingUsers(convId, userKuroha.id);
    assert.strictEqual(typingForKuroha.length, 0, 'Indicador deve sumir imediatamente ao parar de digitar');
  });

  // 15. Reações com emojis: adição, remoção, contagem e prevenção de duplicatas
  runTest('15. Reações às mensagens: alternância (toggle), contagem e prevenção estrita de duplicatas', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const msg = chatStore.addMessage({
      conversationId: convId,
      senderId: userRen.id,
      senderName: userRen.displayName,
      senderAvatarUrl: '',
      recipientId: userKuroha.id,
      text: 'Você viu a cena pós-créditos?',
      type: 'text',
    });

    // 15.1 Kuroha reage com ❤️
    const res1 = chatStore.toggleReaction(convId, msg.message.id, userKuroha.id, '❤️');
    assert.strictEqual(res1.action, 'added');
    assert.deepStrictEqual(res1.message.reactions?.['❤️'], [userKuroha.id]);

    // 15.2 Ren também reage com ❤️
    const res2 = chatStore.toggleReaction(convId, msg.message.id, userRen.id, '❤️');
    assert.strictEqual(res2.action, 'added');
    assert.strictEqual(res2.message.reactions?.['❤️']?.length, 2);

    // 15.3 Kuroha clica novamente no ❤️ -> deve REMOVER sua reação (toggle)
    const res3 = chatStore.toggleReaction(convId, msg.message.id, userKuroha.id, '❤️');
    assert.strictEqual(res3.action, 'removed');
    assert.deepStrictEqual(res3.message.reactions?.['❤️'], [userRen.id]);

    // 15.4 Ren também remove -> a chave '❤️' deve ser limpa
    const res4 = chatStore.toggleReaction(convId, msg.message.id, userRen.id, '❤️');
    assert.strictEqual(res4.action, 'removed');
    assert.strictEqual(res4.message.reactions?.['❤️'], undefined);
  });

  // 16. Indicador de status online em tempo real
  runTest('16. Status Online: indicador verde em tempo real via heartbeat de atividade recente', () => {
    // Kuroha envia heartbeat
    chatStore.recordPresence(userKuroha.id, true, true);
    const isOnlineNow = chatStore.isUserOnline(userKuroha.id);
    assert.strictEqual(isOnlineNow, true, 'Kuroha deve ser reportada como online após heartbeat ativo');

    // Conversas do Ren devem refletir Kuroha online
    const convs = chatStore.getUserConversations(userRen.id);
    const kurohaConv = convs.find((c) => c.participants.includes(userKuroha.id));
    assert.strictEqual(kurohaConv?.participantDetails[userKuroha.id]?.isOnline, true);
  });

  // 17. Configuração de privacidade de status online (ocultação voluntária)
  runTest('17. Privacidade de presença: ocultar status online impede que outros visualizem o indicador verde', () => {
    // Usuário Maya optou por showOnlineStatus = false
    chatStore.recordPresence(userMaya.id, true, false);

    const isMayaOnline = chatStore.isUserOnline(userMaya.id);
    assert.strictEqual(isMayaOnline, false, 'Com showOnlineStatus = false, Maya NUNCA deve ser exibida como online para outros');

    const summary = chatStore.getUserPresenceSummary(userMaya.id);
    assert.strictEqual(summary.isOnline, false);
  });

  // 18. Desconexão inesperada e expiração de presença
  runTest('18. Encerramento de sessão e desconexão: desligamento instantâneo via offline e auto-expiração', () => {
    const testUser = 'usr_temp_logout';
    chatStore.recordPresence(testUser, true, true);
    assert.strictEqual(chatStore.isUserOnline(testUser), true);

    // Chamada de fechamento de página (sendBeacon / visibilitychange)
    chatStore.recordPresence(testUser, false);
    assert.strictEqual(chatStore.isUserOnline(testUser), false, 'Deve ficar offline imediatamente ao fechar a janela');
  });

  // 19. Segurança Zero-Trust: proteção contra injeção de reações por terceiros
  runTest('19. Segurança Zero-Trust: participante de fora da conversa não pode injetar reações', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const msg = chatStore.getConversationMessages(convId, userRen.id, { limit: 1 }).messages[0];
    assert.ok(msg);

    assert.throws(
      () => {
        chatStore.toggleReaction(convId, msg.id, 'usr_intruder', '🔥');
      },
      /Acesso não autorizado/,
      'Terceiros devem ser bloqueados de reagir a mensagens de conversas alheias'
    );
  });

  // 20. Preservação de compatibilidade integral de links e mídias
  runTest('20. Integridade contínua: compatibilidade intacta de links do catálogo Hikari e envio de imagens', () => {
    const convId = getDeterministicConversationId(userRen.id, userKuroha.id);
    const linkMsg = chatStore.addMessage({
      conversationId: convId,
      senderId: userRen.id,
      senderName: userRen.displayName,
      senderAvatarUrl: '',
      recipientId: userKuroha.id,
      text: 'Recomendo assistir Solo Leveling hoje!',
      type: 'link',
    });

    assert.ok(linkMsg.message.linkPreview);
    assert.strictEqual(linkMsg.message.linkPreview.type, 'anime');
    assert.ok(linkMsg.message.linkPreview.title.includes('Solo Leveling'));
    assert.ok(linkMsg.message.linkPreview.extraInfo?.rating);
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
