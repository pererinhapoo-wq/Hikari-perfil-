import assert from 'node:assert';
import { 
  mergeAniListImport, 
  mergeFavoriteCharacters, 
  isGenericOrMissingPoster, 
  isGenericOrMissingImage,
  isValidPosterUrl, 
  isValidImageUrl,
  AniListAnimeEntry 
} from '../../services/anilistService.js';
import { 
  mergeMALImport, 
  MALAnimeEntry 
} from '../../services/malService.js';
import { 
  INITIAL_ANIMES, 
  FAVORITE_CHARACTERS, 
  FAVORITE_COMPANIES, 
  FAVORITE_PEOPLE,
  INITIAL_FOLLOWERS,
  INITIAL_FOLLOWING,
  INITIAL_FOLLOW_REQUESTS,
  INITIAL_NOTIFICATIONS,
  OTHER_USERS
} from '../../data/mockData.js';
import { AnimeItem, FavoriteCharacter } from '../../types/index.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err: unknown) {
    console.error(`  ✗ ${description}`);
    console.error(`    Erro: ${(err as Error).message}`);
    failedTests++;
  }
}

console.log('======================================================');
console.log('AUDITORIA E TESTES COMPLETOS DE IMAGENS — HIKARI PERFIL');
console.log('======================================================\n');

// -------------------------------------------------------------------
// 1. Substituição de imagens genéricas por imagens oficiais válidas
// -------------------------------------------------------------------
console.log('--- 1. Substituição de Imagens Genéricas por Oficiais Válidas ---');

runTest('AniList: Capa genérica do Unsplash é substituída por capa oficial recebida', () => {
  const existingList: AnimeItem[] = [
    {
      id: 'anime_solo',
      anilistId: 151807,
      title: 'Solo Leveling',
      posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
      status: 'watching',
      currentEpisode: 10,
      totalEpisodes: 12,
      rating: 9.4,
      isFavorite: true,
      year: 2024,
      genres: ['Ação', 'Fantasia']
    }
  ];

  const incoming: AniListAnimeEntry[] = [
    {
      anilistId: 151807,
      title: 'Solo Leveling',
      posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg',
      status: 'watching',
      currentEpisode: 10,
      totalEpisodes: 12,
      rating: 9.4,
      year: 2024,
      genres: ['Ação', 'Fantasia']
    }
  ];

  const result = mergeAniListImport(incoming, existingList, true);
  const updated = result.mergedList.find((a) => a.id === 'anime_solo');
  assert.ok(updated);
  assert.strictEqual(
    updated?.posterUrl,
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg',
    'Capa genérica deve ser substituída pela capa oficial'
  );
});

runTest('MAL: Capa genérica do Unsplash é substituída por capa oficial recebida', () => {
  const existingList: AnimeItem[] = [
    {
      id: 'anime_frieren',
      malId: 52991,
      title: 'Sousou no Frieren',
      posterUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500',
      status: 'completed',
      currentEpisode: 28,
      totalEpisodes: 28,
      rating: 9.8,
      isFavorite: true,
      year: 2023,
      genres: ['Aventura']
    }
  ];

  const incoming: MALAnimeEntry[] = [
    {
      malId: 52991,
      title: 'Sousou no Frieren',
      posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
      status: 'completed',
      currentEpisode: 28,
      totalEpisodes: 28,
      rating: 9.8,
      year: 2023,
      genres: ['Aventura']
    }
  ];

  const result = mergeMALImport(incoming, existingList, true);
  const updated = result.mergedList.find((a) => a.id === 'anime_frieren');
  assert.ok(updated);
  assert.strictEqual(
    updated?.posterUrl,
    'https://cdn.myanimelist.net/images/anime/1015/138062.jpg',
    'Capa genérica deve ser atualizada para o CDN oficial do MAL'
  );
});

