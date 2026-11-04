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

// 2. Identidade Hikari Perfil e animação Brilho Aurora
const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const headerTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Header.tsx'), 'utf8');
const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
assert.ok(indexHtml.includes('<title>Hikari Perfil</title>'));
assert.ok(headerTsx.includes('hikari-profile-aurora') && headerTsx.includes('Hikari Perfil'));
assert.ok(indexCss.includes('@keyframes hikariProfileAurora') && indexCss.includes('.hikari-profile-aurora'));

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

console.log('Profile correction tests passed.');
