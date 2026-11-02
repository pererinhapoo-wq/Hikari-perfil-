import assert from 'node:assert';
import {
  mergeAniListImport,
  calculateAniListImportPreview,
  mergeFavoriteCharacters,
  mapAniListCharacter,
  type AniListAnimeEntry,
} from '../../services/anilistService';
import {
  mergeMALImport,
  type MALAnimeEntry,
} from '../../services/malService';
import type { AnimeItem, FavoriteCharacter } from '../../types';

console.log('--- Iniciando Testes de Sincronização de Favoritos (Etapa 4) ---');

function makeAnimeItem(overrides: Partial<AnimeItem> = {}): AnimeItem {
  return {
    id: 'ani_local_1',
    title: 'Frieren: Beyond Journey\'s End',
    posterUrl: 'https://example.com/frieren.jpg',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 10,
    isFavorite: false,
    year: 2023,
    genres: ['Adventure', 'Drama', 'Fantasy'],
    ...overrides,
  };
}

function makeAniListEntry(overrides: Partial<AniListAnimeEntry> = {}): AniListAnimeEntry {
  return {
    anilistId: 154587,
    title: 'Sousou no Frieren',
    titleRomaji: 'Sousou no Frieren',
    posterUrl: 'https://example.com/frieren_al.jpg',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 10,
    isFavorite: false,
    year: 2023,
    genres: ['Adventure', 'Fantasy'],
    ...overrides,
  };
}

function makeMALEntry(overrides: Partial<MALAnimeEntry> = {}): MALAnimeEntry {
  return {
    malId: 52991,
    title: 'Sousou no Frieren',
    titleRomaji: 'Sousou no Frieren',
    posterUrl: 'https://example.com/frieren_mal.jpg',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 10,
    year: 2023,
    genres: ['Adventure', 'Fantasy'],
    ...overrides,
  };
}

// ==========================================
// Teste 1: Importação de anime favorito do AniList (Novo anime)
// ==========================================
{
  const incoming = [
    makeAniListEntry({ anilistId: 101, title: 'Steins;Gate', isFavorite: true }),
    makeAniListEntry({ anilistId: 102, title: 'Clannad', isFavorite: false }),
  ];

  const result = mergeAniListImport(incoming, [], true);
  assert.strictEqual(result.addedCount, 2);
  const steins = result.mergedList.find((a) => a.title === 'Steins;Gate');
  const clannad = result.mergedList.find((a) => a.title === 'Clannad');

  assert.ok(steins, 'Steins;Gate deve existir na lista');
  assert.strictEqual(steins?.isFavorite, true, 'Steins;Gate marcado no AniList deve vir com isFavorite = true');

  assert.ok(clannad, 'Clannad deve existir na lista');
  assert.strictEqual(clannad?.isFavorite, false, 'Clannad não marcado deve ter isFavorite = false');
  console.log('✔ Teste 1 passou: Novos animes do AniList importam isFavorite corretamente');
}

// ==========================================
// Teste 2: Preservação de favoritos manuais já existentes no Hikari
// ==========================================
{
  const localList: AnimeItem[] = [
    makeAnimeItem({
      id: 'local_frieren',
      anilistId: 154587,
      title: 'Frieren',
      isFavorite: true, // Marcado manualmente no Hikari
    }),
  ];

  // AniList vem sem favorito para esse anime
  const incoming = [
    makeAniListEntry({
      anilistId: 154587,
      title: 'Frieren',
      isFavorite: false,
    }),
  ];

  const result = mergeAniListImport(incoming, localList, true);
  const frieren = result.mergedList.find((a) => a.id === 'local_frieren');
  assert.ok(frieren);
  assert.strictEqual(
    frieren?.isFavorite,
    true,
    'Favorito manual no Hikari NUNCA deve ser desmarcado por importação'
  );
  console.log('✔ Teste 2 passou: Favorito manual pré-existente no Hikari é 100% preservado');
}

// ==========================================
// Teste 3: Anime existente ganha favorito vindo do AniList
// ==========================================
{
  const localList: AnimeItem[] = [
    makeAnimeItem({
      id: 'local_eva',
      anilistId: 30,
      title: 'Neon Genesis Evangelion',
      isFavorite: false,
    }),
  ];

  const incoming = [
    makeAniListEntry({
      anilistId: 30,
      title: 'Neon Genesis Evangelion',
      isFavorite: true,
    }),
  ];

  const preview = calculateAniListImportPreview(incoming, localList, 'UserTest');
  assert.strictEqual(preview.matchedItems.length, 1);
  const favChange = preview.matchedItems[0].changes.find((c) => c.field === 'isFavorite');
  assert.ok(favChange, 'Preview de diff deve identificar a alteração de favorito');
  assert.strictEqual(favChange?.newVal, 'Destacado no AniList');

  const result = mergeAniListImport(incoming, localList, true);
  const eva = result.mergedList.find((a) => a.id === 'local_eva');
  assert.ok(eva);
  assert.strictEqual(eva?.isFavorite, true, 'Anime existente deve se tornar favorito após sincronização');
  assert.strictEqual(result.updatedCount, 1, 'Deve contabilizar como item atualizado');
  console.log('✔ Teste 3 passou: Anime existente sincroniza favorito do AniList e gera diff no preview');
}

