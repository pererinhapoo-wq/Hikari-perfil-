import assert from 'node:assert';
import { 
  mergeAniListImport, 
  isGenericOrMissingPoster, 
  isValidPosterUrl, 
  AniListAnimeEntry 
} from '../../services/anilistService.js';
import { 
  mergeMALImport, 
  MALAnimeEntry 
} from '../../services/malService.js';
import { INITIAL_ANIMES } from '../../data/mockData.js';
import { AnimeItem } from '../../types/index.js';

let passedTests = 0;
let failedTests = 0;

function test(description: string, fn: () => void) {
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

console.log('--- 1. Validação dos Helpers de Capa (isGenericOrMissingPoster e isValidPosterUrl) ---');

test('isGenericOrMissingPoster detecta corretamente capas do Unsplash', () => {
  assert.strictEqual(
    isGenericOrMissingPoster('https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80'),
    true
  );
  assert.strictEqual(
    isGenericOrMissingPoster('https://sub.unsplash.com/sample.jpg'),
    true
  );
});

test('isGenericOrMissingPoster detecta capas vazias ou ausentes', () => {
  assert.strictEqual(isGenericOrMissingPoster(''), true);
  assert.strictEqual(isGenericOrMissingPoster('   '), true);
  assert.strictEqual(isGenericOrMissingPoster(undefined), true);
  assert.strictEqual(isGenericOrMissingPoster(null), true);
});

test('isGenericOrMissingPoster preserva capas oficiais de CDNs (AniList / MAL)', () => {
  assert.strictEqual(
    isGenericOrMissingPoster('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg'),
    false
  );
  assert.strictEqual(
    isGenericOrMissingPoster('https://cdn.myanimelist.net/images/anime/1170/124302.jpg'),
    false
  );
});

test('isGenericOrMissingPoster preserva imagens personalizadas do usuário', () => {
  // URLs de servidores externos ou serviços de hospedagem
  assert.strictEqual(
    isGenericOrMissingPoster('https://i.imgur.com/user_custom_cover.png'),
    false
  );
  assert.strictEqual(
    isGenericOrMissingPoster('https://meu-servidor-pessoal.com.br/anime_art.jpg'),
    false
  );
  // Caminhos locais do projeto
  assert.strictEqual(
    isGenericOrMissingPoster('/src/assets/images/hikari_custom_poster.jpg'),
    false
  );
  // Data URLs (ex: imagens base64 customizadas salvas localmente)
  assert.strictEqual(
    isGenericOrMissingPoster('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQ...'),
    false
  );
});

test('isValidPosterUrl valida corretamente URLs HTTP/HTTPS', () => {
  assert.strictEqual(isValidPosterUrl('https://s4.anilist.co/cover.jpg'), true);
  assert.strictEqual(isValidPosterUrl('http://cdn.myanimelist.net/cover.jpg'), true);
  assert.strictEqual(isValidPosterUrl(''), false);
  assert.strictEqual(isValidPosterUrl('   '), false);
  assert.strictEqual(isValidPosterUrl(undefined), false);
  assert.strictEqual(isValidPosterUrl(null), false);
  assert.strictEqual(isValidPosterUrl('not-a-valid-url'), false);
  assert.strictEqual(isValidPosterUrl('javascript:alert(1)'), false);
});

console.log('\n--- 2. Testes de Sincronização do AniList (mergeAniListImport) ---');

const baseExistingAnime: AnimeItem = {
  id: 'anime_test_1',
  anilistId: 101,
  malId: 201,
  title: 'Anime Teste',
  titleRomaji: 'Anime Teste Romaji',
  posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
  status: 'watching',
  currentEpisode: 5,
  totalEpisodes: 12,
  rating: 8.5,
  isFavorite: true,
  year: 2023,
  genres: ['Ação']
};

test('a. AniList: Capa do Unsplash é substituída quando há capa oficial válida recebida', () => {
  const current = [{ ...baseExistingAnime }];
  const incoming: AniListAnimeEntry = {
    anilistId: 101,
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-official.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeAniListImport([incoming], current, true);
  assert.strictEqual(result.mergedList.length, 1);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-official.jpg'
  );
  assert.strictEqual(result.updatedCount, 1);
});

test('b. AniList: Capa oficial existente é preservada e não substituída', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-current-official.jpg'
  }];
  const incoming: AniListAnimeEntry = {
    anilistId: 101,
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-new-incoming.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeAniListImport([incoming], current, true);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-current-official.jpg'
  );
});

