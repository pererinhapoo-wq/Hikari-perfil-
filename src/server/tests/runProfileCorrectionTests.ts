import * as assert from 'node:assert/strict';
import { pruneAniListFavoritesOnDisconnect } from '../../utils/animeSyncHelpers';
import type { FavoriteCharacter, FavoriteCompany, FavoritePerson } from '../../types';

const characters: FavoriteCharacter[] = [
  { id: 'char_al_10', name: 'Importado', animeName: 'A', role: 'Principal', imageUrl: '' },
  { id: 'manual_char_1', name: 'Manual', animeName: 'B', role: 'Principal', imageUrl: '' },
];
assert.deepEqual(pruneAniListFavoritesOnDisconnect(characters, 'char_al_'), [characters[1]]);

const companies: FavoriteCompany[] = [
  { id: 'comp_al_20', name: 'Studio importado', type: 'Studio', notableWorks: '', logoUrl: '', anilistId: 20 },
  { id: 'manual_company_1', name: 'Studio manual', type: 'Studio', notableWorks: '', logoUrl: '', anilistId: 21 },
];
const keptCompanies = pruneAniListFavoritesOnDisconnect(companies, 'comp_al_');
assert.equal(keptCompanies.length, 1);
assert.equal(keptCompanies[0].id, 'manual_company_1');
assert.equal(keptCompanies[0].anilistId, undefined);

const people: FavoritePerson[] = [
  { id: 'person_al_30', name: 'Pessoa importada', role: 'Voice', notableWork: '', imageUrl: '', anilistId: 30 },
  { id: 'manual_person_1', name: 'Pessoa manual', role: 'Voice', notableWork: '', imageUrl: '', anilistId: 31 },
];
const keptPeople = pruneAniListFavoritesOnDisconnect(people, 'person_al_');
assert.equal(keptPeople.length, 1);
assert.equal(keptPeople[0].id, 'manual_person_1');
assert.equal(keptPeople[0].anilistId, undefined);

import fs from 'node:fs';
import path from 'node:path';
import { SocialStore } from '../socialStore';
import { ENABLE_PRIVATE_MESSAGES } from '../../config/features';

// 1. Mensagens privadas desativadas mantendo código intacto
assert.equal(ENABLE_PRIVATE_MESSAGES, false, 'ENABLE_PRIVATE_MESSAGES deve permanecer false');
assert.ok(fs.existsSync(path.resolve(process.cwd(), 'src/components/chat/PrivateChatModal.tsx')));
assert.ok(fs.existsSync(path.resolve(process.cwd(), 'src/services/chatService.ts')));

// 2. Identidade Hikari Perfil e animação Aurora Flutuante (aura atrás das letras + reflexos ao redor, sem brilho atravessando as letras)
const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const headerTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Header.tsx'), 'utf8');
const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
assert.ok(indexHtml.includes('<title>Hikari Perfil</title>'));
assert.ok(headerTsx.includes('hikari-profile-aurora') && headerTsx.includes('Hikari Perfil'));
assert.ok(indexCss.includes('@keyframes hikariProfileAurora') && indexCss.includes('.hikari-profile-aurora'));
assert.ok(indexCss.includes('.hikari-profile-aurora::before') && indexCss.includes('.hikari-profile-aurora::after'));
assert.ok(indexCss.includes('@keyframes hikariAuroraReflections'));

// 3. Links para abrir perfis na lista de seguidores, seguindo e solicitações
const followersModalTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/modals/FollowersModal.tsx'), 'utf8');
assert.ok(followersModalTsx.includes('onSelectProfile(user.id)'));
assert.ok(followersModalTsx.includes('onSelectProfile(req.user.id)'));

// 4. Notificações: criação, leitura, persistência, deduplicação e reenvio após recusa
const store = new SocialStore({ ephemeral: true });
store.syncOwnerWorkspace('uid_owner', {
  profile: {
    id: 'uid_owner',
    username: 'owner_test',
    displayName: 'Owner Test',
    avatarUrl: '',
    bannerUrl: '',
    bio: '',
    createdAt: 'Hoje',
    followersCount: 0,
    followingCount: 0,
    isPrivate: false,
    showCommentsOnProfile: true,
  },
});
store.syncOwnerWorkspace('uid_visitor', {
  profile: {
    id: 'uid_visitor',
    username: 'visitor_test',
    displayName: 'Visitor Test',
    avatarUrl: '',
    bannerUrl: '',
    bio: '',
    createdAt: 'Hoje',
    followersCount: 0,
    followingCount: 0,
    isPrivate: false,
    showCommentsOnProfile: true,
  },
});

const f1 = store.followUser('uid_visitor', 'uid_owner');
assert.equal(f1.status, 'following');
assert.ok(f1.deliveredNotification);
const f1Dup = store.followUser('uid_visitor', 'uid_owner');
assert.equal(f1Dup.status, 'already_following');
assert.equal(f1Dup.deliveredNotification, null);