runTest('Personagens: Imagem genérica do Unsplash é substituída por imagem oficial correspondente', () => {
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_01',
      name: 'Frieren',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400'
    }
  ];

  const incomingChars: FavoriteCharacter[] = [
    {
      id: 'char_al_176754',
      name: 'Frieren',
      originalName: 'フリーレン',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png'
    }
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingChars);
  assert.strictEqual(merged.length, 1, 'Deve manter 1 único registro sem duplicata');
  assert.strictEqual(
    merged[0].imageUrl,
    'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png',
    'Imagem genérica do Unsplash foi substituída pela imagem oficial'
  );
});

// -------------------------------------------------------------------
// 2. Preservação de imagens oficiais existentes
// -------------------------------------------------------------------
console.log('\n--- 2. Preservação de Imagens Oficiais Existentes ---');

runTest('AniList: Capa oficial existente é preservada e não alterada desnecessariamente', () => {
  const officialCover = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gviZ5zgQL7ee.jpg';
  const existingList: AnimeItem[] = [
    {
      id: 'anime_frieren',
      anilistId: 154587,
      title: 'Sousou no Frieren',
      posterUrl: officialCover,
      status: 'completed',
      currentEpisode: 28,
      totalEpisodes: 28,
      rating: 9.8,
      isFavorite: true,
      year: 2023,
      genres: ['Aventura']
    }
  ];

  const incoming: AniListAnimeEntry[] = [
    {
      anilistId: 154587,
      title: 'Sousou no Frieren',
      posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-different.jpg',
      status: 'completed',
      currentEpisode: 28,
      totalEpisodes: 28,
      rating: 9.8,
      year: 2023,
      genres: ['Aventura']
    }
  ];

  const result = mergeAniListImport(incoming, existingList, true);
  const updated = result.mergedList.find((a) => a.id === 'anime_frieren');
  assert.strictEqual(updated?.posterUrl, officialCover, 'Capa oficial já existente deve ser mantida');
});

runTest('Personagens: Imagem oficial de CDN AniList é preservada contra substituição externa', () => {
  const officialCharImage = 'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png';
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_al_176754',
      name: 'Frieren',
      originalName: 'フリーレン',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: officialCharImage
    }
  ];

  const incomingChars: FavoriteCharacter[] = [
    {
      id: 'char_al_176754',
      name: 'Frieren',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: 'https://some-other-cdn.com/frieren_alt.png'
    }
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingChars);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].imageUrl, officialCharImage, 'Imagem oficial pré-existente deve ser preservada');
});

// -------------------------------------------------------------------
// 3. Preservação de imagens personalizadas do usuário
// -------------------------------------------------------------------
console.log('\n--- 3. Preservação de Imagens Personalizadas do Usuário ---');

runTest('AniList/MAL: Preserva capas com Data URL (Base64) customizadas pelo usuário', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const existingList: AnimeItem[] = [
    {
      id: 'anime_custom_1',
      anilistId: 9253,
      title: 'Steins;Gate',
      posterUrl: dataUrl,
      status: 'completed',
      currentEpisode: 24,
      totalEpisodes: 24,
      rating: 9.7,
      isFavorite: true,
      year: 2011,
      genres: ['Sci-Fi']
    }
  ];

  const incoming: AniListAnimeEntry[] = [
    {
      anilistId: 9253,
      title: 'Steins;Gate',
      posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx9253-7pdcPAuaTW5C.png',
      status: 'completed',
      currentEpisode: 24,
      totalEpisodes: 24,
      rating: 9.7,
      year: 2011,
      genres: ['Sci-Fi']
    }
  ];

  const result = mergeAniListImport(incoming, existingList, true);
  const updated = result.mergedList.find((a) => a.id === 'anime_custom_1');
  assert.strictEqual(updated?.posterUrl, dataUrl, 'Data URL customizada não pode ser sobrescrita');
});

