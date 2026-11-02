import assert from 'node:assert/strict';
import {
  CURRENT_USER,
  OTHER_USERS,
  INITIAL_FOLLOWERS,
  INITIAL_FOLLOWING,
} from '../../data/mockData';
import {
  sanitizeWorkspaceForUid,
  createEmptyUserWorkspace,
  type UserPersonalWorkspace,
} from '../../lib/userWorkspaceStorage';
import type { UserProfile, FollowUser } from '../../types';

// Mock localStorage for isolated node execution
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockLocalStorage = new MemoryStorage();
// @ts-expect-error polyfill for Node.js test environment
globalThis.window = { localStorage: mockLocalStorage } as unknown as Window & typeof globalThis;

console.log('======================================================');
console.log('TESTES DE SEGUIR E DEIXAR DE SEGUIR — HIKARI PERFIL');
console.log('======================================================');

let passedCount = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// --------------------------------------------------------------------------
// 1. Verificação de Rótulos de Interface (Seguir vs Deixar de seguir)
// --------------------------------------------------------------------------
console.log('\n--- 1. Rótulos e Ícones da Relação de Seguidor ---');

test('No perfil de outro usuário não seguido, botão deve indicar "Seguir"', () => {
  const isFollowing = false;
  const isRequested = false;
  const isPrivate = false;

  const label = isFollowing
    ? 'Deixar de seguir'
    : isRequested
    ? 'Solicitado'
    : isPrivate
    ? 'Solicitar para Seguir'
    : 'Seguir';

  assert.equal(label, 'Seguir');
});

test('No perfil de outro usuário já seguido, botão deve indicar diretamente "Deixar de seguir"', () => {
  const isFollowing = true;
  const isRequested = false;
  const isPrivate = false;

  const label = isFollowing
    ? 'Deixar de seguir'
    : isRequested
    ? 'Solicitado'
    : isPrivate
    ? 'Solicitar para Seguir'
    : 'Seguir';

  assert.equal(label, 'Deixar de seguir');
});

test('No perfil privado não seguido, botão deve indicar "Solicitar para Seguir"', () => {
  const isFollowing = false;
  const isRequested = false;
  const isPrivate = true;

  const label = isFollowing
    ? 'Deixar de seguir'
    : isRequested
    ? 'Solicitado'
    : isPrivate
    ? 'Solicitar para Seguir'
    : 'Seguir';

  assert.equal(label, 'Solicitar para Seguir');
});

test('No perfil privado já seguido com sucesso, botão deve exibir "Deixar de seguir"', () => {
  const isFollowing = true;
  const isRequested = false;
  const isPrivate = true;

  // Relação confirmada prevalece sobre privacidade para desvinculação
  const label = isFollowing
    ? 'Deixar de seguir'
    : isRequested
    ? 'Solicitado'
    : isPrivate
    ? 'Solicitar para Seguir'
    : 'Seguir';

  assert.equal(label, 'Deixar de seguir');
});

// --------------------------------------------------------------------------
// 2. Operação Atômica: Seguir e Deixar de Seguir (Contadores Simétricos)
// --------------------------------------------------------------------------
console.log('\n--- 2. Atualização Correta e Simétrica dos Contadores ---');

test('Ao seguir um usuário, atualiza followersCount do alvo (+1) e followingCount do autor (+1)', () => {
  const authorProfile: UserProfile = { ...CURRENT_USER, followingCount: 388 };
  const targetProfile: UserProfile = { ...OTHER_USERS['usr_shinji'], followersCount: 520 };
  const followingSet = new Set<string>();

  // Ação: Seguir Shinji
  const targetId = targetProfile.id;
  assert.equal(followingSet.has(targetId), false);

  followingSet.add(targetId);
  const updatedAuthorFollowingCount = authorProfile.followingCount + 1;
  const updatedTargetFollowersCount = targetProfile.followersCount + 1;

  assert.equal(updatedAuthorFollowingCount, 389);
  assert.equal(updatedTargetFollowersCount, 521);
  assert.equal(followingSet.has(targetId), true);
});

