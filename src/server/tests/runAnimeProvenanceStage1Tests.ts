import {
  classifyLegacyAnimeOrigin,
  createAnimeProvenance,
  deriveLinkedProviders,
  normalizeAnimeProvenance,
  migrateAnimeListProvenance,
  markAnimeLocallyModified,
  mergeAnimeProvenanceOnImport,
} from '../../utils/animeProvenance';
import { mergeAniListImport, type AniListAnimeEntry } from '../../services/anilistService';
import { mergeMALImport, type MALAnimeEntry } from '../../services/malService';
import type { AnimeItem, AnimeOriginProvider } from '../../types';

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
console.log('SUÍTE DE TESTES: ETAPA 1 — IDENTIFICAÇÃO DE PROVENIÊNCIA E MIGRAÇÃO');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TESTE 1: Anime importado somente pelo AniList
// -----------------------------------------------------------------------------
const anilistEntry1: AniListAnimeEntry = {
  anilistId: 101,
  title: 'Frieren: Beyond Journey\'s End',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
  status: 'watching',
  currentEpisode: 14,
  totalEpisodes: 28,
  rating: 9.5,
  year: 2023,
  genres: ['Aventura', 'Fantasia'],
};

const resultAL = mergeAniListImport([anilistEntry1], [], true, 'test_user_anilist');
const importedAL = resultAL.mergedList[0];

const test1Passed =
  Boolean(importedAL) &&
  importedAL.provenance?.originProvider === 'anilist' &&
  importedAL.provenance?.accountIdentifier === 'test_user_anilist' &&
  importedAL.provenance?.anilistUsername === 'test_user_anilist' &&
  importedAL.provenance?.linkedProviders.includes('anilist') &&
  importedAL.provenance?.linkedProviders.length === 1 &&
  importedAL.provenance?.hasUserModifications === false;

recordTest(
  1,
  'Anime importado somente pelo AniList',
  test1Passed,
  `originProvider="${importedAL?.provenance?.originProvider}", account="${importedAL?.provenance?.accountIdentifier}", linked=[${importedAL?.provenance?.linkedProviders.join(', ')}]`
);

// -----------------------------------------------------------------------------
// TESTE 2: Anime importado somente pelo MAL
// -----------------------------------------------------------------------------
const malEntry1: MALAnimeEntry = {
  malId: 501,
  title: 'Vinland Saga Season 2',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/124312.jpg',
  status: 'completed',
  currentEpisode: 24,
  totalEpisodes: 24,
  rating: 9,
  year: 2023,
  genres: ['Ação', 'Drama'],
};

const resultMAL = mergeMALImport([malEntry1], [], true, 'test_user_mal');
const importedMAL = resultMAL.mergedList[0];

const test2Passed =
  Boolean(importedMAL) &&
  importedMAL.provenance?.originProvider === 'mal' &&
  importedMAL.provenance?.accountIdentifier === 'test_user_mal' &&
  importedMAL.provenance?.malUsername === 'test_user_mal' &&
  importedMAL.provenance?.linkedProviders.includes('mal') &&
  importedMAL.provenance?.linkedProviders.length === 1 &&
  importedMAL.provenance?.hasUserModifications === false;

recordTest(
  2,
  'Anime importado somente pelo MyAnimeList',
  test2Passed,
  `originProvider="${importedMAL?.provenance?.originProvider}", account="${importedMAL?.provenance?.accountIdentifier}", linked=[${importedMAL?.provenance?.linkedProviders.join(', ')}]`
);

// -----------------------------------------------------------------------------
// TESTE 3: Anime vinculado aos dois provedores (AniList + MAL)
// -----------------------------------------------------------------------------
// Cenário: anime começou importado pelo AniList, depois o usuário sincronizou o MAL com correspondência
const malEntryMatchingFrieren: MALAnimeEntry = {
  malId: 52991,
  anilistId: 101, // mesmo anilistId
  title: 'Frieren: Beyond Journey\'s End',
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
  status: 'watching',
  currentEpisode: 16,
  totalEpisodes: 28,
  rating: 10,
  year: 2023,
  genres: ['Aventura', 'Fantasia'],
};

const resultDual = mergeMALImport([malEntryMatchingFrieren], [importedAL], true, 'test_user_mal');
const dualLinkedItem = resultDual.mergedList[0];

const test3Passed =
  Boolean(dualLinkedItem) &&
  dualLinkedItem.id === importedAL.id && // ID original preservado sem duplicação
  dualLinkedItem.provenance?.originProvider === 'anilist' && // Origem original permanece como AniList
  dualLinkedItem.provenance?.anilistUsername === 'test_user_anilist' &&
  dualLinkedItem.provenance?.malUsername === 'test_user_mal' &&
  dualLinkedItem.provenance?.linkedProviders.includes('anilist') &&
  dualLinkedItem.provenance?.linkedProviders.includes('mal') &&
  dualLinkedItem.provenance?.linkedProviders.length === 2 &&
  dualLinkedItem.anilistId === 101 &&
  dualLinkedItem.malId === 52991;

