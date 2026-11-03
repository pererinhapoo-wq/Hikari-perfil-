import {
  createAnimeProvenance,
  normalizeAnimeProvenance,
  markAnimeLocallyModified,
  classifyLegacyAnimeOrigin,
} from '../../utils/animeProvenance';
import { mergeAniListImport, type AniListAnimeEntry } from '../../services/anilistService';
import { mergeMALImport, type MALAnimeEntry } from '../../services/malService';
import { stripUndefinedDeep } from '../../lib/userWorkspaceStorage';
import {
  partitionAnimesIntoChunks,
  buildAnimeToChunkMap,
  type AnimeChunkDocument,
  type AnimeStorageManifest,
} from '../../lib/chunkedAnimeStorage';
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

function makeMockAnime(
  id: string,
  title: string,
  overrides?: Partial<AnimeItem>
): AnimeItem {
  return {
    id,
    title,
    titleRomaji: title,
    posterUrl: `https://example.com/posters/${id}.jpg`,
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8,
    isFavorite: false,
    year: 2023,
    genres: ['Ação', 'Aventura'],
    ...overrides,
  };
}

console.log('========================================================================');
console.log('SUÍTE DE TESTES: CORREÇÕES DE PROVENIÊNCIA E CHUNKS FIRESTORE');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TESTE 1: Anime com hasUserModifications: true — importação AniList NÃO sobrescreve status, episódio e nota
// -----------------------------------------------------------------------------
const baseAnimeAL = makeMockAnime('ani_al_101_local', 'Frieren: Beyond Journey\'s End', {
  anilistId: 101,
  status: 'watching',
  currentEpisode: 10,
  rating: 9.5,
  totalEpisodes: 28,
  provenance: createAnimeProvenance('anilist', {
    accountIdentifier: 'user_orig',
    anilistUsername: 'user_orig',
    linkedProviders: ['anilist'],
    hasUserModifications: true, // USUÁRIO EDITOU LOCALMENTE
    lastModifiedLocallyAtMs: 1700000000000,
  }),
});

const incomingAniList: AniListAnimeEntry = {
  anilistId: 101,
  title: 'Frieren: Beyond Journey\'s End',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
  status: 'completed', // externo diz completed
  currentEpisode: 28,  // externo diz ep 28
  totalEpisodes: 28,
  rating: 7.0,         // externo diz nota 7.0
  year: 2023,
  genres: ['Aventura', 'Fantasia'],
};

const resultAL = mergeAniListImport([incomingAniList], [baseAnimeAL], true, 'user_orig');
const mergedAL = resultAL.mergedList[0];

const test1Passed =
  Boolean(mergedAL) &&
  mergedAL.id === 'ani_al_101_local' &&
  mergedAL.status === 'watching' &&      // Preservado status local
  mergedAL.currentEpisode === 10 &&      // Preservado ep local
  mergedAL.rating === 9.5 &&             // Preservada nota local
  mergedAL.provenance?.hasUserModifications === true &&
  mergedAL.provenance?.lastModifiedLocallyAtMs === 1700000000000;

recordTest(
  1,
  'Anime com hasUserModifications: true: AniList não sobrescreve status, episódio e nota',
  test1Passed,
  `status="${mergedAL?.status}" (esperado: watching), ep=${mergedAL?.currentEpisode} (esperado: 10), nota=${mergedAL?.rating} (esperado: 9.5)`
);

// -----------------------------------------------------------------------------
// TESTE 2: Anime com hasUserModifications: true — importação MAL NÃO sobrescreve status, episódio e nota
// -----------------------------------------------------------------------------
const baseAnimeMAL = makeMockAnime('ani_mal_501_local', 'Vinland Saga Season 2', {
  malId: 501,
  status: 'on_hold',
  currentEpisode: 12,
  rating: 8.8,
  totalEpisodes: 24,
  provenance: createAnimeProvenance('mal', {
    accountIdentifier: 'user_orig',
    malUsername: 'user_orig',
    linkedProviders: ['mal'],
    hasUserModifications: true, // USUÁRIO EDITOU LOCALMENTE
    lastModifiedLocallyAtMs: 1700000001000,
  }),
});

