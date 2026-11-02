import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AnimeItem, UserActivity, UserProfile, PrivateConversation } from '../../types';
import {
  computeAnimeStats,
  updateSingleAnimeById,
  getAnimeStatsComputeMetrics,
  resetAnimeStatsComputeMetrics,
} from '../../utils/animeStats';
import {
  resolveActivityAnimeMatch,
  resolveActivityPoster,
  resolveActivityAnimeTitle,
  getActivityPosterMetrics,
  resetActivityPosterMetrics,
  invalidateProfileAnimeCatalogIndex,
} from '../../utils/activityPoster';
import {
  subscribeToSharedClock,
  getSharedClockDiagnostics,
  formatRelativeTime,
} from '../../utils/relativeTime';
import {
  runGuardedExternalSync,
  checkExternalSyncEligibility,
  clearExternalSyncCooldown,
  SYNC_COOLDOWN_STORAGE_KEY,
} from '../../utils/syncCooldown';
import {
  createEmptyUserWorkspace,
  readLocalUserWorkspace,
  writeLocalUserWorkspace,
  syncPublicProfileProjection,
  readPublicProfilesMap,
  adjustCachedPublicProfileFollowersCount,
  flushPendingWorkspaceStorageWrites,
  getWorkspaceStorageMetrics,
  resetWorkspaceStorageMetrics,
} from '../../lib/userWorkspaceStorage';
import {
  subscribeToUnreadMessagesCount,
  subscribeToConversationsList,
  subscribeToConversation,
  writeCachedConversations,
  syncUserPrivacyContext,
  sendPresenceHeartbeat,
  getChatServiceDiagnostics,
  resetChatServiceMetrics,
} from '../../services/chatService';
import {
  computeAnimeStatusCounts,
  getNormalizedAnimeSearchText,
} from '../../components/tabs/AnimeListTab';

// ============================================================================
// Lightweight Browser Environment Harness for Node Verification
// ============================================================================

class MemoryLocalStorage implements Storage {
  private store = new Map<string, string>();
  public setItemCalls = 0;
  public getItemCalls = 0;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    this.getItemCalls++;
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.setItemCalls++;
    this.store.set(key, String(value));
  }
}

class SimpleEventTarget {
  private listeners = new Map<string, Set<(event?: any) => void>>();

  addEventListener(type: string, listener: (event?: any) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event?: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of Array.from(set)) {
        fn(event);
      }
    }
    return true;
  }
}

const mockStorage = new MemoryLocalStorage();
const mockWindowTarget = new SimpleEventTarget();
const mockDocTarget = new SimpleEventTarget();
let mockVisibilityState: 'visible' | 'hidden' = 'visible';

function installBrowserMocks() {
  const g = globalThis as any;

  g.window = {
    localStorage: mockStorage,
    location: { origin: 'http://localhost:3000', pathname: '/' },
    addEventListener: mockWindowTarget.addEventListener.bind(mockWindowTarget),
    removeEventListener: mockWindowTarget.removeEventListener.bind(mockWindowTarget),
    dispatchEvent: mockWindowTarget.dispatchEvent.bind(mockWindowTarget),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };

  g.document = {
    get visibilityState() {
      return mockVisibilityState;
    },
    get hidden() {
      return mockVisibilityState === 'hidden';
    },
    addEventListener: mockDocTarget.addEventListener.bind(mockDocTarget),
    removeEventListener: mockDocTarget.removeEventListener.bind(mockDocTarget),
    dispatchEvent: mockDocTarget.dispatchEvent.bind(mockDocTarget),
  };
}

function setDocumentVisibility(state: 'visible' | 'hidden') {
  mockVisibilityState = state;
  mockDocTarget.dispatchEvent({ type: 'visibilitychange' });
}

