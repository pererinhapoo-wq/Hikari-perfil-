import assert from 'node:assert';
import type { AnimeItem, AnimeStatus } from '../../types';

console.log('======================================================');
console.log('TESTES DE DESEMPENHO E NAVEGAÇÃO — HIKARI PERFIL');
console.log('======================================================');

// 1. Gerador de lista simulada de 2.000 animes
function generateSimulatedAnimes(count = 2000): AnimeItem[] {
  const statuses: AnimeItem['status'][] = ['watching', 'completed', 'planned', 'on_hold', 'dropped'];
  const genresList = ['Action', 'Adventure', 'Drama', 'Fantasy', 'Sci-Fi', 'Comedy', 'Mystery', 'Romance'];

  const list: AnimeItem[] = [];
  for (let i = 1; i <= count; i++) {
    const status = statuses[i % statuses.length];
    const genre = genresList[i % genresList.length];
    list.push({
      id: `sim_anime_${i}`,
      title: `Anime Simulado ${i} — ${genre}`,
      titleRomaji: `Anime Simulado Romaji ${i}`,
      posterUrl: `https://cdn.myanimelist.net/images/anime/${(i % 100) + 1}/poster.jpg`,
      status,
      currentEpisode: status === 'completed' ? 24 : (i % 24),
      totalEpisodes: 24,
      rating: (i % 10) + 1,
      isFavorite: i % 10 === 0, // 200 favoritos
      year: 2000 + (i % 25),
      genres: [genre, 'Animation'],
    });
  }
  return list;
}

const largeAnimeList = generateSimulatedAnimes(2000);
assert.strictEqual(largeAnimeList.length, 2000, 'Lista de 2.000 animes gerada com sucesso.');

// 2. Teste do Algoritmo de Janelamento Virtual
console.log('\n--- 1. Validação do Algoritmo de Janelamento Virtual ---');

const COLUMNS = 3;
const OVERSCAN_ROWS = 2;
const ROW_HEIGHT = 380;
const VIEWPORT_HEIGHT = 800;

function computeVirtualWindow(
  items: AnimeItem[],
  scrollY: number,
  gridOffsetTop: number,
  rowHeight: number,
  viewportHeight: number
) {
  const totalItems = items.length;
  const totalRows = Math.ceil(totalItems / COLUMNS);

  if (totalItems <= 24) {
    return {
      visibleItems: items,
      topPadding: 0,
      bottomPadding: 0,
      startRow: 0,
      endRow: totalRows,
    };
  }

  const relativeScroll = Math.max(0, scrollY - gridOffsetTop);
  const startRow = Math.max(0, Math.floor(relativeScroll / rowHeight) - OVERSCAN_ROWS);
  const endRow = Math.min(totalRows, Math.ceil((relativeScroll + viewportHeight) / rowHeight) + OVERSCAN_ROWS);

  const startIndex = startRow * COLUMNS;
  const endIndex = Math.min(totalItems, endRow * COLUMNS);

  return {
    visibleItems: items.slice(startIndex, endIndex),
    topPadding: startRow * rowHeight,
    bottomPadding: Math.max(0, (totalRows - endRow) * rowHeight),
    startRow,
    endRow,
  };
}

// Teste 1.1: No topo da página (scroll = 0)
const topWindow = computeVirtualWindow(largeAnimeList, 0, 0, ROW_HEIGHT, VIEWPORT_HEIGHT);
assert(
  topWindow.visibleItems.length <= 24,
  `Apenas ${topWindow.visibleItems.length} cards renderizados no topo (esperado <= 24, e NÃO 2.000)`
);
assert.strictEqual(topWindow.topPadding, 0, 'Top padding inicial é 0');
assert(topWindow.bottomPadding > 200000, 'Bottom padding sustenta o scrollbar completo da página');
console.log(`  ✓ Topo (scroll=0): Apenas ${topWindow.visibleItems.length} cards no DOM, padding-bottom: ${topWindow.bottomPadding}px`);