const incomingMAL: MALAnimeEntry = {
  malId: 501,
  title: 'Vinland Saga Season 2',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/124312.jpg',
  status: 'completed', // externo diz completed
  currentEpisode: 24,  // externo diz ep 24
  totalEpisodes: 24,
  rating: 9.9,         // externo diz nota 9.9
  year: 2023,
  genres: ['Ação', 'Drama'],
};

const resultMAL = mergeMALImport([incomingMAL], [baseAnimeMAL], true, 'user_orig');
const mergedMAL = resultMAL.mergedList[0];

const test2Passed =
  Boolean(mergedMAL) &&
  mergedMAL.id === 'ani_mal_501_local' &&
  mergedMAL.status === 'on_hold' &&     // Preservado status local
  mergedMAL.currentEpisode === 12 &&     // Preservado ep local
  mergedMAL.rating === 8.8 &&            // Preservada nota local
  mergedMAL.provenance?.hasUserModifications === true &&
  mergedMAL.provenance?.lastModifiedLocallyAtMs === 1700000001000;

recordTest(
  2,
  'Anime com hasUserModifications: true: MAL não sobrescreve status, episódio e nota',
  test2Passed,
  `status="${mergedMAL?.status}" (esperado: on_hold), ep=${mergedMAL?.currentEpisode} (esperado: 12), nota=${mergedMAL?.rating} (esperado: 8.8)`
);

// -----------------------------------------------------------------------------
// TESTE 3: Anime sem alterações manuais — importação continua atualizando os campos
// -----------------------------------------------------------------------------
const unmodifiedAnime = makeMockAnime('ani_al_202_unmod', 'Sousou no Frieren', {
  anilistId: 202,
  status: 'watching',
  currentEpisode: 4,
  rating: 8.0,
  totalEpisodes: 28,
  provenance: createAnimeProvenance('anilist', {
    accountIdentifier: 'user_orig',
    anilistUsername: 'user_orig',
    linkedProviders: ['anilist'],
    hasUserModifications: false, // NÃO modificado manualmente
  }),
});

const incomingUpdate: AniListAnimeEntry = {
  anilistId: 202,
  title: 'Sousou no Frieren',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
  status: 'completed',
  currentEpisode: 28,
  totalEpisodes: 28,
  rating: 10,
  year: 2023,
  genres: ['Fantasia'],
};

const resultUnmod = mergeAniListImport([incomingUpdate], [unmodifiedAnime], true, 'user_orig');
const mergedUnmod = resultUnmod.mergedList[0];

const test3Passed =
  Boolean(mergedUnmod) &&
  mergedUnmod.id === 'ani_al_202_unmod' &&
  mergedUnmod.status === 'completed' &&
  mergedUnmod.currentEpisode === 28 &&
  mergedUnmod.rating === 10;

recordTest(
  3,
  'Anime sem alterações manuais: importação continua atualizando status, episódio e nota',
  test3Passed,
  `status="${mergedUnmod?.status}" (atualizado para completed), ep=${mergedUnmod?.currentEpisode} (atualizado para 28), nota=${mergedUnmod?.rating} (atualizada para 10)`
);

// -----------------------------------------------------------------------------
// TESTE 4: Vínculos AniList e MAL permanecem preservados
// -----------------------------------------------------------------------------
const dualLinkedAnime = makeMockAnime('anime_dual_test_1', 'Attack on Titan', {
  anilistId: 16498,
  malId: 16498,
  status: 'completed',
  currentEpisode: 25,
  rating: 9.0,
  provenance: createAnimeProvenance('anilist', {
    accountIdentifier: 'user_al',
    anilistUsername: 'user_al',
    malUsername: 'user_mal',
    linkedProviders: ['anilist', 'mal'],
    hasUserModifications: true,
  }),
});

// Importando via MAL novamente
const incomingMALForDual: MALAnimeEntry = {
  malId: 16498,
  anilistId: 16498,
  title: 'Attack on Titan',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/10/47347.jpg',
  status: 'completed',
  currentEpisode: 25,
  totalEpisodes: 25,
  rating: 8.5,
  year: 2013,
  genres: ['Ação'],
};

const resultDual = mergeMALImport([incomingMALForDual], [dualLinkedAnime], true, 'user_mal');
const mergedDual = resultDual.mergedList[0];