// ==========================================
// Teste 4: MyAnimeList - Nunca considerar nota 10 como favorito
// ==========================================
{
  const incoming = [
    makeMALEntry({
      malId: 999,
      title: 'Fullmetal Alchemist: Brotherhood',
      rating: 10, // Nota máxima
    }),
  ];

  const result = mergeMALImport(incoming, [], true);
  assert.strictEqual(result.addedCount, 1);
  const fma = result.mergedList[0];
  assert.strictEqual(fma.rating, 10, 'A nota 10 deve ser preservada');
  assert.strictEqual(
    fma.isFavorite,
    false,
    'Nota 10 no MyAnimeList NUNCA deve se transformar automaticamente em favorito'
  );
  console.log('✔ Teste 4 passou: MyAnimeList nota 10 não é convertida em favorito');
}

// ==========================================
// Teste 5: MyAnimeList - Preservação estrita de favoritos locais existentes
// ==========================================
{
  const localList: AnimeItem[] = [
    makeAnimeItem({
      id: 'local_hunter',
      malId: 11061,
      title: 'Hunter x Hunter (2011)',
      isFavorite: true, // Favorito manual
    }),
  ];

  const incoming = [
    makeMALEntry({
      malId: 11061,
      title: 'Hunter x Hunter (2011)',
      rating: 9,
    }),
  ];

  const result = mergeMALImport(incoming, localList, true);
  const hunter = result.mergedList.find((a) => a.id === 'local_hunter');
  assert.ok(hunter);
  assert.strictEqual(hunter?.isFavorite, true, 'Favorito local não pode ser afetado pelo MAL');
  console.log('✔ Teste 5 passou: Importação do MyAnimeList preserva favoritos manuais locais');
}

// ==========================================
// Teste 6: Mapeamento de Personagens Favoritos do AniList
// ==========================================
{
  const rawNode = {
    id: 12345,
    name: {
      userPreferred: 'Frieren',
      full: 'Frieren',
      native: 'フリーレン',
    },
    image: {
      large: 'https://s4.anilist.co/file/anilistcdn/character/large/b12345.png',
      medium: 'https://s4.anilist.co/file/anilistcdn/character/medium/b12345.png',
    },
    media: {
      edges: [
        {
          characterRole: 'MAIN',
          node: {
            id: 154587,
            title: {
              userPreferred: 'Sousou no Frieren',
              romaji: 'Sousou no Frieren',
              english: 'Frieren: Beyond Journey\'s End',
            },
          },
        },
      ],
    },
  };

  const character = mapAniListCharacter(rawNode);
  assert.strictEqual(character.id, 'char_al_12345');
  assert.strictEqual(character.name, 'Frieren');
  assert.strictEqual(character.originalName, 'フリーレン');
  assert.strictEqual(character.animeName, 'Sousou no Frieren');
  assert.strictEqual(character.role, 'Protagonista');
  assert.strictEqual(character.imageUrl, 'https://s4.anilist.co/file/anilistcdn/character/large/b12345.png');
  console.log('✔ Teste 6 passou: mapAniListCharacter extrai campos oficiais do GraphQL');
}

// ==========================================
// Teste 7: Mesclagem e Deduplicação de Personagens Favoritos
// ==========================================
{
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_manual_1',
      name: 'Killua Zoldyck',
      animeName: 'Hunter x Hunter',
      role: 'Protagonista',
      imageUrl: 'https://example.com/killua.jpg',
    },
    {
      id: 'char_al_12345',
      name: 'Frieren',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: 'https://example.com/frieren_old.jpg',
    },
  ];

  const incomingChars: FavoriteCharacter[] = [
    // Duplicata por ID: char_al_12345 já existe na lista manual
    {
      id: 'char_al_12345',
      name: 'Frieren',
      animeName: 'Sousou no Frieren',
      role: 'Protagonista',
      imageUrl: 'https://example.com/frieren_new.jpg',
    },
    // Duplicata por nome e anime: Killua Zoldyck em Hunter x Hunter
    {
      id: 'char_al_99999',
      name: 'Killua Zoldyck',
      animeName: 'Hunter x Hunter',
      role: 'Co-protagonista',
      imageUrl: 'https://example.com/killua_al.jpg',
    },
    // Novo personagem genuíno: Fern
    {
      id: 'char_al_54321',
      name: 'Fern',
      animeName: 'Sousou no Frieren',
      role: 'Principal',
      imageUrl: 'https://example.com/fern.jpg',
    },
  ];

  const merged = mergeFavoriteCharacters(existingChars, incomingChars);

  assert.strictEqual(merged.length, 3, 'Deve conter apenas os 2 originais + 1 novo sem duplicatas');
  assert.strictEqual(merged[0].name, 'Killua Zoldyck', 'Preserva Killua original');
  assert.strictEqual(merged[1].id, 'char_al_12345', 'Preserva Frieren original');
  assert.strictEqual(merged[2].name, 'Fern', 'Adiciona Fern como novo personagem');
  console.log('✔ Teste 7 passou: Deduplicação e preservação de personagens favoritos');
}

// ==========================================
// Teste 8: Lista de favoritos vazia não afeta registros existentes
// ==========================================
{
  const existingChars: FavoriteCharacter[] = [
    {
      id: 'char_manual_1',
      name: 'Gintoki Sakata',
      animeName: 'Gintama',
      role: 'Protagonista',
      imageUrl: 'https://example.com/gintoki.jpg',
    },
  ];

  const merged = mergeFavoriteCharacters(existingChars, []);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].name, 'Gintoki Sakata');
  console.log('✔ Teste 8 passou: Favoritos ausentes ou vazios não apagam dados locais');
}

console.log('--- TODOS OS TESTES DE FAVORITOS (ETAPA 4) PASSARAM COM SUCESSO! ---');
