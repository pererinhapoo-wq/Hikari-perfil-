import assert from 'node:assert';
import { AUTHORIZED_ADMIN_UID } from '../../types/index.js';
import { 
  ELIZABETH_ADMIN_PROFILE, 
  ELIZABETH_ANIMES, 
  OTHER_USERS, 
  CURRENT_USER 
} from '../../data/mockData.js';
import { isProfileAdmin } from '../../components/admin/ElizabethAdminBadge.js';
import { ELIZABETH_SIGNBOARD_PHRASES } from '../../components/admin/ElizabethCorner.js';

async function main() {
  console.log('================================================================');
  console.log('TESTES DO PERFIL PÚBLICO DA ELIZABETH — HIKARI PERFIL (ETAPA 2)');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}`);
            console.error(`    ${err instanceof Error ? err.message : String(err)}`);
            failed++;
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // 1. Identidade e Vínculo Exclusivo da Elizabeth à Conta Proprietária
  runTest('1. Identidade do perfil: vinculado exclusivamente ao UID da conta proprietária', () => {
    assert.strictEqual(ELIZABETH_ADMIN_PROFILE.id, AUTHORIZED_ADMIN_UID);
    assert.strictEqual(ELIZABETH_ADMIN_PROFILE.id, 'TLJx2QuEv4QQYoduGqn0LDJxxRW2');
    assert.strictEqual(ELIZABETH_ADMIN_PROFILE.displayName, 'Elizabeth');
    assert.strictEqual(ELIZABETH_ADMIN_PROFILE.username, 'elizabeth_admin');
    assert.ok(ELIZABETH_ADMIN_PROFILE.avatarUrl.includes('elizabeth_admin_avatar'));
    assert.ok(ELIZABETH_ADMIN_PROFILE.bannerUrl.includes('elizabeth_admin_banner'));
    assert.ok(ELIZABETH_ADMIN_PROFILE.bio.includes('placas'));
  });

  // 2. Registro no Mapa de Perfis Visitáveis (OTHER_USERS)
  runTest('2. Descoberta pública: Elizabeth está registrada e acessível no mapa de perfis', () => {
    const adminFromMap = OTHER_USERS[AUTHORIZED_ADMIN_UID];
    assert.ok(adminFromMap, 'Elizabeth deve estar acessível por OTHER_USERS');
    assert.strictEqual(adminFromMap.displayName, 'Elizabeth');
    assert.strictEqual(adminFromMap.id, AUTHORIZED_ADMIN_UID);
  });

  // 3. Selo Administrativo: Validação Estrita do Proprietário
  runTest('3. Selo administrativo: aprovação exclusiva para a conta proprietária', () => {
    assert.strictEqual(isProfileAdmin(ELIZABETH_ADMIN_PROFILE), true);
    assert.strictEqual(isProfileAdmin(AUTHORIZED_ADMIN_UID), true);
    assert.strictEqual(isProfileAdmin({ id: AUTHORIZED_ADMIN_UID }), true);
    assert.strictEqual(isProfileAdmin({ uid: AUTHORIZED_ADMIN_UID }), true);
  });

  // 4. Selo Administrativo: Rejeição Estrita de Contas Comuns
  runTest('4. Selo administrativo: contas comuns NUNCA recebem o selo', () => {
    assert.strictEqual(isProfileAdmin(CURRENT_USER), false);
    assert.strictEqual(isProfileAdmin(OTHER_USERS['usr_kuroha']), false);
    assert.strictEqual(isProfileAdmin(OTHER_USERS['usr_shinji']), false);
    assert.strictEqual(isProfileAdmin('usr_hikari_001'), false);
    assert.strictEqual(isProfileAdmin(''), false);
    assert.strictEqual(isProfileAdmin(null), false);
    assert.strictEqual(isProfileAdmin(undefined), false);
  });

  // 5. Impossibilidade de Fraude: Usuário Comum com Nome "Elizabeth" ou Role "admin"
  runTest('5. Prevenção de fraude: alterar displayName para "Elizabeth" ou injetar role não ativa o selo', () => {
    const imposterProfile = {
      id: 'usr_hacker_imposter',
      displayName: 'Elizabeth',
      username: 'elizabeth_admin',
      role: 'admin',
      isAdmin: true,
      bio: 'Sou a administradora',
    };

    assert.strictEqual(
      isProfileAdmin(imposterProfile),
      false,
      'A verificação é 100% blindada por UID e ignora qualquer campo cosmético ou customizado'
    );
  });

  // 6. Elizabeth\'s Corner: Frases Engraçadas sobre Hábitos dos Usuários
  runTest('6. Elizabeth\'s Corner: banco de frases cômicas de maratonas, listas e indecisão', () => {
    assert.ok(ELIZABETH_SIGNBOARD_PHRASES.length >= 10, 'Deve conter pelo menos 10 frases variadas');

    const allText = ELIZABETH_SIGNBOARD_PHRASES.join(' ').toLowerCase();
    assert.ok(allText.includes('planejados') || allText.includes('lista'), 'Deve conter brincadeiras sobre listas');
    assert.ok(allText.includes('episódio') || allText.includes('maratona'), 'Deve conter brincadeiras sobre maratonar');
    assert.ok(allText.includes('assistir') || allText.includes('escolhendo'), 'Deve conter brincadeiras sobre escolher animes');
  });

  // 7. Tipografia e Ajuste Proporcional: Ausência de Quebras ou Textos Excessivos
  runTest('7. Placas: formatação segura e limites de caracteres para preservação de margens', () => {
    for (const phrase of ELIZABETH_SIGNBOARD_PHRASES) {
      assert.ok(phrase.trim().length > 10, 'Frase não pode ser vazia');
      assert.ok(phrase.length <= 150, `Frase não pode exceder 150 caracteres para caber na placa sem cortar: "${phrase}"`);
      // Nenhuma palavra monstruosa que quebre o layout sem hífen
      const words = phrase.split(/\s+/);
      for (const word of words) {
        assert.ok(word.length <= 25, `Nenhuma palavra única deve exceder 25 caracteres: "${word}"`);
      }
    }
  });

  // 8. Limites de Presença da Elizabeth: Corner Bloqueado para Outros Perfis
  runTest('8. Limites de presença: Elizabeth\'s Corner é estritamente bloqueado para perfis não-admin', () => {
    // Apenas perfis cujo UID passe em isProfileAdmin têm permissão de renderizar o Corner
    assert.strictEqual(isProfileAdmin('usr_hikari_001'), false);
    assert.strictEqual(isProfileAdmin('usr_kuroha'), false);
    assert.strictEqual(isProfileAdmin(AUTHORIZED_ADMIN_UID), true);
  });

  // 9. Curadoria de Animes da Elizabeth (Gintama e Clássicos de Humor/Ação)
  runTest('9. Catálogo de animes da Elizabeth: presença de Gintama e clássicos da comédia', () => {
    assert.ok(ELIZABETH_ANIMES.length >= 3);
    const hasGintama = ELIZABETH_ANIMES.some((a) => a.title.toLowerCase().includes('gintama'));
    assert.ok(hasGintama, 'O perfil da Elizabeth deve ter Gintama em sua lista de animes');
  });

  // 10. Ausência de Painel Administrativo ou Privilégios no Perfil Público
  runTest('10. Segurança: o perfil público não expõe painel administrativo nem controles confidenciais', () => {
    // Certificamos que o objeto de perfil da Elizabeth não vaza segredos
    assert.strictEqual('adminKey' in ELIZABETH_ADMIN_PROFILE, false);
    assert.strictEqual('serviceAccount' in ELIZABETH_ADMIN_PROFILE, false);
    assert.strictEqual(ELIZABETH_ADMIN_PROFILE.isPrivate, false, 'Perfil é público para a comunidade');
  });

  console.log('----------------------------------------------------------------');
  console.log(`RESULTADO DOS TESTES: ${passed} aprovados, ${failed} reprovados.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica nos testes do perfil da Elizabeth:', err);
  process.exit(1);
});
