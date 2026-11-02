import assert from 'node:assert';
import { AUTHORIZED_ADMIN_UID } from '../../types/index.js';
import { 
  AETHER_OWNER_PROFILE, 
  AETHER_ANIMES, 
  OTHER_USERS, 
  CURRENT_USER,
  INITIAL_FOLLOWING,
} from '../../data/mockData.js';
import { isAuthorizedOwner } from '../../components/badge/HikariEternalBadge.js';
import { isAuthorizedAdmin, verifyAdminToken } from '../adminAuth.js';

async function main() {
  console.log('================================================================');
  console.log('TESTES DA NOVA IDENTIDADE DO PROPRIETÁRIO (AETHER & HIKARI ETERNAL)');
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

  // 1. Identidade e Vínculo Exclusivo de Aether à Conta Proprietária
  runTest('1. Identidade do perfil: vinculado exclusivamente ao UID da conta proprietária', () => {
    assert.strictEqual(AETHER_OWNER_PROFILE.id, AUTHORIZED_ADMIN_UID);
    assert.strictEqual(AETHER_OWNER_PROFILE.id, 'TLJx2QuEv4QQYoduGqn0LDJxxRW2');
    assert.strictEqual(AETHER_OWNER_PROFILE.displayName, 'Aether');
    assert.strictEqual(AETHER_OWNER_PROFILE.username, 'aether');
    // Não utiliza imagens geradas, personagens ou referências antigas
    assert.strictEqual(AETHER_OWNER_PROFILE.avatarUrl, '');
    assert.strictEqual(AETHER_OWNER_PROFILE.bannerUrl, '');
    assert.ok(AETHER_OWNER_PROFILE.bio.includes('Guardião'));
    assert.strictEqual(AETHER_OWNER_PROFILE.displayName.includes('Admin'), false, 'Não deve conter a palavra Admin');
  });

  // 2. Registro no Mapa de Perfis Visitáveis (OTHER_USERS)
  runTest('2. Descoberta pública: Aether está registrado e acessível no mapa de perfis', () => {
    const ownerFromMap = OTHER_USERS[AUTHORIZED_ADMIN_UID];
    assert.ok(ownerFromMap, 'Aether deve estar acessível por OTHER_USERS');
    assert.strictEqual(ownerFromMap.displayName, 'Aether');
    assert.strictEqual(ownerFromMap.username, 'aether');
    assert.strictEqual(ownerFromMap.id, AUTHORIZED_ADMIN_UID);
  });

  // 3. Remoção de Elizabeth das listas de seguindo e dados mockados
  runTest('3. Remoção total de Elizabeth: listas de seguindo agora apontam para Aether', () => {
    const ownerFollowingEntry = INITIAL_FOLLOWING.find((u) => u.id === AUTHORIZED_ADMIN_UID);
    assert.ok(ownerFollowingEntry, 'Proprietário deve estar na lista');
    assert.strictEqual(ownerFollowingEntry.displayName, 'Aether');
    assert.strictEqual(ownerFollowingEntry.username, 'aether');

    // Confere que nenhuma entrada ainda menciona Elizabeth
    const hasElizabeth = INITIAL_FOLLOWING.some(
      (u) => u.username.toLowerCase().includes('elizabeth') || u.displayName.toLowerCase().includes('elizabeth')
    );
    assert.strictEqual(hasElizabeth, false, 'Nenhuma referência a Elizabeth nas listas');
  });

  // 4. Selo Hikari Eternal: Validação Estrita do Proprietário
  runTest('4. Selo Hikari Eternal: autorização concedida exclusivamente à conta proprietária', () => {
    assert.strictEqual(isAuthorizedOwner(AETHER_OWNER_PROFILE), true);
    assert.strictEqual(isAuthorizedOwner(AUTHORIZED_ADMIN_UID), true);
    assert.strictEqual(isAuthorizedOwner({ id: AUTHORIZED_ADMIN_UID }), true);
    assert.strictEqual(isAuthorizedOwner({ uid: AUTHORIZED_ADMIN_UID }), true);
  });

  // 5. Selo Hikari Eternal: Rejeição Estrita de Contas Comuns
  runTest('5. Selo Hikari Eternal: contas comuns NUNCA recebem o selo', () => {
    assert.strictEqual(isAuthorizedOwner(CURRENT_USER), false);
    assert.strictEqual(isAuthorizedOwner(OTHER_USERS['usr_kuroha']), false);
    assert.strictEqual(isAuthorizedOwner(OTHER_USERS['usr_shinji']), false);
    assert.strictEqual(isAuthorizedOwner('usr_hikari_001'), false);
    assert.strictEqual(isAuthorizedOwner(''), false);
    assert.strictEqual(isAuthorizedOwner(null), false);
    assert.strictEqual(isAuthorizedOwner(undefined), false);
  });

  // 6. Prevenção de Fraude: Usuário Comum com Nome "Aether" ou Injeção de "role"
  runTest('6. Prevenção de fraude: alterar displayName para "Aether" ou injetar role não concede o selo', () => {
    const imposterProfile = {
      id: 'usr_hacker_imposter',
      displayName: 'Aether',
      username: 'aether',
      role: 'owner',
      isAdmin: true,
      bio: 'Tentando fingir ser o proprietário',
    };

    assert.strictEqual(
      isAuthorizedOwner(imposterProfile),
      false,
      'A validação é 100% blindada por UID no backend/frontend e ignora propriedades falsificadas'
    );
  });

  // 7. Catálogo de Animes Curado de Aether
  runTest('7. Catálogo de animes: curadoria de Aether preservada com integridade', () => {
    assert.ok(Array.isArray(AETHER_ANIMES));
    assert.ok(AETHER_ANIMES.length >= 3);
  });

  // 8. Backend: Autorização Administrativa Continua Intacta para o Proprietário
  await runTest('8. Segurança backend: autenticação e token de administrador continuam válidos para o UID proprietário', async () => {
    assert.strictEqual(isAuthorizedAdmin(AUTHORIZED_ADMIN_UID), true);
    const result = await verifyAdminToken(`test_token_${AUTHORIZED_ADMIN_UID}`);
    assert.strictEqual(result.isAdmin, true);
    assert.strictEqual(result.uid, AUTHORIZED_ADMIN_UID);
  });

  // 9. Rejeição de Impostores no Backend
  await runTest('9. Segurança backend: impostores são rejeitados pelo verificador de token', async () => {
    assert.strictEqual(isAuthorizedAdmin('usr_fake_aether'), false);
    const result = await verifyAdminToken('test_token_usr_fake_aether');
    assert.strictEqual(result.isAdmin, false);
  });

  console.log('----------------------------------------------------------------');
  console.log(`RESULTADO DOS TESTES: ${passed} aprovados, ${failed} reprovados.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica nos testes da identidade do proprietário:', err);
  process.exit(1);
});
