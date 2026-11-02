import {
  normalizeAniListScore,
  calculateAniListImportPreview,
  mergeAniListImport,
  findMatchingExistingAnime,
  findMatchingAnimeInIndex,
  createExistingAnimeIndex,
  AniListAnimeEntry,
} from '../../services/anilistService.js';
import {
  normalizeMALScore,
  calculateMALImportPreview,
  mergeMALImport,
  findMatchingExistingAnimeForMAL,
  MALAnimeEntry,
} from '../../services/malService.js';
import { AnimeItem } from '../../types/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}`);
    failed++;
  }
}

function runScoreSyncTests() {
  console.log('\n======================================================');
  console.log('TESTES DE SINCRONIZAÇÃO DE NOTAS — ANILIST E MYANIMELIST');
  console.log('======================================================\n');

  // ------------------------------------------------------------------------
  // 1. Testes de Escala e Normalização de Notas - AniList
  // ------------------------------------------------------------------------
  console.log('--- 1. AniList: Escalas, Decimais e Ausência de Nota ---');
  
  // 1.1 Ausência de nota (0, nulo, indefinido, negativo)
  assert(normalizeAniListScore(0) === 0, 'AniList: Nota 0 é normalizada como 0 (ausência de nota)');
  assert(normalizeAniListScore(null) === 0, 'AniList: Nota null é normalizada como 0');
  assert(normalizeAniListScore(undefined) === 0, 'AniList: Nota undefined é normalizada como 0');
  assert(normalizeAniListScore(-1) === 0, 'AniList: Nota negativa é normalizada como 0');
  assert(normalizeAniListScore(NaN) === 0, 'AniList: Nota NaN é normalizada como 0');

  // 1.2 Notas válidas na escala 1 a 10
  assert(normalizeAniListScore(10) === 10, 'AniList: Nota 10 na escala 1-10 preservada como 10');
  assert(normalizeAniListScore(8) === 8, 'AniList: Nota inteira 8 preservada');
  assert(normalizeAniListScore(1) === 1, 'AniList: Nota mínima válida 1 preservada');
  assert(normalizeAniListScore(0.5) === 0.5, 'AniList: Nota fracionária 0.5 tratada como nota válida');

  // 1.3 Preservação de decimais sem arredondamento silencioso
  assert(normalizeAniListScore(8.5) === 8.5, 'AniList: Nota decimal 8.5 preservada exatamente');
  assert(normalizeAniListScore(8.75) === 8.75, 'AniList: Nota decimal 8.75 preservada sem arredondamento para 8.8');
  assert(normalizeAniListScore(7.2) === 7.2, 'AniList: Nota decimal 7.2 preservada');

  // 1.4 Conversão proporcional da escala 0-100 para 0-10
  assert(normalizeAniListScore(85) === 8.5, 'AniList: Nota 85/100 convertida proporcionalmente para 8.5');
  assert(normalizeAniListScore(100) === 10, 'AniList: Nota 100/100 convertida para 10');
  assert(normalizeAniListScore(73) === 7.3, 'AniList: Nota 73/100 convertida proporcionalmente para 7.3');
  assert(normalizeAniListScore(95.5) === 9.55, 'AniList: Nota fracionária 95.5/100 preserva decimais como 9.55');

  // ------------------------------------------------------------------------
  // 2. Testes de Escala e Normalização de Notas - MyAnimeList
  // ------------------------------------------------------------------------
  console.log('\n--- 2. MyAnimeList: Escalas, Decimais e Ausência de Nota ---');

  // 2.1 Ausência de nota (0, nulo, indefinido, negativo)
  assert(normalizeMALScore(0) === 0, 'MAL: Nota 0 é normalizada como 0 (ausência de nota)');
  assert(normalizeMALScore(null) === 0, 'MAL: Nota null é normalizada como 0');
  assert(normalizeMALScore(undefined) === 0, 'MAL: Nota undefined é normalizada como 0');
  assert(normalizeMALScore(-5) === 0, 'MAL: Nota negativa é normalizada como 0');
  assert(normalizeMALScore(NaN) === 0, 'MAL: Nota NaN é normalizada como 0');

  // 2.2 Notas válidas na escala oficial MAL (1 a 10 inteiros)
  assert(normalizeMALScore(10) === 10, 'MAL: Nota 10 preservada como 10');
  assert(normalizeMALScore(7) === 7, 'MAL: Nota inteira 7 preservada');
  assert(normalizeMALScore(1) === 1, 'MAL: Nota mínima 1 preservada');

  // 2.3 Suporte e preservação de decimais caso fornecidos
  assert(normalizeMALScore(8.5) === 8.5, 'MAL: Nota decimal 8.5 preservada');
  assert(normalizeMALScore(9.25) === 9.25, 'MAL: Nota decimal 9.25 preservada sem descarte');
  assert(normalizeMALScore(80) === 8, 'MAL: Nota 80/100 convertida proporcionalmente para 8');
  assert(normalizeMALScore(87) === 8.7, 'MAL: Nota 87/100 convertida proporcionalmente para 8.7');

  // ------------------------------------------------------------------------
  // 3. Testes de Sincronização e Prévia de Importação - MyAnimeList
  // ------------------------------------------------------------------------
  console.log('\n--- 3. MyAnimeList: Sincronização, Remoção de Nota (0) e Atualizações ---');

  const baseExistingAnimeMAL: AnimeItem = {
    id: 'anime_mal_test_1',
    malId: 5114,
    title: 'Fullmetal Alchemist: Brotherhood',
    posterUrl: 'https://example.com/fmab.jpg',
    status: 'completed',
    currentEpisode: 64,
    totalEpisodes: 64,
    rating: 9, // Nota atual no Hikari: 9
    isFavorite: true,
    year: 2009,
    genres: ['Action', 'Adventure'],
    rewatchCount: 2,
  };

  // 3.1 Remoção de nota na plataforma externa (incoming.rating = 0)
  const incomingRemovedScoreMAL: MALAnimeEntry = {
    malId: 5114,
    title: 'Fullmetal Alchemist: Brotherhood',
    posterUrl: 'https://example.com/fmab.jpg',
    status: 'completed',
    currentEpisode: 64,
    totalEpisodes: 64,
    rating: 0, // Usuário apagou a nota no MyAnimeList
    year: 2009,
    genres: ['Action', 'Adventure'],
  };

  const previewRemovedMAL = calculateMALImportPreview(
    [incomingRemovedScoreMAL],
    [baseExistingAnimeMAL],
    'test_user'
  );

  assert(previewRemovedMAL.itemsWithUpdates.length === 1, 'MAL Preview: Detecta que há atualização quando a nota é removida (0)');
  const ratingChangeMAL = previewRemovedMAL.itemsWithUpdates[0]?.changes.find((c) => c.field === 'rating');
  assert(Boolean(ratingChangeMAL), 'MAL Preview: Registra alteração no campo "rating"');
  assert(ratingChangeMAL?.oldVal === '9/10', 'MAL Preview: oldVal é "9/10"');
  assert(ratingChangeMAL?.newVal === 'Sem nota', 'MAL Preview: newVal é "Sem nota"');

  // Merge com remoção de nota
  const mergeResultRemovedMAL = mergeMALImport(
    [incomingRemovedScoreMAL],
    [baseExistingAnimeMAL],
    true
  );

  assert(mergeResultRemovedMAL.updatedCount === 1, 'MAL Merge: updatedCount incrementado na remoção da nota');
  const updatedAnimeRemovedMAL = mergeResultRemovedMAL.mergedList.find((a) => a.malId === 5114);
  assert(updatedAnimeRemovedMAL?.rating === 0, 'MAL Merge: Nota do anime atualizada com sucesso para 0 ("Sem nota")');
  assert(updatedAnimeRemovedMAL?.isFavorite === true, 'MAL Merge: Favorito manual preservado');
  assert(updatedAnimeRemovedMAL?.rewatchCount === 2, 'MAL Merge: Contagem de rewatch preservada');

  // 3.2 Atualização de nota (de 9 para 10)
  const incomingUpdatedScoreMAL: MALAnimeEntry = {
    malId: 5114,
    title: 'Fullmetal Alchemist: Brotherhood',
    posterUrl: 'https://example.com/fmab.jpg',
    status: 'completed',
    currentEpisode: 64,
    totalEpisodes: 64,
    rating: 10, // Nota alterada para 10
    year: 2009,
    genres: ['Action', 'Adventure'],
  };

  const previewUpdatedMAL = calculateMALImportPreview(
    [incomingUpdatedScoreMAL],
    [baseExistingAnimeMAL],
    'test_user'
  );
  assert(previewUpdatedMAL.itemsWithUpdates.length === 1, 'MAL Preview: Detecta atualização de nota válida');
  const changeScoreUpdatedMAL = previewUpdatedMAL.itemsWithUpdates[0]?.changes.find((c) => c.field === 'rating');
  assert(changeScoreUpdatedMAL?.oldVal === '9/10' && changeScoreUpdatedMAL?.newVal === '10/10', 'MAL Preview: Exibe transição correta de 9/10 para 10/10');

  const mergeResultUpdatedMAL = mergeMALImport(
    [incomingUpdatedScoreMAL],
    [baseExistingAnimeMAL],
    true
  );
  const updatedAnimeScoreMAL = mergeResultUpdatedMAL.mergedList.find((a) => a.malId === 5114);
  assert(updatedAnimeScoreMAL?.rating === 10, 'MAL Merge: Nota atualizada com sucesso para 10');

  // 3.3 Importação de nota para anime anteriormente sem nota (0 para 8.5)
  const baseUnratedAnimeMAL: AnimeItem = {
    ...baseExistingAnimeMAL,
    id: 'anime_mal_unrated',
    rating: 0,
  };
  const incomingNewScoreMAL: MALAnimeEntry = {
    ...incomingUpdatedScoreMAL,
    rating: 8.5,
  };
  const previewNewScoreMAL = calculateMALImportPreview(
    [incomingNewScoreMAL],
    [baseUnratedAnimeMAL],
    'test_user'
  );
  const changeNewScoreMAL = previewNewScoreMAL.itemsWithUpdates[0]?.changes.find((c) => c.field === 'rating');
  assert(changeNewScoreMAL?.oldVal === 'Sem nota', 'MAL Preview: Anime sem nota anterior mostra "Sem nota" em oldVal');
  assert(changeNewScoreMAL?.newVal === '8.5/10', 'MAL Preview: Nova nota mostra "8.5/10" em newVal');

  const mergeNewScoreMAL = mergeMALImport([incomingNewScoreMAL], [baseUnratedAnimeMAL], true);
  assert(mergeNewScoreMAL.mergedList[0].rating === 8.5, 'MAL Merge: Nota decimal 8.5 gravada no anime');

  // 3.4 Ambas sem nota (0 -> 0): Não deve gerar alteração espúria
  const incomingZeroMAL: MALAnimeEntry = {
    ...incomingUpdatedScoreMAL,
    rating: 0,
  };
  const previewBothZeroMAL = calculateMALImportPreview(
    [incomingZeroMAL],
    [baseUnratedAnimeMAL],
    'test_user'
  );
  assert(previewBothZeroMAL.itemsWithUpdates.length === 0, 'MAL Preview: Ambas sem nota (0 -> 0) não geram alteração espúria');

  // ------------------------------------------------------------------------
  // 4. Testes de Sincronização e Prévia de Importação - AniList
  // ------------------------------------------------------------------------
  console.log('\n--- 4. AniList: Sincronização, Remoção de Nota (0) e Atualizações ---');

  const baseExistingAnimeAniList: AnimeItem = {
    id: 'anime_al_test_1',
    anilistId: 16498,
    title: 'Shingeki no Kyojin',
    posterUrl: 'https://example.com/aot.jpg',
    status: 'completed',
    currentEpisode: 25,
    totalEpisodes: 25,
    rating: 8.5,
    isFavorite: true,
    year: 2013,
    genres: ['Action', 'Drama'],
    rewatchCount: 1,
  };

  // 4.1 Remoção de nota na plataforma externa (incoming.rating = 0)
  const incomingRemovedScoreAL: AniListAnimeEntry = {
    anilistId: 16498,
    title: 'Shingeki no Kyojin',
    posterUrl: 'https://example.com/aot.jpg',
    status: 'completed',
    currentEpisode: 25,
    totalEpisodes: 25,
    rating: 0, // Removida no AniList
    year: 2013,
    genres: ['Action', 'Drama'],
  };

  const previewRemovedAL = calculateAniListImportPreview(
    [incomingRemovedScoreAL],
    [baseExistingAnimeAniList],
    'test_user'
  );

  assert(previewRemovedAL.itemsWithUpdates.length === 1, 'AniList Preview: Detecta atualização quando a nota é removida');
  const ratingChangeAL = previewRemovedAL.itemsWithUpdates[0]?.changes.find((c) => c.field === 'rating');
  assert(Boolean(ratingChangeAL), 'AniList Preview: Registra alteração no campo "rating"');
  assert(ratingChangeAL?.oldVal === '8.5/10', 'AniList Preview: oldVal é "8.5/10"');
  assert(ratingChangeAL?.newVal === 'Sem nota', 'AniList Preview: newVal é "Sem nota"');

  const mergeResultRemovedAL = mergeAniListImport(
    [incomingRemovedScoreAL],
    [baseExistingAnimeAniList],
    true
  );

  assert(mergeResultRemovedAL.updatedCount === 1, 'AniList Merge: updatedCount incrementado na remoção');
  const updatedAnimeRemovedAL = mergeResultRemovedAL.mergedList.find((a) => a.anilistId === 16498);
  assert(updatedAnimeRemovedAL?.rating === 0, 'AniList Merge: Nota atualizada com sucesso para 0');
  assert(updatedAnimeRemovedAL?.isFavorite === true, 'AniList Merge: Favorito manual preservado');
  assert(updatedAnimeRemovedAL?.rewatchCount === 1, 'AniList Merge: Contagem de rewatch preservada');

  // 4.2 Atualização de nota com casas decimais (de 8.5 para 9.3)
  const incomingUpdatedScoreAL: AniListAnimeEntry = {
    anilistId: 16498,
    title: 'Shingeki no Kyojin',
    posterUrl: 'https://example.com/aot.jpg',
    status: 'completed',
    currentEpisode: 25,
    totalEpisodes: 25,
    rating: 9.3,
    year: 2013,
    genres: ['Action', 'Drama'],
  };

  const previewUpdatedAL = calculateAniListImportPreview(
    [incomingUpdatedScoreAL],
    [baseExistingAnimeAniList],
    'test_user'
  );
  assert(previewUpdatedAL.itemsWithUpdates.length === 1, 'AniList Preview: Detecta nota decimal atualizada');
  const changeScoreUpdatedAL = previewUpdatedAL.itemsWithUpdates[0]?.changes.find((c) => c.field === 'rating');
  assert(changeScoreUpdatedAL?.oldVal === '8.5/10' && changeScoreUpdatedAL?.newVal === '9.3/10', 'AniList Preview: 8.5/10 -> 9.3/10');

  const mergeResultUpdatedAL = mergeAniListImport(
    [incomingUpdatedScoreAL],
    [baseExistingAnimeAniList],
    true
  );
  assert(mergeResultUpdatedAL.mergedList[0].rating === 9.3, 'AniList Merge: Nota decimal 9.3 gravada sem perdas');

  // ------------------------------------------------------------------------
  // 5. Testes de Priorização de Identificadores e Rejeição de Conflitos
  // ------------------------------------------------------------------------
  console.log('\n--- 5. Identificadores Confiáveis e Rejeição de Falsos Positivos de Título ---');

  // 5.1 Priorização de IDs externos confiáveis
  const existingListWithIDs: AnimeItem[] = [
    {
      id: 'existing_1',
      anilistId: 100,
      malId: 200,
      title: 'Anime Alpha Original',
      posterUrl: '',
      status: 'watching',
      currentEpisode: 5,
      totalEpisodes: 12,
      rating: 7,
      isFavorite: false,
      year: 2020,
      genres: [],
    },
    {
      id: 'existing_2',
      anilistId: 101,
      malId: 201,
      title: 'Anime Beta',
      posterUrl: '',
      status: 'completed',
      currentEpisode: 24,
      totalEpisodes: 24,
      rating: 8,
      isFavorite: false,
      year: 2021,
      genres: [],
    },
  ];

  const index = createExistingAnimeIndex(existingListWithIDs);

  // Busca por AniList ID
  const matchByAniId = findMatchingAnimeInIndex(
    { anilistId: 100, title: 'Título Totalmente Diferente' },
    index,
    'anilist_first'
  );
  assert(matchByAniId?.id === 'existing_1', 'Identificação prioritária por anilistId prevalece mesmo com títulos diferentes');

  // Busca por MAL ID
  const matchByMalId = findMatchingAnimeInIndex(
    { malId: 201, title: 'Outro Título' },
    index,
    'mal_first'
  );
  assert(matchByMalId?.id === 'existing_2', 'Identificação prioritária por malId prevalece com sucesso');

  // 5.2 Rejeição de correspondência por título quando IDs externos são conflitantes
  // Exemplo: Hunter x Hunter 1999 (malId: 136) vs Hunter x Hunter 2011 (malId: 11061)
  const hunter1999: AnimeItem = {
    id: 'hxh_1999',
    malId: 136,
    anilistId: 136,
    title: 'Hunter x Hunter',
    posterUrl: '',
    status: 'completed',
    currentEpisode: 62,
    totalEpisodes: 62,
    rating: 8,
    isFavorite: false,
    year: 1999,
    genres: ['Action'],
  };

  const hunterIndex = createExistingAnimeIndex([hunter1999]);

  const hunter2011Incoming: MALAnimeEntry = {
    malId: 11061,
    title: 'Hunter x Hunter',
    posterUrl: '',
    status: 'watching',
    currentEpisode: 100,
    totalEpisodes: 148,
    rating: 10,
    year: 2011,
    genres: ['Action'],
  };

  const matchHunterMAL = findMatchingExistingAnimeForMAL(hunter2011Incoming, [hunter1999], hunterIndex);
  assert(matchHunterMAL === undefined, 'MAL: Impede associação indevida por mesmo título quando IDs do MAL são conflitantes');

  const hunter2011AniList: AniListAnimeEntry = {
    anilistId: 11061,
    malId: 11061,
    title: 'Hunter x Hunter',
    posterUrl: '',
    status: 'watching',
    currentEpisode: 100,
    totalEpisodes: 148,
    rating: 10,
    year: 2011,
    genres: ['Action'],
  };

  const matchHunterAL = findMatchingExistingAnime(hunter2011AniList, [hunter1999], hunterIndex);
  assert(matchHunterAL === undefined, 'AniList: Impede associação indevida por mesmo título quando IDs do AniList são conflitantes');

  // 5.3 Correspondência por título como alternativa legítima quando não há conflito de IDs
  const manualAnimeWithoutExternalId: AnimeItem = {
    id: 'manual_frieren',
    title: 'Sousou no Frieren',
    posterUrl: '',
    status: 'watching',
    currentEpisode: 10,
    totalEpisodes: 28,
    rating: 0,
    isFavorite: true,
    year: 2023,
    genres: ['Fantasy'],
  };

  const manualIndex = createExistingAnimeIndex([manualAnimeWithoutExternalId]);

  const frierenIncoming: AniListAnimeEntry = {
    anilistId: 154587,
    malId: 52991,
    title: 'Sousou no Frieren',
    posterUrl: 'https://example.com/frieren.jpg',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 9.8,
    year: 2023,
    genres: ['Fantasy'],
  };

  const matchFrieren = findMatchingExistingAnime(frierenIncoming, [manualAnimeWithoutExternalId], manualIndex);
  assert(matchFrieren?.id === 'manual_frieren', 'Correspondência por título permitida quando o anime local é manual e não possui ID conflitante');

  const mergedFrieren = mergeAniListImport([frierenIncoming], [manualAnimeWithoutExternalId], true);
  assert(mergedFrieren.mergedList[0].anilistId === 154587, 'Vincula anilistId ao anime manual');
  assert(mergedFrieren.mergedList[0].malId === 52991, 'Vincula malId ao anime manual');
  assert(mergedFrieren.mergedList[0].rating === 9.8, 'Sincroniza nota 9.8 para o anime manual vinculado');
  assert(mergedFrieren.mergedList[0].isFavorite === true, 'Preserva favorito manual do anime');

  // ------------------------------------------------------------------------
  // Sumário Final
  // ------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`RESULTADO DOS TESTES: ${passed} passaram, ${failed} falharam.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runScoreSyncTests();