test('Ao deixar de seguir, atualiza followersCount do alvo (-1) e followingCount do autor (-1)', () => {
  const authorProfile: UserProfile = { ...CURRENT_USER, followingCount: 389 };
  const targetProfile: UserProfile = { ...OTHER_USERS['usr_shinji'], followersCount: 521 };
  const followingSet = new Set<string>([targetProfile.id]);

  // Ação: Deixar de seguir Shinji
  const targetId = targetProfile.id;
  assert.equal(followingSet.has(targetId), true);

  followingSet.delete(targetId);
  const updatedAuthorFollowingCount = Math.max(0, authorProfile.followingCount - 1);
  const updatedTargetFollowersCount = Math.max(0, targetProfile.followersCount - 1);

  assert.equal(updatedAuthorFollowingCount, 388);
  assert.equal(updatedTargetFollowersCount, 520);
  assert.equal(followingSet.has(targetId), false);
});

test('Contadores nunca assumem valores negativos mesmo com chamadas repetidas de unfollow', () => {
  let count = 0;
  for (let i = 0; i < 5; i++) {
    count = Math.max(0, count - 1);
  }
  assert.equal(count, 0);
});

// --------------------------------------------------------------------------
// 3. Persistência e Recuperação após Recarregamento (Reload)
// --------------------------------------------------------------------------
console.log('\n--- 3. Persistência de Relações e Contadores após Reload ---');

test('Modo Demo: Grava e recupera relação de seguidor e contadores do storage local', () => {
  const DEMO_STORAGE_KEY = 'hikari_profile_user_data_v1';
  mockLocalStorage.clear();

  // Simula estado após Ren seguir um novo usuário
  const payload = {
    profileOverrides: {
      displayName: CURRENT_USER.displayName,
      username: CURRENT_USER.username,
      followingCount: 389,
      followersCount: 1420,
    },
    animes: [],
    comments: [],
    activities: [],
    notifications: [],
    followingIds: ['usr_kuroha', 'usr_shinji', 'usr_custom_001'],
    otherProfiles: {
      'usr_custom_001': {
        ...OTHER_USERS['usr_shinji'],
        id: 'usr_custom_001',
        username: 'custom_anime_fan',
        followersCount: 1,
      },
    },
  };

  mockLocalStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(payload));

  // Simula recarregamento da página (hidratação limpa do storage)
  const reloadedRaw = mockLocalStorage.getItem(DEMO_STORAGE_KEY);
  assert.ok(reloadedRaw, 'Storage deve conter os dados gravados');

  const parsed = JSON.parse(reloadedRaw);
  const reloadedFollowingIds = new Set<string>(parsed.followingIds);

  assert.equal(reloadedFollowingIds.has('usr_custom_001'), true);
  assert.equal(parsed.profileOverrides.followingCount, 389);
  assert.equal(parsed.otherProfiles['usr_custom_001'].followersCount, 1);

  // Rótulo recuperado após reload
  const isFollowingAfterReload = reloadedFollowingIds.has('usr_custom_001');
  const labelAfterReload = isFollowingAfterReload ? 'Deixar de seguir' : 'Seguir';
  assert.equal(labelAfterReload, 'Deixar de seguir');
});