test('c. AniList: Imagem personalizada do usuário é preservada', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://minha-arte-personalizada.org/capa_custom.png'
  }];
  const incoming: AniListAnimeEntry = {
    anilistId: 101,
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-official.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeAniListImport([incoming], current, true);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://minha-arte-personalizada.org/capa_custom.png'
  );
});

test('d. AniList: URL vazia ou inválida da plataforma não sobrescreve a imagem atual', () => {
  const currentWithUnsplash: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477'
  }];
  const incomingEmpty: AniListAnimeEntry = {
    anilistId: 101,
    malId: 201,
    title: 'Anime Teste',
    posterUrl: '',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const resultEmpty = mergeAniListImport([incomingEmpty], currentWithUnsplash, true);
  assert.strictEqual(
    resultEmpty.mergedList[0].posterUrl,
    'https://images.unsplash.com/photo-1578632767115-351597cf2477'
  );

  const incomingInvalid: AniListAnimeEntry = {
    ...incomingEmpty,
    posterUrl: 'invalid_url_not_http'
  };
  const resultInvalid = mergeAniListImport([incomingInvalid], currentWithUnsplash, true);
  assert.strictEqual(
    resultInvalid.mergedList[0].posterUrl,
    'https://images.unsplash.com/photo-1578632767115-351597cf2477'
  );
});

test('e. AniList: Atualização de capa não altera nota, status, progresso ou favoritos', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    rating: 9.4,
    status: 'watching',
    currentEpisode: 7,
    totalEpisodes: 12,
    isFavorite: true,
    posterUrl: 'https://images.unsplash.com/photo-generic'
  }];
  const incoming: AniListAnimeEntry = {
    anilistId: 101,
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-official.jpg',
    status: 'watching',
    currentEpisode: 7,
    totalEpisodes: 12,
    rating: 9.4,
    isFavorite: false, // Mesmo que o AniList não tenha favorito, favorito local deve ser mantido
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeAniListImport([incoming], current, true);
  const updated = result.mergedList[0];

  assert.strictEqual(updated.posterUrl, 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101-official.jpg');
  assert.strictEqual(updated.rating, 9.4);
  assert.strictEqual(updated.status, 'watching');
  assert.strictEqual(updated.currentEpisode, 7);
  assert.strictEqual(updated.totalEpisodes, 12);
  assert.strictEqual(updated.isFavorite, true);
});

console.log('\n--- 3. Testes de Sincronização do MyAnimeList (mergeMALImport) ---');

test('a. MAL: Capa do Unsplash é substituída quando há capa oficial válida recebida', () => {
  const current: AnimeItem[] = [{ ...baseExistingAnime }];
  const incoming: MALAnimeEntry = {
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/124302.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeMALImport([incoming], current, true);
  assert.strictEqual(result.mergedList.length, 1);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://cdn.myanimelist.net/images/anime/1170/124302.jpg'
  );
  assert.strictEqual(result.updatedCount, 1);
});

test('b. MAL: Capa oficial existente é preservada e não substituída', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/existing_cover.jpg'
  }];
  const incoming: MALAnimeEntry = {
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/incoming_cover.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeMALImport([incoming], current, true);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://cdn.myanimelist.net/images/anime/1015/existing_cover.jpg'
  );
});

test('c. MAL: Imagem personalizada do usuário é preservada', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://meu-portfolio.com/art_cover.jpg'
  }];
  const incoming: MALAnimeEntry = {
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://cdn.myanimelist.net/images/anime/1170/incoming.jpg',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const result = mergeMALImport([incoming], current, true);
  assert.strictEqual(
    result.mergedList[0].posterUrl,
    'https://meu-portfolio.com/art_cover.jpg'
  );
});

