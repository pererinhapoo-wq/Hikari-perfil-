import assert from 'node:assert';
import {
  mapAniListStudio,
  mapAniListStaff,
  mapAniListStaffRole,
} from '../../services/anilistService';
import {
  mergeFavoriteCompanies,
  mergeFavoritePeople,
  pruneAniListFavoritesOnDisconnect,
} from '../../utils/animeSyncHelpers';
import type { FavoriteCompany, FavoritePerson } from '../../types';

console.log('=== Iniciando Testes de Favoritos AniList (Estúdios & Pessoas) ===\n');

// --------------------------------------------------------------------------
// 1. Teste de mapeamento de estúdios e produtoras do AniList
// --------------------------------------------------------------------------
console.log('1. Testando mapeamento de Estúdios e Produtoras do AniList...');

const rawStudioAnimation = {
  id: 43,
  name: 'ufotable',
  isAnimationStudio: true,
  siteUrl: 'http://www.ufotable.com/',
  media: {
    nodes: [
      { title: { userPreferred: 'Kimetsu no Yaiba' } },
      { title: { userPreferred: 'Fate/Zero' } },
      { title: { userPreferred: 'Kara no Kyoukai' } },
      { title: { userPreferred: 'Fate/stay night: Unlimited Blade Works' } },
    ],
  },
};

const mappedStudio = mapAniListStudio(rawStudioAnimation);
assert.strictEqual(mappedStudio.id, 'comp_al_43');
assert.strictEqual(mappedStudio.name, 'ufotable');
assert.strictEqual(mappedStudio.type, 'Estúdio de Animação');
assert.strictEqual(mappedStudio.anilistId, 43);
assert.ok(mappedStudio.notableWorks.includes('Kimetsu no Yaiba'));
assert.ok(mappedStudio.notableWorks.includes('Fate/Zero'));
assert.ok(mappedStudio.notableWorks.includes('Kara no Kyoukai'));

const rawProducerCompany = {
  id: 17,
  name: 'Aniplex',
  isAnimationStudio: false,
  siteUrl: 'https://www.aniplex.co.jp/',
  media: {
    nodes: [
      { title: { english: 'Bocchi the Rock!' } },
      { title: { romaji: 'Sword Art Online' } },
    ],
  },
};

const mappedProducer = mapAniListStudio(rawProducerCompany);
assert.strictEqual(mappedProducer.id, 'comp_al_17');
assert.strictEqual(mappedProducer.name, 'Aniplex');
assert.strictEqual(mappedProducer.type, 'Produtora & Distribuidora');
assert.strictEqual(mappedProducer.anilistId, 17);
assert.ok(mappedProducer.notableWorks.includes('Bocchi the Rock!'));
console.log('✓ Mapeamento de estúdios e produtoras validado com sucesso.');

// --------------------------------------------------------------------------
// 2. Teste de mapeamento de pessoas (Criadores, Voz, Diretores)
// --------------------------------------------------------------------------
console.log('\n2. Testando mapeamento de Pessoas (Voz, Direção, Música, Mangá)...');

assert.strictEqual(mapAniListStaffRole(['Voice Actor']), 'Dublador / Seiyuu');
assert.strictEqual(mapAniListStaffRole(['Director', 'Series Composition']), 'Diretor(a) de Animação');
assert.strictEqual(mapAniListStaffRole(['Music', 'Composer']), 'Compositor(a) Musical');
assert.strictEqual(mapAniListStaffRole(['Original Creator', 'Manga']), 'Mangaká / Criador(a) Original');
assert.strictEqual(mapAniListStaffRole(['Character Design', 'Chief Animation Director']), 'Animador(a) & Designer');
assert.strictEqual(mapAniListStaffRole(['Script', 'Series Composition']), 'Roteirista');

const rawStaffVoice = {
  id: 95087,
  name: {
    userPreferred: 'Rie Takahashi',
    full: 'Rie Takahashi',
    native: '高橋李依',
  },
  image: {
    large: 'https://s4.anilist.co/file/anilistcdn/staff/large/n95087.jpg',
  },
  primaryOccupations: ['Voice Actor'],
  staffMedia: {
    nodes: [
      { title: { userPreferred: 'KonoSuba' } },
      { title: { userPreferred: 'Re:Zero' } },
      { title: { userPreferred: 'Oshi no Ko' } },
    ],
  },
};

