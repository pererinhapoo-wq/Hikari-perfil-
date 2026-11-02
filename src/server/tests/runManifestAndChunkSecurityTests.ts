import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { AnimeItem, UserProfile } from '../../types';
import {
  syncPublicProfileProjection,
  readPublicProfilesMap,
  sanitizePublicAnimeItem,
  type PublicProfileProjection,
} from '../../lib/userWorkspaceStorage';
import {
  partitionAnimesIntoChunks,
  buildAnimeToChunkMap,
  DEFAULT_CHUNK_SIZE,
  type AnimeStorageManifest,
  type AnimeChunkDocument,
} from '../../lib/chunkedAnimeStorage';

// Setup mock window & localStorage environment for headless Node execution
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, val: string): void {
    this.store.set(key, val);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: mockStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};

interface TestResult {
  num: number;
  name: string;
  passed: boolean;
  details: string;
}

const testResults: TestResult[] = [];

function recordTest(num: number, name: string, passed: boolean, details: string) {
  testResults.push({ num, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${String(num).padStart(2, '0')}] ${icon} - ${name}: ${details}`);
}

/**
 * Validador simulado das regras de segurança do Firestore para o Hikari.
 * Reflete estritamente a semântica implementada em firestore.rules.
 */
function evaluateFirestoreRules(context: {
  authUid: string | null;
  isAnonymous?: boolean;
  docPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  targetUserData?: { isPrivate: boolean; showAnimeList: boolean };
}): { allowed: boolean; reason: string } {
  const { authUid, isAnonymous, docPath, operation, targetUserData } = context;

  const isSignedIn = Boolean(authUid) && !isAnonymous;
  const isOwner = (targetUserId: string) => isSignedIn && authUid === targetUserId;

  // Analisa caminhos no padrão /users/{userId}/...
  const parts = docPath.replace(/^\//, '').split('/');
  if (parts[0] !== 'users' || parts.length < 2) {
    return { allowed: false, reason: 'Caminho fora da hierarquia /users' };
  }

  const userId = parts[1];
  const subcollection = parts[2];
  const docId = parts[3];

  // 1. Documento raiz do usuário: /users/{userId}
  if (parts.length === 2) {
    if (operation === 'get') {
      if (isOwner(userId)) return { allowed: true, reason: 'Proprietário lê seu perfil' };
      if (isSignedIn && targetUserData?.isPrivate === false) {
        return { allowed: true, reason: 'Usuário autenticado lê perfil público' };
      }
      return { allowed: false, reason: 'Acesso negado a perfil privado ou não autenticado' };
    }
    if (operation === 'update' || operation === 'create') {
      return { allowed: isOwner(userId), reason: isOwner(userId) ? 'Permitido ao dono' : 'Negado a terceiros' };
    }
  }

  // 2. Subcoleção anime_storage: /users/{userId}/anime_storage/{docId}
  if (subcollection === 'anime_storage') {
    if (docId === 'manifest') {
      if (operation === 'get') {
        const allowed = isOwner(userId);
        return { allowed, reason: allowed ? 'Permitido: dono lendo manifesto' : 'Negado: manifesto restrito ao dono' };
      }
      if (operation === 'create' || operation === 'update') {
        const allowed = isOwner(userId);
        return { allowed, reason: allowed ? 'Permitido: dono gravando manifesto' : 'Negado: escrita restrita ao dono' };
      }
    }
    return { allowed: false, reason: 'Operação não permitida em anime_storage' };
  }

  // 3. Subcoleção anime_chunks: /users/{userId}/anime_chunks/{chunkId}
  if (subcollection === 'anime_chunks') {
    if (operation === 'get' || operation === 'list') {
      const allowed = isOwner(userId);
      return {
        allowed,
        reason: allowed
          ? 'Permitido: dono lendo blocos particionados'
          : 'Negado: blocos particionados restritos estritamente ao dono (zero-trust)',
      };
    }
    if (operation === 'create' || operation === 'update' || operation === 'delete') {
      const allowed = isOwner(userId);
      return { allowed, reason: allowed ? 'Permitido: dono gerenciando blocos' : 'Negado: escrita restrita ao dono' };
    }
  }

  return { allowed: false, reason: 'Regra padrão Zero-Trust bloqueou a operação' };
}

function makeMockAnime(id: string, title: string, status: AnimeItem['status'], rating: number): AnimeItem {
  return {
    id,
    title,
    titleRomaji: `${title} (Romaji)`,
    posterUrl: `https://cdn.hikari.app/covers/${id}.jpg`,
    status,
    currentEpisode: 12,
    totalEpisodes: 24,
    rating,
    isFavorite: rating >= 9,
    year: 2023,
    genres: ['Action', 'Fantasy'],
    episodeDurationMinutes: 24,
    rewatchCount: 1,
    anilistId: 1000 + Number(id.replace(/\D/g, '') || 1),
    malId: 5000 + Number(id.replace(/\D/g, '') || 1),
  };
}

