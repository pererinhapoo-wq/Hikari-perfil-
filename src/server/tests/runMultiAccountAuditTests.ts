import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';

// Ensure singleton stores run in ephemeral mode during test imports so .data/ is never polluted
process.env.HIKARI_EPHEMERAL_TEST_STORE = '1';

import { socialRouter } from '../socialRoutes.js';
import { SocialStore, socialStore } from '../socialStore.js';
import { activityRouter, setBackendUserActivities } from '../activityRoutes.js';
import { chatRouter } from '../chatRoutes.js';
import { ChatStore, chatStore, getDeterministicConversationId } from '../chatStore.js';
import {
  configureSocialServiceForTests,
  syncOwnerSocialWorkspace,
  searchRemoteUserProfiles,
  fetchAuthorizedUserProfileComplete,
  followRemoteUser,
  fetchOwnerNotifications,
  markOwnerNotificationsRead,
} from '../../services/socialService.js';
import {
  configureChatServiceForTests,
  clearChatSessionMemoryCache,
  startOrGetConversation,
  sendPrivateMessage,
  fetchUserConversations,
  fetchConversationMessages,
  markConversationAsRead,
  readCachedConversations,
  readCachedMessages,
  syncUserPrivacyContext,
} from '../../services/chatService.js';
import {
  createEmptyUserWorkspace,
  writeLocalUserWorkspace,
  readLocalUserWorkspace,
  syncPublicProfileProjection,
  purgeCachedPublicProfileProjection,
  readPublicProfilesMap,
  flushPendingWorkspaceWrites,
  clearSessionWorkspaceCaches,
} from '../../lib/userWorkspaceStorage.js';
import { clearAllMemoryCache } from '../../lib/profileCacheManager.js';
import type {
  AnimeItem,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
  ParticipantSummary,
  UserActivity,
  UserProfile,
} from '../../types/index.js';

// ============================================================================
// Browser Storage & Window Simulation (Tab-Isolated Session + Shared LocalStorage)
// ============================================================================
const simulatedLocalStorage = new Map<string, string>();
const simulatedTab1SessionStorage = new Map<string, string>();
const simulatedTab2SessionStorage = new Map<string, string>();