function buildLargeAnimeCatalog(count: number): AnimeItem[] {
  const statuses: AnimeItem['status'][] = [
    'watching',
    'completed',
    'planned',
    'on_hold',
    'dropped',
  ];
  const list: AnimeItem[] = [];
  for (let i = 0; i < count; i++) {
    const status = statuses[i % statuses.length];
    const totalEpisodes = 12 + (i % 24);
    const currentEpisode =
      status === 'completed' ? totalEpisodes : status === 'planned' ? 0 : (i % totalEpisodes) + 1;
    list.push({
      id: `anime_perf_${i}`,
      title: `Crônicas Estelares Volume ${i}`,
      titleRomaji: `Hoshi no Chronicles Part ${i}`,
      posterUrl: `https://cdn.hikari.test/posters/anime_${i}.jpg`,
      status,
      currentEpisode,
      totalEpisodes,
      rating: (i % 10) + 1,
      year: 2015 + (i % 11),
      genres: ['Fantasia', i % 2 === 0 ? 'Aventura' : 'Sci-Fi'],
      isFavorite: i % 20 === 0,
      episodeDurationMinutes: 24,
    });
  }
  return list;
}

function buildSampleProfile(uid: string): UserProfile {
  return {
    id: uid,
    username: `user_${uid}`,
    displayName: `Usuário ${uid}`,
    avatarUrl: 'https://cdn.hikari.test/avatars/u1.jpg',
    bannerUrl: '',
    bio: 'Perfil de teste Etapa 2',
    createdAt: '01 de janeiro de 2026',
    createdAtTimestamp: 1767225600000,
    followersCount: 12,
    followingCount: 8,
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
}

async function runTests() {
  installBrowserMocks();
  console.log('=== HIKARI PERFIL — TESTES DA ETAPA 2 (REDUÇÃO DE TRABALHO REDUNDANTE) ===\n');

  // --------------------------------------------------------------------------
  // 1. Edição pontual de anime sem clonar toda a lista + memoização de stats
  // --------------------------------------------------------------------------
  {
    resetAnimeStatsComputeMetrics();
    const catalog2000 = buildLargeAnimeCatalog(2000);

    // No-op não deve clonar nem criar novo array
    const noOpResult = updateSingleAnimeById(catalog2000, 'anime_perf_500', (curr) => curr);
    assert.equal(noOpResult, null, 'Edição sem mudança real deve retornar null');

    // Atualização de 1 registro em 2.000 animes preserva 1.999 referências intactas
    const editResult = updateSingleAnimeById(catalog2000, 'anime_perf_500', (curr) => ({
      ...curr,
      currentEpisode: curr.currentEpisode + 1,
      rating: 10,
    }));
    assert.ok(editResult !== null, 'Edição válida deve retornar novo array raso');
    assert.notEqual(editResult.nextAnimes, catalog2000);
    assert.notEqual(editResult.nextAnimes[500], catalog2000[500]);

    let preservedReferences = 0;
    for (let i = 0; i < catalog2000.length; i++) {
      if (i !== 500 && editResult.nextAnimes[i] === catalog2000[i]) {
        preservedReferences++;
      }
    }
    assert.equal(
      preservedReferences,
      1999,
      'Todos os outros 1.999 objetos de anime devem preservar sua referência exata'
    );

    // computeAnimeStats: 50 chamadas seguidas na mesma referência calculam apenas 1 vez
    let firstStats = computeAnimeStats(catalog2000);
    for (let i = 0; i < 49; i++) {
      const repeated = computeAnimeStats(catalog2000);
      assert.equal(repeated, firstStats, 'WeakMap deve reutilizar a mesma instância de resumo');
    }
    const statsMetricsBeforeEdit = getAnimeStatsComputeMetrics();
    assert.equal(statsMetricsBeforeEdit.executions, 1);
    assert.equal(statsMetricsBeforeEdit.cacheHits, 49);

    // Ao editar 1 anime, o novo array invalida automaticamente e recalcula apenas 1 vez
    const updatedStats = computeAnimeStats(editResult.nextAnimes);
    assert.equal(getAnimeStatsComputeMetrics().executions, 2);
    assert.equal(
      updatedStats.totalEpisodesWatched,
      firstStats.totalEpisodesWatched + 1,
      'Estatística de episódios deve refletir imediatamente o +1 episódio editado'
    );

    console.log(
      '✓ [1/8] Edição pontual O(1) por índice (1.999/2.000 referências preservadas) e computeAnimeStats memoizado (1 execução / 49 cache hits).'
    );
  }

  // --------------------------------------------------------------------------
  // 2. Eliminação de JSON.parse repetido + debounce de JSON.stringify + flush seguro
  // --------------------------------------------------------------------------
  {
    mockStorage.clear();
    mockWindowTarget.dispatchEvent({ type: 'storage', key: null });
    resetWorkspaceStorageMetrics();

    const uidA = 'usr_stage2_alpha';
    const uidB = 'usr_stage2_beta';
    const profileA = buildSampleProfile(uidA);
    let currentAnimesA = buildLargeAnimeCatalog(1200);
    let workspaceA = {
      ...createEmptyUserWorkspace(uidA),
      animes: currentAnimesA,
      updatedAtMs: Date.now(),
    };

    // Simula 10 edições rápidas consecutivas de episódios + leitura de workspace e projeção pública
    for (let step = 1; step <= 10; step++) {
      const mod = updateSingleAnimeById(currentAnimesA, 'anime_perf_1', (curr) => ({
        ...curr,
        currentEpisode: step,
      }));
      if (mod) {
        currentAnimesA = mod.nextAnimes;
      }
      workspaceA = writeLocalUserWorkspace(uidA, {
        ...workspaceA,
        animes: currentAnimesA,
        updatedAtMs: Date.now() + step,
      });
      syncPublicProfileProjection(profileA, currentAnimesA, workspaceA.updatedAtMs);

      // Leituras repetidas na sessão devem usar o cache write-through sem JSON.parse
      const readBack = readLocalUserWorkspace(uidA);
      assert.equal(readBack?.animes[1].currentEpisode, step);
      const projections = readPublicProfilesMap();
      assert.equal(projections[uidA]?.profile.id, uidA);
    }

    const metricsBeforeFlush = getWorkspaceStorageMetrics();
    assert.equal(
      metricsBeforeFlush.jsonParseCalls,
      0,
      'Cache write-through deve eliminar 100% dos JSON.parse repetidos durante edições na sessão'
    );
    assert.equal(
      metricsBeforeFlush.jsonStringifyCalls,
      0,
      'Gravações rápidas em sequência não devem bloquear a thread principal com JSON.stringify síncrono a cada clique'
    );

    // Simula ocultação da aba / encerramento de página -> flush síncrono imediato sem perda de dados
    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');
    flushPendingWorkspaceStorageWrites();

    const metricsAfterFlush = getWorkspaceStorageMetrics();
    assert.equal(
      metricsAfterFlush.jsonStringifyCalls,
      2,
      '10 edições rápidas devem ser agrupadas em apenas 1 gravação do workspace + 1 da projeção pública'
    );

    // Isolamento estrito entre contas
    const workspaceB = readLocalUserWorkspace(uidB);
    assert.equal(workspaceB, null, 'Conta B não deve herdar dados do cache da Conta A');

    // Ajuste de seguidores no cache público sem JSON.parse extra
    adjustCachedPublicProfileFollowersCount(uidA, 1);
    const updatedProj = readPublicProfilesMap()[uidA];
    assert.equal(updatedProj.profile.followersCount, 13);
    flushPendingWorkspaceStorageWrites();

    console.log(
      '✓ [2/8] Armazenamento otimizado: 0 JSON.parse redundantes em 10 edições seguidas e agrupamento (debounce + flush) reduzindo 20 JSON.stringify síncronos para 2.'
    );
  }

  // --------------------------------------------------------------------------
  // 3. Índice normalizado O(1) de atividades e posters + invalidação automática
  // --------------------------------------------------------------------------
  {
    resetActivityPosterMetrics();
    invalidateProfileAnimeCatalogIndex();

    const profileId = 'usr_activity_perf';
    const userAnimes = buildLargeAnimeCatalog(2000);
    const activities: UserActivity[] = [];

    for (let i = 0; i < 200; i++) {
      const targetIdx = (i * 7) % 2000;
      const targetAnime = userAnimes[targetIdx];
      if (i % 4 === 0) {
        activities.push({
          id: `act_${1700000000000 + i}_${targetAnime.id}`,
          type: 'watched_ep',
          title: `Assistiu até o episódio 5 de ${targetAnime.title}`,
          description: 'Progresso: 5/12 episódios',
          timestamp: 'Há 2 horas',
        });
      } else if (i % 4 === 1) {
        activities.push({
          id: `act_custom_${i}`,
          type: 'completed_anime',
          title: `Marcou ${targetAnime.title} como concluído`,
          description: '12/12 episódios',
          timestamp: 'Ontem',
        });
      } else if (i % 4 === 2) {
        activities.push({
          id: `act_romaji_${i}`,
          type: 'rated',
          title: `Avaliou ${targetAnime.titleRomaji} com nota 9`,
          description: 'Avaliação atualizada (9/10)',
          timestamp: 'Há 3 dias',
        });
      } else {
        activities.push({
          id: `act_explicit_${i}`,
          type: 'added_favorite',
          title: `Adicionou ${targetAnime.title} aos favoritos`,
          description: 'Fantasia · Aventura',
          animeId: targetAnime.id,
          timestamp: 'Agora',
        });
      }
    }

    // 1ª renderização de 200 atividades + 2ª re-renderização idêntica
    for (let renderPass = 0; renderPass < 2; renderPass++) {
      for (const act of activities) {
        const match = resolveActivityAnimeMatch(act, userAnimes, profileId);
        assert.ok(match.posterUrl && match.posterUrl.startsWith('https://cdn.hikari.test/posters/'));
        assert.ok(match.animeTitle && match.animeTitle.length > 0);
      }
    }

    const posterMetrics = getActivityPosterMetrics();
    assert.equal(
      posterMetrics.indexBuildCount,
      1,
      'Índice normalizado deve ser construído apenas 1 única vez para 400 consultas em 2 renderizações'
    );

    // Ao adicionar/atualizar anime na lista do perfil, o índice invalida e resolve o novo anime imediatamente
    const importedAnime: AnimeItem = {
      id: 'mal_999999',
      title: ' Kusuriya no Hitorigoto Season 2 ',
      titleRomaji: 'The Apothecary Diaries 2',
      posterUrl: 'https://cdn.hikari.test/posters/kusuriya_s2.jpg',
      status: 'watching',
      currentEpisode: 3,
      totalEpisodes: 24,
      rating: 9,
      year: 2025,
      genres: ['Mistério', 'Drama'],
      isFavorite: true,
    };
    const nextAnimes = [importedAnime, ...userAnimes];
    const newAct: UserActivity = {
      id: 'act_new_import',
      type: 'watched_ep',
      title: 'Assistiu até o episódio 3 de Kusuriya no Hitorigoto Season 2',
      description: 'Progresso: 3/24 episódios',
      timestamp: 'Agora',
    };

    assert.equal(
      resolveActivityPoster(newAct, nextAnimes, profileId),
      'https://cdn.hikari.test/posters/kusuriya_s2.jpg'
    );
    assert.equal(
      resolveActivityAnimeTitle(newAct, nextAnimes, profileId),
      ' Kusuriya no Hitorigoto Season 2 '
    );
    assert.equal(
      getActivityPosterMetrics().indexBuildCount,
      2,
      'Mudança na lista de animes deve reconstruir o índice exatamente 1 vez'
    );

    console.log(
      '✓ [3/8] Índice O(1) de atividades/posters validado (1 normalização do catálogo para 400 consultas; invalidação automática ao mudar animes).'
    );
  }

  // --------------------------------------------------------------------------
  // 4. Redução de polling e assinaturas duplicadas do chat + pausa em segundo plano
  // --------------------------------------------------------------------------
  {
    resetChatServiceMetrics();
    mockStorage.removeItem('hikari_chat_conversations_cache_v1');
    mockWindowTarget.dispatchEvent({
      type: 'storage',
      key: 'hikari_chat_conversations_cache_v1',
    });

    let heartbeatFetches = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/chat/presence/heartbeat')) {
        heartbeatFetches++;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/chat/sync-user-context')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/chat/conversations') && url.includes('/messages')) {
        return new Response(JSON.stringify({ messages: [], typingUsers: [] }), { status: 200 });
      }
      if (url.includes('/api/chat/conversations')) {
        const seeded: PrivateConversation[] = [
          {
            id: 'conv_u1_u2',
            participants: ['usr_chat_1', 'usr_chat_2'],
            participantDetails: {},
            unreadCounts: { usr_chat_1: 3, usr_chat_2: 0 },
            updatedAt: Date.now(),
            createdAt: Date.now(),
          },
        ];
        return new Response(JSON.stringify({ conversations: seeded }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      setDocumentVisibility('visible');

      // 4a. Deduplicação de syncUserPrivacyContext: 10 chamadas idênticas -> 1 requisição de rede
      const privacyPayload = {
        id: 'usr_chat_1',
        username: 'hikari_u1',
        displayName: 'Hikari U1',
        avatarUrl: '',
        allowDirectMessages: true,
        directMessagesFrom: 'everyone' as const,
        showOnlineStatus: true,
        followingIds: ['usr_chat_2'],
        followerIds: ['usr_chat_2'],
        blockedIds: [],
      };
      for (let i = 0; i < 10; i++) {
        await syncUserPrivacyContext(privacyPayload);
      }
      assert.equal(
        getChatServiceDiagnostics().syncPrivacyContextNetworkCalls,
        1,
        'syncUserPrivacyContext não deve repetir POST quando os dados de privacidade não mudaram'
      );

      // 4b. Chat fechado: assinatura passiva de não lidas cria ZERO intervalos de polling
      let observedUnread = 0;
      const unsubUnread = subscribeToUnreadMessagesCount('usr_chat_1', (count) => {
        observedUnread = count;
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(observedUnread, 3, 'Contador inicial de não lidas deve ser carregado sem polling');

      const closedDiag = getChatServiceDiagnostics();
      assert.equal(
        closedDiag.activeListPollTimers,
        0,
        'Nenhum timer de polling da lista deve existir com o chat fechado'
      );
      assert.equal(
        closedDiag.activeConversationPollTimers,
        0,
        'Nenhum timer de polling de conversa deve existir com o chat fechado'
      );

      // Atualização passiva instantânea ao ler conversa no cache
      writeCachedConversations([
        {
          id: 'conv_u1_u2',
          participants: ['usr_chat_1', 'usr_chat_2'],
          participantDetails: {},
          unreadCounts: { usr_chat_1: 0, usr_chat_2: 0 },
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
      ]);
      assert.equal(observedUnread, 0, 'Contador passivo deve atualizar imediatamente para 0');

      // 4c. Chat aberto: múltiplas assinaturas para a mesma conversa compartilham 1 único canal
      const unsubList1 = subscribeToConversationsList('usr_chat_1', () => {});
      const unsubList2 = subscribeToConversationsList('usr_chat_1', () => {});
      const unsubConv1 = subscribeToConversation('conv_u1_u2', 'usr_chat_1', () => {});
      const unsubConv2 = subscribeToConversation('conv_u1_u2', 'usr_chat_1', () => {});

      const openDiag = getChatServiceDiagnostics();
      assert.equal(openDiag.activeListPollTimers, 1, 'Deve haver no máximo 1 poller de lista por usuário');
      assert.equal(
        openDiag.activeConversationPollTimers,
        1,
        'Duas assinaturas na mesma conversa devem compartilhar 1 único timer'
      );

      // 4d. Aba em segundo plano: todos os timers de polling e batimentos pausam imediatamente
      setDocumentVisibility('hidden');
      const hiddenDiag = getChatServiceDiagnostics();
      assert.equal(hiddenDiag.activeListPollTimers, 0, 'Polling de lista deve pausar em segundo plano');
      assert.equal(
        hiddenDiag.activeConversationPollTimers,
        0,
        'Polling de conversa deve pausar em segundo plano'
      );

      const heartbeatsBeforeHiddenCall = heartbeatFetches;
      await sendPresenceHeartbeat('usr_chat_1', true);
      assert.equal(
        heartbeatFetches,
        heartbeatsBeforeHiddenCall,
        'sendPresenceHeartbeat não deve disparar rede com aba oculta'
      );

      // 4e. Retorno ao primeiro plano: retoma apenas os canais abertos
      setDocumentVisibility('visible');
      const resumedDiag = getChatServiceDiagnostics();
      assert.equal(resumedDiag.activeListPollTimers, 1);
      assert.equal(resumedDiag.activeConversationPollTimers, 1);

      // 4f. Fechamento do modal de chat: limpa 100% dos timers ativos
      unsubList1();
      unsubList2();
      unsubConv1();
      unsubConv2();
      const afterCloseDiag = getChatServiceDiagnostics();
      assert.equal(afterCloseDiag.activeListPollTimers, 0);
      assert.equal(afterCloseDiag.activeConversationPollTimers, 0);

      unsubUnread();
      assert.equal(getChatServiceDiagnostics().passiveUnreadSubscribers, 0);
    } finally {
      (globalThis as any).fetch = originalFetch;
      setDocumentVisibility('visible');
    }

    console.log(
      '✓ [4/8] Chat otimizado: 0 timers com chat fechado, deduplicação de canais abertos, pausa total em aba oculta e limpeza completa ao desmontar.'
    );
  }

  // --------------------------------------------------------------------------
  // 5. Cooldown persistente, permissão manual, lock concorrente e erro 429 (MAL/AniList)
  // --------------------------------------------------------------------------
  {
    clearExternalSyncCooldown();
    const scopeA = {
      profileId: 'usr_sync_1',
      provider: 'anilist' as const,
      accountIdentifier: 'HikariFan',
      cooldownMs: 30 * 60 * 1000,
    };
    const scopeDifferentUser = {
      profileId: 'usr_sync_2',
      provider: 'anilist' as const,
      accountIdentifier: 'HikariFan',
      cooldownMs: 30 * 60 * 1000,
    };
    const scopeMAL = {
      profileId: 'usr_sync_1',
      provider: 'mal' as const,
      accountIdentifier: 'HikariFanMAL',
      cooldownMs: 30 * 60 * 1000,
    };

    // 5a. 1ª sincronização automática permitida e persistida em localStorage
    const auto1 = await runGuardedExternalSync(scopeA, 'auto', async () => ['anime_1', 'anime_2']);
    assert.equal(auto1.executed, true);
    assert.ok(mockStorage.getItem(SYNC_COOLDOWN_STORAGE_KEY), 'Cooldown deve persistir em localStorage');

    // Simula reload do navegador invalidando cache em memória via evento storage
    mockWindowTarget.dispatchEvent({ type: 'storage', key: SYNC_COOLDOWN_STORAGE_KEY });

    // 5b. 2ª sincronização automática dentro da janela de 30 min é bloqueada após reload
    const auto2 = await runGuardedExternalSync(scopeA, 'auto', async () => ['should_not_run']);
    assert.equal(auto2.executed, false);
    if (!auto2.executed) {
      assert.equal(auto2.reason, 'cooldown');
      assert.ok(auto2.remainingMs > 0);
    }

    // 5c. Sincronização MANUAL explícita pelo usuário NUNCA é bloqueada pelo cooldown
    const manual1 = await runGuardedExternalSync(scopeA, 'manual', async () => ['manual_ok']);
    assert.equal(manual1.executed, true, 'Sincronização manual solicitada pelo usuário deve funcionar sempre');

    // 5d. Isolamento por UID e por provedor (MAL vs AniList)
    assert.equal(checkExternalSyncEligibility(scopeDifferentUser, 'auto').allowed, true);
    assert.equal(checkExternalSyncEligibility(scopeMAL, 'auto').allowed, true);

    // 5e. Bloqueio de chamadas simultâneas duplicadas (in_flight)
    let resolveSlowSync!: (val: number) => void;
    const slowPromise = runGuardedExternalSync(
      scopeMAL,
      'manual',
      () =>
        new Promise<number>((resolve) => {
          resolveSlowSync = resolve;
        })
    );

    const duplicateCall = await runGuardedExternalSync(scopeMAL, 'manual', async () => 999);
    assert.equal(duplicateCall.executed, false);
    if (!duplicateCall.executed) {
      assert.equal(duplicateCall.reason, 'in_flight');
    }
    resolveSlowSync(42);
    const slowOutcome = await slowPromise;
    assert.equal(slowOutcome.executed, true);

    // 5f. Tratamento de erro / limite 429: libera lock imediatamente sem bloquear nova tentativa
    const scopeRetry = {
      profileId: 'usr_sync_retry',
      provider: 'mal' as const,
      accountIdentifier: 'RateLimitedUser',
    };
    await assert.rejects(
      () =>
        runGuardedExternalSync(scopeRetry, 'auto', async () => {
          throw new Error('HTTP 429 Too Many Requests');
        }),
      /429/
    );
    assert.equal(
      checkExternalSyncEligibility(scopeRetry, 'auto').allowed,
      true,
      'Falha ou erro 429 não deve gravar falso cooldown nem manter lock travado'
    );

    console.log(
      '✓ [5/8] Cooldown e concorrência MAL/AniList validados (bloqueio de auto-sync no reload, manual sempre livre, in-flight lock e recuperação pós-429).'
    );
  }

  // --------------------------------------------------------------------------
  // 6. Relógio compartilhado único, pausa em aba oculta e zero timer no Header
  // --------------------------------------------------------------------------
  {
    setDocumentVisibility('visible');
    assert.equal(getSharedClockDiagnostics().activeTimersCount, 0);

    // 30 componentes inscritos compartilham exatamente 1 único timer global
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 30; i++) {
      unsubs.push(subscribeToSharedClock(() => {}, 15000));
    }

    const activeDiag = getSharedClockDiagnostics();
    assert.equal(
      activeDiag.activeTimersCount,
      1,
      '30 componentes de tempo relativo devem compartilhar exatamente 1 único setInterval'
    );
    assert.equal(activeDiag.totalSubscribersCount, 30);

    // Aba em segundo plano pausa o timer único
    setDocumentVisibility('hidden');
    assert.equal(
      getSharedClockDiagnostics().activeTimersCount,
      0,
      'Relógio compartilhado deve pausar quando document.visibilityState === hidden'
    );

    // Aba visível retoma o timer único
    setDocumentVisibility('visible');
    assert.equal(getSharedClockDiagnostics().activeTimersCount, 1);

    // Desmontagem limpa 100% dos recursos
    for (const u of unsubs) u();
    const emptyDiag = getSharedClockDiagnostics();
    assert.equal(emptyDiag.activeTimersCount, 0);
    assert.equal(emptyDiag.totalSubscribersCount, 0);

    // Formatação preservada em português
    const baseNow = 1_800_000_000_000;
    assert.equal(formatRelativeTime(baseNow - 10_000, baseNow), 'Agora');
    assert.equal(formatRelativeTime(baseNow - 5 * 60_000, baseNow), 'Há 5 minutos');
    assert.equal(formatRelativeTime(baseNow - 3 * 86_400_000, baseNow), 'Há 3 dias');

    const headerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/Header.tsx'),
      'utf8'
    );
    assert.ok(
      !headerSource.includes('useCurrentTime') && !headerSource.includes('useRelativeTimeLabel'),
      'Header.tsx nunca deve assinar timers de relógio'
    );

    console.log(
      '✓ [6/8] Relógio centralizado único validado (30 inscritos -> 1 timer visível -> 0 timers em segundo plano -> 0 timers ao desmontar; Header isolado).'
    );
  }

  // --------------------------------------------------------------------------
  // 7. Contagem em passagem única O(N), busca pré-indexada e zero layout thrashing
  // --------------------------------------------------------------------------
  {
    const list2000 = buildLargeAnimeCatalog(2000);
    const counts = computeAnimeStatusCounts(list2000);

    assert.equal(counts.all, 2000);
    assert.equal(counts.watching, 400);
    assert.equal(counts.completed, 400);
    assert.equal(counts.planned, 400);
    assert.equal(counts.on_hold, 400);
    assert.equal(counts.dropped, 400);

    const sampleAnime = list2000[0];
    const searchNorm1 = getNormalizedAnimeSearchText(sampleAnime);
    const searchNorm2 = getNormalizedAnimeSearchText(sampleAnime);
    assert.equal(searchNorm1, searchNorm2);
    assert.ok(searchNorm1.includes('crônicas estelares volume 0'));
    assert.ok(searchNorm1.includes('hoshi no chronicles part 0'));

    const animeListTabSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/tabs/AnimeListTab.tsx'),
      'utf8'
    );
    assert.ok(
      !animeListTabSource.includes('animes.filter((a) => a.status === cat.id)'),
      'AnimeListTab não deve filtrar o array 5 vezes dentro do .map() das abas de status'
    );
    const visibleMemoStart = animeListTabSource.indexOf('const { visibleAnimes, topPadding, bottomPadding } = useMemo(');
    const visibleMemoEnd = animeListTabSource.indexOf('}, [filteredAnimes, totalItems', visibleMemoStart);
    assert.ok(visibleMemoStart !== -1 && visibleMemoEnd !== -1);
    const visibleMemoBlock = animeListTabSource.slice(visibleMemoStart, visibleMemoEnd);
    assert.ok(
      !visibleMemoBlock.includes('getBoundingClientRect('),
      'visibleAnimes useMemo não deve executar getBoundingClientRect() síncrono durante renderização'
    );

    console.log(
      '✓ [7/8] Filtros O(N) em passagem única, busca pré-indexada WeakMap e eliminação de getBoundingClientRect() validados.'
    );
  }

  // --------------------------------------------------------------------------
  // 8. Preservação integral da Etapa 1, Firestore batching e regras de segurança
  // --------------------------------------------------------------------------
  {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    assert.ok(
      appSource.includes('subscribeToUnreadMessagesCount'),
      'App.tsx deve usar subscribeToUnreadMessagesCount passivo enquanto o chat está fechado'
    );
    assert.ok(
      !appSource.includes('subscribeToConversationsList'),
      'App.tsx não deve iniciar polling global de conversas'
    );
    assert.ok(
      appSource.includes('updateSingleAnimeById'),
      'App.tsx deve usar updateSingleAnimeById nas edições de anime'
    );
    assert.ok(
      appSource.includes("useState<ProfileTab>('overview')"),
      'Aba inicial Visão Geral da Etapa 1 deve permanecer intacta'
    );

    const workspaceSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/userWorkspaceStorage.ts'),
      'utf8'
    );
    assert.ok(
      workspaceSource.includes('writeBatch(db)'),
      'userWorkspaceStorage.ts deve agrupar gravações remotas usando writeBatch(db)'
    );
    assert.ok(
      workspaceSource.includes('Promise.all(['),
      'loadUserWorkspaceFromFirestore deve buscar perfil e workspace em paralelo'
    );

    console.log(
      '✓ [8/8] Integração com App.tsx, agrupamento writeBatch(db) no Firestore e preservação da Etapa 1 verificados.'
    );
  }

  console.log('\n✅ TODOS OS 8 GRUPOS DE TESTES DA ETAPA 2 PASSARAM COM SUCESSO!');
}

runTests().catch((err) => {
  console.error('\n❌ FALHA NOS TESTES DA ETAPA 2:', err);
  process.exit(1);
});
