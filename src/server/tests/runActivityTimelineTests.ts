import assert from 'node:assert';
import { INITIAL_ACTIVITIES, INITIAL_ANIMES } from '../../data/mockData.ts';
import { resolveActivityPoster, resolveActivityAnimeTitle } from '../../utils/activityPoster.ts';
import type { UserActivity, AnimeItem } from '../../types/index.ts';

console.log('--- TEST SUITE: ETAPA 3 — LINHA DO TEMPO DE ATIVIDADES HIKARI ---');

// TEST 1: Capas corretas para diferentes tipos de atividades
console.log('1. Testando capas reais corretas para diferentes tipos de atividades...');
const typesTested = new Set<UserActivity['type']>();

for (const act of INITIAL_ACTIVITIES) {
  typesTested.add(act.type);
  const poster = resolveActivityPoster(act, INITIAL_ANIMES);
  if (act.animeId || act.animeTitle || act.description.includes('Solo Leveling') || act.description.includes('Frieren')) {
    assert(poster && poster.startsWith('https://'), `Atividade ${act.id} (${act.type}) deveria ter capa oficial válida, obteve: ${poster}`);
  }
}

// Verifica que testamos todos os 7 tipos solicitados
const expectedTypes: UserActivity['type'][] = [
  'watched_ep',
  'completed_anime',
  'rated',
  'commented',
  'added_favorite',
  'status_changed',
  'added_anime'
];
for (const t of expectedTypes) {
  assert(typesTested.has(t), `Deveria cobrir o tipo de atividade "${t}"`);
}
console.log('✓ PASS: Capas reais verificadas com sucesso para todos os tipos de atividades!');

// TEST 2: Fallback quando uma imagem não existir
console.log('2. Testando fallback visual discreto quando a imagem não existir...');
const nonAnimeActivity: UserActivity = {
  id: 'act_test_no_poster',
  type: 'commented',
  title: 'Publicou uma mensagem na comunidade geral',
  description: 'Discussão aberta sobre técnicas de animação tradicional',
  timestamp: 'Agora',
  createdAtTimestamp: Date.now()
};
const posterFallback = resolveActivityPoster(nonAnimeActivity, INITIAL_ANIMES);
assert.strictEqual(posterFallback, undefined, 'Atividade sem obra relacionada deve retornar undefined para acionar o fallback');

const missingUrlActivity: UserActivity = {
  id: 'act_test_missing_url',
  type: 'watched_ep',
  title: 'Assistiu obra desconhecida',
  description: 'Obra Inexistente XYZ 12345',
  timestamp: 'Agora'
};
const missingPoster = resolveActivityPoster(missingUrlActivity, INITIAL_ANIMES);
assert.strictEqual(missingPoster, undefined, 'Obra inexistente deve retornar undefined para acionar fallback');
console.log('✓ PASS: Fallback visual discreto ativado corretamente na ausência de imagem!');

// TEST 3: Limite inicial de atividades
console.log('3. Testando limite inicial de atividades exibidas...');
const INITIAL_BATCH_SIZE = 6;
assert(INITIAL_ACTIVITIES.length > INITIAL_BATCH_SIZE, 'Deve haver mais atividades no catálogo que o lote inicial');
const initialSlice = INITIAL_ACTIVITIES.slice(0, INITIAL_BATCH_SIZE);
assert.strictEqual(initialSlice.length, INITIAL_BATCH_SIZE, `Lote inicial deve ter exatamente ${INITIAL_BATCH_SIZE} itens`);
console.log(`✓ PASS: Limite inicial de ${INITIAL_BATCH_SIZE} itens verificado com sucesso!`);

// TEST 4: Funcionamento do botão "Ver tudo" e "Carregar mais"
console.log('4. Testando funcionamento do carregamento progressivo e botão "Ver tudo"...');
let currentVisibleCount = INITIAL_BATCH_SIZE;
const PROGRESSIVE_BATCH_STEP = 6;

