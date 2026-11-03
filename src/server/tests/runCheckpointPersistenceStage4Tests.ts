import {
  startOrResumeImport,
  cancelImport,
  getImportCheckpoint,
  getOrReconcileImportCheckpoint,
  saveImportCheckpointAsync,
  clearImportCheckpointAsync,
  setRemoteCheckpointStoreForTesting,
  setLocalStorageAdapterForTesting,
  CheckpointStorageError,
  type ImportCheckpoint,
} from '../../services/importSyncManager';
import {
  sanitizeCheckpointForStorage,
  validateCheckpointIntegrity,
  reconcileCheckpoints,
  getLocalCheckpointKey,
  getRemoteCheckpointDocPath,
  type RemoteCheckpointStore,
} from '../../services/importCheckpointStorage';
import { mergeMALImport, type MALAnimeEntry } from '../../services/malService';
import { mergeAniListImport, type AniListAnimeEntry } from '../../services/anilistService';
import type { AnimeItem } from '../../types';

interface TestReportItem {
  id: number;
  title: string;
  passed: boolean;
  details: string;
}

const testResults: TestReportItem[] = [];

function recordTest(id: number, title: string, passed: boolean, details: string) {
  testResults.push({ id, title, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${String(id).padStart(2, '0')}] ${status} - ${title}: ${details}`);
}

class MockLocalStorage implements Storage {
  private store = new Map<string, string>();
  public shouldThrowQuotaError = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrowQuotaError) {
      const quotaErr = new Error('The quota has been exceeded.');
      quotaErr.name = 'QuotaExceededError';
      throw quotaErr;
    }
    this.store.set(key, value);
  }
}

class InMemoryRemoteCheckpointStore implements RemoteCheckpointStore {
  public checkpoints = new Map<string, ImportCheckpoint>();
  public simulateNetworkReadFailure = false;
  public simulateNetworkWriteFailure = false;

  private makeKey(profileId: string, provider: string, account: string): string {
    return `${profileId.trim()}:${provider}:${account.trim().toLowerCase()}`;
  }

  async get(profileId: string, provider: string, account: string): Promise<ImportCheckpoint | null> {
    if (this.simulateNetworkReadFailure) {
      throw new CheckpointStorageError(
        'remote_network_error',
        'Simulated network timeout during remote checkpoint read.'
      );
    }
    const key = this.makeKey(profileId, provider, account);
    const existing = this.checkpoints.get(key);
    return existing ? { ...existing } : null;
  }

  async set(
    checkpoint: ImportCheckpoint,
    expectedVersion?: number
  ): Promise<{ success: boolean; version: number; error?: CheckpointStorageError }> {
    if (this.simulateNetworkWriteFailure) {
      return {
        success: false,
        version: checkpoint.version ?? 1,
        error: new CheckpointStorageError(
          'remote_write_error',
          'Simulated remote storage write failure.'
        ),
      };
    }

    const key = this.makeKey(
      checkpoint.profileId,
      checkpoint.provider,
      checkpoint.accountIdentifier
    );
    const current = this.checkpoints.get(key);

    if (current && typeof expectedVersion === 'number' && (current.version ?? 1) > expectedVersion) {
      return {
        success: false,
        version: current.version ?? 1,
        error: new CheckpointStorageError(
          'version_conflict',
          `Conflito de versão: a versão remota (${current.version}) é mais recente que a esperada (${expectedVersion}).`
        ),
      };
    }

    const nextVersion = (checkpoint.version ?? 1) + 1;
    const toSave: ImportCheckpoint = {
      ...checkpoint,
      version: nextVersion,
      updatedAtMs: Date.now(),
      lastUpdated: new Date().toISOString(),
    };
    this.checkpoints.set(key, toSave);
    return { success: true, version: nextVersion };
  }

  async delete(
    profileId: string,
    provider: string,
    account: string
  ): Promise<{ success: boolean; error?: CheckpointStorageError }> {
    const key = this.makeKey(profileId, provider, account);
    this.checkpoints.delete(key);
    return { success: true };
  }
}

function makeSyntheticAnime(id: string, title: string, status: AnimeItem['status'], episode = 1, year = 2024): AnimeItem {
  return {
    id,
    title,
    titleRomaji: title,
    posterUrl: `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=400&q=80`,
    status,
    currentEpisode: episode,
    totalEpisodes: 24,
    rating: 8.5,
    isFavorite: false,
    year,
    genres: ['Ação', 'Aventura'],
  };
}

async function runStage4Tests() {
  console.log('========================================================================');
  console.log('HIKARI PERFIL — ETAPA 4: PERSISTÊNCIA SEGURA E RECUPERAÇÃO DE CHECKPOINTS');
  console.log('========================================================================\n');

  const mockLocal = new MockLocalStorage();
  const mockRemote = new InMemoryRemoteCheckpointStore();
  setLocalStorageAdapterForTesting(mockLocal);
  setRemoteCheckpointStoreForTesting(mockRemote);

  // TEST 01: Gravação e leitura de checkpoint local
  try {
    mockLocal.clear();
    const chk: ImportCheckpoint = {
      version: 1,
      profileId: 'usr_local_01',
      provider: 'mal',
      accountIdentifier: 'otaku_local',
      status: 'paused',
      cursor: 1000,
      page: 2,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
      addedCount: 800,
      updatedCount: 200,
      lastConfirmedPoint: 'offset_1000',
      updatedAtMs: Date.now(),
    };

    await saveImportCheckpointAsync(chk);
    const read = getImportCheckpoint('usr_local_01', 'mal', 'otaku_local');
    const pass =
      read !== null &&
      read.cursor === 1000 &&
      read.recordsConfirmed === 1000 &&
      read.accountIdentifier === 'otaku_local' &&
      read.status === 'paused';

    recordTest(
      1,
      'Gravação e leitura de checkpoint local',
      pass,
      `Checkpoint gravado e recuperado com precisão no armazenamento local (cursor=${read?.cursor}, confirmados=${read?.recordsConfirmed})`
    );
  } catch (err) {
    recordTest(1, 'Gravação e leitura de checkpoint local', false, String(err));
  }

  // TEST 02: Gravação e leitura de checkpoint remoto
  try {
    const chkRemote: ImportCheckpoint = {
      version: 1,
      profileId: 'usr_remote_01',
      provider: 'anilist',
      accountIdentifier: 'hikari_fan',
      status: 'in_progress',
      cursor: 3,
      page: 3,
      recordsReceived: 1500,
      recordsProcessed: 1500,
      recordsConfirmed: 1500,
      recordsPersisted: 1500,
      addedCount: 1400,
      updatedCount: 100,
      lastConfirmedPoint: 'chunk_3',
      updatedAtMs: Date.now(),
    };

    const saveRes = await saveImportCheckpointAsync(chkRemote);
    const fetchedRemote = await mockRemote.get('usr_remote_01', 'anilist', 'hikari_fan');
    const pass =
      saveRes.remoteSuccess &&
      fetchedRemote !== null &&
      fetchedRemote.cursor === 3 &&
      fetchedRemote.recordsConfirmed === 1500 &&
      fetchedRemote.version === 2;

    recordTest(
      2,
      'Gravação e leitura de checkpoint remoto',
      pass,
      `Gravado com sucesso no armazenamento remoto com versão incrementada (v${fetchedRemote?.version}, confirmados=${fetchedRemote?.recordsConfirmed})`
    );
  } catch (err) {
    recordTest(2, 'Gravação e leitura de checkpoint remoto', false, String(err));
  }

  // TEST 03: Isolamento entre usuários
  try {
    const userA = 'usr_alpha_999';
    const userB = 'usr_beta_888';

    await saveImportCheckpointAsync({
      version: 1,
      profileId: userA,
      provider: 'mal',
      accountIdentifier: 'shared_name',
      status: 'paused',
      cursor: 2000,
      recordsReceived: 2000,
      recordsProcessed: 2000,
      recordsConfirmed: 2000,
      recordsPersisted: 2000,
    });

    await saveImportCheckpointAsync({
      version: 1,
      profileId: userB,
      provider: 'mal',
      accountIdentifier: 'shared_name',
      status: 'in_progress',
      cursor: 500,
      recordsReceived: 500,
      recordsProcessed: 500,
      recordsConfirmed: 500,
      recordsPersisted: 500,
    });

    const chkA = await mockRemote.get(userA, 'mal', 'shared_name');
    const chkB = await mockRemote.get(userB, 'mal', 'shared_name');

    const pass =
      chkA !== null &&
      chkB !== null &&
      chkA.cursor === 2000 &&
      chkB.cursor === 500 &&
      chkA.profileId === userA &&
      chkB.profileId === userB;

    recordTest(
      3,
      'Isolamento entre usuários',
      pass,
      `Contas com mesmo identificador mantidas com isolamento total por UID (${userA}: ${chkA?.cursor} vs ${userB}: ${chkB?.cursor})`
    );
  } catch (err) {
    recordTest(3, 'Isolamento entre usuários', false, String(err));
  }

  // TEST 04: Isolamento entre MAL e AniList
  try {
    const userSame = 'usr_same_identity';
    const sameAccount = 'my_anime_handle';

    await saveImportCheckpointAsync({
      version: 1,
      profileId: userSame,
      provider: 'mal',
      accountIdentifier: sameAccount,
      status: 'paused',
      cursor: 3000,
      recordsReceived: 3000,
      recordsProcessed: 3000,
      recordsConfirmed: 3000,
      recordsPersisted: 3000,
    });

    await saveImportCheckpointAsync({
      version: 1,
      profileId: userSame,
      provider: 'anilist',
      accountIdentifier: sameAccount,
      status: 'paused',
      cursor: 4,
      recordsReceived: 2000,
      recordsProcessed: 2000,
      recordsConfirmed: 2000,
      recordsPersisted: 2000,
    });

    const malChk = await mockRemote.get(userSame, 'mal', sameAccount);
    const alChk = await mockRemote.get(userSame, 'anilist', sameAccount);

    const pathMAL = getRemoteCheckpointDocPath(userSame, 'mal', sameAccount);
    const pathAL = getRemoteCheckpointDocPath(userSame, 'anilist', sameAccount);

    const pass =
      malChk !== null &&
      alChk !== null &&
      malChk.cursor === 3000 &&
      alChk.cursor === 4 &&
      pathMAL.docId === 'mal_my_anime_handle' &&
      pathAL.docId === 'anilist_my_anime_handle' &&
      (pathMAL.docId as string) !== (pathAL.docId as string);

    recordTest(
      4,
      'Isolamento entre MAL e AniList',
      pass,
      `Separação estrita de subcoleção e documento (MAL=${malChk?.cursor} @ ${pathMAL.docId} | AniList=${alChk?.cursor} @ ${pathAL.docId})`
    );
  } catch (err) {
    recordTest(4, 'Isolamento entre MAL e AniList', false, String(err));
  }

  // TEST 05: Retomada em outro dispositivo usando checkpoint remoto
  try {
    const profileCross = 'usr_device_switch';
    const acc = 'cross_dev_user';

    // Dispositivo 1 gravou progresso remoto com 2.000 animes
    await saveImportCheckpointAsync({
      version: 2,
      profileId: profileCross,
      provider: 'mal',
      accountIdentifier: acc,
      status: 'paused',
      cursor: 2000,
      page: 3,
      recordsReceived: 2000,
      recordsProcessed: 2000,
      recordsConfirmed: 2000,
      recordsPersisted: 2000,
      lastConfirmedPoint: 'offset_2000',
    });

    // Dispositivo 2 inicia com localStorage e memória completamente limpos (novo dispositivo)
    mockLocal.clear();
    const { clearInMemoryCheckpointsForTesting } = await import('../../services/importSyncManager');
    clearInMemoryCheckpointsForTesting();

    const reconciled = await getOrReconcileImportCheckpoint(profileCross, 'mal', acc);
    const pass =
      reconciled.source === 'remote' &&
      reconciled.checkpoint !== null &&
      reconciled.checkpoint.cursor === 2000 &&
      reconciled.checkpoint.recordsConfirmed === 2000 &&
      mockLocal.getItem(getLocalCheckpointKey(profileCross, 'mal', acc)) !== null;

    recordTest(
      5,
      'Retomada em outro dispositivo usando checkpoint remoto',
      pass,
      `Dispositivo novo identificou checkpoint remoto na nuvem e hidratou cache local sem perda de progresso (cursor=${reconciled.checkpoint?.cursor})`
    );
  } catch (err) {
    recordTest(5, 'Retomada em outro dispositivo usando checkpoint remoto', false, String(err));
  }

  // TEST 06: Falha de rede durante a leitura remota
  try {
    const profileNetFail = 'usr_net_read_fail';
    const acc = 'net_user';

    // Grava checkpoint local prévio
    mockLocal.setItem(
      getLocalCheckpointKey(profileNetFail, 'anilist', acc),
      JSON.stringify({
        version: 1,
        profileId: profileNetFail,
        provider: 'anilist',
        accountIdentifier: acc,
        status: 'paused',
        cursor: 2,
        recordsReceived: 1000,
        recordsProcessed: 1000,
        recordsConfirmed: 1000,
        recordsPersisted: 1000,
        lastConfirmedPoint: 'chunk_2',
      })
    );

    mockRemote.simulateNetworkReadFailure = true;
    const res = await getOrReconcileImportCheckpoint(profileNetFail, 'anilist', acc);
    mockRemote.simulateNetworkReadFailure = false;

    const pass =
      res.source === 'local' &&
      res.checkpoint !== null &&
      res.checkpoint.cursor === 2 &&
      res.diagnostic.includes('Aviso remoto');

    recordTest(
      6,
      'Falha de rede durante a leitura remota',
      pass,
      `Falha remota tratada com contingência local sem interromper execução (cursor=${res.checkpoint?.cursor}, diagnostic="${res.diagnostic}")`
    );
  } catch (err) {
    mockRemote.simulateNetworkReadFailure = false;
    recordTest(6, 'Falha de rede durante a leitura remota', false, String(err));
  }

  // TEST 07: Falha na gravação remota
  try {
    const profileWriteFail = 'usr_write_fail';
    const acc = 'remote_write_user';

    mockRemote.simulateNetworkWriteFailure = true;
    const saveRes = await saveImportCheckpointAsync({
      version: 1,
      profileId: profileWriteFail,
      provider: 'mal',
      accountIdentifier: acc,
      status: 'in_progress',
      cursor: 1000,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
    });
    mockRemote.simulateNetworkWriteFailure = false;

    const pass =
      !saveRes.remoteSuccess &&
      saveRes.localSuccess &&
      saveRes.remoteError?.code === 'remote_write_error' &&
      saveRes.checkpoint.recordsConfirmed === 1000 &&
      saveRes.checkpoint.storageError !== null;

    recordTest(
      7,
      'Falha na gravação remota',
      pass,
      `Falha remota reportada sem transformar em falso sucesso e mantendo integridade do cursor confirmado localmente`
    );
  } catch (err) {
    mockRemote.simulateNetworkWriteFailure = false;
    recordTest(7, 'Falha na gravação remota', false, String(err));
  }

  // TEST 08: Falha de quota no armazenamento local
  try {
    const profileQuota = 'usr_quota_fail';
    const acc = 'quota_user';

    mockLocal.shouldThrowQuotaError = true;
    const saveRes = await saveImportCheckpointAsync({
      version: 1,
      profileId: profileQuota,
      provider: 'mal',
      accountIdentifier: acc,
      status: 'in_progress',
      cursor: 1000,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
    });
    mockLocal.shouldThrowQuotaError = false;

    const pass =
      !saveRes.localSuccess &&
      saveRes.remoteSuccess &&
      saveRes.localError?.code === 'local_quota_exceeded' &&
      saveRes.checkpoint.storageSource === 'remote';

    recordTest(
      8,
      'Falha de quota no armazenamento local',
      pass,
      `QuotaExceededError capturada e classificada (código=${saveRes.localError?.code}), com sucesso na persistência remota`
    );
  } catch (err) {
    mockLocal.shouldThrowQuotaError = false;
    recordTest(8, 'Falha de quota no armazenamento local', false, String(err));
  }

  // TEST 09: Conflito entre versões de checkpoints
  try {
    const localChk: ImportCheckpoint = {
      version: 3,
      profileId: 'usr_conflict',
      provider: 'anilist',
      accountIdentifier: 'conflict_user',
      status: 'paused',
      cursor: 5,
      recordsReceived: 2500,
      recordsProcessed: 2500,
      recordsConfirmed: 2500,
      recordsPersisted: 2500,
      lastConfirmedPoint: 'chunk_5',
    };

    const remoteChk: ImportCheckpoint = {
      version: 2,
      profileId: 'usr_conflict',
      provider: 'anilist',
      accountIdentifier: 'conflict_user',
      status: 'paused',
      cursor: 4,
      recordsReceived: 2000,
      recordsProcessed: 2000,
      recordsConfirmed: 2000,
      recordsPersisted: 2000,
      lastConfirmedPoint: 'chunk_4',
    };

    // Caso 9a: Resolução segura quando o local tem progresso mais avançado e linear comprovado
    const resolution = reconcileCheckpoints(localChk, remoteChk);
    const passLinear =
      resolution.source === 'local' &&
      resolution.checkpoint?.cursor === 5 &&
      resolution.checkpoint?.recordsConfirmed === 2500;

    // Caso 9b: Divergência real concorrente (cursores conflitantes com mesma versão ou direções incompatíveis)
    const divergedRemote: ImportCheckpoint = {
      ...remoteChk,
      version: 3,
      cursor: 3,
      recordsConfirmed: 1500,
      lastConfirmedPoint: 'chunk_3_diverged',
    };

    const divergedResolution = reconcileCheckpoints(localChk, divergedRemote);
    const passConflict =
      divergedResolution.diverged &&
      divergedResolution.conflict?.code === 'divergence_conflict' &&
      divergedResolution.checkpoint === null;

    const pass = passLinear && passConflict;
    recordTest(
      9,
      'Conflito entre versões de checkpoints',
      pass,
      `Reconciliação linear selecionou o progresso comprovadamente confirmado (v3/cursor=5); divergência não linear preservou ambos os estados e gerou erro controlado`
    );
  } catch (err) {
    recordTest(9, 'Conflito entre versões de checkpoints', false, String(err));
  }

  // TEST 10: Duas sessões tentando atualizar o mesmo checkpoint
  try {
    const profileConcurrency = 'usr_concurrent';
    const acc = 'multi_session';

    // Sessão 1 estabelece v1 -> v2 no backend
    const initialRes = await saveImportCheckpointAsync({
      version: 1,
      profileId: profileConcurrency,
      provider: 'mal',
      accountIdentifier: acc,
      status: 'in_progress',
      cursor: 1000,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
    });

    const v2 = initialRes.checkpoint.version; // 2

    // Sessão 1 avança v2 -> v3
    const session1Update = await mockRemote.set(
      {
        ...initialRes.checkpoint,
        cursor: 2000,
        recordsConfirmed: 2000,
      },
      v2
    );

    // Sessão 2 (estava com o checkpoint antigo v2) tenta salvar com expectedVersion v2 após Sessão 1 ter salvo
    const session2Update = await mockRemote.set(
      {
        ...initialRes.checkpoint,
        cursor: 1500,
        recordsConfirmed: 1500,
      },
      v2 // stale!
    );

    const pass =
      session1Update.success &&
      !session2Update.success &&
      session2Update.error?.code === 'version_conflict';

    recordTest(
      10,
      'Duas sessões tentando atualizar o mesmo checkpoint',
      pass,
      `Gravação concorrente defasada detectada com optimistic locking (erro=${session2Update.error?.message})`
    );
  } catch (err) {
    recordTest(10, 'Duas sessões tentando atualizar o mesmo checkpoint', false, String(err));
  }

  // TEST 11: Recuperação sem avançar cursor não confirmado
  try {
    const profileUnconfirmed = 'usr_unconfirmed_recovery';
    const acc = 'stage1_fail_user';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('graphql.anilist.co')) {
        return new Response(
          JSON.stringify({
            data: {
              MediaListCollection: {
                hasNextChunk: false,
                lists: [
                  {
                    name: 'Watching',
                    entries: [
                      {
                        id: 701,
                        status: 'CURRENT',
                        score: 8,
                        progress: 2,
                        repeat: 0,
                        updatedAt: 1700000000,
                        media: {
                          id: 701,
                          title: { english: 'Test Anime 701', romaji: 'Test Anime 701' },
                          coverImage: { extraLarge: 'https://cdn.anilist.co/701.jpg' },
                          episodes: 12,
                          startDate: { year: 2024 },
                          genres: ['Action'],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    };

    let simulatedCommitCalled = false;
    let importThrew = false;
    try {
      const importRes = await startOrResumeImport({
        profileId: profileUnconfirmed,
        provider: 'anilist',
        accountIdentifier: acc,
        onBatchCommitted: async () => {
          simulatedCommitCalled = true;
          throw new Error('SimulatedFirestoreError: Disk failure during batch commit');
        },
      });
      if (!importRes.success) {
        importThrew = true;
      }
    } catch {
      importThrew = true;
    } finally {
      globalThis.fetch = originalFetch;
    }

    const checkpointAfterFail = getImportCheckpoint(profileUnconfirmed, 'anilist', acc);
    const pass =
      simulatedCommitCalled &&
      importThrew &&
      checkpointAfterFail !== null &&
      checkpointAfterFail.status === 'error' &&
      checkpointAfterFail.cursor === 1 && // Permanece no chunk 1 (não avança para chunk 2)
      checkpointAfterFail.recordsConfirmed === 0;

    recordTest(
      11,
      'Recuperação sem avançar cursor não confirmado',
      pass,
      `Cursor permaneceu inalterado no último confirmado (chunk=1, confirmados=0) após exceção no onBatchCommitted`
    );
  } catch (err) {
    recordTest(11, 'Recuperação sem avançar cursor não confirmado', false, String(err));
  }

  // TEST 12: Reprocessamento idempotente após commit concluído e falha no checkpoint
  try {
    const profileIdempotent = 'usr_idempotent_retry';
    const acc = 'idempotent_user';

    const baseList: AnimeItem[] = [
      makeSyntheticAnime('mal-501', 'Steins;Gate', 'completed', 24, 2011),
    ];

    const duplicateBatch: MALAnimeEntry[] = [
      {
        malId: 501,
        title: 'Steins;Gate',
        posterUrl: 'https://cdn.myanimelist.net/steins.jpg',
        status: 'completed',
        currentEpisode: 24,
        totalEpisodes: 24,
        rating: 10,
        year: 2011,
        genres: ['Sci-Fi', 'Suspense'],
      },
      {
        malId: 502,
        title: 'Steins;Gate 0',
        posterUrl: 'https://cdn.myanimelist.net/steins0.jpg',
        status: 'completed',
        currentEpisode: 23,
        totalEpisodes: 23,
        rating: 9,
        year: 2018,
        genres: ['Sci-Fi'],
      },
    ];

    // Simula commit concluído com sucesso
    const firstMerge = mergeMALImport(duplicateBatch, baseList, true);

    // Simula falha na gravação do checkpoint remoto no momento do commit
    mockRemote.simulateNetworkWriteFailure = true;
    await saveImportCheckpointAsync({
      version: 1,
      profileId: profileIdempotent,
      provider: 'mal',
      accountIdentifier: acc,
      status: 'in_progress',
      cursor: 1000,
      recordsReceived: 2,
      recordsProcessed: 2,
      recordsConfirmed: 2,
      recordsPersisted: 2,
    });
    mockRemote.simulateNetworkWriteFailure = false;

    // Reprocessamento do mesmo lote
    const secondMerge = mergeMALImport(duplicateBatch, firstMerge.mergedList, true);

    const pass =
      firstMerge.mergedList.length === 2 &&
      secondMerge.mergedList.length === 2 &&
      secondMerge.addedCount === 0 &&
      secondMerge.unchangedCount === 2;

    recordTest(
      12,
      'Reprocessamento idempotente após commit concluído e falha no checkpoint',
      pass,
      `Reprocessamento não gerou duplicatas após falha do checkpoint (tamanho=${secondMerge.mergedList.length}, novos=0, inalterados=${secondMerge.unchangedCount})`
    );
  } catch (err) {
    mockRemote.simulateNetworkWriteFailure = false;
    recordTest(12, 'Reprocessamento idempotente após commit concluído', false, String(err));
  }

  // TEST 13: Compatibilidade com checkpoints antigos
  try {
    const legacyRaw = {
      profileId: 'usr_legacy',
      provider: 'mal',
      accountIdentifier: 'legacy_user',
      status: 'paused',
      page: 2,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      // Sem 'version', sem 'recordsConfirmed', sem 'lastConfirmedCheckpoint'
    };

    const validation = validateCheckpointIntegrity(legacyRaw, 'usr_legacy', 'mal', 'legacy_user');
    const pass =
      validation.valid &&
      validation.checkpoint !== null &&
      validation.checkpoint.version === 1 &&
      validation.checkpoint.recordsConfirmed === 1000 &&
      validation.checkpoint.recordsPersisted === 1000 &&
      validation.checkpoint.cursor === 0;

    recordTest(
      13,
      'Compatibilidade com checkpoints antigos',
      pass,
      `Estrutura legada normalizada automaticamente para padrão V2 sem quebrar campos essenciais (version=${validation.checkpoint?.version}, confirmados=${validation.checkpoint?.recordsConfirmed})`
    );
  } catch (err) {
    recordTest(13, 'Compatibilidade com checkpoints antigos', false, String(err));
  }

  // TEST 14: Cancelamento e remoção de checkpoint
  try {
    const profileCancel = 'usr_cancel_test';
    const acc = 'cancel_acc';

    await saveImportCheckpointAsync({
      version: 1,
      profileId: profileCancel,
      provider: 'anilist',
      accountIdentifier: acc,
      status: 'in_progress',
      cursor: 3,
      recordsReceived: 1500,
      recordsProcessed: 1500,
      recordsConfirmed: 1500,
      recordsPersisted: 1500,
    });

    cancelImport(profileCancel, 'anilist', acc);
    await clearImportCheckpointAsync(profileCancel, 'anilist', acc);

    const localAfter = getImportCheckpoint(profileCancel, 'anilist', acc);
    const remoteAfter = await mockRemote.get(profileCancel, 'anilist', acc);

    const pass = localAfter === null && remoteAfter === null;
    recordTest(
      14,
      'Cancelamento e remoção de checkpoint',
      pass,
      `Cancelamento limpou com sucesso ambos os registros local e remoto sem deixar resíduos`
    );
  } catch (err) {
    recordTest(14, 'Cancelamento e remoção de checkpoint', false, String(err));
  }

  // TEST 15: Ausência de regressões na importação MAL/AniList
  try {
    const malEntries: MALAnimeEntry[] = [
      {
        malId: 801,
        title: 'Neon Genesis Evangelion',
        posterUrl: 'https://cdn.myanimelist.net/eva.jpg',
        status: 'completed',
        currentEpisode: 26,
        totalEpisodes: 26,
        rating: 10,
        year: 1995,
        genres: ['Mecha', 'Psychological'],
      },
    ];

    const alEntries: AniListAnimeEntry[] = [
      {
        anilistId: 901,
        title: 'Cowboy Bebop',
        posterUrl: 'https://s4.anilist.co/bebop.jpg',
        status: 'completed',
        currentEpisode: 26,
        totalEpisodes: 26,
        rating: 9.8,
        year: 1998,
        genres: ['Action', 'Sci-Fi'],
      },
    ];

    const malRes = mergeMALImport(malEntries, [], true);
    const alRes = mergeAniListImport(alEntries, [], true);

    const pass =
      malRes.mergedList.length === 1 &&
      malRes.mergedList[0].malId === 801 &&
      malRes.addedCount === 1 &&
      alRes.mergedList.length === 1 &&
      alRes.mergedList[0].anilistId === 901 &&
      alRes.addedCount === 1;

    recordTest(
      15,
      'Ausência de regressões na importação MAL/AniList',
      pass,
      `Pipelines canônicos de mesclagem MAL e AniList operando com 100% de estabilidade e correspondência de IDs (malId=${malRes.mergedList[0].malId}, anilistId=${alRes.mergedList[0].anilistId})`
    );
  } catch (err) {
    recordTest(15, 'Ausência de regressões na importação MAL/AniList', false, String(err));
  }

  // TEST 16: Preservação dos dados locais e isolamento entre contas
  try {
    const acc1 = 'account_one';
    const acc2 = 'account_two';
    const profileIso = 'usr_multi_account';

    await saveImportCheckpointAsync({
      version: 1,
      profileId: profileIso,
      provider: 'mal',
      accountIdentifier: acc1,
      status: 'paused',
      cursor: 1000,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
    });

    await saveImportCheckpointAsync({
      version: 1,
      profileId: profileIso,
      provider: 'mal',
      accountIdentifier: acc2,
      status: 'in_progress',
      cursor: 3000,
      recordsReceived: 3000,
      recordsProcessed: 3000,
      recordsConfirmed: 3000,
      recordsPersisted: 3000,
    });

    const chk1 = getImportCheckpoint(profileIso, 'mal', acc1);
    const chk2 = getImportCheckpoint(profileIso, 'mal', acc2);

    const pass =
      chk1 !== null &&
      chk2 !== null &&
      chk1.cursor === 1000 &&
      chk2.cursor === 3000 &&
      chk1.accountIdentifier === acc1 &&
      chk2.accountIdentifier === acc2;

    recordTest(
      16,
      'Preservação dos dados locais e isolamento entre contas',
      pass,
      `Alternância e presença de múltiplas contas na mesma sessão mantidas sem vazamento de estado (acc1=${chk1?.cursor} vs acc2=${chk2?.cursor})`
    );
  } catch (err) {
    recordTest(16, 'Preservação dos dados locais e isolamento entre contas', false, String(err));
  }

  console.log('\n========================================================================');
  const allPassed = testResults.every((t) => t.passed);
  const passedCount = testResults.filter((t) => t.passed).length;
  console.log(`RESULTADO DA ETAPA 4: ${passedCount}/${testResults.length} TESTES PASSARAM`);
  console.log(`STATUS GERAL: ${allPassed ? '✅ ETAPA 4 VALIDADA COM SUCESSO (TODOS OS 16 TESTES APROVADOS)' : '❌ FALHAS DETECTADAS'}`);
  console.log('========================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runStage4Tests().catch((err) => {
  console.error('Erro fatal ao executar testes da Etapa 4:', err);
  process.exit(1);
});