const mappedVoice = mapAniListStaff(rawStaffVoice);
assert.strictEqual(mappedVoice.id, 'person_al_95087');
assert.strictEqual(mappedVoice.name, 'Rie Takahashi');
assert.strictEqual(mappedVoice.role, 'Dublador / Seiyuu');
assert.strictEqual(mappedVoice.imageUrl, 'https://s4.anilist.co/file/anilistcdn/staff/large/n95087.jpg');
assert.strictEqual(mappedVoice.anilistId, 95087);
assert.ok(mappedVoice.notableWork.includes('KonoSuba'));
console.log('✓ Mapeamento de pessoas e dubladores validado com sucesso.');

// --------------------------------------------------------------------------
// 3. Teste de prevenção de duplicatas e priorização de IDs
// --------------------------------------------------------------------------
console.log('\n3. Testando prevenção de duplicatas na mesclagem...');

const existingCompanies: FavoriteCompany[] = [
  {
    id: 'comp_local_1',
    name: 'Kyoto Animation',
    type: 'Estúdio de Animação',
    notableWorks: 'Violet Evergarden, Clannad',
    logoUrl: 'https://example.com/kyoani_local.png',
  },
];

const incomingDuplicateByName: FavoriteCompany = {
  id: 'comp_al_2',
  name: 'kyoto animation', // minúsculas / normalizável
  type: 'Estúdio de Animação',
  notableWorks: 'Hibike! Euphonium',
  logoUrl: '',
  anilistId: 2,
};

const mergedCompanies = mergeFavoriteCompanies(existingCompanies, [incomingDuplicateByName]);
assert.strictEqual(mergedCompanies.length, 1, 'Não deve duplicar estúdio com o mesmo nome');
assert.strictEqual(mergedCompanies[0].id, 'comp_local_1', 'Mantém ID local do item existente');
assert.strictEqual(mergedCompanies[0].anilistId, 2, 'Vincula o anilistId ao item existente');
assert.strictEqual(mergedCompanies[0].logoUrl, 'https://example.com/kyoani_local.png', 'Preserva logo manual');

const existingPeople: FavoritePerson[] = [
  {
    id: 'person_local_1',
    name: 'Hayao Miyazaki',
    role: 'Diretor Lendário',
    imageUrl: 'https://example.com/miyazaki_custom.jpg',
    notableWork: 'A Viagem de Chihiro',
    anilistId: 95000,
  },
];

const incomingDuplicateById: FavoritePerson = {
  id: 'person_al_95000',
  name: 'Hayao Miyazaki',
  role: 'Diretor(a) de Animação',
  imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/95000.jpg',
  notableWork: 'Mononoke Hime',
  anilistId: 95000,
};

const mergedPeople = mergeFavoritePeople(existingPeople, [incomingDuplicateById]);
assert.strictEqual(mergedPeople.length, 1, 'Não deve duplicar pessoa com mesmo anilistId');
assert.strictEqual(mergedPeople[0].id, 'person_local_1');
assert.strictEqual(mergedPeople[0].role, 'Diretor Lendário', 'Preserva papel manual configurado');
assert.strictEqual(mergedPeople[0].imageUrl, 'https://example.com/miyazaki_custom.jpg', 'Preserva foto manual');
console.log('✓ Prevenção de duplicatas validada.');

// --------------------------------------------------------------------------
// 4. Teste de preservação de favoritos manuais e enriquecimento
// --------------------------------------------------------------------------
console.log('\n4. Testando preservação de favoritos manuais e enriquecimento...');

const manualCompany: FavoriteCompany = {
  id: 'comp_manual_wit',
  name: 'Wit Studio',
  type: 'Estúdio de Animação',
  notableWorks: 'Attack on Titan S1-S3, Vinland Saga',
  logoUrl: '', // Sem logo
};

const incomingWit: FavoriteCompany = {
  id: 'comp_al_858',
  name: 'WIT STUDIO',
  type: 'Estúdio de Animação',
  notableWorks: 'Spy x Family',
  logoUrl: 'https://example.com/wit_logo.png',
  anilistId: 858,
};

const mergedManual = mergeFavoriteCompanies([manualCompany], [incomingWit]);
assert.strictEqual(mergedManual.length, 1);
assert.strictEqual(mergedManual[0].id, 'comp_manual_wit');
assert.strictEqual(mergedManual[0].anilistId, 858);
assert.strictEqual(mergedManual[0].notableWorks, 'Attack on Titan S1-S3, Vinland Saga', 'Preserva obras manuais customizadas');
assert.strictEqual(mergedManual[0].logoUrl, 'https://example.com/wit_logo.png', 'Enriquece logo ausente');

