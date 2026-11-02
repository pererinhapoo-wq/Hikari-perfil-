import {
  mergeMALImport,
  findMatchingExistingAnimeForMAL,
  type MALAnimeEntry,
} from '../../services/malService';
import {
  mergeAniListImport,
  findMatchingExistingAnime,
  findMatchingAnimeInIndex,
  createExistingAnimeIndex,
  type AniListAnimeEntry,
} from '../../services/anilistService';
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

function makeTestAnime(
  id: string,
  title: string,
  year: number,
  overrides?: Partial<AnimeItem>
): AnimeItem {
  return {
    id,
    title,
    titleRomaji: title,
    posterUrl: `https://example.com/posters/${id}.jpg`,
    status: 'completed',
    currentEpisode: 12,
    totalEpisodes: 12,
    rating: 8.5,
    isFavorite: false,
    year,
    genres: ['Ação'],
    ...overrides,
  };
}

async function runAllTests() {
  console.log('========================================================================');
  console.log('HIKARI PERFIL — SUÍTE DE TESTES: IDENTIFICAÇÃO ANTI-COLISÃO POR TÍTULO E ANO');
  console.log('========================================================================\n');

  // CENÁRIO 01: Registros com mesmo título e anos diferentes sem IDs externos mantidos separados
  try {
    const anime2018 = makeTestAnime('local_example_2018', 'Example', 2018, {
      rating: 9.0,
      isFavorite: true,
      currentEpisode: 24,
      totalEpisodes: 24,
    });

    const incoming2024: MALAnimeEntry = {
      malId: 0, // sem ID externo oficial
      title: 'Example',
      posterUrl: 'https://example.com/example_2024.jpg',
      status: 'watching',
      currentEpisode: 5,
      totalEpisodes: 12,
      rating: 8.0,
      year: 2024,
      genres: ['Sci-Fi'],
    };

    const matchDirect = findMatchingExistingAnimeForMAL(incoming2024, [anime2018]);
    const mergeRes = mergeMALImport([incoming2024], [anime2018], true);

    const pass =
      matchDirect === undefined &&
      mergeRes.mergedList.length === 2 &&
      mergeRes.addedCount === 1 &&
      mergeRes.updatedCount === 0 &&
      mergeRes.mergedList.some((a) => a.id === 'local_example_2018' && a.year === 2018 && a.rating === 9.0) &&
      mergeRes.mergedList.some((a) => a.year === 2024 && a.currentEpisode === 5);

    recordTest(
      1,
      'Mesmo título e anos diferentes sem IDs externos mantidos estritamente separados',
      pass,
      `Anime A (2018) e Anime B (2024) não colidiram (total na lista: ${mergeRes.mergedList.length}, novos: ${mergeRes.addedCount})`
    );
  } catch (err) {
    recordTest(1, 'Mesmo título e anos diferentes sem IDs externos', false, String(err));
  }

  // CENÁRIO 02: Registros com mesmo título e mesmo ano sem IDs externos mesclados corretamente
  try {
    const existingAnime = makeTestAnime('local_same_year_01', 'Example', 2024, {
      status: 'watching',
      currentEpisode: 3,
      rating: 0,
      isFavorite: true,
    });

    const incomingSameYear: AniListAnimeEntry = {
      anilistId: 0,
      title: 'Example',
      posterUrl: 'https://cdn.anilist.co/example_2024.jpg',
      status: 'completed',
      currentEpisode: 12,
      totalEpisodes: 12,
      rating: 8.8,
      year: 2024,
      genres: ['Fantasy'],
    };

    const matchDirect = findMatchingExistingAnime(incomingSameYear, [existingAnime]);
    const mergeRes = mergeAniListImport([incomingSameYear], [existingAnime], true);

    const pass =
      matchDirect !== undefined &&
      matchDirect.id === 'local_same_year_01' &&
      mergeRes.mergedList.length === 1 &&
      mergeRes.updatedCount === 1 &&
      mergeRes.addedCount === 0 &&
      mergeRes.mergedList[0].id === 'local_same_year_01' &&
      mergeRes.mergedList[0].status === 'completed' &&
      mergeRes.mergedList[0].currentEpisode === 12 &&
      mergeRes.mergedList[0].rating === 8.8 &&
      mergeRes.mergedList[0].isFavorite === true; // favorito manual preservado

    recordTest(
      2,
      'Mesmo título e mesmo ano sem IDs externos mesclados com sucesso sem duplicatas',
      pass,
      `Registro unificado no ID interno original: ${mergeRes.mergedList[0]?.id} (status: ${mergeRes.mergedList[0]?.status}, nota: ${mergeRes.mergedList[0]?.rating})`
    );
  } catch (err) {
    recordTest(2, 'Mesmo título e mesmo ano sem IDs externos', false, String(err));
  }

  // CENÁRIO 03: Identificador prioritário malId prevalece sobre título e ano
  try {
    const existing = makeTestAnime('local_mal_prio', 'Attack on Titan Season 1', 2013, {
      malId: 16498,
      rating: 9.0,
      isFavorite: true,
    });

    // Entrada com título em inglês alternativo e ano ligeiramente divergente (ex: re-release)
    const incoming: MALAnimeEntry = {
      malId: 16498,
      title: 'Shingeki no Kyojin',
      posterUrl: 'https://cdn.myanimelist.net/aot.jpg',
      status: 'completed',
      currentEpisode: 25,
      totalEpisodes: 25,
      rating: 9.2,
      year: 2014,
      genres: ['Action'],
    };

    const index = createExistingAnimeIndex([existing]);
    const match = findMatchingAnimeInIndex(incoming, index, 'mal_first');
    const mergeRes = mergeMALImport([incoming], [existing], true);

    const pass =
      match !== undefined &&
      match.id === 'local_mal_prio' &&
      mergeRes.mergedList.length === 1 &&
      mergeRes.mergedList[0].id === 'local_mal_prio' &&
      mergeRes.mergedList[0].rating === 9.2 &&
      mergeRes.mergedList[0].isFavorite === true;

    recordTest(
      3,
      'Identificador prioritário malId prevalece sobre título e ano',
      pass,
      `Vínculo exato pelo malId=16498 prevaleceu sobre divergências secundárias de metadados`
    );
  } catch (err) {
    recordTest(3, 'Prioridade malId', false, String(err));
  }

  // CENÁRIO 04: Identificador prioritário anilistId prevalece sobre título e ano
  try {
    const existing = makeTestAnime('local_al_prio', 'Demon Slayer: Entertainment District Arc', 2021, {
      anilistId: 129874,
      rating: 8.9,
      isFavorite: true,
    });

    const incoming: AniListAnimeEntry = {
      anilistId: 129874,
      title: 'Kimetsu no Yaiba: Yuukaku-hen',
      posterUrl: 'https://cdn.anilist.co/kny.jpg',
      status: 'completed',
      currentEpisode: 11,
      totalEpisodes: 11,
      rating: 9.3,
      year: 2022,
      genres: ['Action', 'Demons'],
    };

    const index = createExistingAnimeIndex([existing]);
    const match = findMatchingAnimeInIndex(incoming, index, 'anilist_first');
    const mergeRes = mergeAniListImport([incoming], [existing], true);

    const pass =
      match !== undefined &&
      match.id === 'local_al_prio' &&
      mergeRes.mergedList.length === 1 &&
      mergeRes.mergedList[0].id === 'local_al_prio' &&
      mergeRes.mergedList[0].rating === 9.3 &&
      mergeRes.mergedList[0].isFavorite === true;

    recordTest(
      4,
      'Identificador prioritário anilistId prevalece sobre título e ano',
      pass,
      `Vínculo exato pelo anilistId=129874 prevaleceu sobre variação romaji/inglês`
    );
  } catch (err) {
    recordTest(4, 'Prioridade anilistId', false, String(err));
  }

  // CENÁRIO 05: Registros com mesmo título mas IDs externos conflitantes são rejeitados
  try {
    const hunter1999 = makeTestAnime('local_hxh_1999', 'Hunter x Hunter', 1999, {
      malId: 136,
      anilistId: 136,
    });

    // Entrada de 2011 que compartilhe o mesmo título base "Hunter x Hunter", mas com malId diferente
    const hunter2011: MALAnimeEntry = {
      malId: 11061,
      anilistId: 11061,
      title: 'Hunter x Hunter',
      posterUrl: 'https://cdn.myanimelist.net/hxh2011.jpg',
      status: 'watching',
      currentEpisode: 50,
      totalEpisodes: 148,
      rating: 9.5,
      year: 2011,
      genres: ['Adventure'],
    };

    const match = findMatchingExistingAnimeForMAL(hunter2011, [hunter1999]);
    const mergeRes = mergeMALImport([hunter2011], [hunter1999], true);

    const pass =
      match === undefined &&
      mergeRes.mergedList.length === 2 &&
      mergeRes.mergedList.some((a) => a.id === 'local_hxh_1999' && a.malId === 136) &&
      mergeRes.mergedList.some((a) => a.malId === 11061 && a.currentEpisode === 50);

    recordTest(
      5,
      'Mesmo título com IDs externos conflitantes rejeita correspondência',
      pass,
      `Hunter x Hunter (1999, id: 136) e Hunter x Hunter (2011, id: 11061) preservados como obras distintas`
    );
  } catch (err) {
    recordTest(5, 'IDs externos conflitantes', false, String(err));
  }

  // CENÁRIO 06: Registros sem ano (ano 0 / indefinido) não geram colisões nem anos inventados
  try {
    const legacyNoYear = makeTestAnime('local_legacy_001', 'Serial Experiments Lain', 0, {
      status: 'completed',
      rating: 9.4,
      isFavorite: true,
    });

    const incomingNoYear: MALAnimeEntry = {
      malId: 0,
      title: 'Serial Experiments Lain',
      posterUrl: 'https://example.com/lain.jpg',
      status: 'completed',
      currentEpisode: 13,
      totalEpisodes: 13,
      rating: 9.4,
      year: 0, // sem ano
      genres: ['Sci-Fi', 'Psychological'],
    };

    const match = findMatchingExistingAnimeForMAL(incomingNoYear, [legacyNoYear]);
    const mergeRes = mergeMALImport([incomingNoYear], [legacyNoYear], true);

    const pass =
      match !== undefined &&
      match.id === 'local_legacy_001' &&
      mergeRes.mergedList.length === 1 &&
      mergeRes.mergedList[0].id === 'local_legacy_001' &&
      mergeRes.mergedList[0].year === 0 && // não inventou um ano arbitrário
      mergeRes.mergedList[0].isFavorite === true;

    recordTest(
      6,
      'Registros sem ano são compatíveis retroativamente e não têm anos inventados',
      pass,
      `Registro legado recuperado com ID intacto (${mergeRes.mergedList[0]?.id}) e ano preservado como 0`
    );
  } catch (err) {
    recordTest(6, 'Registros sem ano', false, String(err));
  }

  // CENÁRIO 07: Confronto ambíguo de múltiplos candidatos sem ano não é associado automaticamente
  try {
    const candidateA = makeTestAnime('local_amb_1', 'Kino no Tabi', 0, { status: 'completed' });
    const candidateB = makeTestAnime('local_amb_2', 'Kino no Tabi', 0, { status: 'dropped' });

    const incomingAmb: MALAnimeEntry = {
      malId: 0,
      title: 'Kino no Tabi',
      posterUrl: 'https://example.com/kino.jpg',
      status: 'watching',
      currentEpisode: 4,
      totalEpisodes: 12,
      rating: 8.0,
      year: 0,
      genres: ['Adventure'],
    };

    const index = createExistingAnimeIndex([candidateA, candidateB]);
    const match = findMatchingAnimeInIndex(incomingAmb, index, 'mal_first');
    const mergeRes = mergeMALImport([incomingAmb], [candidateA, candidateB], true);

    const pass =
      match === undefined &&
      mergeRes.mergedList.length === 3 && // adicionou como novo registro separado por ambiguidade
      mergeRes.addedCount === 1;

    recordTest(
      7,
      'Múltiplos candidatos sem ano com mesmo título não são associados por ambiguidade',
      pass,
      `Detectada ambiguidade entre múltiplos candidatos; evitou associação errônea automática`
    );
  } catch (err) {
    recordTest(7, 'Ambiguidade sem ano', false, String(err));
  }

  // CENÁRIO 08: Confronto entre registro com ano conhecido e registro sem ano não é associado
  try {
    // Usuário tem uma adaptação com ano conhecido (2018)
    const existingWithYear = makeTestAnime('local_known_year', 'Persona 5', 2018, {
      status: 'completed',
      rating: 8.5,
    });

    // Entrada externa recebida sem informação de ano
    const incomingWithoutYear: AniListAnimeEntry = {
      anilistId: 0,
      title: 'Persona 5',
      posterUrl: 'https://example.com/p5.jpg',
      status: 'watching',
      currentEpisode: 2,
      totalEpisodes: 26,
      rating: 8.0,
      year: 0, // ano ausente
      genres: ['Action'],
    };

    const match = findMatchingExistingAnime(incomingWithoutYear, [existingWithYear]);
    const mergeRes = mergeAniListImport([incomingWithoutYear], [existingWithYear], true);

    const pass =
      match === undefined &&
      mergeRes.mergedList.length === 2 &&
      mergeRes.mergedList.some((a) => a.id === 'local_known_year' && a.year === 2018) &&
      mergeRes.mergedList.some((a) => a.year === 0 && a.currentEpisode === 2);

    recordTest(
      8,
      'Confronto entre registro com ano conhecido e entrada sem ano não colide',
      pass,
      `Ano conhecido (2018) não foi sobrescrito por entrada ambígua sem ano (total: 2 itens)`
    );
  } catch (err) {
    recordTest(8, 'Confronto ano conhecido vs sem ano', false, String(err));
  }

  // CENÁRIO 09: Preservação integral de campos locais no Hikari durante o merge
  try {
    const manualCustomAnime = makeTestAnime('local_custom_frieren_101', 'Sousou no Frieren', 2023, {
      rating: 9.75, // nota decimal personalizada
      isFavorite: true,
      currentEpisode: 14,
      totalEpisodes: 28,
      status: 'watching',
      posterUrl: 'https://example.com/custom_manual_art.png', // capa manual
      rewatchCount: 2,
    });

    const incomingFrieren: AniListAnimeEntry = {
      anilistId: 154587,
      malId: 52991,
      title: 'Sousou no Frieren',
      posterUrl: 'https://cdn.anilist.co/frieren_official.jpg',
      status: 'watching',
      currentEpisode: 14,
      totalEpisodes: 28,
      rating: 9.8,
      year: 2023,
      genres: ['Fantasy', 'Drama'],
      isFavorite: false, // entrada externa não favorita
      rewatchCount: 0,
    };

    const mergeRes = mergeAniListImport([incomingFrieren], [manualCustomAnime], true);
    const mergedItem = mergeRes.mergedList[0];

    const pass =
      mergeRes.mergedList.length === 1 &&
      mergedItem.id === 'local_custom_frieren_101' && // ID interno mantido
      mergedItem.isFavorite === true && // favorito manual mantido
      mergedItem.posterUrl === 'https://example.com/custom_manual_art.png' && // capa personalizada mantida
      mergedItem.anilistId === 154587 && // vinculado com segurança
      mergedItem.malId === 52991 && // vinculado com segurança
      mergedItem.year === 2023;

    recordTest(
      9,
      'Preservação integral de campos locais no Hikari (IDs, notas, favoritos, capas manuais)',
      pass,
      `ID=${mergedItem.id}, isFavorite=${mergedItem.isFavorite}, capaManual=${mergedItem.posterUrl.includes('custom_manual_art')}`
    );
  } catch (err) {
    recordTest(9, 'Preservação de campos locais', false, String(err));
  }

  // CENÁRIO 10: Determinismo estrito e consistência em múltiplos lotes sequenciais de importação
  try {
    const baseList: AnimeItem[] = [
      makeTestAnime('local_det_1', 'Fate/Stay Night', 2006),
      makeTestAnime('local_det_2', 'Fate/Stay Night: Unlimited Blade Works', 2014),
      makeTestAnime('local_det_3', 'Fate/Stay Night: Heaven\'s Feel', 2017),
    ];

    const batch1: MALAnimeEntry[] = [
      {
        malId: 356,
        title: 'Fate/Stay Night',
        posterUrl: 'https://cdn.myanimelist.net/fsn.jpg',
        status: 'completed',
        currentEpisode: 24,
        totalEpisodes: 24,
        rating: 8.0,
        year: 2006,
        genres: ['Action', 'Fantasy'],
      },
    ];

    const batch2: MALAnimeEntry[] = [
      {
        malId: 22297,
        title: 'Fate/Stay Night: Unlimited Blade Works',
        posterUrl: 'https://cdn.myanimelist.net/ubw.jpg',
        status: 'completed',
        currentEpisode: 12,
        totalEpisodes: 12,
        rating: 9.0,
        year: 2014,
        genres: ['Action', 'Fantasy'],
      },
      // Repetição do batch 1 no mesmo lote 2 para testar idempotência de lote
      {
        malId: 356,
        title: 'Fate/Stay Night',
        posterUrl: 'https://cdn.myanimelist.net/fsn.jpg',
        status: 'completed',
        currentEpisode: 24,
        totalEpisodes: 24,
        rating: 8.0,
        year: 2006,
        genres: ['Action', 'Fantasy'],
      },
    ];

    // Execução sequencial dos lotes
    const res1 = mergeMALImport(batch1, baseList, true);
    const res2 = mergeMALImport(batch2, res1.mergedList, true);

    const pass =
      res1.mergedList.length === 3 &&
      res2.mergedList.length === 3 &&
      res2.addedCount === 0 &&
      res2.mergedList[0].id === 'local_det_1' &&
      res2.mergedList[0].malId === 356 &&
      res2.mergedList[1].id === 'local_det_2' &&
      res2.mergedList[1].malId === 22297 &&
      res2.mergedList[2].id === 'local_det_3';

    recordTest(
      10,
      'Determinismo estrito e consistência em múltiplos lotes sequenciais de importação',
      pass,
      `Ordem e integridade de 3 obras da franquia preservadas sem duplicações através de lotes múltiplos`
    );
  } catch (err) {
    recordTest(10, 'Determinismo sequencial', false, String(err));
  }

  // SUMÁRIO FINAL
  const passedCount = testResults.filter((t) => t.passed).length;
  const failedCount = testResults.filter((t) => !t.passed).length;

  console.log('\n========================================================================');
  console.log(`RESULTADO DA ETAPA 3: ${passedCount}/${testResults.length} TESTES PASSARAM`);
  if (failedCount === 0) {
    console.log('STATUS GERAL: ✅ ETAPA 3 VALIDADA COM SUCESSO (TODOS OS 10 TESTES APROVADOS)');
  } else {
    console.log(`STATUS GERAL: ❌ EXISTEM ${failedCount} FALHAS NOS TESTES`);
  }
  console.log('========================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Erro fatal na suíte de testes da Etapa 3:', err);
  process.exit(1);
});
