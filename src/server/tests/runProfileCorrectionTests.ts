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

console.log('Profile correction tests passed.');
