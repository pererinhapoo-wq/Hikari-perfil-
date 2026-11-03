import {
  identifyAnimeProviderAffinity,
  pruneAnimesOnDisconnect,
  type DisconnectPruneResult,
} from '../../utils/animeDisconnection';
import {
  writeLocalUserWorkspace,
  readLocalUserWorkspace,
  createEmptyUserWorkspace,
  getUserWorkspaceStorageKey,
  hydrateWorkspaceFromIndexedDb,
} from '../../lib/userWorkspaceStorage';
import {
  saveAnimesToIndexedDb,
  getAnimesFromIndexedDb,
  STORES,
} from '../../lib/indexedDbStorage';
import {
  saveImportCheckpoint,
  getImportCheckpoint,
  clearImportCheckpoint,
  saveImportCheckpointAsync,
  clearImportCheckpointAsync,
  type ImportCheckpoint,
} from '../../services/importSyncManager';
import {
  recordExternalSyncSuccess,
  clearExternalSyncCooldown,
  getLastExternalSyncTimestamp,
} from '../../utils/syncCooldown';
import { createAnimeProvenance } from '../../utils/animeProvenance';
import type { AnimeItem, UserProfile } from '../../types';

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

// Mock de localStorage para simulação isolada em ambiente Node/tsx
class MockLocalStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof window === 'undefined' || !window.localStorage) {
  const mockStorage = new MockLocalStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: mockStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

console.log('========================================================================');
console.log('SUÍTE DE TESTES: DESCONEXÃO ANILIST E MYANIMELIST (HIKARI PERFIL)');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TESTE 01: 300 animes importados do AniList: desconectar AniList remove os 300
// -----------------------------------------------------------------------------
const anilist300: AnimeItem[] = [];
for (let i = 1; i <= 300; i++) {
  anilist300.push(
    makeMockAnime(`ani_al_${1000 + i}_${Date.now()}_u${i}`, `AniList Show ${i}`, {
      anilistId: 1000 + i,
      posterUrl: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${1000 + i}.jpg`,
      provenance: createAnimeProvenance('anilist', {
        accountIdentifier: 'otaku_al',
        anilistUsername: 'otaku_al',
        linkedProviders: ['anilist'],
      }),
    })
  );
}

const audit1 = pruneAnimesOnDisconnect(anilist300, 'anilist', 'otaku_al');
const test1Passed =
  audit1.removedCount === 300 &&
  audit1.nextAnimes.length === 0 &&
  audit1.removedAnimeIds.length === 300;

recordTest(
  1,
  '300 animes importados do AniList: desconectar AniList remove os 300',
  test1Passed,
  `removidos=${audit1.removedCount}/300, restantes=${audit1.nextAnimes.length}`
);

// -----------------------------------------------------------------------------
// TESTE 02: 300 animes importados do MAL: desconectar MAL remove os 300
// -----------------------------------------------------------------------------
const mal300: AnimeItem[] = [];
for (let i = 1; i <= 300; i++) {
  mal300.push(
    makeMockAnime(`ani_mal_${5000 + i}_${Date.now()}_m${i}`, `MAL Show ${i}`, {
      malId: 5000 + i,
      posterUrl: `https://cdn.myanimelist.net/images/anime/${5000 + i}.jpg`,
      provenance: createAnimeProvenance('mal', {
        accountIdentifier: 'otaku_mal',
        malUsername: 'otaku_mal',
        linkedProviders: ['mal'],
      }),
    })
  );
}

const audit2 = pruneAnimesOnDisconnect(mal300, 'mal', 'otaku_mal');
const test2Passed =
  audit2.removedCount === 300 &&
  audit2.nextAnimes.length === 0 &&
  audit2.removedAnimeIds.length === 300;

recordTest(
  2,
  '300 animes importados do MAL: desconectar MAL remove os 300',
  test2Passed,
  `removidos=${audit2.removedCount}/300, restantes=${audit2.nextAnimes.length}`
);

// -----------------------------------------------------------------------------
// TESTE 03: Anime presente nas duas plataformas: desconectar uma preserva o vínculo com a outra
// -----------------------------------------------------------------------------
const dualLinkedItem: AnimeItem = makeMockAnime('ani_al_99999_dual', 'Frieren: Beyond Journey\'s End', {
  anilistId: 154587,
  malId: 52991,
  posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.jpg',
  currentEpisode: 20,
  rating: 10,
  isFavorite: true,
  provenance: createAnimeProvenance('anilist', {
    accountIdentifier: 'otaku_al',
    anilistUsername: 'otaku_al',
    malUsername: 'otaku_mal',
    linkedProviders: ['anilist', 'mal'],
    hasUserModifications: true,
  }),
});

const audit3 = pruneAnimesOnDisconnect([dualLinkedItem], 'anilist', 'otaku_al');
const preservedFromDual = audit3.nextAnimes[0];

const test3Passed =
  audit3.removedCount === 0 &&
  audit3.preservedDualLinkedCount === 1 &&
  audit3.nextAnimes.length === 1 &&
  Boolean(preservedFromDual) &&
  preservedFromDual.id === dualLinkedItem.id &&
  preservedFromDual.anilistId === undefined &&
  preservedFromDual.malId === 52991 &&
  preservedFromDual.provenance?.originProvider === 'mal' &&
  preservedFromDual.provenance?.linkedProviders.includes('mal') &&
  !preservedFromDual.provenance?.linkedProviders.includes('anilist') &&
  preservedFromDual.provenance?.anilistUsername === undefined &&
  preservedFromDual.provenance?.malUsername === 'otaku_mal' &&
  preservedFromDual.currentEpisode === 20 &&
  preservedFromDual.rating === 10 &&
  preservedFromDual.isFavorite === true;

recordTest(
  3,
  'Anime presente nas duas plataformas: desconectar uma preserva o vínculo com a outra',
  test3Passed,
  `preservadoId="${preservedFromDual?.id}", novoProvedor="${preservedFromDual?.provenance?.originProvider}", linked=[${preservedFromDual?.provenance?.linkedProviders.join(', ')}], malId=${preservedFromDual?.malId}`
);

// -----------------------------------------------------------------------------
// TESTE 04: Desconectar ambas: nenhum anime importado permanece
// -----------------------------------------------------------------------------
const mixedLibrary: AnimeItem[] = [
  ...anilist300.slice(0, 100), // 100 exclusivos AniList
  ...mal300.slice(0, 100),     // 100 exclusivos MAL
  makeMockAnime('ani_al_dual_1', 'Dual Anime 1', {
    anilistId: 201,
    malId: 301,
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx201.jpg',
    provenance: createAnimeProvenance('anilist', {
      linkedProviders: ['anilist', 'mal'],
      anilistUsername: 'al_user',
      malUsername: 'mal_user',
    }),
  }),
  makeMockAnime('ani_mal_dual_2', 'Dual Anime 2', {
    anilistId: 202,
    malId: 302,
    posterUrl: 'https://cdn.myanimelist.net/images/anime/302.jpg',
    provenance: createAnimeProvenance('mal', {
      linkedProviders: ['anilist', 'mal'],
      anilistUsername: 'al_user',
      malUsername: 'mal_user',
    }),
  }),
  makeMockAnime('manual_personal_001', 'My Custom Indie Animation', {
    provenance: createAnimeProvenance('manual', { linkedProviders: [] }),
  }),
];

// Passo 1: Desconecta AniList
const afterALDisconnect = pruneAnimesOnDisconnect(mixedLibrary, 'anilist', 'al_user');

// Passo 2: Desconecta MAL sobre a lista restante
const afterBothDisconnect = pruneAnimesOnDisconnect(afterALDisconnect.nextAnimes, 'mal', 'mal_user');

const test4Passed =
  afterBothDisconnect.nextAnimes.length === 1 &&
  afterBothDisconnect.nextAnimes[0].id === 'manual_personal_001' &&
  afterBothDisconnect.removedCount === 102; // 100 MAL + 2 ex-duals agora exclusivos do MAL

recordTest(
  4,
  'Desconectar ambas as plataformas: nenhum anime importado permanece',
  test4Passed,
  `totalInicial=${mixedLibrary.length}, apósAL=${afterALDisconnect.nextAnimes.length}, apósAmbas=${afterBothDisconnect.nextAnimes.length} (único restante="${afterBothDisconnect.nextAnimes[0]?.id}")`
);

// -----------------------------------------------------------------------------
// TESTE 05: Registros manuais independentes permanecem
// -----------------------------------------------------------------------------
const manualIndependent1 = makeMockAnime('manual_original_work', 'Anime Caseiro 1', {
  status: 'completed',
  rating: 10,
  genres: ['Original', 'Indie'],
  provenance: createAnimeProvenance('manual', { linkedProviders: [] }),
});

const manualWithFormerLink = makeMockAnime('manual_with_link', 'Anime com Vínculo Externo', {
  status: 'watching',
  rating: 9,
  anilistId: 7777,
  provenance: createAnimeProvenance('manual', {
    linkedProviders: ['anilist'],
    anilistUsername: 'otaku_al',
  }),
});

const audit5 = pruneAnimesOnDisconnect([manualIndependent1, manualWithFormerLink], 'anilist', 'otaku_al');
const test5Passed =
  audit5.removedCount === 0 &&
  audit5.preservedManualCount === 2 &&
  audit5.nextAnimes.length === 2 &&
  audit5.nextAnimes.some((a) => a.id === 'manual_original_work') &&
  audit5.nextAnimes.some((a) => a.id === 'manual_with_link' && a.anilistId === undefined && a.provenance?.linkedProviders.length === 0);

recordTest(
  5,
  'Registros manuais independentes permanecem intactos',
  test5Passed,
  `restantes=${audit5.nextAnimes.length}/2, preservadosManual=${audit5.preservedManualCount}`
);

// -----------------------------------------------------------------------------
// TESTE 06: Registros com alterações locais são tratados conforme sua origem
// -----------------------------------------------------------------------------
// Caso A: Manual com alterações locais -> mantido
const locallyModifiedManual = makeMockAnime('manual_edited_01', 'Manual Editado', {
  currentEpisode: 12,
  rating: 9.5,
  provenance: createAnimeProvenance('manual', {
    hasUserModifications: true,
    lastModifiedLocallyAtMs: Date.now(),
  }),
});

// Caso B: Dual-linked com alterações locais -> mantido com alterações no outro provedor
const locallyModifiedDual = makeMockAnime('ani_al_dual_modified', 'Dual Editado', {
  anilistId: 8888,
  malId: 9999,
  posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx8888.jpg',
  currentEpisode: 24,
  rating: 10,
  provenance: createAnimeProvenance('anilist', {
    linkedProviders: ['anilist', 'mal'],
    anilistUsername: 'user_al',
    malUsername: 'user_mal',
    hasUserModifications: true,
    lastModifiedLocallyAtMs: Date.now(),
  }),
});

// Caso C: Anime exclusivo do AniList com alteração local
// Como sua origem comprovada é exclusivamente a conta AniList desconectada e não há outro provedor
// nem criação manual, ele deve ser removido conforme a regra de desconexão.
const locallyModifiedExclusiveAL = makeMockAnime('ani_al_exclusive_modified', 'AL Exclusivo Editado', {
  anilistId: 7777,
  posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx7777.jpg',
  currentEpisode: 10,
  rating: 8.5,
  provenance: createAnimeProvenance('anilist', {
    linkedProviders: ['anilist'],
    anilistUsername: 'user_al',
    hasUserModifications: true,
  }),
});

const audit6 = pruneAnimesOnDisconnect(
  [locallyModifiedManual, locallyModifiedDual, locallyModifiedExclusiveAL],
  'anilist',
  'user_al'
);

const test6Passed =
  audit6.nextAnimes.length === 2 &&
  audit6.nextAnimes.some((a) => a.id === 'manual_edited_01') &&
  audit6.nextAnimes.some(
    (a) =>
      a.id === 'ani_al_dual_modified' &&
      a.provenance?.originProvider === 'mal' &&
      a.provenance?.hasUserModifications === true &&
      a.rating === 10 &&
      a.currentEpisode === 24
  ) &&
  !audit6.nextAnimes.some((a) => a.id === 'ani_al_exclusive_modified') &&
  audit6.removedCount === 1;

recordTest(
  6,
  'Registros com alterações locais tratados conforme sua origem (não apagados cegamente)',
  test6Passed,
  `restantes=${audit6.nextAnimes.length}/2, manualMantido=true, dualMantidoComModificações=true, exclusivoRemovido=true`
);

// -----------------------------------------------------------------------------
// TESTE 07: Registros legados identificados como importados são removidos corretamente
// -----------------------------------------------------------------------------
// Registros sem objeto provenance ou com 'legacy_unknown', mas com evidências objetivas de CDN do AniList/MAL
const legacyWithAniListCdn1 = makeMockAnime('anime_solo_leveling_legacy', 'Solo Leveling', {
  // id legado no formato do projeto anterior
  posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg',
  provenance: createAnimeProvenance('legacy_unknown', { linkedProviders: [] }),
});

const legacyWithAniListCdn2 = makeMockAnime('anime_cyberpunk_legacy', 'Cyberpunk Edgerunners', {
  posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx120377-p4RwqR4rDlsG.jpg',
  anilistId: 120377,
});

const legacyWithMalCdn = makeMockAnime('anime_vinland_legacy', 'Vinland Saga', {
  posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/124312.jpg',
  malId: 49387,
});

const audit7AL = pruneAnimesOnDisconnect(
  [legacyWithAniListCdn1, legacyWithAniListCdn2, legacyWithMalCdn],
  'anilist'
);

const test7Passed =
  audit7AL.removedCount === 2 &&
  audit7AL.nextAnimes.length === 1 &&
  audit7AL.nextAnimes[0].id === 'anime_vinland_legacy';

recordTest(
  7,
  'Registros legados identificados como importados são removidos corretamente',
  test7Passed,
  `removidosAniList=${audit7AL.removedCount}/2, mantidoMAL="${audit7AL.nextAnimes[0]?.id}"`
);

// -----------------------------------------------------------------------------
// TESTE 08: Registros realmente ambíguos são preservados para revisão (sem reaparecer como importados)
// -----------------------------------------------------------------------------
const trulyAmbiguousItem = makeMockAnime('custom_legacy_independent_99', 'Anime Raro Não Mapeado', {
  // Pôster personalizado ou neutro (não pertence a nenhum CDN oficial de AniList ou MAL)
  posterUrl: 'https://meuservidor.com/capas/desenho_raro.jpg',
  anilistId: undefined,
  malId: undefined,
  provenance: createAnimeProvenance('legacy_unknown', {
    linkedProviders: [],
  }),
});

const audit8 = pruneAnimesOnDisconnect([trulyAmbiguousItem], 'anilist');
const preservedAmbiguous = audit8.nextAnimes[0];

const test8Passed =
  audit8.removedCount === 0 &&
  audit8.ambiguousPreservedCount === 1 &&
  audit8.ambiguousRecords.length === 1 &&
  Boolean(preservedAmbiguous) &&
  preservedAmbiguous.id === 'custom_legacy_independent_99' &&
  preservedAmbiguous.provenance?.originProvider === 'legacy_unknown' &&
  preservedAmbiguous.provenance?.linkedProviders.length === 0;

recordTest(
  8,
  'Registros realmente ambíguos são preservados para revisão, sem reaparecer como importados ativos',
  test8Passed,
  `preservadosAmbíguos=${audit8.ambiguousPreservedCount}, id="${preservedAmbiguous?.id}", origin="${preservedAmbiguous?.provenance?.originProvider}", linked=[${preservedAmbiguous?.provenance?.linkedProviders.join(', ')}]`
);

// -----------------------------------------------------------------------------
// TESTE 09: Recarregar a página não restaura os animes removidos
// -----------------------------------------------------------------------------
async function runPersistenceReloadTest(): Promise<boolean> {
  const testUid = 'user_test_persistence_reload_uid';

  // 1. Inicializa workspace com 300 animes importados do AniList
  const initialWorkspace = createEmptyUserWorkspace(testUid);
  initialWorkspace.animes = [...anilist300];
  initialWorkspace.profileOverrides = {
    externalAccounts: {
      anilist: { connected: true, username: 'otaku_al' },
      mal: { connected: false },
    },
  };

  writeLocalUserWorkspace(testUid, initialWorkspace, { immediate: true });
  await saveAnimesToIndexedDb(testUid, initialWorkspace.animes);

  // Confirma que foram gravados inicialmente
  const readBefore = readLocalUserWorkspace(testUid);
  const indexedBefore = await getAnimesFromIndexedDb(testUid);
  if (!readBefore || readBefore.animes.length !== 300 || !indexedBefore || indexedBefore.length !== 300) {
    return false;
  }

  // 2. Executa a desconexão do AniList
  const pruneResult = pruneAnimesOnDisconnect(initialWorkspace.animes, 'anilist', 'otaku_al');
  const updatedWorkspace = {
    ...initialWorkspace,
    animes: pruneResult.nextAnimes,
    profileOverrides: {
      ...initialWorkspace.profileOverrides,
      externalAccounts: {
        anilist: { connected: false },
        mal: { connected: false },
      },
    },
    updatedAtMs: Date.now(),
  };

  // 3. Persiste em todas as camadas (LocalStorage + IndexedDB)
  writeLocalUserWorkspace(testUid, updatedWorkspace, { immediate: true });
  await saveAnimesToIndexedDb(testUid, updatedWorkspace.animes);

  // 4. Simula recarregamento da página (leitura pura a partir do armazenamento frio)
  const reloadedFromLocalStorage = readLocalUserWorkspace(testUid);
  const reloadedFromIndexedDb = await getAnimesFromIndexedDb(testUid);
  const hydratedWorkspace = await hydrateWorkspaceFromIndexedDb(testUid);

  return (
    reloadedFromLocalStorage !== null &&
    reloadedFromLocalStorage.animes.length === 0 &&
    Array.isArray(reloadedFromIndexedDb) &&
    reloadedFromIndexedDb.length === 0 &&
    hydratedWorkspace !== null &&
    hydratedWorkspace.animes.length === 0
  );
}

runPersistenceReloadTest().then((test9Passed) => {
  recordTest(
    9,
    'Recarregar a página não restaura os animes removidos (IndexedDB + LocalStorage validados)',
    test9Passed,
    test9Passed
      ? 'Lista recarregada permaneceu com 0 animes em memória, localStorage e IndexedDB'
      : 'Falha: animes foram restaurados indevidamente'
  );

  // -----------------------------------------------------------------------------
  // TESTE 10: Uma nova sincronização não recupera dados da conta desconectada
  // -----------------------------------------------------------------------------
  const test10Uid = 'user_test_resync_cooldown_uid';
  const testAccount = 'otaku_al';

  // Registra checkpoint e cooldown prévios
  const activeCheckpoint: ImportCheckpoint = {
    profileId: test10Uid,
    provider: 'anilist',
    accountIdentifier: testAccount,
    cursor: 50,
    page: 2,
    recordsReceived: 50,
    recordsProcessed: 50,
    recordsConfirmed: 50,
    recordsPersisted: 50,
    status: 'completed',
    lastUpdated: new Date().toISOString(),
    updatedAtMs: Date.now(),
  };

  saveImportCheckpoint(activeCheckpoint);
  recordExternalSyncSuccess({
    profileId: test10Uid,
    provider: 'anilist',
    accountIdentifier: testAccount,
  });

  // Confirma existência prévia
  const checkpointBefore = getImportCheckpoint(test10Uid, 'anilist', testAccount);
  const cooldownTimestampBefore = getLastExternalSyncTimestamp({
    profileId: test10Uid,
    provider: 'anilist',
    accountIdentifier: testAccount,
  });

  // Executa desconexão: limpa checkpoints e cooldowns
  clearImportCheckpoint(test10Uid, 'anilist', testAccount);
  clearExternalSyncCooldown({
    profileId: test10Uid,
    provider: 'anilist',
    accountIdentifier: testAccount,
  });

  const checkpointAfter = getImportCheckpoint(test10Uid, 'anilist', testAccount);
  const cooldownTimestampAfter = getLastExternalSyncTimestamp({
    profileId: test10Uid,
    provider: 'anilist',
    accountIdentifier: testAccount,
  });

  const test10Passed =
    checkpointBefore !== null &&
    typeof cooldownTimestampBefore === 'number' &&
    checkpointAfter === null &&
    cooldownTimestampAfter === null;

  recordTest(
    10,
    'Nova sincronização não recupera dados da conta desconectada (checkpoints e cooldowns limpos)',
    test10Passed,
    `checkpointAntes=${Boolean(checkpointBefore)}, checkpointDepois=${Boolean(checkpointAfter)}, cooldownLimpo=${cooldownTimestampAfter === null}`
  );

  console.log('\n========================================================================');
  const allPassed = testResults.every((t) => t.passed);
  const passCount = testResults.filter((t) => t.passed).length;
  console.log(`TOTAL DE TESTES: ${testResults.length} | PASSOU: ${passCount} | FALHOU: ${testResults.length - passCount}`);
  console.log('========================================================================');

  if (!allPassed) {
    process.exit(1);
  }
});