test('d. MAL: URL vazia ou inválida da plataforma não sobrescreve a imagem atual', () => {
  const currentWithUnsplash: AnimeItem[] = [{
    ...baseExistingAnime,
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477'
  }];
  const incomingEmpty: MALAnimeEntry = {
    malId: 201,
    title: 'Anime Teste',
    posterUrl: '',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 12,
    rating: 8.5,
    year: 2023,
    genres: ['Ação']
  };

  const resultEmpty = mergeMALImport([incomingEmpty], currentWithUnsplash, true);
  assert.strictEqual(
    resultEmpty.mergedList[0].posterUrl,
    'https://images.unsplash.com/photo-1578632767115-351597cf2477'
  );
});

test('e. MAL: Atualização de capa não altera nota, status, progresso ou favoritos', () => {
  const current: AnimeItem[] = [{
    ...baseExistingAnime,
    rating: 9.8,
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    isFavorite: true,
    posterUrl: 'https://images.unsplash.com/photo-generic-unsplash'
  }];
  const incoming: MALAnimeEntry = {
    malId: 201,
    title: 'Anime Teste',
    posterUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 9.8,
    year: 2023,
    genres: ['Aventura']
  };

  const result = mergeMALImport([incoming], current, true);
  const updated = result.mergedList[0];

  assert.strictEqual(updated.posterUrl, 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg');
  assert.strictEqual(updated.rating, 9.8);
  assert.strictEqual(updated.status, 'completed');
  assert.strictEqual(updated.currentEpisode, 28);
  assert.strictEqual(updated.totalEpisodes, 28);
  assert.strictEqual(updated.isFavorite, true);
});

console.log('\n--- 4. Verificação de INITIAL_ANIMES em mockData.ts ---');

test('Nenhum anime em INITIAL_ANIMES utiliza URLs do Unsplash', () => {
  for (const anime of INITIAL_ANIMES) {
    assert.strictEqual(
      isGenericOrMissingPoster(anime.posterUrl),
      false,
      `Anime ${anime.title} ainda possui URL genérica ou vazia: ${anime.posterUrl}`
    );
  }
});

test('Todos os 18 animes de demonstração possuem capas oficiais válidas', () => {
  assert.strictEqual(INITIAL_ANIMES.length, 18);
  for (const anime of INITIAL_ANIMES) {
    assert.strictEqual(isValidPosterUrl(anime.posterUrl), true, `URL inválida para ${anime.title}: ${anime.posterUrl}`);
    assert.ok(
      anime.posterUrl.startsWith('https://s4.anilist.co/') || anime.posterUrl.startsWith('https://cdn.myanimelist.net/'),
      `Capa não pertence a CDN oficial confiável: ${anime.posterUrl}`
    );
  }
});

test('Campos de dados e IDs de INITIAL_ANIMES estão íntegros', () => {
  const soloLeveling = INITIAL_ANIMES.find((a) => a.id === 'anime_solo_leveling');
  assert.ok(soloLeveling);
  assert.strictEqual(soloLeveling.rating, 9.4);
  assert.strictEqual(soloLeveling.status, 'watching');
  assert.strictEqual(soloLeveling.currentEpisode, 10);
  assert.strictEqual(soloLeveling.totalEpisodes, 12);
  assert.strictEqual(soloLeveling.isFavorite, true);

  const frieren = INITIAL_ANIMES.find((a) => a.id === 'anime_frieren');
  assert.ok(frieren);
  assert.strictEqual(frieren.rating, 9.8);
  assert.strictEqual(frieren.status, 'completed');
  assert.strictEqual(frieren.isFavorite, true);
});

console.log('========================================');
console.log(`Resultados dos Testes de Sincronização de Capas: ${passedTests} passaram, ${failedTests} falharam.`);
console.log('========================================');

if (failedTests > 0) {
  process.exit(1);
}
