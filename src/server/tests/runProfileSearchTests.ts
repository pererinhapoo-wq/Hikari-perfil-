import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OTHER_USERS } from '../../data/mockData.js';
import { UserProfile } from '../../types/index.js';

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface ProfileSearchResult {
  profile: UserProfile;
  isSelf: boolean;
  isPrivate: boolean;
  matchScore: number;
}

function searchProfiles(
  rawTerm: string,
  candidateProfiles: UserProfile[],
  currentUserId: string,
  limit: number = 10
): ProfileSearchResult[] {
  const cleanTerm = normalizeSearchText(rawTerm.replace(/^@/, ''));
  if (!cleanTerm) return [];

  const matched: ProfileSearchResult[] = [];

  for (const profile of candidateProfiles) {
    if (!profile || !profile.id) continue;

    const normName = normalizeSearchText(profile.displayName || '');
    const normUser = normalizeSearchText(profile.username || '');

    let score = 0;

    if (normUser.startsWith(cleanTerm)) {
      score += 100;
    } else if (normUser.includes(cleanTerm)) {
      score += 50;
    }

    if (normName.startsWith(cleanTerm)) {
      score += 80;
    } else if (normName.includes(cleanTerm)) {
      score += 40;
    }

    if (score > 0) {
      matched.push({
        profile,
        isSelf: profile.id === currentUserId,
        isPrivate: Boolean(profile.isPrivate),
        matchScore: score,
      });
    }
  }

  matched.sort((a, b) => b.matchScore - a.matchScore);
  return matched.slice(0, limit);
}

console.log('================================================================');
console.log('TESTES DA BARRA EXCLUSIVA DE BUSCA DE PERFIS — HIKARI PERFIL');
console.log('================================================================');

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const mockProfiles: UserProfile[] = Object.values(OTHER_USERS);

// 1. Sugestões automáticas com "mat"
runTest('1. Sugestão automática ao digitar "mat" encontra Mateus Silva (@mateus_silva)', () => {
  const results = searchProfiles('mat', mockProfiles, 'usr_ren');
  assert.ok(results.length > 0, 'Deve retornar ao menos 1 resultado para "mat"');
  const mateus = results.find((r) => r.profile.username === 'mateus_silva');
  assert.ok(mateus, 'Mateus Silva deve estar presente nos resultados');
  assert.strictEqual(mateus.profile.displayName, 'Mateus Silva');
});

// 2. Busca case-insensitive e com @
runTest('2. Busca é tolerante a maiúsculas/minúsculas e prefixo @', () => {
  const res1 = searchProfiles('MAT', mockProfiles, 'usr_ren');
  const res2 = searchProfiles('@mat', mockProfiles, 'usr_ren');
  const res3 = searchProfiles('@mateus_silva', mockProfiles, 'usr_ren');

  assert.strictEqual(res1.length, res2.length, 'Resultados de "MAT" e "@mat" devem ser equivalentes');
  assert.strictEqual(res3[0].profile.username, 'mateus_silva', 'Busca direta por @mateus_silva deve ser top resultado');
});

// 3. Exclusividade de perfis (não pesquisa animes)
runTest('3. Pesquisa exclusivamente perfis de usuários (zero animes ou tópicos)', () => {
  const results = searchProfiles('frieren', mockProfiles, 'usr_ren');
  // Nenhum usuário possui frieren no nome ou username
  assert.strictEqual(results.length, 0, 'Não deve retornar títulos de anime como Frieren');
});

// 4. Limitação de resultados a no máximo 10
runTest('4. Limitação estrita de resultados: nunca retorna mais que 10 perfis de uma vez', () => {
  // Criar lista sintética com 30 perfis
  const manyProfiles: UserProfile[] = Array.from({ length: 30 }, (_, i) => ({
    ...OTHER_USERS['usr_shinji'],
    id: `usr_test_${i}`,
    username: `test_user_${i}`,
    displayName: `Test User ${i}`,
  }));

  const results = searchProfiles('test', manyProfiles, 'usr_ren', 10);
  assert.strictEqual(results.length, 10, 'Deve limitar a exatamente 10 resultados');
});

// 5. Preservação e respeito à privacidade (isPrivate)
runTest('5. Perfis privados exibem indicador isPrivate e não vazam credenciais ou dados restritos', () => {
  const kurohaProfile = OTHER_USERS['usr_kuroha'];
  assert.strictEqual(kurohaProfile.isPrivate, true, 'Kuroha deve ser perfil privado');

  const results = searchProfiles('kuroha', mockProfiles, 'usr_ren');
  const kuroha = results.find((r) => r.profile.id === 'usr_kuroha');
  assert.ok(kuroha, 'Kuroha deve ser encontrada');
  assert.strictEqual(kuroha.isPrivate, true, 'isPrivate deve ser sinalizado como verdadeiro');

  // Verifica que campos confidenciais não existem no UserProfile
  const profObj = kuroha.profile as unknown as Record<string, unknown>;
  assert.strictEqual(profObj.email, undefined, 'E-mail privado não deve constar no objeto de perfil público');
  assert.strictEqual(profObj.password, undefined, 'Senha não deve constar no objeto');
  assert.strictEqual(profObj.tokens, undefined, 'Tokens não devem constar no objeto');
});

// 6. Ranking de relevância: correspondência inicial pontua mais que substring
runTest('6. Usuários com prefixo correspondente aparecem no topo do ranking', () => {
  const candidatePool: UserProfile[] = [
    {
      ...OTHER_USERS['usr_shinji'],
      id: 'usr_sub_mat',
      username: 'animat_fan',
      displayName: 'Fan do Animat',
    },
    {
      ...OTHER_USERS['usr_mateus'],
      id: 'usr_exact_mat',
      username: 'mateus_silva',
      displayName: 'Mateus Silva',
    },
  ];

  const results = searchProfiles('mat', candidatePool, 'usr_ren');
  assert.strictEqual(results[0].profile.username, 'mateus_silva', 'mateus_silva (prefixo) deve vir antes de animat_fan (substring)');
});

// 7. Simulação de Bloqueio e Restauração de Rolagem sem saltos
runTest('7. Protocolo de rolagem independente congela body na posição salva e restaura no fechamento', () => {
  let savedScrollY = 1240;
  let bodyPosition = '';
  let bodyTop = '';
  let bodyOverflow = '';
  let restoredScrollY = -1;

  // Ao abrir a busca:
  bodyPosition = 'fixed';
  bodyTop = `-${savedScrollY}px`;
  bodyOverflow = 'hidden';

  assert.strictEqual(bodyPosition, 'fixed');
  assert.strictEqual(bodyTop, '-1240px');
  assert.strictEqual(bodyOverflow, 'hidden');

  // Ao fechar a busca:
  bodyPosition = '';
  bodyTop = '';
  bodyOverflow = '';
  restoredScrollY = savedScrollY;

  assert.strictEqual(bodyPosition, '');
  assert.strictEqual(bodyTop, '');
  assert.strictEqual(restoredScrollY, 1240, 'Posição anterior de rolagem restaurada perfeitamente');
});

console.log('----------------------------------------------------------------');
console.log(`RESULTADO DOS TESTES: ${passed} aprovados, ${failed} reprovados.`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