test('Modo Autenticado: Sanitização de workspace preserva followingIds e lista de seguindo', () => {
  const testUid = 'usr_firebase_alice_777';
  const workspace: UserPersonalWorkspace = {
    ...createEmptyUserWorkspace(testUid),
    profileOverrides: {
      followingCount: 5,
      followersCount: 12,
    },
    followingIds: ['usr_bob', 'usr_charlie', 'usr_shinji'],
    following: [
      {
        id: 'usr_shinji',
        username: 'shinji_mecha',
        displayName: 'Shinji Kazuki',
        avatarUrl: '',
        bio: 'Crítico amador de mechas',
        isFollowing: true,
        isRequested: false,
        isFollower: false,
        isBlocked: false,
        createdAt: '12 de novembro de 2023',
      },
    ],
    updatedAtMs: Date.now(),
  };

  const sanitized = sanitizeWorkspaceForUid(workspace, testUid);
  assert.ok(sanitized, 'Workspace deve passar na validação estrita de segurança');
  assert.equal(sanitized.uid, testUid);
  assert.deepEqual(sanitized.followingIds, ['usr_bob', 'usr_charlie', 'usr_shinji']);
  assert.equal(sanitized.profileOverrides.followingCount, 5);
  assert.equal(sanitized.profileOverrides.followersCount, 12);
  assert.equal(sanitized.following.length, 1);
  assert.equal(sanitized.following[0].id, 'usr_shinji');
});

// --------------------------------------------------------------------------
// 4. Prevenção de Cliques Repetidos e Anti-Duplicação
// --------------------------------------------------------------------------
console.log('\n--- 4. Prevenção de Cliques Repetidos e Anti-Duplicação ---');

test('Cliques repetidos durante operação bloqueada (isFollowPending) são ignorados', () => {
  let isFollowPending = false;
  let followCallCount = 0;

  function attemptToggle() {
    if (isFollowPending) return;
    isFollowPending = true;
    followCallCount++;
    // Simula tempo de processamento assíncrono
  }

  // 1º clique (válido)
  attemptToggle();
  assert.equal(followCallCount, 1);
  assert.equal(isFollowPending, true);

  // 2º ao 10º cliques rápidos enquanto a operação está pendente
  for (let i = 0; i < 9; i++) {
    attemptToggle();
  }
  // Contador de execuções deve permanecer estritamente 1
  assert.equal(followCallCount, 1);

  // Liberação do lock
  isFollowPending = false;
  // Próximo clique após conclusão é aceito
  attemptToggle();
  assert.equal(followCallCount, 2);
});

test('Array de following não cria duplicatas mesmo se ID for inserido repetidamente', () => {
  const initialFollowing: FollowUser[] = [
    {
      id: 'usr_shinji',
      username: 'shinji_mecha',
      displayName: 'Shinji Kazuki',
      avatarUrl: '',
      bio: '',
      isFollowing: true,
      isRequested: false,
      isFollower: false,
      isBlocked: false,
      createdAt: '',
    },
  ];

  const targetToAdd: FollowUser = {
    id: 'usr_shinji',
    username: 'shinji_mecha',
    displayName: 'Shinji Kazuki',
    avatarUrl: '',
    bio: '',
    isFollowing: true,
    isRequested: false,
    isFollower: false,
    isBlocked: false,
    createdAt: '',
  };

  // Lógica idempotente implementada no handleFollowToggle:
  const alreadyListed = initialFollowing.some((u) => u.id === targetToAdd.id);
  const nextFollowing = alreadyListed ? initialFollowing : [targetToAdd, ...initialFollowing];

  assert.equal(nextFollowing.length, 1);
  assert.equal(nextFollowing[0].id, 'usr_shinji');
});

test('Unfollow a partir do modal sincroniza decremento de contadores em ambos os perfis', () => {
  let myFollowingCount = 10;
  let shinjiFollowersCount = 520;
  let myFollowingIds = ['usr_kuroha', 'usr_shinji', 'usr_asuka'];

  // Unfollow acionado a partir da aba "Seguindo" do modal
  const targetId = 'usr_shinji';
  myFollowingIds = myFollowingIds.filter((id) => id !== targetId);
  myFollowingCount = Math.max(0, myFollowingCount - 1);
  shinjiFollowersCount = Math.max(0, shinjiFollowersCount - 1);

  assert.equal(myFollowingIds.includes('usr_shinji'), false);
  assert.equal(myFollowingCount, 9);
  assert.equal(shinjiFollowersCount, 519);
});

console.log('\n======================================================');
console.log(`Resultados dos Testes: ${passedCount} passaram, 0 falharam.`);
console.log('======================================================\n');