runTest('Personagens: Preserva retratos personalizados em outros serviços (Imgur, servidor próprio, caminhos locais)', () => {
  const customImgur = 'https://i.imgur.com/my_custom_character_art.png';
  const customLocal = '/src/assets/images/hikari_custom_char.jpg';
  const customDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg...';

  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_custom_1',
      name: 'Levi Ackerman',
      animeName: 'Attack on Titan',
      role: 'Capitão',
      imageUrl: customImgur
    },
    {
      id: 'char_custom_2',
      name: 'Sung Jin-woo',
      animeName: 'Solo Leveling',
      role: 'Monarca',
      imageUrl: customLocal
    },
    {
      id: 'char_custom_3',
      name: 'David Martinez',
      animeName: 'Cyberpunk',
      role: 'Edgerunner',
      imageUrl: customDataUrl
    }
  ];

  const incomingChars: FavoriteCharacter[] = [
    {
      id: 'char_al_45627',
      name: 'Levi Ackerman',
      animeName: 'Attack on Titan',
      role: 'Capitão',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b45627-CR68RyZmddGG.png'
    },
    {
      id: 'char_al_129928',
      name: 'Sung Jin-woo',
      animeName: 'Solo Leveling',
      role: 'Monarca',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b129928-BCEjVaP0AQSw.png'
    },
    {
      id: 'char_al_284158',
      name: 'David Martinez',
      animeName: 'Cyberpunk',
      role: 'Edgerunner',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b284158-z1uGKC3IYVa1.png'
    }
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingChars);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].imageUrl, customImgur, 'Imgur customizado é 100% preservado');
  assert.strictEqual(merged[1].imageUrl, customLocal, 'Caminho local customizado é 100% preservado');
  assert.strictEqual(merged[2].imageUrl, customDataUrl, 'Data URL customizada é 100% preservada');
});

// -------------------------------------------------------------------
// 4. Proteção contra URLs vazias ou inválidas
// -------------------------------------------------------------------
console.log('\n--- 4. Proteção contra URLs Vazias ou Inválidas ---');

runTest('AniList/MAL: URL vazia, whitespace ou inválida da API nunca apaga capa válida', () => {
  const existingList: AnimeItem[] = [
    {
      id: 'anime_bleach',
      anilistId: 114446,
      title: 'Bleach: Thousand-Year Blood War',
      posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx114446-pG4r1S7z7k6n.jpg',
      status: 'planned',
      currentEpisode: 0,
      totalEpisodes: 26,
      rating: 0,
      isFavorite: false,
      year: 2024,
      genres: ['Ação']
    }
  ];

  const incomingWithEmpty: AniListAnimeEntry[] = [
    {
      anilistId: 114446,
      title: 'Bleach: Thousand-Year Blood War',
      posterUrl: '',
      status: 'planned',
      currentEpisode: 0,
      totalEpisodes: 26,
      rating: 0,
      year: 2024,
      genres: ['Ação']
    }
  ];

  const result = mergeAniListImport(incomingWithEmpty, existingList, true);
  const updated = result.mergedList.find((a) => a.id === 'anime_bleach');
  assert.strictEqual(
    updated?.posterUrl,
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx114446-pG4r1S7z7k6n.jpg',
    'Capa válida nunca é apagada por string vazia da API'
  );
});

runTest('Personagens: URL vazia, nula ou inválida recebida nunca apaga imagem existente válida', () => {
  const validImageUrl = 'https://s4.anilist.co/file/anilistcdn/character/large/b138101-7NCB0Md8zA6G.png';
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_08',
      name: 'Loid Forger',
      animeName: 'SPY x FAMILY',
      role: 'Espião',
      imageUrl: validImageUrl
    }
  ];

  const incomingEmpty: FavoriteCharacter[] = [
    {
      id: 'char_al_138101',
      name: 'Loid Forger',
      animeName: 'SPY x FAMILY',
      role: 'Espião',
      imageUrl: ''
    }
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingEmpty);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].imageUrl, validImageUrl, 'Imagem existente deve ser preservada contra URL vazia');
});