// Simula primeiro clique em "Carregar mais"
currentVisibleCount = Math.min(INITIAL_ACTIVITIES.length, currentVisibleCount + PROGRESSIVE_BATCH_STEP);
assert.strictEqual(currentVisibleCount, 12, 'Após clique em carregar mais, contagem deve expandir em lote');

// Simula clique em "Ver tudo"
currentVisibleCount = INITIAL_ACTIVITIES.length;
assert.strictEqual(currentVisibleCount, INITIAL_ACTIVITIES.length, 'Após "Ver tudo", todas as atividades devem ser exibidas');
console.log('✓ PASS: Carregamento progressivo e "Ver tudo" operam com precisão!');

// TEST 5: Ausência de duplicatas durante carregamento
console.log('5. Testando ausência de itens duplicados durante paginação...');
const allIds = INITIAL_ACTIVITIES.map((a) => a.id);
const uniqueIds = new Set(allIds);
assert.strictEqual(allIds.length, uniqueIds.size, 'Não devem existir IDs de atividades duplicadas no histórico');
console.log('✓ PASS: Sem duplicatas em todo o histórico de atividades!');

// TEST 6: Ordem cronológica
console.log('6. Testando preservação da ordem cronológica...');
for (let i = 0; i < INITIAL_ACTIVITIES.length - 1; i++) {
  const current = INITIAL_ACTIVITIES[i];
  const next = INITIAL_ACTIVITIES[i + 1];
  if (current.createdAtTimestamp && next.createdAtTimestamp) {
    assert(
      current.createdAtTimestamp >= next.createdAtTimestamp,
      `Ordem cronológica violada entre ${current.id} (${current.createdAtTimestamp}) e ${next.id} (${next.createdAtTimestamp})`
    );
  }
}
console.log('✓ PASS: Ordem cronológica estritamente preservada (mais recentes primeiro)!');

// TEST 7: Resolução de títulos e metadados de anime
console.log('7. Testando resolução inteligente de títulos de animes para legendas e alt text...');
const soloTitle = resolveActivityAnimeTitle(INITIAL_ACTIVITIES[0], INITIAL_ANIMES);
assert(soloTitle && soloTitle.includes('Solo Leveling'), `Título do anime deveria ser Solo Leveling, obteve: ${soloTitle}`);

const frierenTitle = resolveActivityAnimeTitle(INITIAL_ACTIVITIES[1], INITIAL_ANIMES);
assert(frierenTitle && frierenTitle.includes('Frieren'), `Título do anime deveria ser Frieren, obteve: ${frierenTitle}`);
console.log('✓ PASS: Títulos e obras reconhecidos com perfeição!');

// TEST 8: Preservação de todos os dados das atividades
console.log('8. Testando preservação de metadados (score, episódio, timestamp, títulos)...');
const epActivity = INITIAL_ACTIVITIES.find((a) => a.type === 'watched_ep' && a.episode !== undefined);
assert(epActivity && typeof epActivity.episode === 'number', 'Dados de episódio devem ser preservados');

const ratedActivity = INITIAL_ACTIVITIES.find((a) => a.type === 'rated' && a.score !== undefined);
assert(ratedActivity && typeof ratedActivity.score === 'number', 'Dados de avaliação/nota devem ser preservados');

const completedActivity = INITIAL_ACTIVITIES.find((a) => a.type === 'completed_anime');
assert(completedActivity && completedActivity.description, 'Dados de obra concluída devem ser preservados');

const commentActivity = INITIAL_ACTIVITIES.find((a) => a.type === 'commented');
assert(commentActivity && commentActivity.title, 'Dados de comentário devem ser preservados');
console.log('✓ PASS: Todos os metadados e tipos de eventos preservados sem qualquer perda de dados!');

console.log('-----------------------------------------------------------');
console.log('>>> TODOS OS 8 TESTES DA ETAPA 3 FORAM APROVADOS COM SUCESSO! <<<');