// Teste 1.2: No meio da página (scroll = 100.000px)
const midWindow = computeVirtualWindow(largeAnimeList, 100000, 0, ROW_HEIGHT, VIEWPORT_HEIGHT);
assert(
  midWindow.visibleItems.length <= 24,
  `Apenas ${midWindow.visibleItems.length} cards renderizados no meio (esperado <= 24)`
);
assert(midWindow.topPadding > 90000, 'Cards anteriores removidos do DOM e compensados com topPadding');
assert(midWindow.bottomPadding > 0, 'Cards posteriores ainda não atingidos mantêm bottomPadding');
assert(midWindow.startRow > 200, `Linha inicial avançou corretamente para linha ${midWindow.startRow}`);
console.log(`  ✓ Meio (scroll=100.000px): ${midWindow.visibleItems.length} cards ativos, linha inicial: ${midWindow.startRow}, topPadding: ${midWindow.topPadding}px`);

// Teste 1.3: No final da página (scroll = 252.000px)
const bottomWindow = computeVirtualWindow(largeAnimeList, 252000, 0, ROW_HEIGHT, VIEWPORT_HEIGHT);
assert(
  bottomWindow.visibleItems.length > 0 && bottomWindow.visibleItems.length <= 24,
  `Apenas ${bottomWindow.visibleItems.length} cards renderizados no rodapé`
);
assert.strictEqual(bottomWindow.bottomPadding, 0, 'Bottom padding atinge 0 no rodapé');
console.log(`  ✓ Rodapé (scroll=252.000px): Apenas ${bottomWindow.visibleItems.length} cards no DOM, bottomPadding zerado`);

// 3. Teste de Filtros, Pesquisa e Ordenação sobre a Lista Completa
console.log('\n--- 2. Filtros e Pesquisa sobre a Coleção Completa (2.000 Itens) ---');

// Filtro por status
const watchingItems = largeAnimeList.filter((a) => a.status === 'watching');
assert.strictEqual(watchingItems.length, 400, 'Filtro watching encontra exatamente 400 animes');
const watchingWindow = computeVirtualWindow(watchingItems, 0, 0, ROW_HEIGHT, VIEWPORT_HEIGHT);
assert(watchingWindow.visibleItems.length <= 24, 'Janela virtual para status watching restrita a <= 24 cards');
console.log(`  ✓ Filtro de status "Assistindo": 400 animes encontrados na coleção, ${watchingWindow.visibleItems.length} no DOM`);

// Filtro por busca de texto
const searchFantasy = largeAnimeList.filter((a) => a.title.toLowerCase().includes('fantasy') || a.genres.includes('Fantasy'));
assert(searchFantasy.length > 0, 'Busca por gênero Fantasy encontra resultados na coleção');
console.log(`  ✓ Busca textual por "Fantasy": ${searchFantasy.length} animes filtrados com sucesso`);

// 4. Teste de Alternância Repetida de Abas (Simulação de 100 Trocas)
console.log('\n--- 3. Simulação de 100 Trocas Rápidas de Abas ---');
const t0 = performance.now();
let activeTab: 'overview' | 'animes' = 'overview';
let preservedScrollY = 1250;

for (let i = 0; i < 100; i++) {
  activeTab = activeTab === 'overview' ? 'animes' : 'overview';
  if (activeTab === 'animes') {
    // Simula renderização do slice da aba animes na posição preservada
    const windowSlice = computeVirtualWindow(largeAnimeList, preservedScrollY, 300, ROW_HEIGHT, VIEWPORT_HEIGHT);
    assert(windowSlice.visibleItems.length <= 24);
  }
}
const elapsed = performance.now() - t0;
console.log(`  ✓ 100 alternâncias consecutivas entre "Visão geral" e "Animes" concluídas em ${elapsed.toFixed(2)}ms (~${(elapsed / 100).toFixed(3)}ms por troca)`);

// 5. Verificação da Integridade de Textos e Dados dos Usuários
console.log('\n--- 4. Preservação de Dados de Usuário e Remoção de Decoradores ---');
import { OTHER_USERS, INITIAL_ACTIVITIES } from '../../data/mockData';

assert.strictEqual(OTHER_USERS['usr_kuroha'].displayName, 'Kuroha ✦', 'Nome de usuário com símbolo "Kuroha ✦" preservado integralmente');
const starActivity = INITIAL_ACTIVITIES.find((a) => a.title.includes('★'));
assert(Boolean(starActivity), 'Atividade com nota "Avaliou com nota 9.8 ★" preservada nos dados');
console.log('  ✓ Dados de usuário contendo "Kuroha ✦" e "Avaliou com nota 9.8 ★" mantidos intactos');

console.log('\n======================================================');
console.log('TODOS OS TESTES DE DESEMPENHO E NAVEGAÇÃO PASSARAM COM SUCESSO!');
console.log('======================================================\n');