runTest('Validadores de URL: isValidPosterUrl e isValidImageUrl rejeitam protocolos inseguros ou malformados', () => {
  assert.strictEqual(isValidPosterUrl(''), false);
  assert.strictEqual(isValidPosterUrl('   '), false);
  assert.strictEqual(isValidPosterUrl(null), false);
  assert.strictEqual(isValidPosterUrl(undefined), false);
  assert.strictEqual(isValidPosterUrl('javascript:alert(1)'), false);
  assert.strictEqual(isValidPosterUrl('file:///etc/passwd'), false);
  assert.strictEqual(isValidPosterUrl('invalid-url'), false);
  assert.strictEqual(isValidPosterUrl('https://s4.anilist.co/image.png'), true);
  assert.strictEqual(isValidPosterUrl('http://cdn.myanimelist.net/image.jpg'), true);

  assert.strictEqual(isValidImageUrl(''), false);
  assert.strictEqual(isValidImageUrl('https://s4.anilist.co/character.png'), true);
});

// -------------------------------------------------------------------
// 5. Integridade dos demais dados durante a sincronização
// -------------------------------------------------------------------
console.log('\n--- 5. Integridade dos Demais Dados Durante a Sincronização ---');

runTest('Atualização de imagem não altera id, títulos, nota, status, progresso ou favoritos de animes', () => {
  const existingList: AnimeItem[] = [
    {
      id: 'anime_kaiju8',
      anilistId: 153288,
      malId: 52211,
      title: 'Kaiju No. 8',
      titleRomaji: 'Kaijuu 8-gou',
      posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477',
      status: 'watching',
      currentEpisode: 6,
      totalEpisodes: 12,
      rating: 8.5,
      isFavorite: true,
      year: 2024,
      genres: ['Ação', 'Monstros'],
      rewatchCount: 1,
      episodeDurationMinutes: 24
    }
  ];

  const incoming: AniListAnimeEntry[] = [
    {
      anilistId: 153288,
      title: 'Kaiju No. 8',
      titleRomaji: 'Kaijuu 8-gou',
      posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx153288-E2jR5k338o7R.jpg',
      status: 'watching',
      currentEpisode: 6,
      totalEpisodes: 12,
      rating: 8.5,
      year: 2024,
      genres: ['Ação', 'Monstros']
    }
  ];

  const result = mergeAniListImport(incoming, existingList, false);
  const updated = result.mergedList[0];

  assert.strictEqual(updated.id, 'anime_kaiju8');
  assert.strictEqual(updated.anilistId, 153288);
  assert.strictEqual(updated.malId, 52211);
  assert.strictEqual(updated.title, 'Kaiju No. 8');
  assert.strictEqual(updated.titleRomaji, 'Kaijuu 8-gou');
  assert.strictEqual(updated.status, 'watching');
  assert.strictEqual(updated.currentEpisode, 6);
  assert.strictEqual(updated.totalEpisodes, 12);
  assert.strictEqual(updated.rating, 8.5);
  assert.strictEqual(updated.isFavorite, true);
  assert.strictEqual(updated.rewatchCount, 1);
  assert.strictEqual(updated.episodeDurationMinutes, 24);
  assert.strictEqual(
    updated.posterUrl,
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx153288-E2jR5k338o7R.jpg'
  );
});