// Inserção de novo estúdio preserva posição dos manuais
const newStudio: FavoriteCompany = {
  id: 'comp_al_569',
  name: 'MAPPA',
  type: 'Estúdio de Animação',
  notableWorks: 'Jujutsu Kaisen, Chainsaw Man',
  logoUrl: '',
  anilistId: 569,
};

const mergedMultiple = mergeFavoriteCompanies(mergedManual, [newStudio]);
assert.strictEqual(mergedMultiple.length, 2);
assert.strictEqual(mergedMultiple[0].name, 'Wit Studio', 'Item manual permanece na primeira posição');
assert.strictEqual(mergedMultiple[1].name, 'MAPPA', 'Novo item adicionado ao final');
console.log('✓ Preservação de favoritos manuais e enriquecimento validados.');

// --------------------------------------------------------------------------
// 5. Teste de sincronização repetida (idempotência)
// --------------------------------------------------------------------------
console.log('\n5. Testando sincronização repetida (idempotência)...');

const sync1Companies = mergeFavoriteCompanies([], [mappedStudio, mappedProducer]);
assert.strictEqual(sync1Companies.length, 2);

const sync2Companies = mergeFavoriteCompanies(sync1Companies, [mappedStudio, mappedProducer]);
assert.strictEqual(sync2Companies.length, 2, 'Sincronização repetida não deve aumentar a lista de empresas');
assert.strictEqual(sync2Companies[0].name, 'ufotable');
assert.strictEqual(sync2Companies[1].name, 'Aniplex');

const sync1People = mergeFavoritePeople([], [mappedVoice]);
assert.strictEqual(sync1People.length, 1);

const sync2People = mergeFavoritePeople(sync1People, [mappedVoice]);
assert.strictEqual(sync2People.length, 1, 'Sincronização repetida não deve duplicar pessoas');
console.log('✓ Idempotência de sincronizações consecutivas validada.');

// --------------------------------------------------------------------------
// 6. Teste de resposta vazia ou falha da API (resiliência)
// --------------------------------------------------------------------------
console.log('\n6. Testando resposta vazia ou falha da API (resiliência)...');

const initialCompanies: FavoriteCompany[] = [mappedStudio];
const initialPeople: FavoritePerson[] = [mappedVoice];

// API retornou array vazio (usuário sem favoritos de estúdio/pessoa no AniList ou falha tratada)
const emptyCompaniesResult = mergeFavoriteCompanies(initialCompanies, []);
assert.strictEqual(emptyCompaniesResult.length, 1, 'Array vazio não pode apagar favoritos existentes');
assert.strictEqual(emptyCompaniesResult[0].id, mappedStudio.id);

const emptyPeopleResult = mergeFavoritePeople(initialPeople, []);
assert.strictEqual(emptyPeopleResult.length, 1, 'Array vazio não pode apagar pessoas existentes');
assert.strictEqual(emptyPeopleResult[0].id, mappedVoice.id);
console.log('✓ Resiliência com lista vazia / falha validada sem perda de dados.');

// --------------------------------------------------------------------------
// 7. Não mistura estúdios com pessoas
// --------------------------------------------------------------------------
console.log('\n7. Testando separação estrita de categorias (estúdios vs pessoas)...');

const companiesList = mergeFavoriteCompanies([], [mappedStudio]);
const peopleList = mergeFavoritePeople([], [mappedVoice]);

// Verifica que estúdios não têm propriedades exclusivas de pessoas e vice-versa
assert.ok(!('role' in companiesList[0]), 'Empresas não possuem campo role');
assert.ok(!('imageUrl' in companiesList[0]), 'Empresas não possuem campo imageUrl');
assert.ok('logoUrl' in companiesList[0], 'Empresas possuem campo logoUrl');
assert.ok('type' in companiesList[0], 'Empresas possuem campo type');

assert.ok('role' in peopleList[0], 'Pessoas possuem campo role');
assert.ok('imageUrl' in peopleList[0], 'Pessoas possuem campo imageUrl');
assert.ok(!('logoUrl' in (peopleList[0] as any)), 'Pessoas não possuem campo logoUrl');
console.log('✓ Separação estrita entre estúdios e pessoas comprovada.');

// --------------------------------------------------------------------------
// 8. Isolamento de dados entre usuários (UID Workspace Isolation)
// --------------------------------------------------------------------------
console.log('\n8. Testando isolamento de dados entre múltiplos usuários...');