const test4Passed = Boolean(
  mergedDual &&
  mergedDual.id === 'anime_dual_test_1' &&
  mergedDual.anilistId === 16498 &&
  mergedDual.malId === 16498 &&
  mergedDual.provenance?.linkedProviders.includes('anilist') &&
  mergedDual.provenance?.linkedProviders.includes('mal') &&
  mergedDual.provenance?.anilistUsername === 'user_al' &&
  mergedDual.provenance?.malUsername === 'user_mal' &&
  mergedDual.rating === 9.0 // Preservada nota manual
);

recordTest(
  4,
  'Vínculos AniList e MAL permanecem preservados em animes duplamente vinculados',
  test4Passed,
  `anilistId=${mergedDual?.anilistId}, malId=${mergedDual?.malId}, linked=[${mergedDual?.provenance?.linkedProviders.join(', ')}], alUser="${mergedDual?.provenance?.anilistUsername}", malUser="${mergedDual?.provenance?.malUsername}"`
);

// -----------------------------------------------------------------------------
// TESTE 5: Sanitização remove "undefined" recursivamente
// -----------------------------------------------------------------------------
const objectWithUndefined = {
  id: 'test_obj',
  definedProp: 'valid',
  undefProp: undefined,
  nested: {
    definedNested: 123,
    undefNested: undefined,
    deepArray: [
      { a: 1, b: undefined },
      { c: undefined, d: 'ok' },
    ],
  },
  arrayWithUndef: [undefined, 'item', undefined],
};

const sanitizedObject = stripUndefinedDeep(objectWithUndefined);
const hasTopUndef = 'undefProp' in sanitizedObject;
const hasNestedUndef = 'undefNested' in (sanitizedObject.nested as any);
const hasDeepArrayUndef = 'b' in (sanitizedObject.nested as any).deepArray[0];

const test5Passed = !hasTopUndef && !hasNestedUndef && !hasDeepArrayUndef;

recordTest(
  5,
  'Sanitização remove propriedades "undefined" recursivamente',
  test5Passed,
  `hasTopUndef=${hasTopUndef}, hasNestedUndef=${hasNestedUndef}, hasDeepArrayUndef=${hasDeepArrayUndef}`
);

// -----------------------------------------------------------------------------
// TESTE 6: Sanitização preserva "null", "false", "0" e strings vazias
// -----------------------------------------------------------------------------
const falsyObject = {
  nullVal: null,
  falseVal: false,
  zeroVal: 0,
  emptyStr: '',
  undefVal: undefined,
  nested: {
    nullNested: null,
    falseNested: false,
    zeroNested: 0,
    emptyNested: '',
  },
};

const sanitizedFalsy = stripUndefinedDeep(falsyObject) as any;

const test6Passed =
  sanitizedFalsy.nullVal === null &&
  sanitizedFalsy.falseVal === false &&
  sanitizedFalsy.zeroVal === 0 &&
  sanitizedFalsy.emptyStr === '' &&
  !('undefVal' in sanitizedFalsy) &&
  sanitizedFalsy.nested.nullNested === null &&
  sanitizedFalsy.nested.falseNested === false &&
  sanitizedFalsy.nested.zeroNested === 0 &&
  sanitizedFalsy.nested.emptyNested === '';

recordTest(
  6,
  'Sanitização preserva rigorosamente "null", "false", "0" e strings vazias',
  test6Passed,
  `nullVal=${sanitizedFalsy.nullVal}, falseVal=${sanitizedFalsy.falseVal}, zeroVal=${sanitizedFalsy.zeroVal}, emptyStr="${sanitizedFalsy.emptyStr}"`
);

// -----------------------------------------------------------------------------
// TESTE 7: Proveniência sobrevive à sanitização e à gravação simulada dos chunks
// -----------------------------------------------------------------------------
const animeToChunk: AnimeItem = makeMockAnime('chunk_test_item', 'Demon Slayer', {
  anilistId: 101922,
  provenance: createAnimeProvenance('anilist', {
    accountIdentifier: undefined, // undefined proposital
    anilistUsername: undefined,   // undefined proposital
    malUsername: undefined,       // undefined proposital
    lastModifiedLocallyAtMs: undefined, // undefined proposital
    hasUserModifications: false,
    linkedProviders: ['anilist'],
  }),
});