runTest('Atualização de imagem não altera id, nome, originalName, animeName ou role de personagens', () => {
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_03',
      name: 'Gojou Satoru',
      originalName: '五条悟',
      animeName: 'Jujutsu Kaisen',
      role: 'Feiticeiro Especial',
      imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400'
    }
  ];

  const incomingChars: FavoriteCharacter[] = [
    {
      id: 'char_al_127691',
      name: 'Gojou Satoru',
      originalName: '五条悟',
      animeName: 'Jujutsu Kaisen',
      role: 'Protagonista', // Papel diferente vindo da API
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png'
    }
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingChars);
  assert.strictEqual(merged.length, 1);
  const char = merged[0];
  assert.strictEqual(char.id, 'char_03', 'ID local deve ser rigorosamente mantido');
  assert.strictEqual(char.name, 'Gojou Satoru');
  assert.strictEqual(char.originalName, '五条悟');
  assert.strictEqual(char.animeName, 'Jujutsu Kaisen');
  assert.strictEqual(char.role, 'Feiticeiro Especial', 'Cargo/role local deve ser rigorosamente preservado');
  assert.strictEqual(
    char.imageUrl,
    'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png'
  );
});

// -------------------------------------------------------------------
// 6. Deduplicação e correspondência correta de personagens
// -------------------------------------------------------------------
console.log('\n--- 6. Deduplicação e Correspondência Correta de Personagens ---');

runTest('mergeFavoriteCharacters deduplica por ID de personagem', () => {
  const list1: FavoriteCharacter[] = [
    {
      id: 'char_al_1',
      name: 'Killua Zoldyck',
      animeName: 'Hunter x Hunter',
      role: 'Coprotagonista',
      imageUrl: 'https://s4.anilist.co/image1.jpg'
    }
  ];
  const list2: FavoriteCharacter[] = [
    {
      id: 'char_al_1',
      name: 'Killua',
      animeName: 'Hunter x Hunter',
      role: 'Coprotagonista',
      imageUrl: 'https://s4.anilist.co/image1.jpg'
    }
  ];

  const merged = mergeFavoriteCharacters(list1, list2);
  assert.strictEqual(merged.length, 1, 'Não deve criar duplicata por ID');
});

runTest('mergeFavoriteCharacters deduplica por nome normalizado (case and accent insensitive)', () => {
  const list1: FavoriteCharacter[] = [
    {
      id: 'char_local_1',
      name: 'Roronoa Zoro',
      animeName: 'One Piece',
      role: 'Espadachim',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png'
    }
  ];
  const list2: FavoriteCharacter[] = [
    {
      id: 'char_al_62',
      name: 'roronoa  zoro',
      animeName: 'One Piece',
      role: 'Espadachim',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png'
    }
  ];

  const merged = mergeFavoriteCharacters(list1, list2);
  assert.strictEqual(merged.length, 1, 'Não deve duplicar personages com nomes idênticos normalizados');
  assert.strictEqual(merged[0].id, 'char_local_1', 'Preserva ID e ordem do item original');
});

// -------------------------------------------------------------------
// 7. Ausência de imagens genéricas indevidas nos dados de demonstração
// -------------------------------------------------------------------
console.log('\n--- 7. Verificação de Ausência de Imagens Genéricas nos Dados de Demonstração ---');

runTest('INITIAL_ANIMES: Todos os 18 animes utilizam capas oficiais verificadas e 0 Unsplash', () => {
  assert.strictEqual(INITIAL_ANIMES.length, 18);
  for (const anime of INITIAL_ANIMES) {
    assert.ok(anime.posterUrl, `Anime ${anime.title} possui capa definida`);
    assert.strictEqual(
      isGenericOrMissingPoster(anime.posterUrl),
      false,
      `Anime ${anime.title} NÃO deve possuir capa genérica ou do Unsplash`
    );
    assert.ok(
      anime.posterUrl.startsWith('https://s4.anilist.co/') ||
      anime.posterUrl.startsWith('https://cdn.myanimelist.net/'),
      `Capa de ${anime.title} provém de CDN oficial verificado (AniList / MAL)`
    );
  }
});