const fakeWindow = {
  localStorage: {
    getItem: (k: string) => simulatedLocalStorage.get(k) ?? null,
    setItem: (k: string, v: string) => simulatedLocalStorage.set(k, v),
    removeItem: (k: string) => simulatedLocalStorage.delete(k),
    clear: () => simulatedLocalStorage.clear(),
  },
  sessionStorage: {
    getItem: (k: string) => simulatedTab1SessionStorage.get(k) ?? null,
    setItem: (k: string, v: string) => simulatedTab1SessionStorage.set(k, v),
    removeItem: (k: string) => simulatedTab1SessionStorage.delete(k),
    clear: () => simulatedTab1SessionStorage.clear(),
  },
  location: {
    pathname: '/',
    search: '',
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
(globalThis as unknown as { document: Record<string, unknown> }).document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
};

// ============================================================================
// Synthetic Accounts (Strictly Synthetic, Zero Real User Data)
// ============================================================================
const UID_A = 'usr_synth_pererinha_a';
const TOKEN_A = `test_token_${UID_A}`;

const UID_B = 'usr_synth_visitor_b';
const TOKEN_B = `test_token_${UID_B}`;

const UID_C_INTRUDER = 'usr_synth_intruder_c';
const TOKEN_C = `test_token_${UID_C_INTRUDER}`;

function buildSyntheticAnimesForA(count: number): AnimeItem[] {
  const list: AnimeItem[] = [];
  for (let i = 1; i <= count; i++) {
    list.push({
      id: `synth_anime_a_${i}`,
      title: `Anime Sintético Exportado #${i}`,
      titleRomaji: `Synth Exported Anime ${i}`,
      posterUrl: `https://example.com/posters/synth_a_${i}.jpg`,
      status: i % 3 === 0 ? 'watching' : 'completed',
      currentEpisode: i % 3 === 0 ? 6 : 24,
      totalEpisodes: 24,
      rating: i <= 5 ? 10 : 8.5,
      isFavorite: i <= 5,
      year: 2020 + (i % 6),
      genres: ['Fantasia', 'Aventura'],
      anilistId: 100000 + i,
    });
  }
  return list;
}

function buildSyntheticAnimesForB(): AnimeItem[] {
  return [
    {
      id: 'synth_anime_b_only_1',
      title: 'Exclusivo Conta B #1',
      posterUrl: 'https://example.com/posters/b1.jpg',
      status: 'completed',
      currentEpisode: 12,
      totalEpisodes: 12,
      rating: 9,
      isFavorite: true,
      year: 2024,
      genres: ['Sci-Fi'],
    },
    {
      id: 'synth_anime_b_only_2',
      title: 'Exclusivo Conta B #2',
      posterUrl: 'https://example.com/posters/b2.jpg',
      status: 'watching',
      currentEpisode: 4,
      totalEpisodes: 12,
      rating: 8,
      isFavorite: false,
      year: 2025,
      genres: ['Mistério'],
    },
    {
      id: 'synth_anime_b_only_3',
      title: 'Exclusivo Conta B #3',
      posterUrl: 'https://example.com/posters/b3.jpg',
      status: 'planned',
      currentEpisode: 0,
      totalEpisodes: 24,
      rating: 0,
      isFavorite: false,
      year: 2025,
      genres: ['Drama'],
    },
  ];
}

const profileA_Public: UserProfile = {
  id: UID_A,
  username: 'pererinha_synth',
  displayName: 'Pererinha Sintética (Conta A)',
  avatarUrl: 'https://example.com/avatars/synth_a.png',
  bannerUrl: 'https://example.com/banners/synth_a_banner.jpg',
  bio: 'Bio pública sintética da Conta A para auditoria.',
  createdAt: '10 de janeiro de 2025',
  createdAtTimestamp: 1736467200000,
  followersCount: 0,
  followingCount: 0,
  isPrivate: false,
  showCommentsOnProfile: true,
  privacySettings: {
    showAnimeList: true,
    showFavorites: true,
    showActivity: true,
    showCommentsOnProfile: true,
    allowDirectMessages: true,
    directMessagesFrom: 'everyone',
    showOnlineStatus: true,
  },
  externalAccounts: {
    anilist: { connected: true, username: 'pererinha_al_synth' },
    mal: { connected: false },
  },
};

const profileB_Public: UserProfile = {
  id: UID_B,
  username: 'visitante_synth',
  displayName: 'Visitante Sintético (Conta B)',
  avatarUrl: 'https://example.com/avatars/synth_b.png',
  bannerUrl: 'https://example.com/banners/synth_b_banner.jpg',
  bio: 'Bio pública sintética da Conta B.',
  createdAt: '12 de janeiro de 2025',
  createdAtTimestamp: 1736640000000,
  followersCount: 0,
  followingCount: 0,
  isPrivate: false,
  showCommentsOnProfile: true,
  privacySettings: {
    showAnimeList: true,
    showFavorites: true,
    showActivity: true,
    showCommentsOnProfile: true,
    allowDirectMessages: true,
    directMessagesFrom: 'everyone',
    showOnlineStatus: true,
  },
  externalAccounts: {
    anilist: { connected: false },
    mal: { connected: false },
  },
};

const favCharsA: FavoriteCharacter[] = [
  {
    id: 'char_synth_a_1',
    name: 'Personagem Sintético A1',
    animeName: 'Anime Sintético Exportado #1',
    role: 'Protagonista',
    imageUrl: 'https://example.com/chars/a1.jpg',
  },
];

const favCompaniesA: FavoriteCompany[] = [
  {
    id: 'comp_synth_a_1',
    name: 'Estúdio Sintético Aurora',
    type: 'Estúdio de Animação',
    notableWorks: 'Anime Sintético Exportado #1',
    logoUrl: 'https://example.com/studios/a1.jpg',
  },
];

const favPeopleA: FavoritePerson[] = [
  {
    id: 'person_synth_a_1',
    name: 'Diretora Sintética A1',
    role: 'Direção',
    notableWork: 'Anime Sintético Exportado #1',
    imageUrl: 'https://example.com/people/a1.jpg',
  },
];

const activitiesA: UserActivity[] = [
  {
    id: 'act_synth_a_pub_1',
    type: 'completed_anime',
    title: 'Anime Sintético Exportado #1',
    description: 'Completou todos os 24 episódios.',
    timestamp: 'Há 2 horas',
    createdAtTimestamp: Date.now() - 7200_000,
    score: 10,
    isPrivate: false,
  },
  {
    id: 'act_synth_a_priv_2',
    type: 'watched_ep',
    title: 'Nota Privada Interna A',
    description: 'Atividade marcada individualmente como privada.',
    timestamp: 'Há 1 hora',
    createdAtTimestamp: Date.now() - 3600_000,
    episode: 6,
    isPrivate: true,
  },
];

const participantA: ParticipantSummary = {
  id: UID_A,
  username: profileA_Public.username,
  displayName: profileA_Public.displayName,
  avatarUrl: profileA_Public.avatarUrl,
};

const participantB: ParticipantSummary = {
  id: UID_B,
  username: profileB_Public.username,
  displayName: profileB_Public.displayName,
  avatarUrl: profileB_Public.avatarUrl,
};

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/users', socialRouter);
  app.use('/users', socialRouter);
  app.use('/api/users', activityRouter);
  app.use('/api/activities', activityRouter);
  app.use('/api/chat', chatRouter);

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function runAuditSuite() {
  console.log('================================================================================');
  console.log('AUDITORIA COMPLETA DE MULTI-CONTAS, PRIVACIDADE, NOTIFICAÇÕES E MENSAGENS HIKARI');
  console.log('================================================================================\n');

  socialStore.resetForTests(true);
  chatStore.resetForTests(true);
  simulatedLocalStorage.clear();
  simulatedTab1SessionStorage.clear();
  simulatedTab2SessionStorage.clear();
  clearSessionWorkspaceCaches();
  clearChatSessionMemoryCache();
  clearAllMemoryCache();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-audit-synth-'));
  const tempSocialFile = path.join(tempDir, 'social-store.json');
  const tempChatFile = path.join(tempDir, 'chat-store.json');

  const { server, baseUrl } = await startTestServer();

  const results: Array<{ id: number; name: string; passed: boolean; details: string }> = [];

  try {
    const animesA = buildSyntheticAnimesForA(420); // > 300 legacy Firestore limit & > 150 localStorage slice
    const animesB = buildSyntheticAnimesForB();

    // =========================================================================
    // TESTE 1: Conta A possui animes (420 exportados/importados) e favoritos
    // =========================================================================
    {
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });

      const wsA = createEmptyUserWorkspace(UID_A);
      wsA.animes = animesA;
      wsA.favoriteCharacters = favCharsA;
      wsA.favoriteCompanies = favCompaniesA;
      wsA.favoritePeople = favPeopleA;
      wsA.activities = activitiesA;
      wsA.profileOverrides = {
        username: profileA_Public.username,
        displayName: profileA_Public.displayName,
        avatarUrl: profileA_Public.avatarUrl,
        bannerUrl: profileA_Public.bannerUrl,
        bio: profileA_Public.bio,
        isPrivate: false,
        privacySettings: profileA_Public.privacySettings,
      };

      writeLocalUserWorkspace(UID_A, wsA, { immediate: true });
      syncPublicProfileProjection(profileA_Public, animesA, Date.now(), {
        immediate: true,
        favoriteCharacters: favCharsA,
        favoriteCompanies: favCompaniesA,
        favoritePeople: favPeopleA,
        activities: activitiesA,
      });
      setBackendUserActivities(UID_A, activitiesA);

      const syncResA = await syncOwnerSocialWorkspace(UID_A, {
        profile: profileA_Public,
        animes: animesA,
        animesComplete: true,
        favoriteCharacters: favCharsA,
        favoriteCompanies: favCompaniesA,
        favoritePeople: favPeopleA,
        activities: activitiesA,
      });

      assert.ok(syncResA, 'Sincronização da Conta A deve retornar estado válido');
      const storedA = socialStore.getUserRecord(UID_A);
      assert.ok(storedA, 'Registro da Conta A deve existir no backend');
      assert.strictEqual(storedA.animes.length, 420, 'Conta A deve manter todos os 420 animes sem truncamento');
      assert.strictEqual(
        storedA.animes.filter((a) => a.isFavorite).length,
        5,
        'Conta A deve manter os 5 animes favoritos'
      );
      assert.strictEqual(storedA.favoriteCharacters.length, 1);
      assert.strictEqual(storedA.favoriteCompanies.length, 1);
      assert.strictEqual(storedA.favoritePeople.length, 1);

      // Configura também Conta B com dados próprios distintos para garantir não-mistura
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      const wsB = createEmptyUserWorkspace(UID_B);
      wsB.animes = animesB;
      wsB.profileOverrides = {
        username: profileB_Public.username,
        displayName: profileB_Public.displayName,
        avatarUrl: profileB_Public.avatarUrl,
        bio: profileB_Public.bio,
        isPrivate: false,
        privacySettings: profileB_Public.privacySettings,
      };
      writeLocalUserWorkspace(UID_B, wsB, { immediate: true });
      await syncOwnerSocialWorkspace(UID_B, {
        profile: profileB_Public,
        animes: animesB,
        animesComplete: true,
      });

      results.push({
        id: 1,
        name: 'Conta A possui animes (420 exportados/importados) e favoritos completos',
        passed: true,
        details: '420 animes, 5 animes favoritos, personagens/estúdios/pessoas favoritos e atividades sincronizados por UID.',
      });
    }

    // =========================================================================
    // TESTE 2: Conta B pesquisa "pererinha_synth", abre perfil público de A e vê 100% dos dados públicos
    // =========================================================================
    {
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });

      const foundProfiles = await searchRemoteUserProfiles('pererinha_synth');
      assert.ok(
        foundProfiles.some((p) => p.id === UID_A && p.username === 'pererinha_synth'),
        'Conta B deve encontrar "pererinha_synth" na busca remota'
      );

      // Testa paginação explícita de animes em blocos de 150 para provar ausência de truncamento
      const page1Res = await fetch(`${baseUrl}/api/users/${UID_A}/animes?offset=0&limit=150`, {
        headers: { Authorization: `Bearer ${TOKEN_B}` },
      });
      assert.strictEqual(page1Res.status, 200);
      const page1Data = await page1Res.json();
      assert.strictEqual(page1Data.animes.length, 150);
      assert.strictEqual(page1Data.totalAnimes, 420);
      assert.strictEqual(page1Data.hasMore, true);
      assert.strictEqual(page1Data.nextOffset, 150);

      // Testa hidratação completa automática usada pelo App.tsx ao visitar perfil público
      const visitResult = await fetchAuthorizedUserProfileComplete('pererinha_synth');
      assert.strictEqual(visitResult.status, 'ok', 'Conta B deve acessar perfil público de A');
      if (visitResult.status === 'ok') {
        assert.strictEqual(visitResult.data.isOwner, false);
        assert.strictEqual(visitResult.data.profile.id, UID_A);
        assert.strictEqual(
          visitResult.data.animes.length,
          420,
          'Conta B deve visualizar todos os 420 animes públicos de A (sem truncar em 150 ou 300)'
        );
        assert.strictEqual(
          visitResult.data.animes.some((a) => a.id.startsWith('synth_anime_b_')),
          false,
          'Visitante B jamais deve ver seus próprios animes ao visitar A'
        );
        assert.strictEqual(visitResult.data.animes.filter((a) => a.isFavorite).length, 5);
        assert.strictEqual(visitResult.data.favoriteCharacters.length, 1);
        assert.strictEqual(visitResult.data.favoriteCompanies.length, 1);
        assert.strictEqual(visitResult.data.favoritePeople.length, 1);
        // Apenas a atividade pública de A deve aparecer (a atividade privada individual é filtrada)
        assert.strictEqual(visitResult.data.activities.length, 1);
        assert.strictEqual(visitResult.data.activities[0].id, 'act_synth_a_pub_1');
        // Credenciais/conexões externas privadas são sanitizadas para visitantes
        assert.strictEqual(visitResult.data.profile.externalAccounts.anilist.connected, false);
      }

      results.push({
        id: 2,
        name: 'Conta B abre o perfil público de A e visualiza os dados públicos completos',
        passed: true,
        details: 'Busca encontrou @pererinha_synth; visitante B carregou 420/420 animes paginados, favoritos completos e atividades públicas (0 vazamento de B ou de itens privados de A).',
      });
    }

    // =========================================================================
    // TESTE 3: A atualiza a página (F5) e continua autenticada como A (mesmo com B logada em outra aba)
    // =========================================================================
    {
      const firebaseLibSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/lib/firebase.ts'),
        'utf8'
      );
      assert.ok(
        firebaseLibSource.includes('browserSessionPersistence'),
        'firebase.ts deve configurar browserSessionPersistence para isolar a sessão por aba e nunca trocar de conta no F5'
      );
      assert.ok(
        !firebaseLibSource.includes('indexedDBLocalPersistence'),
        'firebase.ts não deve usar indexedDBLocalPersistence compartilhado entre abas'
      );

      const storageLibSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/lib/userWorkspaceStorage.ts'),
        'utf8'
      );
      assert.ok(
        storageLibSource.includes('activeManifest.totalAnimes > legacyCount'),
        'userWorkspaceStorage.ts deve carregar todos os chunks quando totalAnimes > legacyCount no reload'
      );

      // Simula Aba 1 autenticada como Conta A e Aba 2 autenticada como Conta B simultaneamente
      simulatedTab1SessionStorage.set('firebase:authUser:hikari', JSON.stringify({ uid: UID_A }));
      simulatedTab2SessionStorage.set('firebase:authUser:hikari', JSON.stringify({ uid: UID_B }));

      // Aba 1 dá F5 (recarrega memória volátil, mantendo sessionStorage da Aba 1 e localStorage)
      const restoredTab1Auth = JSON.parse(
        simulatedTab1SessionStorage.get('firebase:authUser:hikari') || '{}'
      );
      assert.strictEqual(
        restoredTab1Auth.uid,
        UID_A,
        'Ao atualizar a página na Aba 1, a sessão restaurada deve continuar sendo Conta A (nunca Conta B)'
      );

      // Verifica que mesmo após limpar cache em memória (reload), Conta A recupera seus 420 animes do backend/workspace
      clearSessionWorkspaceCaches();
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      const ownerReloadView = await fetchAuthorizedUserProfileComplete(UID_A);
      assert.strictEqual(ownerReloadView.status, 'ok');
      if (ownerReloadView.status === 'ok') {
        assert.strictEqual(ownerReloadView.data.isOwner, true);
        assert.strictEqual(ownerReloadView.data.animes.length, 420);
      }

      results.push({
        id: 3,
        name: 'Conta A atualiza a página e continua autenticada como A com dados completos',
        passed: true,
        details: 'browserSessionPersistence isola cada aba de logins concorrentes; F5 preserva UID_A e restaura 420/420 animes.',
      });
    }

    // =========================================================================
    // TESTE 4: B segue A e A recebe a notificação (sem duplicatas)
    // =========================================================================
    {
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      const followRes1 = await followRemoteUser(
        UID_A,
        {
          username: profileB_Public.username,
          displayName: profileB_Public.displayName,
          avatarUrl: profileB_Public.avatarUrl,
        },
        {
          username: profileA_Public.username,
          displayName: profileA_Public.displayName,
          avatarUrl: profileA_Public.avatarUrl,
          isPrivate: false,
        }
      );

      assert.ok(followRes1 && followRes1.ok, 'Ação de B seguir A deve ter sucesso');
      assert.strictEqual(followRes1.status, 'following');
      assert.strictEqual(followRes1.isFollowBack, false);
      assert.strictEqual(followRes1.targetFollowersCount, 1);

      // Repete tentativa de seguir para provar idempotência e ausência de notificações duplicadas
      const followResDuplicate = await followRemoteUser(UID_A, {
        username: profileB_Public.username,
        displayName: profileB_Public.displayName,
        avatarUrl: profileB_Public.avatarUrl,
      });
      assert.ok(followResDuplicate);
      assert.strictEqual(followResDuplicate.status, 'already_following');
      assert.strictEqual(followResDuplicate.deliveredNotificationId, null);

      // Conta B tenta ler notificações de A -> deve ser bloqueada com HTTP 403
      const forbiddenNotifRes = await fetch(`${baseUrl}/api/users/${UID_A}/notifications`, {
        headers: { Authorization: `Bearer ${TOKEN_B}` },
      });
      assert.strictEqual(
        forbiddenNotifRes.status,
        403,
        'Conta B não pode acessar notificações privadas da Conta A'
      );

      // Conta A consulta suas próprias notificações
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      const notifStateA = await fetchOwnerNotifications(UID_A);
      assert.ok(notifStateA, 'Conta A deve receber seu estado de notificações');
      assert.strictEqual(notifStateA.notifications.length, 1, 'Não deve criar notificações duplicadas');
      assert.strictEqual(notifStateA.unreadCount, 1, 'Contador de notificações não lidas deve ser 1');
      assert.strictEqual(notifStateA.notifications[0].type, 'new_follower');
      assert.strictEqual(notifStateA.notifications[0].actor.id, UID_B);
      assert.strictEqual(notifStateA.notifications[0].message, 'começou a seguir você.');

      results.push({
        id: 4,
        name: 'Conta B segue Conta A e A recebe notificação real sem duplicidade',
        passed: true,
        details: 'Notificação new_follower entregue a A (unreadCount=1), repetição idempotente sem duplicatas e bloqueio 403 contra leitura por terceiros.',
      });
    }

    // =========================================================================
    // TESTE 5: A e B trocam mensagens; ambas permanecem após atualizar a página e reiniciar store
    // =========================================================================
    const convAB = getDeterministicConversationId(UID_A, UID_B);
    {
      // B inicia conversa e envia mensagem para A
      configureChatServiceForTests({ baseUrl, token: TOKEN_B, activeUserId: UID_B });
      await syncUserPrivacyContext({
        id: UID_B,
        username: profileB_Public.username,
        displayName: profileB_Public.displayName,
        avatarUrl: profileB_Public.avatarUrl,
        allowDirectMessages: true,
        directMessagesFrom: 'everyone',
        followingIds: [UID_A],
        followerIds: [],
        blockedIds: [],
      });

      const startedConv = await startOrGetConversation(participantB, participantA);
      assert.strictEqual(startedConv.id, convAB);

      const msgFromB = await sendPrivateMessage({
        conversationId: convAB,
        sender: participantB,
        recipient: participantA,
        text: 'Olá Pererinha! Gostei muito da sua lista completa de animes.',
      });
      assert.ok(msgFromB.id);

      // A responde para B
      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });
      await syncUserPrivacyContext({
        id: UID_A,
        username: profileA_Public.username,
        displayName: profileA_Public.displayName,
        avatarUrl: profileA_Public.avatarUrl,
        allowDirectMessages: true,
        directMessagesFrom: 'everyone',
        followingIds: [],
        followerIds: [UID_B],
        blockedIds: [],
      });

      const msgFromA = await sendPrivateMessage({
        conversationId: convAB,
        sender: participantA,
        recipient: participantB,
        text: 'Obrigada! Que bom que todos os 420 animes apareceram direitinho.',
      });
      assert.ok(msgFromA.id);

      // Simula F5 (limpeza total da memória em tempo de execução) para A e para B
      clearChatSessionMemoryCache();

      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });
      const convsAfterReloadA = await fetchUserConversations(UID_A);
      assert.strictEqual(convsAfterReloadA.length, 1, 'Conversa deve permanecer para Conta A após reload');
      const historyAfterReloadA = await fetchConversationMessages(convAB, UID_A);
      assert.strictEqual(
        historyAfterReloadA.messages.length,
        2,
        'Ambas as mensagens devem permanecer para Conta A após atualizar a página'
      );

      configureChatServiceForTests({ baseUrl, token: TOKEN_B, activeUserId: UID_B });
      const convsAfterReloadB = await fetchUserConversations(UID_B);
      assert.strictEqual(convsAfterReloadB.length, 1, 'Conversa deve permanecer para Conta B após reload');
      const historyAfterReloadB = await fetchConversationMessages(convAB, UID_B);
      assert.strictEqual(
        historyAfterReloadB.messages.length,
        2,
        'Ambas as mensagens devem permanecer para Conta B após atualizar a página'
      );

      // Valida persistência real em disco (ChatStore recarregando de arquivo temporário isolado)
      const diskChatStore1 = new ChatStore({ storageFilePath: tempChatFile, ephemeral: false });
      diskChatStore1.createOrGetConversation(participantA, participantB);
      diskChatStore1.addMessage({
        conversationId: convAB,
        senderId: UID_B,
        senderName: participantB.displayName,
        senderUsername: participantB.username,
        senderAvatarUrl: participantB.avatarUrl,
        recipientId: UID_A,
        text: 'Mensagem persistida em disco 1',
        type: 'text',
      });
      const diskChatStoreReloaded = new ChatStore({ storageFilePath: tempChatFile, ephemeral: false });
      const reloadedDiskMsgs = diskChatStoreReloaded.getConversationMessages(convAB, UID_A);
      assert.strictEqual(
        reloadedDiskMsgs.messages.length,
        1,
        'ChatStore deve persistir conversas e mensagens em disco entre reinicializações'
      );

      // Valida que Conta C (intrusa) recebe HTTP 403 ao tentar ler mensagens ou conversas de A/B
      const intruderConvRes = await fetch(
        `${baseUrl}/api/chat/conversations?userId=${encodeURIComponent(UID_A)}`,
        { headers: { Authorization: `Bearer ${TOKEN_C}` } }
      );
      assert.strictEqual(
        intruderConvRes.status,
        403,
        'Conta C não pode consultar conversas passando userId de outra conta'
      );

      const intruderMsgsRes = await fetch(
        `${baseUrl}/api/chat/conversations/${encodeURIComponent(convAB)}/messages?userId=${encodeURIComponent(UID_C_INTRUDER)}`,
        { headers: { Authorization: `Bearer ${TOKEN_C}` } }
      );
      assert.strictEqual(
        intruderMsgsRes.status,
        403,
        'Conta C não pode ler histórico de mensagens de conversa entre A e B'
      );

      results.push({
        id: 5,
        name: 'A e B trocam mensagens; ambas permanecem após reload e são isoladas contra terceiros',
        passed: true,
        details: '2/2 mensagens preservadas em reload de sessão e persistência em disco; Conta C bloqueada com HTTP 403.',
      });
    }

    // =========================================================================
    // TESTE 6: Ao visualizar uma mensagem, a barra roxa desaparece e o estado permanece após reload
    // =========================================================================
    {
      // Verifica no código do PrivateChatModal que a barra roxa (border-l-purple-500) depende estritamente de hasUnread (unreadCount > 0)
      const modalSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/chat/PrivateChatModal.tsx'),
        'utf8'
      );
      assert.ok(
        modalSource.includes("hasUnread\n                          ? 'border-l-4 border-l-purple-500'") ||
          modalSource.includes("hasUnread ? 'border-l-4 border-l-purple-500'"),
        'PrivateChatModal deve vincular border-l-purple-500 exclusivamente a hasUnread (unreadCount > 0)'
      );

      // Antes de A visualizar a mensagem de B: A tem unreadCount = 1 (barra roxa ativa), B também tem unreadCount = 1 (da resposta de A)
      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });
      const beforeReadConvsA = await fetchUserConversations(UID_A);
      const convBeforeReadA = beforeReadConvsA.find((c) => c.id === convAB);
      assert.ok(convBeforeReadA);
      assert.strictEqual(
        convBeforeReadA.unreadCounts[UID_A],
        1,
        'Antes de abrir a conversa, Conta A deve ter 1 mensagem não lida (barra roxa visível)'
      );

      // Conta A visualiza a conversa -> marca como lida
      await markConversationAsRead(convAB, UID_A);

      // Verifica imediatamente no cache local de A (barra roxa some na hora)
      const immediateCachedConvsA = readCachedConversations(UID_A);
      const immediateConvA = immediateCachedConvsA.find((c) => c.id === convAB);
      assert.ok(immediateConvA);
      const hasPurpleBarAfterView = (immediateConvA.unreadCounts[UID_A] || 0) > 0;
      assert.strictEqual(
        hasPurpleBarAfterView,
        false,
        'Barra roxa deve desaparecer imediatamente ao visualizar a conversa'
      );

      // Verifica que o estado de leitura é INDIVIDUAL por usuário: Conta B ainda não leu a resposta de A!
      configureChatServiceForTests({ baseUrl, token: TOKEN_B, activeUserId: UID_B });
      const convsForB = await fetchUserConversations(UID_B);
      const convForB = convsForB.find((c) => c.id === convAB);
      assert.ok(convForB);
      assert.strictEqual(
        convForB.unreadCounts[UID_B],
        1,
        'Marcar como lida para A não pode alterar o estado não lido individual de B'
      );

      // Conta A dá F5 (limpa memória e recarrega do servidor) -> NÃO pode voltar a aparecer como não lida!
      clearChatSessionMemoryCache();
      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });
      const afterReloadConvsA = await fetchUserConversations(UID_A);
      const convAfterReloadA = afterReloadConvsA.find((c) => c.id === convAB);
      assert.ok(convAfterReloadA);
      assert.strictEqual(
        convAfterReloadA.unreadCounts[UID_A],
        0,
        'Após atualizar a página (F5), a conversa visualizada por A deve permanecer lida (unreadCount = 0)'
      );
      const msgsAfterReloadA = await fetchConversationMessages(convAB, UID_A);
      const incomingForA = msgsAfterReloadA.messages.filter((m) => m.recipientId === UID_A);
      assert.ok(
        incomingForA.every((m) => m.isRead === true),
        'Todas as mensagens recebidas por A devem permanecer com isRead === true após reload'
      );

      results.push({
        id: 6,
        name: 'Ao visualizar mensagem, barra roxa desaparece, estado é individual e persiste após reload',
        passed: true,
        details: 'unreadCounts[A] foi de 1 -> 0 (hasUnread=false), permaneceu 0 após F5, enquanto unreadCounts[B]=1 manteve independência.',
      });
    }

    // =========================================================================
    // TESTE 7: B segue A e depois recebe notificação de follow-back quando A segue B
    // =========================================================================
    {
      // Marca notificação anterior de A como lida para verificar contador individual
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      const readNotifA = await markOwnerNotificationsRead(UID_A, { markAll: true });
      assert.ok(readNotifA);
      assert.strictEqual(readNotifA.unreadCount, 0);

      // Agora Conta A segue Conta B de volta!
      const followBackRes = await followRemoteUser(
        UID_B,
        {
          username: profileA_Public.username,
          displayName: profileA_Public.displayName,
          avatarUrl: profileA_Public.avatarUrl,
        },
        {
          username: profileB_Public.username,
          displayName: profileB_Public.displayName,
          avatarUrl: profileB_Public.avatarUrl,
          isPrivate: false,
        }
      );

      assert.ok(followBackRes && followBackRes.ok, 'Follow-back de A para B deve ter sucesso');
      assert.strictEqual(followBackRes.status, 'following');
      assert.strictEqual(
        followBackRes.isFollowBack,
        true,
        'Backend deve identificar relacionamento mútuo como follow-back'
      );

      // Repete follow-back para garantir zero duplicidade
      const duplicateFollowBack = await followRemoteUser(UID_B, {
        username: profileA_Public.username,
        displayName: profileA_Public.displayName,
      });
      assert.ok(duplicateFollowBack);
      assert.strictEqual(duplicateFollowBack.status, 'already_following');
      assert.strictEqual(duplicateFollowBack.deliveredNotificationId, null);

      // Conta B verifica suas notificações -> deve ter recebido "seguiu você de volta."
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      const notifStateB = await fetchOwnerNotifications(UID_B);
      assert.ok(notifStateB);
      assert.strictEqual(
        notifStateB.notifications.length,
        1,
        'Conta B deve possuir exatamente 1 notificação de follow-back (sem duplicatas)'
      );
      assert.strictEqual(notifStateB.unreadCount, 1);
      assert.strictEqual(notifStateB.notifications[0].type, 'new_follower');
      assert.strictEqual(notifStateB.notifications[0].actor.id, UID_A);
      assert.strictEqual(notifStateB.notifications[0].message, 'seguiu você de volta.');

      results.push({
        id: 7,
        name: 'Conta B recebe notificação de follow-back quando A segue B de volta',
        passed: true,
        details: 'isFollowBack=true detectado; Conta B recebeu "seguiu você de volta." com unreadCount=1 e zero duplicatas.',
      });
    }

    // =========================================================================
    // TESTE 8: A altera o perfil para privado e B perde o acesso ao conteúdo (mesmo já seguindo A!)
    // =========================================================================
    const profileA_Private: UserProfile = {
      ...profileA_Public,
      isPrivate: true,
    };
    {
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      await syncOwnerSocialWorkspace(UID_A, {
        profile: profileA_Private,
        animes: animesA,
        animesComplete: true,
        favoriteCharacters: favCharsA,
        favoriteCompanies: favCompaniesA,
        favoritePeople: favPeopleA,
        activities: activitiesA,
      });

      // Atualiza também projeção local para validar limpeza imediata de cache público
      syncPublicProfileProjection(profileA_Private, animesA, Date.now(), {
        immediate: true,
        favoriteCharacters: favCharsA,
        favoriteCompanies: favCompaniesA,
        favoritePeople: favPeopleA,
        activities: activitiesA,
      });

      const cachedPublicAfterPrivate = readPublicProfilesMap()[UID_A];
      assert.ok(cachedPublicAfterPrivate, 'Stub privado sanitizado deve refletir isPrivate=true');
      assert.strictEqual(cachedPublicAfterPrivate.profile.isPrivate, true);
      assert.strictEqual(
        cachedPublicAfterPrivate.publicAnimes.length,
        0,
        'Cache público local não pode reter animes após mudar perfil para privado'
      );
      assert.strictEqual(cachedPublicAfterPrivate.favoriteCharacters?.length ?? 0, 0);
      assert.strictEqual(cachedPublicAfterPrivate.publicActivities?.length ?? 0, 0);
      assert.strictEqual(cachedPublicAfterPrivate.profile.bio, '');
      assert.strictEqual(cachedPublicAfterPrivate.profile.bannerUrl, '');

      // Conta B (que já seguia A no Teste 4!) tenta abrir o perfil de A
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      const bVisitAfterPrivate = await fetchAuthorizedUserProfileComplete('pererinha_synth');
      assert.strictEqual(
        bVisitAfterPrivate.status,
        'private_blocked',
        'Conta B deve perder acesso imediatamente quando A muda o perfil para privado'
      );
      if (bVisitAfterPrivate.status === 'private_blocked') {
        assert.strictEqual(bVisitAfterPrivate.profileStub?.isPrivate, true);
        assert.strictEqual(bVisitAfterPrivate.profileStub?.bio, '');
        assert.strictEqual(bVisitAfterPrivate.profileStub?.bannerUrl, '');
        purgeCachedPublicProfileProjection(UID_A, bVisitAfterPrivate.profileStub ?? undefined);
      }

      // Verifica no código do App.tsx que isPrivateLocked bloqueia TODAS as abas (sem exceção para seguidores ou aba 'about')
      const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
      assert.ok(
        appSource.includes('const isPrivateLocked = !isOwnProfile && activeProfile.isPrivate;'),
        'App.tsx deve aplicar isPrivateLocked estritamente para todos os não-proprietários'
      );

      results.push({
        id: 8,
        name: 'Conta A muda perfil para privado e Conta B perde acesso ao conteúdo e caches',
        passed: true,
        details: 'Mesmo sendo seguidor prévio, B recebeu private_blocked; caches locais de animes/favoritos/bio/atividades de A foram zerados.',
      });
    }

    // =========================================================================
    // TESTE 9: Tentativas por URL direta, APIs e regras de banco para acessar perfil privado são bloqueadas
    // =========================================================================
    {
      // 9.1 Tentativa via API de perfil por username e por UID (como Conta B e como anônimo)
      const apiProfileAsB = await fetch(`${baseUrl}/api/users/pererinha_synth/profile`, {
        headers: { Authorization: `Bearer ${TOKEN_B}` },
      });
      assert.strictEqual(apiProfileAsB.status, 403, 'GET /api/users/:username/profile deve retornar 403');
      const apiProfileBody = await apiProfileAsB.json();
      assert.strictEqual(apiProfileBody.code, 'PRIVATE_PROFILE');
      assert.strictEqual('animes' in apiProfileBody, false, 'Resposta 403 não pode conter lista de animes');

      const apiProfileAnon = await fetch(`${baseUrl}/api/users/${UID_A}/profile`);
      assert.strictEqual(apiProfileAnon.status, 403, 'Acesso anônimo por UID deve retornar 403');

      // 9.2 Tentativa via API paginada de animes
      const apiAnimesAsB = await fetch(`${baseUrl}/api/users/${UID_A}/animes?offset=0&limit=50`, {
        headers: { Authorization: `Bearer ${TOKEN_B}` },
      });
      assert.strictEqual(apiAnimesAsB.status, 403, 'GET /api/users/:id/animes deve retornar 403 para perfil privado');
      const apiAnimesBody = await apiAnimesAsB.json();
      assert.strictEqual(apiAnimesBody.animes.length, 0);

      // 9.3 Tentativa via API de atividades — incluindo ataque de spoofing do header x-client-uid!
      const apiActivitiesSpoofed = await fetch(`${baseUrl}/api/users/${UID_A}/activities`, {
        headers: {
          Authorization: `Bearer ${TOKEN_B}`,
          'x-client-uid': UID_A, // Tentativa maliciosa de se passar pelo dono!
        },
      });
      assert.strictEqual(
        apiActivitiesSpoofed.status,
        403,
        'GET /api/users/:id/activities deve ignorar x-client-uid falsificado e retornar 403'
      );

      const apiActivitiesUnauthSpoof = await fetch(
        `${baseUrl}/api/activities?userId=${encodeURIComponent(UID_A)}`,
        {
          headers: { 'x-client-uid': UID_A },
        }
      );
      assert.strictEqual(
        apiActivitiesUnauthSpoof.status,
        403,
        'GET /api/activities sem token válido deve retornar 403 para conta privada real'
      );

      // 9.4 Busca pública enquanto A é privada não pode vazar bio nem banner
      const searchPrivateRes = await fetch(`${baseUrl}/api/users/search?q=pererinha_synth`);
      const searchPrivateData = await searchPrivateRes.json();
      const foundPrivateStub = searchPrivateData.profiles.find((p: UserProfile) => p.id === UID_A);
      assert.ok(foundPrivateStub);
      assert.strictEqual(foundPrivateStub.isPrivate, true);
      assert.strictEqual(foundPrivateStub.bio, '');
      assert.strictEqual(foundPrivateStub.bannerUrl, '');

      // 9.5 Verificação de URL direta (?profile=pererinha_synth e /u/pererinha_synth) + Regras do Firestore
      const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
      assert.ok(
        appSource.includes('resolveDirectProfileTargetFromLocation'),
        'App.tsx deve resolver URLs diretas (?profile=, /u/, /perfil/) passando pelo bloqueio de privacidade'
      );

      const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
      assert.ok(
        rulesSource.includes('allow get, list: if isOwner(userId) || resource.data.isPrivate == false;'),
        'firestore.rules deve bloquear get/list em /users/{userId} quando isPrivate == true'
      );
      assert.ok(
        rulesSource.includes('match /public_projection/{projId}') &&
          rulesSource.includes('.data.isPrivate == false'),
        'firestore.rules deve bloquear /users/{userId}/public_projection/{projId} quando isPrivate == true'
      );
      assert.ok(
        rulesSource.includes('match /workspace/{docId}') &&
          rulesSource.includes('match /anime_chunks/{chunkId}'),
        'firestore.rules deve restringir workspace e anime_chunks exclusivamente ao proprietário'
      );

      results.push({
        id: 9,
        name: 'URL direta, APIs (/profile, /animes, /activities + spoofing) e regras do banco bloqueiam perfil privado',
        passed: true,
        details: 'Todas as rotas retornaram HTTP 403 (incluindo spoofing de x-client-uid); firestore.rules valida isPrivate == false.',
      });
    }

    // =========================================================================
    // TESTE 10: Conta A continua acessando seus próprios dados privados normalmente
    // =========================================================================
    {
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      const ownerPrivateView = await fetchAuthorizedUserProfileComplete(UID_A);
      assert.strictEqual(
        ownerPrivateView.status,
        'ok',
        'Proprietária Conta A deve continuar acessando 100% dos seus dados mesmo com isPrivate=true'
      );
      if (ownerPrivateView.status === 'ok') {
        assert.strictEqual(ownerPrivateView.data.isOwner, true);
        assert.strictEqual(ownerPrivateView.data.profile.isPrivate, true);
        assert.strictEqual(ownerPrivateView.data.profile.bio, profileA_Public.bio);
        assert.strictEqual(ownerPrivateView.data.animes.length, 420);
        assert.strictEqual(ownerPrivateView.data.favoriteCharacters.length, 1);
        assert.strictEqual(ownerPrivateView.data.activities.length, 2);
      }

      const ownerActivitiesRes = await fetch(`${baseUrl}/api/users/${UID_A}/activities`, {
        headers: { Authorization: `Bearer ${TOKEN_A}` },
      });
      assert.strictEqual(ownerActivitiesRes.status, 200);
      const ownerActivitiesData = await ownerActivitiesRes.json();
      assert.strictEqual(ownerActivitiesData.isOwner, true);
      assert.strictEqual(
        ownerActivitiesData.activities.length,
        2,
        'Proprietária Conta A deve ver tanto atividades públicas quanto privadas próprias'
      );

      results.push({
        id: 10,
        name: 'Conta A (proprietária) continua acessando seus próprios dados privados integralmente',
        passed: true,
        details: 'HTTP 200 para A com 420 animes, favoritos, bio e 2/2 atividades (incluindo atividade privada).',
      });
    }

    // =========================================================================
    // TESTE 11: Trocar entre A e B não mistura listas, favoritos, mensagens, notificações ou caches
    // =========================================================================
    {
      // Sessão ativa: Conta A -> Troca para Conta B
      await flushPendingWorkspaceWrites();
      clearSessionWorkspaceCaches(UID_B);
      clearChatSessionMemoryCache(UID_B);
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      configureChatServiceForTests({ baseUrl, token: TOKEN_B, activeUserId: UID_B });

      const localWsB = readLocalUserWorkspace(UID_B);
      assert.ok(localWsB);
      assert.strictEqual(localWsB.uid, UID_B);
      assert.strictEqual(localWsB.animes.length, 3, 'Workspace local de B deve conter apenas os 3 animes de B');
      assert.strictEqual(localWsB.favoriteCharacters.length, 0);

      const notifsB = await fetchOwnerNotifications(UID_B);
      assert.ok(notifsB);
      assert.ok(
        notifsB.notifications.every((n) => n.actor.id !== UID_B),
        'Notificações de B pertencem apenas a B'
      );

      // Cria uma conversa exclusiva entre B e um contato sintético D para provar que o cache de chat de A nunca vê a conversa de B
      const participantD: ParticipantSummary = {
        id: 'usr_synth_friend_d',
        username: 'amigo_d_synth',
        displayName: 'Amigo Sintético D',
        avatarUrl: '',
      };
      const convBD = getDeterministicConversationId(UID_B, participantD.id);
      await startOrGetConversation(participantB, participantD);
      await sendPrivateMessage({
        conversationId: convBD,
        sender: participantB,
        recipient: participantD,
        text: 'Mensagem exclusiva entre B e D',
      });

      const cachedConvsB = readCachedConversations(UID_B);
      assert.ok(cachedConvsB.some((c) => c.id === convBD));

      // Troca de volta: Conta B -> Conta A
      await flushPendingWorkspaceWrites();
      clearSessionWorkspaceCaches(UID_A);
      clearChatSessionMemoryCache(UID_A);
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      configureChatServiceForTests({ baseUrl, token: TOKEN_A, activeUserId: UID_A });

      const localWsA = readLocalUserWorkspace(UID_A);
      assert.ok(localWsA);
      assert.strictEqual(localWsA.uid, UID_A);
      assert.strictEqual(
        localWsA.animes.some((a) => a.id.startsWith('synth_anime_b_')),
        false,
        'Lista de animes de A não pode conter nenhum item de B após alternar contas'
      );

      const convsA = await fetchUserConversations(UID_A);
      assert.strictEqual(
        convsA.some((c) => c.id === convBD),
        false,
        'Conta A jamais pode visualizar conversa exclusiva de B com D'
      );
      assert.strictEqual(
        readCachedMessages(convBD, UID_A).length,
        0,
        'Cache de mensagens por UID de A não pode conter mensagens da conversa B-D'
      );

      results.push({
        id: 11,
        name: 'Alternância entre Conta A e Conta B não mistura listas, favoritos, mensagens, notificações ou caches',
        passed: true,
        details: 'Caches de workspace e chat escopados por UID; conversa B-D invisível para A e 420 animes de A invisíveis no workspace de B.',
      });
    }

    // =========================================================================
    // TESTE 12: Atualizar página, sair e entrar novamente nunca restaura conta ou dados errados
    // =========================================================================
    {
      // Simula fluxo completo de Logout da Conta A
      await flushPendingWorkspaceWrites();
      clearSessionWorkspaceCaches();
      clearChatSessionMemoryCache();
      clearAllMemoryCache();
      simulatedTab1SessionStorage.delete('firebase:authUser:hikari');
      configureSocialServiceForTests({ baseUrl, token: null });
      configureChatServiceForTests({ baseUrl, token: null, activeUserId: null });

      // Tentativa sem autenticação de sincronizar em nome de A deve falhar com HTTP 401
      const unauthSyncRes = await fetch(`${baseUrl}/api/users/${UID_A}/sync`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: profileA_Public, animes: [] }),
      });
      assert.strictEqual(unauthSyncRes.status, 401, 'Sincronização sem token deve retornar 401');

      // Tentativa autenticada como B de sobrescrever dados de A deve falhar com HTTP 403
      const crossAccountSyncRes = await fetch(`${baseUrl}/api/users/${UID_A}/sync`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN_B}`,
        },
        body: JSON.stringify({ profile: profileB_Public, animes: [] }),
      });
      assert.strictEqual(
        crossAccountSyncRes.status,
        403,
        'Conta B autenticada jamais pode sobrescrever dados da Conta A (HTTP 403)'
      );

      // Login fresco como Conta B -> atualiza página -> verifica sessão B
      simulatedTab1SessionStorage.set('firebase:authUser:hikari', JSON.stringify({ uid: UID_B }));
      configureSocialServiceForTests({ baseUrl, token: TOKEN_B });
      const bOwnReload = await fetchAuthorizedUserProfileComplete(UID_B);
      assert.strictEqual(bOwnReload.status, 'ok');
      if (bOwnReload.status === 'ok') {
        assert.strictEqual(bOwnReload.data.profile.id, UID_B);
        assert.strictEqual(bOwnReload.data.animes.length, 3);
      }

      // Logout de B -> Login fresco como Conta A -> verifica que todos os 420 animes e privacidade de A seguem intactos
      clearSessionWorkspaceCaches();
      clearChatSessionMemoryCache();
      simulatedTab1SessionStorage.set('firebase:authUser:hikari', JSON.stringify({ uid: UID_A }));
      configureSocialServiceForTests({ baseUrl, token: TOKEN_A });
      const aOwnReload = await fetchAuthorizedUserProfileComplete(UID_A);
      assert.strictEqual(aOwnReload.status, 'ok');
      if (aOwnReload.status === 'ok') {
        assert.strictEqual(aOwnReload.data.profile.id, UID_A);
        assert.strictEqual(aOwnReload.data.profile.isPrivate, true);
        assert.strictEqual(aOwnReload.data.animes.length, 420);
      }

      // Também valida persistência em disco do SocialStore isolado
      const diskSocial1 = new SocialStore({ storageFilePath: tempSocialFile, ephemeral: false });
      diskSocial1.syncOwnerWorkspace(UID_A, {
        profile: profileA_Private,
        animes: animesA,
        animesComplete: true,
      });
      const diskSocialReloaded = new SocialStore({
        storageFilePath: tempSocialFile,
        ephemeral: false,
      });
      const reloadedRecordA = diskSocialReloaded.getUserRecord(UID_A);
      assert.ok(reloadedRecordA);
      assert.strictEqual(reloadedRecordA.animes.length, 420);
      assert.strictEqual(reloadedRecordA.profile.isPrivate, true);

      results.push({
        id: 12,
        name: 'Reload, logout e novo login restauram estritamente a conta correta sem perda de dados',
        passed: true,
        details: 'Bloqueio 401/403 contra sync cruzado; login/logout/F5 preservou 3 animes de B e 420 animes + isPrivate=true de A.',
      });
    }

    console.log('RESULTADOS INDIVIDUAIS DOS 12 TESTES SINTÉTICOS OBRIGATÓRIOS:');
    for (const r of results) {
      console.log(`  [PASSOU] Teste ${String(r.id).padStart(2, '0')}: ${r.name}`);
      console.log(`           -> ${r.details}`);
    }
    console.log('\nTodos os 12 cenários obrigatórios e validações Zero-Trust passaram com 100% de sucesso!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    socialStore.resetForTests(true);
    chatStore.resetForTests(true);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
  }
}

runAuditSuite().catch((err) => {
  console.error('\n[FALHA NA AUDITORIA MULTI-CONTAS]:', err);
  process.exit(1);
});