const userA_Workspace = {
  uid: 'user_alice_123',
  favoriteCompanies: [{ id: 'comp_1', name: 'Kyoto Animation', type: 'Estúdio de Animação', notableWorks: '', logoUrl: '' }],
  favoritePeople: [{ id: 'per_1', name: 'Naoko Yamada', role: 'Diretor(a)', notableWork: '', imageUrl: '' }],
};

const userB_Workspace = {
  uid: 'user_bob_456',
  favoriteCompanies: [{ id: 'comp_2', name: 'Trigger', type: 'Estúdio de Animação', notableWorks: '', logoUrl: '' }],
  favoritePeople: [{ id: 'per_2', name: 'Hiroyuki Imaishi', role: 'Diretor(a)', notableWork: '', imageUrl: '' }],
};

// Sincroniza AniList apenas para o usuário A
const userA_SyncedCompanies = mergeFavoriteCompanies(userA_Workspace.favoriteCompanies, [mappedStudio]);
const userA_SyncedPeople = mergeFavoritePeople(userA_Workspace.favoritePeople, [mappedVoice]);

// Valida que o usuário B permanece absolutamente intacto
assert.strictEqual(userB_Workspace.favoriteCompanies.length, 1);
assert.strictEqual(userB_Workspace.favoriteCompanies[0].name, 'Trigger');
assert.strictEqual(userB_Workspace.favoritePeople.length, 1);
assert.strictEqual(userB_Workspace.favoritePeople[0].name, 'Hiroyuki Imaishi');

// Valida que o usuário A recebeu os dados corretamente
assert.strictEqual(userA_SyncedCompanies.length, 2);
assert.strictEqual(userA_SyncedCompanies[0].name, 'Kyoto Animation');
assert.strictEqual(userA_SyncedCompanies[1].name, 'ufotable');
assert.strictEqual(userA_SyncedPeople.length, 2);
assert.strictEqual(userA_SyncedPeople[0].name, 'Naoko Yamada');
assert.strictEqual(userA_SyncedPeople[1].name, 'Rie Takahashi');
console.log('✓ Isolamento de workspaces entre usuários validado.');

// 12. Desconexão do AniList remove favoritos importados e preserva itens manuais.
const charsAfterDisconnect = pruneAniListFavoritesOnDisconnect(
  [
    { id: 'char_al_12345', name: 'Frieren', animeName: 'Sousou no Frieren', role: 'Protagonista', imageUrl: 'https://example.com/frieren.jpg' },
    { id: 'manual_char_1', name: 'Personagem manual', animeName: 'Anime', role: 'Apoio', imageUrl: '' },
  ],
  'char_al_'
);
assert.deepStrictEqual(charsAfterDisconnect.map((item) => item.id), ['manual_char_1']);

const companiesAfterDisconnect = pruneAniListFavoritesOnDisconnect(
  [
    { id: 'comp_al_43', name: 'ufotable', type: 'Estúdio de Animação', notableWorks: '', logoUrl: '', anilistId: 43 },
    { id: 'manual_company_1', name: 'Wit Studio', type: 'Estúdio', notableWorks: 'Obras manuais', logoUrl: '', anilistId: 858 },
    { id: 'manual_company_2', name: 'Studio Manual', type: 'Estúdio', notableWorks: '', logoUrl: '' },
  ],
  'comp_al_'
);
assert.deepStrictEqual(companiesAfterDisconnect.map((item) => item.id), ['manual_company_1', 'manual_company_2']);
assert.strictEqual(companiesAfterDisconnect[0].anilistId, undefined);
assert.strictEqual(companiesAfterDisconnect[0].name, 'Wit Studio');

const peopleAfterDisconnect = pruneAniListFavoritesOnDisconnect(
  [
    { id: 'person_al_95087', name: 'Staff AniList', role: 'Seiyuu', notableWork: '', imageUrl: '', anilistId: 95087 },
    { id: 'manual_person_1', name: 'Pessoa manual', role: 'Diretor', notableWork: '', imageUrl: '', anilistId: 42 },
  ],
  'person_al_'
);
assert.deepStrictEqual(peopleAfterDisconnect.map((item) => item.id), ['manual_person_1']);
assert.strictEqual(peopleAfterDisconnect[0].anilistId, undefined);
console.log('✔ Teste 12 passou: desconexão remove favoritos AniList e preserva favoritos manuais');

console.log('\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===');