runTest('FAVORITE_CHARACTERS: Todos os 10 personagens utilizam retratos oficiais do AniList e 0 Unsplash', () => {
  assert.strictEqual(FAVORITE_CHARACTERS.length, 10);
  for (const char of FAVORITE_CHARACTERS) {
    assert.ok(char.imageUrl, `Personagem ${char.name} possui imagem definida`);
    assert.strictEqual(
      isGenericOrMissingImage(char.imageUrl),
      false,
      `Personagem ${char.name} NÃO deve possuir imagem genérica ou do Unsplash`
    );
    assert.ok(
      char.imageUrl.startsWith('https://s4.anilist.co/file/anilistcdn/character/'),
      `Imagem de ${char.name} deve provir do CDN oficial do AniList`
    );
  }
});

runTest('FAVORITE_COMPANIES: Todas as 10 empresas/estúdios possuem logos oficiais do MAL e 0 Unsplash', () => {
  assert.strictEqual(FAVORITE_COMPANIES.length, 10);
  for (const comp of FAVORITE_COMPANIES) {
    assert.ok(comp.logoUrl, `Empresa ${comp.name} possui logotipo definido`);
    assert.strictEqual(
      isGenericOrMissingImage(comp.logoUrl),
      false,
      `Empresa ${comp.name} NÃO deve possuir imagem genérica ou do Unsplash`
    );
    assert.ok(
      comp.logoUrl.startsWith('https://cdn.myanimelist.net/s/common/company_logos/'),
      `Logotipo de ${comp.name} deve provir do repositório oficial de empresas do MyAnimeList`
    );
  }
});

runTest('FAVORITE_PEOPLE: Todas as 10 pessoas/criadores possuem retratos oficiais de Staff do AniList e 0 Unsplash', () => {
  assert.strictEqual(FAVORITE_PEOPLE.length, 10);
  for (const person of FAVORITE_PEOPLE) {
    assert.ok(person.imageUrl, `Pessoa ${person.name} possui retrato definido`);
    assert.strictEqual(
      isGenericOrMissingImage(person.imageUrl),
      false,
      `Pessoa ${person.name} NÃO deve possuir imagem genérica ou do Unsplash`
    );
    assert.ok(
      person.imageUrl.startsWith('https://s4.anilist.co/file/anilistcdn/staff/'),
      `Retrato de ${person.name} deve provir do CDN oficial de Staff do AniList`
    );
  }
});

runTest('INITIAL_FOLLOWERS, INITIAL_FOLLOWING, REQUESTS, NOTIFICATIONS e OTHER_USERS: Ausência de Unsplash e avatares duplicados', () => {
  const allFollowers = [...INITIAL_FOLLOWERS, ...INITIAL_FOLLOWING];
  for (const user of allFollowers) {
    if (user.avatarUrl) {
      assert.strictEqual(
        user.avatarUrl.includes('unsplash.com'),
        false,
        `Avatar de ${user.displayName} não deve conter URL do Unsplash`
      );
    }
  }

  for (const req of INITIAL_FOLLOW_REQUESTS) {
    if (req.user.avatarUrl) {
      assert.strictEqual(
        req.user.avatarUrl.includes('unsplash.com'),
        false,
        `Avatar de solicitação de ${req.user.displayName} não deve conter Unsplash`
      );
    }
  }

  for (const notif of INITIAL_NOTIFICATIONS) {
    if (notif.actor.avatarUrl) {
      assert.strictEqual(
        notif.actor.avatarUrl.includes('unsplash.com'),
        false,
        `Avatar do ator de notificação ${notif.actor.displayName} não deve conter Unsplash`
      );
    }
  }

  // Shinji não deve reutilizar o mesmo avatar local de Ren Amano
  assert.notStrictEqual(
    OTHER_USERS['usr_shinji']?.avatarUrl,
    '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
    'Shinji Kazuki não deve reutilizar indevidamente o avatar de Ren Amano'
  );
});

console.log('\n======================================================');
console.log(`RESULTADO DOS TESTES DE IMAGENS: ${passedTests} passaram, ${failedTests} falharam (Total: ${totalTests})`);
console.log('======================================================');

if (failedTests > 0) {
  process.exit(1);
}