recordTest(
  3,
  'Anime vinculado a ambos os provedores (AniList + MAL simultâneos)',
  test3Passed,
  `ID mantido="${dualLinkedItem?.id}", originProvider="${dualLinkedItem?.provenance?.originProvider}", linked=[${dualLinkedItem?.provenance?.linkedProviders.join(', ')}], anilistUser="${dualLinkedItem?.provenance?.anilistUsername}", malUser="${dualLinkedItem?.provenance?.malUsername}"`
);

// -----------------------------------------------------------------------------
// TESTE 4: Anime adicionado manualmente
// -----------------------------------------------------------------------------
const manualAnime = makeMockAnime('manual_custom_anime_001', 'Oshi no Ko', {
  status: 'watching',
  currentEpisode: 8,
  rating: 9,
});
const normalizedManual = normalizeAnimeProvenance(manualAnime);

const test4Passed =
  normalizedManual.provenance?.originProvider === 'manual' &&
  normalizedManual.provenance?.accountIdentifier === undefined &&
  normalizedManual.provenance?.linkedProviders.length === 0;

recordTest(
  4,
  'Anime manual criado localmente no Hikari',
  test4Passed,
  `originProvider="${normalizedManual.provenance?.originProvider}", linked=[${normalizedManual.provenance?.linkedProviders.join(', ')}]`
);

// -----------------------------------------------------------------------------
// TESTE 5: Anime com alterações manuais após importação
// -----------------------------------------------------------------------------
const modifiedItem = markAnimeLocallyModified({
  ...importedAL,
  currentEpisode: 20,
  rating: 10,
  isFavorite: true,
});

const test5Passed =
  modifiedItem.provenance?.originProvider === 'anilist' &&
  modifiedItem.provenance?.accountIdentifier === 'test_user_anilist' &&
  modifiedItem.provenance?.hasUserModifications === true &&
  typeof modifiedItem.provenance?.lastModifiedLocallyAtMs === 'number' &&
  modifiedItem.provenance?.lastModifiedLocallyAtMs > 0 &&
  modifiedItem.currentEpisode === 20 &&
  modifiedItem.isFavorite === true;

recordTest(
  5,
  'Anime com alterações manuais após importação (hasUserModifications)',
  test5Passed,
  `hasUserModifications=${modifiedItem.provenance?.hasUserModifications}, lastModifiedMs=${modifiedItem.provenance?.lastModifiedLocallyAtMs}`
);

// -----------------------------------------------------------------------------
// TESTE 6: Registro antigo sem origem comprovável (classificação conservadora)
// -----------------------------------------------------------------------------
const legacyAmbiguousAnime = makeMockAnime('ani_legacy_seed_42', 'Cowboy Bebop', {
  // Não possui prefixo ani_al_ ou ani_mal_, não possui provenance
  anilistId: undefined,
  malId: undefined,
});

const classifiedLegacy = normalizeAnimeProvenance(legacyAmbiguousAnime);

const test6Passed =
  classifiedLegacy.provenance?.originProvider === 'legacy_unknown' &&
  classifiedLegacy.provenance?.accountIdentifier === undefined && // Não inventa conta!
  classifiedLegacy.provenance?.linkedProviders.length === 0;

recordTest(
  6,
  'Registro antigo sem origem comprovável classificado conservadoramente',
  test6Passed,
  `originProvider="${classifiedLegacy.provenance?.originProvider}", accountIdentifier=${classifiedLegacy.provenance?.accountIdentifier}`
);

// -----------------------------------------------------------------------------
// TESTE 7: Migração em lote sem perda ou duplicação de dados
// -----------------------------------------------------------------------------
const legacyBatch: AnimeItem[] = [
  makeMockAnime('ani_al_9999_1700000_abcd', 'Attack on Titan', { anilistId: 9999 }),
  makeMockAnime('ani_mal_8888_1700000_wxyz', 'Death Note', { malId: 8888 }),
  makeMockAnime('manual_1234', 'Neon Genesis Evangelion'),
  makeMockAnime('ani_custom_seed_1', 'Fullmetal Alchemist: Brotherhood'),
  makeMockAnime('ani_custom_seed_2', 'Steins;Gate', { anilistId: 9253, malId: 9253 }),
];

const originalTitles = legacyBatch.map((a) => a.title);
const originalIds = legacyBatch.map((a) => a.id);

const migrationReport = migrateAnimeListProvenance(legacyBatch);

const test7Lossless =
  migrationReport.list.length === legacyBatch.length &&
  migrationReport.list.every((item, idx) => item.id === originalIds[idx] && item.title === originalTitles[idx]) &&
  migrationReport.migratedCount === 5 &&
  migrationReport.byOriginCount.anilist === 1 &&
  migrationReport.byOriginCount.mal === 1 &&
  migrationReport.byOriginCount.manual === 1 &&
  migrationReport.byOriginCount.legacy_unknown === 2; // os dois últimos sem prefixo comprovável

recordTest(
  7,
  'Migração de lote legado sem perda de dados ou duplicação',
  test7Lossless,
  `Total entrada=${legacyBatch.length}, Total saída=${migrationReport.list.length}, Migrados=${migrationReport.migratedCount}, Análise: AL=${migrationReport.byOriginCount.anilist}, MAL=${migrationReport.byOriginCount.mal}, Manual=${migrationReport.byOriginCount.manual}, LegacyUnknown=${migrationReport.byOriginCount.legacy_unknown}`
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