const chunks = partitionAnimesIntoChunks([animeToChunk], 300);
const { chunkIds } = buildAnimeToChunkMap(chunks);
const chunkId = chunkIds[0];

const sanitizedChunkAnimes = stripUndefinedDeep(chunks[0]);
const chunkDoc: AnimeChunkDocument = {
  ownerUid: 'test_uid_456',
  chunkId,
  chunkIndex: 0,
  animes: sanitizedChunkAnimes,
  count: sanitizedChunkAnimes.length,
  updatedAtMs: Date.now(),
};

const sanitizedChunkDoc = stripUndefinedDeep(chunkDoc);

// Verifica que nenhum campo do chunkDoc ou de seus animes possui valor undefined
const serializedJson = JSON.stringify(sanitizedChunkDoc);
const deserialized = JSON.parse(serializedJson);

const chunkAnime = deserialized.animes[0];
const test7Passed =
  Boolean(chunkAnime) &&
  chunkAnime.id === 'chunk_test_item' &&
  chunkAnime.provenance !== undefined &&
  chunkAnime.provenance.originProvider === 'anilist' &&
  chunkAnime.provenance.hasUserModifications === false &&
  Array.isArray(chunkAnime.provenance.linkedProviders) &&
  chunkAnime.provenance.linkedProviders[0] === 'anilist' &&
  !('accountIdentifier' in chunkAnime.provenance) && // Undefined foi removido
  !('anilistUsername' in chunkAnime.provenance);

recordTest(
  7,
  'Proveniência sobrevive à sanitização e à estrutura dos chunks do Firestore',
  test7Passed,
  `originProvider="${chunkAnime?.provenance?.originProvider}", linked=[${chunkAnime?.provenance?.linkedProviders?.join(', ')}], sem undefined no payload`
);

// -----------------------------------------------------------------------------
// TESTE 8: Registros "legacy_unknown" permanecem intactos
// -----------------------------------------------------------------------------
const legacyItem = makeMockAnime('anime_kaiju8', 'Kaiju No. 8', {
  status: 'watching',
  currentEpisode: 6,
  totalEpisodes: 12,
  rating: 8.5,
  year: 2024,
});

// 1. Classificação conservadora
const normalizedLegacy = normalizeAnimeProvenance(legacyItem);

// 2. Simulação de importação não relacionada (não deve tocar em registros legados sem correspondência)
const incomingUnrelated: AniListAnimeEntry = {
  anilistId: 99999,
  title: 'Outro Anime Totalmente Diferente',
  posterUrl: 'https://example.com/poster.jpg',
  status: 'completed',
  currentEpisode: 12,
  totalEpisodes: 12,
  rating: 8,
  year: 2024,
  genres: ['Ação'],
};

const mergeResult = mergeAniListImport([incomingUnrelated], [normalizedLegacy], true, 'test_user');
const preservedLegacy = mergeResult.mergedList.find((a) => a.id === 'anime_kaiju8');

const test8Passed =
  Boolean(preservedLegacy) &&
  preservedLegacy?.provenance?.originProvider === 'legacy_unknown' &&
  preservedLegacy?.provenance?.accountIdentifier === undefined &&
  preservedLegacy?.provenance?.linkedProviders.length === 0 &&
  preservedLegacy?.status === 'watching' &&
  preservedLegacy?.currentEpisode === 6 &&
  preservedLegacy?.rating === 8.5;

recordTest(
  8,
  'Registros "legacy_unknown" permanecem intactos sem alteração de origem ou dados',
  test8Passed,
  `originProvider="${preservedLegacy?.provenance?.originProvider}", status="${preservedLegacy?.status}", ep=${preservedLegacy?.currentEpisode}, nota=${preservedLegacy?.rating}`
);

// -----------------------------------------------------------------------------
// RESUMO FINAL
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
const totalPassed = testResults.filter((t) => t.passed).length;
const totalFailed = testResults.filter((t) => !t.passed).length;
console.log(`TOTAL DE TESTES: ${testResults.length} | PASSOU: ${totalPassed} | FALHOU: ${totalFailed}`);
console.log('========================================================================');

if (totalFailed > 0) {
  process.exit(1);
}
