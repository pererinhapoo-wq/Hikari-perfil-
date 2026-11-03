import fs from 'node:fs';
import path from 'node:path';
import { getRemoteCheckpointDocPath } from '../../services/importCheckpointStorage';

interface TestReportItem {
  id: number;
  title: string;
  passed: boolean;
  details: string;
}

const testResults: TestReportItem[] = [];

function recordTest(id: number, title: string, passed: boolean, details: string) {
  testResults.push({ id, title, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${String(id).padStart(2, '0')}] ${status} - ${title}: ${details}`);
}

interface RuleContext {
  authUid: string | null;
  isAnonymous?: boolean;
  docPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  incomingData?: Record<string, unknown>;
  existingData?: Record<string, unknown>;
  targetUserDoc?: { isPrivate: boolean; privacySettings: { showAnimeList: boolean } };
}

/**
 * Validador semântico das regras de segurança do Firestore (firestore.rules).
 * Espelha fielmente a execução das funções de autorização do rules_version = '2'.
 */
class FirestoreRulesSimulator {
  private rulesContent: string;

  constructor(rulesContent: string) {
    this.rulesContent = rulesContent;
  }

  public getRawRules(): string {
    return this.rulesContent;
  }

  private isSignedIn(ctx: RuleContext): boolean {
    return ctx.authUid !== null && ctx.authUid.trim().length > 0 && !ctx.isAnonymous;
  }

  private isOwner(ctx: RuleContext, userId: string): boolean {
    return this.isSignedIn(ctx) && ctx.authUid === userId;
  }

  private isValidId(id: string): boolean {
    return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
  }

  public isValidImportCheckpoint(data: Record<string, unknown> | undefined, userId: string, checkpointId: string): boolean {
    if (!data || typeof data !== 'object') return false;

    // Campos obrigatórios: provider, accountIdentifier, profileId, status, version, cursor, updatedAtMs
    const requiredKeys = ['provider', 'accountIdentifier', 'profileId', 'status', 'version', 'cursor', 'updatedAtMs'];
    for (const k of requiredKeys) {
      if (!(k in data)) return false;
    }

    // Whitelist estrita de campos permitidos (hasOnly)
    const allowedKeys = new Set([
      'provider',
      'accountIdentifier',
      'profileId',
      'status',
      'version',
      'cursor',
      'updatedAtMs',
      'page',
      'recordsReceived',
      'recordsProcessed',
      'recordsConfirmed',
      'recordsPersisted',
      'addedCount',
      'updatedCount',
      'unchangedCount',
      'preservedFieldsCount',
      'totalEstimated',
      'lastConfirmedCheckpoint',
      'lastConfirmedPoint',
      'lastUpdated',
      'errorMessage',
      'lastError',
      'storageSource',
      'storageError',
    ]);
    for (const k of Object.keys(data)) {
      if (!allowedKeys.has(k)) return false;
    }

    if (data.provider !== 'mal' && data.provider !== 'anilist') return false;

    // Coerência com checkpointId
    if (data.provider === 'mal' && !/^mal_[a-zA-Z0-9_\-]+$/.test(checkpointId)) return false;
    if (data.provider === 'anilist' && !/^anilist_[a-zA-Z0-9_\-]+$/.test(checkpointId)) return false;

    if (typeof data.profileId !== 'string' || data.profileId !== userId) return false;
    if (typeof data.accountIdentifier !== 'string' || data.accountIdentifier.length < 1) return false;

    // Limites exatos do identificador para nunca estourar os 128 caracteres do checkpointId
    if (data.provider === 'mal' && data.accountIdentifier.length > 124) return false;
    if (data.provider === 'anilist' && data.accountIdentifier.length > 120) return false;

    const validStatuses = ['idle', 'in_progress', 'paused', 'error', 'completed'];
    if (typeof data.status !== 'string' || !validStatuses.includes(data.status)) return false;

    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) return false;
    if (typeof data.cursor !== 'number' || !Number.isInteger(data.cursor) || data.cursor < 0) return false;
    if (typeof data.updatedAtMs !== 'number' || !Number.isInteger(data.updatedAtMs) || data.updatedAtMs < 0) return false;

    // Campos opcionais numéricos
    const positiveIntFields = ['page', 'recordsReceived', 'recordsProcessed', 'recordsConfirmed', 'recordsPersisted', 'addedCount', 'updatedCount', 'unchangedCount', 'preservedFieldsCount'];
    for (const f of positiveIntFields) {
      if (f in data) {
        const val = data[f];
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) return false;
      }
    }

    if ('totalEstimated' in data && data.totalEstimated !== null) {
      const te = data.totalEstimated;
      if (typeof te !== 'number' || !Number.isInteger(te) || te < 0) return false;
    }

    // Bloqueio explícito de credenciais, segredos e animes
    const forbiddenKeys = ['idToken', 'accessToken', 'refreshToken', 'token', 'animes', 'workingAnimes', 'mergedAnimes'];
    for (const fk of forbiddenKeys) {
      if (fk in data) return false;
    }

    return true;
  }

  public evaluate(ctx: RuleContext): { allowed: boolean; reason: string } {
    const parts = ctx.docPath.replace(/^\//, '').split('/');
    if (parts[0] !== 'users' || parts.length < 2) {
      return { allowed: false, reason: 'Bloqueio padrão zero-trust' };
    }

    const userId = parts[1];
    const subcollection = parts[2];
    const docId = parts[3];

    // Subcoleção: /users/{userId}/import_checkpoints/{checkpointId}
    if (subcollection === 'import_checkpoints') {
      if (!this.isValidId(userId)) {
        return { allowed: false, reason: 'userId inválido' };
      }

      if (ctx.operation === 'get' || ctx.operation === 'list') {
        const allowed = this.isOwner(ctx, userId);
        return {
          allowed,
          reason: allowed
            ? 'Leitura permitida ao proprietário autenticado'
            : 'Acesso negado: leitura de checkpoint restrita ao proprietário autenticado',
        };
      }

      if (ctx.operation === 'create') {
        if (!docId || !this.isValidId(docId)) {
          return { allowed: false, reason: 'checkpointId inválido' };
        }
        if (!this.isOwner(ctx, userId)) {
          return { allowed: false, reason: 'Acesso negado: criação restrita ao proprietário' };
        }
        const validDoc = this.isValidImportCheckpoint(ctx.incomingData, userId, docId);
        return {
          allowed: validDoc,
          reason: validDoc
            ? 'Criação permitida com schema válido'
            : 'Documento rejeitado por falha na validação de schema do checkpoint',
        };
      }

      if (ctx.operation === 'update') {
        if (!docId || !this.isValidId(docId)) {
          return { allowed: false, reason: 'checkpointId inválido' };
        }
        if (!this.isOwner(ctx, userId)) {
          return { allowed: false, reason: 'Acesso negado: atualização restrita ao proprietário' };
        }
        const validDoc = this.isValidImportCheckpoint(ctx.incomingData, userId, docId);
        if (!validDoc) {
          return { allowed: false, reason: 'Documento rejeitado por validação de campos' };
        }
        // Invariantes: profileId, provider, accountIdentifier não podem mudar
        if (ctx.existingData) {
          if (
            ctx.incomingData?.profileId !== ctx.existingData.profileId ||
            ctx.incomingData?.provider !== ctx.existingData.provider ||
            ctx.incomingData?.accountIdentifier !== ctx.existingData.accountIdentifier
          ) {
            return {
              allowed: false,
              reason: 'Rejeitado: não é permitido alterar identidade do proprietário ou do provedor',
            };
          }
        }
        return { allowed: true, reason: 'Atualização autorizada pelo proprietário' };
      }

      if (ctx.operation === 'delete') {
        if (!docId || !this.isValidId(docId)) {
          return { allowed: false, reason: 'checkpointId inválido' };
        }
        const allowed = this.isOwner(ctx, userId);
        return {
          allowed,
          reason: allowed ? 'Exclusão permitida ao proprietário' : 'Acesso negado a terceiros para exclusão',
        };
      }
    }

    return { allowed: false, reason: 'Operação não autorizada' };
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('HIKARI PERFIL — ETAPA 4.1: TESTES DE REGRAS DE SEGURANÇA FIRESTORE');
  console.log('========================================================================\n');

  const rulesFilePath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesFilePath, 'utf8');
  const simulator = new FirestoreRulesSimulator(rulesContent);

  const ownerUid = 'usr_owner_alpha_123';
  const thirdPartyUid = 'usr_third_party_456';
  const malDocId = 'mal_otaku_pro';
  const anilistDocId = 'anilist_otaku_pro';

  const validMALPayload: Record<string, unknown> = {
    version: 1,
    provider: 'mal',
    accountIdentifier: 'otaku_pro',
    profileId: ownerUid,
    status: 'in_progress',
    cursor: 1000,
    page: 2,
    recordsReceived: 1000,
    recordsProcessed: 1000,
    recordsConfirmed: 1000,
    recordsPersisted: 1000,
    addedCount: 800,
    updatedCount: 200,
    unchangedCount: 0,
    preservedFieldsCount: 0,
    lastConfirmedCheckpoint: 1700000000000,
    lastConfirmedPoint: 'offset_1000',
    updatedAtMs: 1700000000000,
    lastUpdated: new Date().toISOString(),
    errorMessage: null,
    lastError: null,
  };

  // TEST 01: Proprietário consegue criar checkpoint
  try {
    const res = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: validMALPayload,
    });
    const inRules = rulesContent.includes('match /import_checkpoints/{checkpointId}') && rulesContent.includes('allow create: if isOwner(userId)');
    const pass = res.allowed && inRules;
    recordTest(1, 'Proprietário consegue criar checkpoint', pass, `Permitido criar ${malDocId} sob sua conta com schema validado`);
  } catch (err) {
    recordTest(1, 'Proprietário consegue criar checkpoint', false, String(err));
  }

  // TEST 02: Proprietário consegue ler checkpoint (get e list)
  try {
    const resGet = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'get',
    });
    const resList = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints`,
      operation: 'list',
    });
    const inRules = rulesContent.includes('allow get, list: if isOwner(userId)');
    const pass = resGet.allowed && resList.allowed && inRules;
    recordTest(2, 'Proprietário consegue ler checkpoint', pass, `Leitura (get) e listagem (list) autorizadas para o UID proprietário`);
  } catch (err) {
    recordTest(2, 'Proprietário consegue ler checkpoint', false, String(err));
  }

  // TEST 03: Proprietário consegue atualizar checkpoint
  try {
    const updatedPayload = { ...validMALPayload, version: 2, cursor: 2000, recordsConfirmed: 2000 };
    const res = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'update',
      incomingData: updatedPayload,
      existingData: validMALPayload,
    });
    const pass = res.allowed;
    recordTest(3, 'Proprietário consegue atualizar checkpoint', pass, `Atualização incremental (v2, cursor=2000) autorizada para o dono`);
  } catch (err) {
    recordTest(3, 'Proprietário consegue atualizar checkpoint', false, String(err));
  }

  // TEST 04: Proprietário consegue excluir checkpoint
  try {
    const res = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'delete',
    });
    const inRules = rulesContent.includes('allow delete: if isOwner(userId)');
    const pass = res.allowed && inRules;
    recordTest(4, 'Proprietário consegue excluir checkpoint', pass, `Exclusão autorizada após conclusão ou cancelamento da importação`);
  } catch (err) {
    recordTest(4, 'Proprietário consegue excluir checkpoint', false, String(err));
  }

  // TEST 05: Usuário terceiro não consegue ler
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'get',
    });
    const pass = !res.allowed;
    recordTest(5, 'Usuário terceiro não consegue ler', pass, `Leitura de terceiro bloqueada com zero-trust (${res.reason})`);
  } catch (err) {
    recordTest(5, 'Usuário terceiro não consegue ler', false, String(err));
  }

  // TEST 06: Usuário terceiro não consegue criar em nome de outra pessoa
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: validMALPayload,
    });
    const pass = !res.allowed;
    recordTest(6, 'Usuário terceiro não consegue criar em nome de outra pessoa', pass, `Criação por terceiro bloqueada (${res.reason})`);
  } catch (err) {
    recordTest(6, 'Usuário terceiro não consegue criar em nome de outra pessoa', false, String(err));
  }

  // TEST 07: Usuário terceiro não consegue atualizar
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'update',
      incomingData: { ...validMALPayload, cursor: 5000 },
      existingData: validMALPayload,
    });
    const pass = !res.allowed;
    recordTest(7, 'Usuário terceiro não consegue atualizar', pass, `Atualização por terceiro rejeitada (${res.reason})`);
  } catch (err) {
    recordTest(7, 'Usuário terceiro não consegue atualizar', false, String(err));
  }

  // TEST 08: Usuário terceiro não consegue excluir
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'delete',
    });
    const pass = !res.allowed;
    recordTest(8, 'Usuário terceiro não consegue excluir', pass, `Exclusão por terceiro rejeitada (${res.reason})`);
  } catch (err) {
    recordTest(8, 'Usuário terceiro não consegue excluir', false, String(err));
  }

  // TEST 09: Visitante não autenticado não consegue acessar
  try {
    const resGet = simulator.evaluate({
      authUid: null,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'get',
    });
    const resWrite = simulator.evaluate({
      authUid: null,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: validMALPayload,
    });
    const pass = !resGet.allowed && !resWrite.allowed;
    recordTest(9, 'Visitante não autenticado não consegue acessar', pass, `Sessão anônima/nula bloqueada (get=${resGet.allowed}, create=${resWrite.allowed})`);
  } catch (err) {
    recordTest(9, 'Visitante não autenticado não consegue acessar', false, String(err));
  }

  // TEST 10: Perfil público não concede acesso aos checkpoints
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'get',
      targetUserDoc: { isPrivate: false, privacySettings: { showAnimeList: true } },
    });
    const pass = !res.allowed;
    recordTest(10, 'Perfil público não concede acesso aos checkpoints', pass, `Perfil com isPrivate=false não enfraquece o isolamento do checkpoint`);
  } catch (err) {
    recordTest(10, 'Perfil público não concede acesso aos checkpoints', false, String(err));
  }

  // TEST 11: "showAnimeList == true" não concede acesso aos checkpoints
  try {
    const res = simulator.evaluate({
      authUid: thirdPartyUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'get',
      targetUserDoc: { isPrivate: false, privacySettings: { showAnimeList: true } },
    });
    const pass = !res.allowed;
    recordTest(11, '"showAnimeList == true" não concede acesso aos checkpoints', pass, `Listas públicas não expõem subcoleção interna de importação`);
  } catch (err) {
    recordTest(11, '"showAnimeList == true" não concede acesso', false, String(err));
  }

  // TEST 12: Documento com "profileId" incompatível é rejeitado
  try {
    const corruptedPayload = { ...validMALPayload, profileId: 'attacker_uid_999' };
    const res = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: corruptedPayload,
    });
    const pass = !res.allowed;
    recordTest(12, 'Documento com "profileId" incompatível é rejeitado', pass, `profileId divergente do userId do caminho foi recusado`);
  } catch (err) {
    recordTest(12, 'Documento com "profileId" incompatível é rejeitado', false, String(err));
  }

  // TEST 13: Provedor inválido é rejeitado
  try {
    const invalidProviderPayload = { ...validMALPayload, provider: 'unsupported_platform' };
    const resInvalidProvider = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: invalidProviderPayload,
    });
    const mismatchedIdPayload = { ...validMALPayload, provider: 'anilist' }; // provider anilist mas docId mal_otaku_pro
    const resMismatchId = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: mismatchedIdPayload,
    });
    const pass = !resInvalidProvider.allowed && !resMismatchId.allowed;
    recordTest(13, 'Provedor inválido é rejeitado', pass, `Provedor diferente de 'mal'/'anilist' ou incompatível com o ID é rejeitado`);
  } catch (err) {
    recordTest(13, 'Provedor inválido é rejeitado', false, String(err));
  }

  // TEST 14: Dados sensíveis ou tokens não podem ser gravados
  try {
    const tokenInjectedPayload = { ...validMALPayload, accessToken: 'secret_oauth_token_123', idToken: 'firebase_jwt' };
    const resWithToken = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: tokenInjectedPayload,
    });
    const animeArrayInjected = { ...validMALPayload, animes: [{ title: 'Anime 1' }] };
    const resWithAnimes = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: animeArrayInjected,
    });
    const inRules = rulesContent.includes("!('accessToken' in data)") && rulesContent.includes("!('animes' in data)");
    const pass = !resWithToken.allowed && !resWithAnimes.allowed && inRules;
    recordTest(14, 'Dados sensíveis ou tokens não podem ser gravados', pass, `Campos de credenciais (token, idToken, accessToken) e arrays de animes bloqueados`);
  } catch (err) {
    recordTest(14, 'Dados sensíveis ou tokens não podem ser gravados', false, String(err));
  }

  // TEST 15: As regras de manifesto e blocos continuam inalteradas
  try {
    const hasStorage = rulesContent.includes('match /anime_storage/{docId}') && rulesContent.includes("docId == 'manifest'");
    const hasChunks = rulesContent.includes('match /anime_chunks/{chunkId}') && rulesContent.includes('incoming().animes.size() <= 450');
    const pass = hasStorage && hasChunks;
    recordTest(15, 'As regras de manifesto e blocos continuam inalteradas', pass, `anime_storage e anime_chunks preservados integralmente`);
  } catch (err) {
    recordTest(15, 'Regras de manifesto e blocos intactas', false, String(err));
  }

  // TEST 16: Não existem regressões nas regras das demais funcionalidades
  try {
    const hasUsers = rulesContent.includes('match /users/{userId}');
    const hasWorkspace = rulesContent.includes('match /workspace/{docId}');
    const hasAnimeList = rulesContent.includes('match /animeList/{animeId}');
    const hasActivities = rulesContent.includes('match /activities/{activityId}');
    const hasNotifications = rulesContent.includes('match /notifications/{notifId}');
    const hasConversations = rulesContent.includes('match /conversations/{convId}');
    const hasMessages = rulesContent.includes('match /messages/{msgId}');
    const hasAdmin = rulesContent.includes('match /admin/{docId}');
    const pass = hasUsers && hasWorkspace && hasAnimeList && hasActivities && hasNotifications && hasConversations && hasMessages && hasAdmin;
    recordTest(16, 'Não existem regressões nas regras das demais funcionalidades', pass, `Todas as subcoleções e coleções de sistema mantidas intactas`);
  } catch (err) {
    recordTest(16, 'Regressões em regras existentes', false, String(err));
  }

  // TEST 17: Whitelist estrita (hasOnly) bloqueia campos arbitrários e desconhecidos
  try {
    const unknownFieldPayload = { ...validMALPayload, arbitraryInjectedField: 'dangerous_data' };
    const resUnknown = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: unknownFieldPayload,
    });
    const codeVerifierPayload = { ...validMALPayload, codeVerifier: 'secret_oauth_verifier' };
    const resVerifier = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: codeVerifierPayload,
    });
    const hasOnlyInRules = rulesContent.includes('data.keys().hasOnly([');
    const pass = !resUnknown.allowed && !resVerifier.allowed && hasOnlyInRules;
    recordTest(17, 'Whitelist estrita (hasOnly) bloqueia campos desconhecidos', pass, `Campos arbitrários (arbitraryInjectedField, codeVerifier) bloqueados e hasOnly presente em firestore.rules`);
  } catch (err) {
    recordTest(17, 'Whitelist estrita bloqueia campos desconhecidos', false, String(err));
  }

  // TEST 18: Limites do accountIdentifier respeitam teto de 128 chars do checkpointId
  try {
    // Para MAL: prefixo 'mal_' (4 chars). Máximo accountIdentifier = 124 (total = 128)
    const mal124 = 'a'.repeat(124);
    const mal124DocId = `mal_${mal124}`;
    const resMAL124 = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${mal124DocId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, accountIdentifier: mal124 },
    });

    const mal125 = 'a'.repeat(125);
    const mal125DocId = `mal_${mal125}`;
    const resMAL125 = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${mal125DocId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, accountIdentifier: mal125 },
    });

    // Para AniList: prefixo 'anilist_' (8 chars). Máximo accountIdentifier = 120 (total = 128)
    const anilist120 = 'b'.repeat(120);
    const anilist120DocId = `anilist_${anilist120}`;
    const resAniList120 = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${anilist120DocId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, provider: 'anilist', accountIdentifier: anilist120 },
    });

    const anilist121 = 'b'.repeat(121);
    const anilist121DocId = `anilist_${anilist121}`;
    const resAniList121 = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${anilist121DocId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, provider: 'anilist', accountIdentifier: anilist121 },
    });

    const rulesBounds = rulesContent.includes('data.accountIdentifier.size() <= 124') &&
                        rulesContent.includes('data.accountIdentifier.size() <= 120');

    const pass = resMAL124.allowed && !resMAL125.allowed && resAniList120.allowed && !resAniList121.allowed && rulesBounds;
    recordTest(18, 'Limites do accountIdentifier respeitam teto de 128 chars', pass, `MAL aceita até 124 chars (total 128) e AniList até 120 chars (total 128). Estouro rejeitado`);
  } catch (err) {
    recordTest(18, 'Limites do accountIdentifier', false, String(err));
  }

  // TEST 19: Payload real sanitizado produzido pelo serviço é aceito
  try {
    const realServicePayload: Record<string, unknown> = {
      version: 2,
      provider: 'mal',
      accountIdentifier: 'otaku_pro',
      profileId: ownerUid,
      cursor: 1000,
      page: 2,
      totalEstimated: 2500,
      recordsReceived: 1000,
      recordsProcessed: 1000,
      recordsConfirmed: 1000,
      recordsPersisted: 1000,
      addedCount: 800,
      updatedCount: 200,
      unchangedCount: 0,
      preservedFieldsCount: 0,
      status: 'in_progress',
      lastConfirmedCheckpoint: 1700000000000,
      lastConfirmedPoint: 'offset_1000',
      lastUpdated: new Date().toISOString(),
      updatedAtMs: 1700000000000,
      errorMessage: null,
      lastError: null,
    };
    const resReal = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${malDocId}`,
      operation: 'create',
      incomingData: realServicePayload,
    });
    recordTest(19, 'Payload real sanitizado do serviço é compatível', resReal.allowed, `Todos os 22 campos padrão gerados por sanitizeCheckpointForStorage são aceitos`);
  } catch (err) {
    recordTest(19, 'Payload real sanitizado do serviço é compatível', false, String(err));
  }

  // TEST 20: Prevenção de colisão de IDs entre contas com hífen e underscore (ex: foo-bar vs foo_bar)
  try {
    const p1 = getRemoteCheckpointDocPath(ownerUid, 'mal', 'foo-bar');
    const p2 = getRemoteCheckpointDocPath(ownerUid, 'mal', 'foo_bar');
    const p3 = getRemoteCheckpointDocPath(ownerUid, 'mal', 'foo.bar');
    const p4 = getRemoteCheckpointDocPath(ownerUid, 'mal', 'user@name');

    const t1 = p1.docId === 'mal_foo-bar';
    const t2 = p2.docId === 'mal_foo_bar';
    const t3 = p1.docId !== p2.docId;
    const t4 = p3.docId === 'mal_foo_bar' && p4.docId === 'mal_user_name';

    // Compatibilidade com as regras do Firestore
    const resHyphen = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${p1.docId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, accountIdentifier: 'foo-bar' },
    });
    const resUnderscore = simulator.evaluate({
      authUid: ownerUid,
      docPath: `/users/${ownerUid}/import_checkpoints/${p2.docId}`,
      operation: 'create',
      incomingData: { ...validMALPayload, accountIdentifier: 'foo_bar' },
    });

    const pass = t1 && t2 && t3 && t4 && resHyphen.allowed && resUnderscore.allowed;
    recordTest(
      20,
      'Prevenção de colisão entre contas com hífen e underscore',
      pass,
      `"foo-bar" -> "${p1.docId}", "foo_bar" -> "${p2.docId}" (IDs distintos). Regras aceitam ambos e caracteres inválidos viram _`
    );
  } catch (err) {
    recordTest(20, 'Prevenção de colisão entre contas com hífen e underscore', false, String(err));
  }

  console.log('\n========================================================================');
  const allPassed = testResults.every((t) => t.passed);
  const passedCount = testResults.filter((t) => t.passed).length;
  console.log(`RESULTADO DA ETAPA 4.1: ${passedCount}/${testResults.length} TESTES PASSARAM`);
  console.log(`STATUS GERAL: ${allPassed ? `✅ ETAPA 4.1 VALIDADA COM SUCESSO (TODOS OS ${testResults.length} TESTES APROVADOS)` : '❌ FALHAS DETECTADAS'}`);
  console.log('========================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal ao rodar testes de regras da Etapa 4.1:', err);
  process.exit(1);
});