const readRes = store.markNotificationsRead('uid_owner', { markAll: true });
assert.equal(readRes.unreadCount, 0);

// Sincronização do workspace preserva estado lido e não restaura não-lido
store.syncOwnerWorkspace('uid_owner', {
  profile: store.getUserRecord('uid_owner')!.profile,
  notifications: readRes.notifications,
});
assert.equal(store.getNotificationsState('uid_owner').unreadCount, 0);

// Remoção de seguidor sincroniza no store
const rem = store.removeFollower('uid_owner', 'uid_visitor');
assert.equal(rem.ownerFollowersCount, 0);
assert.equal(store.getNotificationsState('uid_owner').followers.length, 0);

// 5. Teste integrado HTTP: Notificação de novo seguidor -> Seguir de volta -> Botões no perfil -> Deixar de seguir -> Persistência pós-reload -> Denúncia e Moderação no Admin existente
import http from 'node:http';
import express from 'express';
import { socialRouter } from '../socialRoutes';
import { adminRouter } from '../adminRoutes';
import { socialStore } from '../socialStore';
import { AUTHORIZED_ADMIN_UID } from '../../types';

async function runEndToEndVerification() {
  socialStore.resetForTests(true);

  const app = express();
  app.use(express.json());
  app.use('/api/users', socialRouter);
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(urlPath: string, init: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  try {
    // Registra dois usuários no socialStore via sync
    await api('/api/users/usr_alice/sync', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
      body: JSON.stringify({
        profile: {
          id: 'usr_alice',
          username: 'alice_hikari',
          displayName: 'Alice Hikari',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          createdAt: 'Hoje',
          followersCount: 0,
          followingCount: 0,
          isPrivate: false,
          showCommentsOnProfile: true,
        },
        followers: [],
        following: [],
        followingIds: [],
      }),
    });

    await api('/api/users/usr_bob/sync', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test_token_usr_bob' },
      body: JSON.stringify({
        profile: {
          id: 'usr_bob',
          username: 'bob_otaku',
          displayName: 'Bob Otaku',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          createdAt: 'Hoje',
          followersCount: 0,
          followingCount: 0,
          isPrivate: false,
          showCommentsOnProfile: true,
        },
        followers: [],
        following: [],
        followingIds: [],
      }),
    });

    // Impede que o usuário siga a própria conta
    const selfFollow = await api('/api/users/usr_alice/follow', {
      method: 'POST',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
    });
    assert.equal(selfFollow.status, 400, 'Deve impedir que o usuário siga a própria conta');

    // Passo 1: Bob segue Alice -> Alice recebe notificação de novo seguidor
    const bobFollowsAlice = await api('/api/users/usr_alice/follow', {
      method: 'POST',
      headers: { Authorization: 'Bearer test_token_usr_bob' },
      body: JSON.stringify({
        followerSummary: { username: 'bob_otaku', displayName: 'Bob Otaku', avatarUrl: '' },
        targetSummary: { username: 'alice_hikari', displayName: 'Alice Hikari', avatarUrl: '', isPrivate: false },
      }),
    });
    assert.equal(bobFollowsAlice.status, 200);
    assert.equal(bobFollowsAlice.body.status, 'following');
    assert.equal(bobFollowsAlice.body.isFollowBack, false);
    assert.equal(bobFollowsAlice.body.targetFollowersCount, 1);

    const aliceNotifs = await api('/api/users/usr_alice/notifications', {
      headers: { Authorization: 'Bearer test_token_usr_alice' },
    });
    assert.equal(aliceNotifs.status, 200);
    assert.equal(aliceNotifs.body.notifications.length, 1);
    assert.equal(aliceNotifs.body.notifications[0].type, 'new_follower');
    assert.equal(aliceNotifs.body.notifications[0].actor.id, 'usr_bob');
    assert.equal(aliceNotifs.body.followersCount, 1);
    assert.equal(aliceNotifs.body.followingCount, 0);
    assert.equal(aliceNotifs.body.followers[0].isFollower, true);
    assert.equal(aliceNotifs.body.followers[0].isFollowing, false);

    // Passo 2: Alice clica em "Seguir de volta" pela notificação
    const aliceFollowsBack = await api('/api/users/usr_bob/follow', {
      method: 'POST',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
      body: JSON.stringify({
        followerSummary: { username: 'alice_hikari', displayName: 'Alice Hikari', avatarUrl: '' },
        targetSummary: { username: 'bob_otaku', displayName: 'Bob Otaku', avatarUrl: '', isPrivate: false },
      }),
    });
    assert.equal(aliceFollowsBack.status, 200);
    assert.equal(aliceFollowsBack.body.status, 'following');
    assert.equal(aliceFollowsBack.body.isFollowBack, true);
    assert.equal(aliceFollowsBack.body.targetFollowersCount, 1);
    assert.deepEqual(aliceFollowsBack.body.callerSocialState.followingIds, ['usr_bob']);
    assert.equal(aliceFollowsBack.body.callerSocialState.followingCount, 1);
    assert.equal(aliceFollowsBack.body.callerSocialState.followers[0].isFollowing, true);

    // Passo 3 e 4: Alice abre o perfil de Bob (já segue -> Deixar de seguir) e deixa de seguir
    const aliceUnfollowsBob = await api('/api/users/usr_bob/unfollow', {
      method: 'POST',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
    });
    assert.equal(aliceUnfollowsBob.status, 200);
    assert.equal(aliceUnfollowsBob.body.targetFollowersCount, 0);
    assert.deepEqual(aliceUnfollowsBob.body.callerSocialState.followingIds, []);
    assert.equal(aliceUnfollowsBob.body.callerSocialState.followingCount, 0);
    assert.equal(aliceUnfollowsBob.body.callerSocialState.followersCount, 1);

    // Passo 5: Simula recarregamento da página (syncOwnerWorkspace com contagens atualizadas)
    const aliceReloadSync = await api('/api/users/usr_alice/sync', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
      body: JSON.stringify({
        profile: {
          id: 'usr_alice',
          username: 'alice_hikari',
          displayName: 'Alice Hikari',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          createdAt: 'Hoje',
          followersCount: 1,
          followingCount: 0,
          isPrivate: false,
          showCommentsOnProfile: true,
        },
        followers: aliceUnfollowsBob.body.callerSocialState.followers,
        following: [],
        followingIds: [],
      }),
    });
    assert.equal(aliceReloadSync.status, 200);
    assert.deepEqual(aliceReloadSync.body.followingIds, [], 'Após reload, não deve restaurar quem deixou de seguir');
    assert.equal(aliceReloadSync.body.followingCount, 0, 'Contagem de seguindo deve permanecer 0 após reload');
    assert.equal(aliceReloadSync.body.followersCount, 1, 'Contagem de seguidores deve permanecer 1 após reload');

    // Passo 6: Fazer uma denúncia de teste e confirmar que aparece na área de denúncias já existente no Admin
    const submitReport = await api('/api/users/usr_bob/report', {
      method: 'POST',
      headers: { Authorization: 'Bearer test_token_usr_alice' },
      body: JSON.stringify({
        reason: 'spam ou golpe',
        details: 'Envio de links suspeitos na bio do perfil.',
        targetUsername: 'bob_otaku',
        targetDisplayName: 'Bob Otaku',
        reporterUsername: 'alice_hikari',
        reporterDisplayName: 'Alice Hikari',
      }),
    });
    assert.equal(submitReport.status, 201, 'Denúncia deve ser registrada com HTTP 201');
    assert.equal(submitReport.body.ok, true);
    assert.ok(submitReport.body.reportId, 'Deve retornar reportId da denúncia criada');

    // Usuário comum NÃO pode acessar a área de denúncias do Admin
    const nonAdminModeration = await api('/api/admin/moderation', {
      headers: { Authorization: 'Bearer test_token_usr_alice' },
    });
    assert.equal(nonAdminModeration.status, 403, 'Usuário comum deve ser bloqueado na área de denúncias do Admin');

    // Administrador autorizado visualiza a denúncia na área de Moderação existente
    const adminModeration = await api('/api/admin/moderation', {
      headers: { Authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
    });
    assert.equal(adminModeration.status, 200);
    assert.equal(adminModeration.body.total, 1);
    assert.equal(adminModeration.body.pending, 1);
    assert.equal(adminModeration.body.reports[0].targetId, 'usr_bob');
    assert.equal(adminModeration.body.reports[0].reporterUid, 'usr_alice');
    assert.equal(adminModeration.body.reports[0].reason, 'spam ou golpe');
    assert.equal(adminModeration.body.reports[0].status, 'pending');

    // Administrador gerencia o status da denúncia (in_review -> resolved)
    const reportId = adminModeration.body.reports[0].id;
    const adminResolve = await api(`/api/admin/moderation/reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer test_token_${AUTHORIZED_ADMIN_UID}` },
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.equal(adminResolve.status, 200);
    assert.equal(adminResolve.body.ok, true);
    assert.equal(adminResolve.body.reports[0].status, 'resolved');
    assert.equal(adminResolve.body.pending, 0);
  } finally {
    server.close();
  }
}

runEndToEndVerification()
  .then(() => {
    console.log('Profile correction tests passed.');
  })
  .catch((err) => {
    console.error('Falha nos testes de correção do perfil:', err);
    process.exit(1);
  });