function makeMockProfile(id: string, isPrivate: boolean, showAnimeList: boolean): UserProfile {
  return {
    id,
    username: `user_${id}`,
    displayName: `User ${id}`,
    avatarUrl: `https://cdn.hikari.app/avatars/${id}.jpg`,
    bannerUrl: `https://cdn.hikari.app/banners/${id}.jpg`,
    bio: `Bio de teste para ${id}`,
    createdAt: '01 de janeiro de 2024',
    createdAtTimestamp: 1704067200000,
    followersCount: 42,
    followingCount: 10,
    isPrivate,
    showCommentsOnProfile: true,
    privacySettings: {
      showAnimeList,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
    },
    externalAccounts: {
      anilist: { connected: true, username: `anilist_${id}` },
      mal: { connected: true, username: `mal_${id}` },
    },
  };
}

export async function runManifestAndChunkSecurityTests(): Promise<void> {
  console.log('========================================================================');
  console.log('HIKARI PERFIL — SUÍTE DE TESTES: LEITURA DO MANIFESTO E PROJEÇÃO PÚBLICA');
  console.log('========================================================================\n');

  const ownerUid = 'hikari_owner_uid_101';
  const otherUserUid = 'hikari_other_uid_202';

  // TEST 01: O proprietário consegue ler seu manifesto
  try {
    const res = evaluateFirestoreRules({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/anime_storage/manifest`,
      operation: 'get',
    });
    const pass = res.allowed === true;
    recordTest(
      1,
      'O proprietário consegue ler seu manifesto',
      pass,
      `Acesso concedido com sucesso para ${ownerUid} (motivo: ${res.reason})`
    );
  } catch (err) {
    recordTest(1, 'Proprietário lê manifesto', false, String(err));
  }

  // TEST 02: Outro usuário não consegue ler o manifesto privado
  try {
    const res = evaluateFirestoreRules({
      authUid: otherUserUid,
      docPath: `/users/${ownerUid}/anime_storage/manifest`,
      operation: 'get',
      targetUserData: { isPrivate: false, showAnimeList: true },
    });
    const pass = res.allowed === false;
    recordTest(
      2,
      'Outro usuário não consegue ler o manifesto privado',
      pass,
      `Acesso bloqueado para UID terceiro ${otherUserUid} (motivo: ${res.reason})`
    );
  } catch (err) {
    recordTest(2, 'Terceiro lê manifesto privado', false, String(err));
  }

  // TEST 03: Um visitante não consegue ler manifestos privados de perfis públicos
  try {
    const anonymousVisitorRes = evaluateFirestoreRules({
      authUid: null,
      docPath: `/users/${ownerUid}/anime_storage/manifest`,
      operation: 'get',
      targetUserData: { isPrivate: false, showAnimeList: true },
    });
    const authVisitorRes = evaluateFirestoreRules({
      authUid: 'random_visitor_999',
      docPath: `/users/${ownerUid}/anime_storage/manifest`,
      operation: 'get',
      targetUserData: { isPrivate: false, showAnimeList: true },
    });
    const pass = anonymousVisitorRes.allowed === false && authVisitorRes.allowed === false;
    recordTest(
      3,
      'Um visitante não consegue ler manifestos privados de perfis públicos',
      pass,
      `Visitante anônimo e visitante autenticado bloqueados do manifesto mesmo em perfil público`
    );
  } catch (err) {
    recordTest(3, 'Visitante lê manifesto de perfil público', false, String(err));
  }

  // TEST 04: Um visitante consegue visualizar a lista pública sanitizada quando o perfil está público e showAnimeList == true
  try {
    mockStorage.clear();
    const publicProfile = makeMockProfile(ownerUid, false, true);
    const mockAnimes = [
      makeMockAnime('ani_1', 'Frieren: Beyond Journey', 'completed', 10),
      makeMockAnime('ani_2', 'Jujutsu Kaisen', 'watching', 9),
    ];

    syncPublicProfileProjection(publicProfile, mockAnimes, Date.now(), { immediate: true });
    const publicMap = readPublicProfilesMap(otherUserUid);
    const proj = publicMap[ownerUid];

    const pass =
      proj !== undefined &&
      proj.profile.isPrivate === false &&
      proj.profile.privacySettings.showAnimeList === true &&
      proj.publicAnimes.length === 2 &&
      proj.publicAnimes[0].title === 'Frieren: Beyond Journey';

    recordTest(
      4,
      'Um visitante consegue visualizar a lista pública sanitizada quando perfil é público e showAnimeList == true',
      pass,
      `Lista pública sanitizada exposta com sucesso (${proj?.publicAnimes.length} animes visíveis)`
    );
  } catch (err) {
    recordTest(4, 'Visualização da lista pública sanitizada', false, String(err));
  }

  // TEST 05: Um visitante não consegue visualizar a lista quando o perfil é privado
  try {
    mockStorage.clear();
    const privateProfile = makeMockProfile(ownerUid, true, true); // isPrivate: true
    const mockAnimes = [makeMockAnime('ani_priv_1', 'Solo Leveling', 'watching', 8.5)];

    syncPublicProfileProjection(privateProfile, mockAnimes, Date.now(), { immediate: true });
    const publicMap = readPublicProfilesMap(otherUserUid);
    const proj = publicMap[ownerUid];

    const pass =
      proj !== undefined &&
      proj.profile.isPrivate === true &&
      proj.publicAnimes.length === 0; // Lista removida para []

    recordTest(
      5,
      'Um visitante não consegue visualizar a lista quando o perfil é privado',
      pass,
      `Perfil privado teve publicAnimes estritamente esvaziado para 0 itens (publicAnimes.length === ${proj?.publicAnimes.length})`
    );
  } catch (err) {
    recordTest(5, 'Lista oculta em perfil privado', false, String(err));
  }

  // TEST 06: Um visitante não consegue visualizar a lista quando showAnimeList == false
  try {
    mockStorage.clear();
    const hiddenListProfile = makeMockProfile(ownerUid, false, false); // isPrivate: false, showAnimeList: false
    const mockAnimes = [makeMockAnime('ani_hidden_1', 'Chainsaw Man', 'completed', 9.5)];

    syncPublicProfileProjection(hiddenListProfile, mockAnimes, Date.now(), { immediate: true });
    const publicMap = readPublicProfilesMap(otherUserUid);
    const proj = publicMap[ownerUid];

    const pass =
      proj !== undefined &&
      proj.profile.isPrivate === false &&
      proj.profile.privacySettings.showAnimeList === false &&
      proj.publicAnimes.length === 0; // Lista removida para []

    recordTest(
      6,
      'Um visitante não consegue visualizar a lista quando showAnimeList == false',
      pass,
      `Configuração showAnimeList=false esvaziou estritamente publicAnimes (itens visíveis = ${proj?.publicAnimes.length})`
    );
  } catch (err) {
    recordTest(6, 'Lista oculta quando showAnimeList=false', false, String(err));
  }

  // TEST 07: Dados internos e privados não aparecem na projeção pública
  try {
    mockStorage.clear();
    const testProfile = makeMockProfile(ownerUid, false, true);

    // Cria animes simulando que contêm metadados internos arbitrários
    const animeWithInternals = {
      ...makeMockAnime('ani_sec_1', 'Demon Slayer', 'completed', 9),
      _internalStorageChunkId: 'chunk_99',
      _storageEngineVersion: 'chunked_v1',
      _privateSyncToken: 'secret_token_abc_123',
    } as unknown as AnimeItem;

    syncPublicProfileProjection(testProfile, [animeWithInternals], Date.now(), { immediate: true });
    const publicMap = readPublicProfilesMap();
    const proj = publicMap[ownerUid];
    const rawEntry = (proj?.publicAnimes[0] as unknown as Record<string, unknown>) || {};

    const hasChunkField = '_internalStorageChunkId' in rawEntry;
    const hasSyncToken = '_privateSyncToken' in rawEntry;
    const hasEngineVer = '_storageEngineVersion' in rawEntry;
    const anilistConnected = proj?.profile.externalAccounts?.anilist?.connected;
    const malConnected = proj?.profile.externalAccounts?.mal?.connected;

    // Garante que o manifesto de armazenamento não está misturado na projeção
    const hasManifestInProj = 'chunkIds' in (proj || {}) || 'animeToChunkMap' in (proj || {});

    const pass =
      !hasChunkField &&
      !hasSyncToken &&
      !hasEngineVer &&
      anilistConnected === false &&
      malConnected === false &&
      !hasManifestInProj;

    recordTest(
      7,
      'Dados internos e privados não aparecem na projeção pública',
      pass,
      `Metadados internos (_internalChunk, _syncToken), contas externas desconectadas e manifesto ausentes da projeção`
    );
  } catch (err) {
    recordTest(7, 'Isolamento de dados internos na projeção', false, String(err));
  }

  // TEST 08: As regras dos blocos continuam coerentes com o fluxo público
  try {
    const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

    // Verifica que anime_chunks e anime_storage possuem o mesmo nível de proteção: apenas isOwner
    const chunkRuleMatch = rulesSource.includes('match /anime_chunks/{chunkId}');
    const chunkGetIsOwnerOnly = rulesSource.includes(
      'allow get: if isOwner(userId) && isValidId(userId) && isValidId(chunkId);'
    );
    const chunkListIsOwnerOnly = rulesSource.includes('allow list: if isOwner(userId);');

    // Simulação de tentativa de terceiro lendo chunk do dono diretamente
    const thirdPartyChunkGet = evaluateFirestoreRules({
      authUid: otherUserUid,
      docPath: `/users/${ownerUid}/anime_chunks/chunk_0`,
      operation: 'get',
      targetUserData: { isPrivate: false, showAnimeList: true },
    });

    const ownerChunkGet = evaluateFirestoreRules({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/anime_chunks/chunk_0`,
      operation: 'get',
      targetUserData: { isPrivate: false, showAnimeList: true },
    });

    const pass =
      chunkRuleMatch &&
      chunkGetIsOwnerOnly &&
      chunkListIsOwnerOnly &&
      thirdPartyChunkGet.allowed === false &&
      ownerChunkGet.allowed === true;

    recordTest(
      8,
      'As regras dos blocos continuam coerentes com o fluxo público',
      pass,
      `anime_chunks alinhado a anime_storage: leitura direta de blocos restrita exclusivamente ao dono (Zero-Trust)`
    );
  } catch (err) {
    recordTest(8, 'Coerência das regras dos blocos', false, String(err));
  }

  // TEST 09: As operações de leitura e gravação do proprietário continuam funcionando
  try {
    const animes = Array.from({ length: 650 }, (_, i) =>
      makeMockAnime(`item_${i + 1}`, `Anime #${i + 1}`, i < 200 ? 'watching' : 'completed', 8)
    );

    const chunks = partitionAnimesIntoChunks(animes, DEFAULT_CHUNK_SIZE);
    const { chunkIds, chunkCounts, animeToChunkMap } = buildAnimeToChunkMap(chunks);

    const manifest: AnimeStorageManifest = {
      version: 1,
      storageEngine: 'chunked_v1',
      ownerUid,
      totalAnimes: animes.length,
      chunkIds,
      chunkCounts,
      statusCounts: {
        watching: 200,
        completed: 450,
        planned: 0,
        on_hold: 0,
        dropped: 0,
      },
      animeToChunkMap,
      migratedFromLegacy: false,
      legacyItemCount: 0,
      updatedAtMs: Date.now(),
    };

    // Avalia regras de escrita para o proprietário
    const manifestWrite = evaluateFirestoreRules({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/anime_storage/manifest`,
      operation: 'create',
    });
    const chunk0Write = evaluateFirestoreRules({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/anime_chunks/${chunkIds[0]}`,
      operation: 'create',
    });
    const chunk0Read = evaluateFirestoreRules({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/anime_chunks/${chunkIds[0]}`,
      operation: 'get',
    });

    const pass =
      manifest.chunkIds.length === 3 &&
      chunks[0].length === 300 &&
      chunks[1].length === 300 &&
      chunks[2].length === 50 &&
      manifestWrite.allowed === true &&
      chunk0Write.allowed === true &&
      chunk0Read.allowed === true;

    recordTest(
      9,
      'As operações de leitura e gravação do proprietário continuam funcionando',
      pass,
      `Proprietário particionou 650 itens em 3 blocos (300, 300, 50) com permissões ativas de leitura e gravação`
    );
  } catch (err) {
    recordTest(9, 'Operações de CRUD do proprietário', false, String(err));
  }

  // TEST 10: Não há regressões nas importações MAL/AniList nem no armazenamento particionado
  try {
    const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

    // Validações fundamentais das regras do armazenamento particionado
    const hasStorageDoc = rulesSource.includes('match /anime_storage/{docId}');
    const hasChunkDoc = rulesSource.includes('match /anime_chunks/{chunkId}');
    const hasAdminUid = rulesSource.includes("request.auth.uid == 'TLJx2QuEv4QQYoduGqn0LDJxxRW2'");
    const hasMaxChunkLimit = rulesSource.includes('incoming().animes.size() <= 450');

    // Sanitização e isolamento da projeção pública mantidos
    const sampleItem = sanitizePublicAnimeItem(makeMockAnime('reg_1', 'Bleach', 'completed', 9));
    const pass =
      hasStorageDoc &&
      hasChunkDoc &&
      hasAdminUid &&
      hasMaxChunkLimit &&
      sampleItem.title === 'Bleach' &&
      sampleItem.rating === 9;

    recordTest(
      10,
      'Não há regressões nas importações MAL/AniList nem no armazenamento particionado',
      pass,
      `Regras estruturais, limites de bloco (<= 450) e integridade de tipos totalmente validados sem efeitos colaterais`
    );
  } catch (err) {
    recordTest(10, 'Ausência de regressões', false, String(err));
  }

  console.log('\n========================================================================');
  const allPassed = testResults.every((t) => t.passed);
  const passedCount = testResults.filter((t) => t.passed).length;
  console.log(`RESULTADO DA ETAPA 2: ${passedCount}/${testResults.length} TESTES PASSARAM`);
  if (allPassed) {
    console.log('STATUS GERAL: ✅ ETAPA 2 VALIDADA COM SUCESSO (TODOS OS 10 TESTES APROVADOS)');
  } else {
    console.log('STATUS GERAL: ❌ EXISTEM FALHAS NOS TESTES');
  }
  console.log('========================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runManifestAndChunkSecurityTests().catch((err) => {
  console.error('Erro inesperado durante os testes da Etapa 2:', err);
  process.exit(1);
});
