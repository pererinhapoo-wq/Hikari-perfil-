import { Router, type Request, type Response } from 'express';
import { INITIAL_ACTIVITIES, CURRENT_USER, OTHER_USERS } from '../data/mockData.js';
import { filterActivitiesForViewer } from '../utils/activityPrivacy.js';
import type { UserActivity, UserProfile } from '../types/index.js';
import { getAdminFirestore } from './firebaseAdmin.js';
import { verifyRequestUser, isDemoMockUserId } from './userAuth.js';
import { socialStore } from './socialStore.js';

export const activityRouter = Router();

// Store em memória de atividades para simulação e persistência local no backend
const memoryActivitiesByUid = new Map<string, UserActivity[]>();

// Inicializa o usuário mock de demonstração com as atividades padrão
memoryActivitiesByUid.set(CURRENT_USER.id, [...INITIAL_ACTIVITIES]);

/**
 * Permite registrar ou sincronizar atividades em memória no backend (para testes e tempo real)
 */
export function setBackendUserActivities(userId: string, activities: UserActivity[]): void {
  memoryActivitiesByUid.set(userId, [...activities]);
}

/**
 * Adiciona uma atividade para o usuário no backend
 */
export function appendBackendUserActivity(userId: string, activity: UserActivity): void {
  const current = memoryActivitiesByUid.get(userId) ?? [];
  memoryActivitiesByUid.set(userId, [activity, ...current]);
}

/**
 * Obtém todas as atividades brutas de um usuário (socialStore -> memória -> Firestore Admin -> mock)
 */
export async function getRawUserActivities(userId: string): Promise<UserActivity[]> {
  const syncedRecord = socialStore.getUserRecord(userId);
  if (syncedRecord && syncedRecord.activities.length > 0) {
    return syncedRecord.activities;
  }

  const inMemory = memoryActivitiesByUid.get(userId);
  if (inMemory) {
    return inMemory;
  }

  const db = getAdminFirestore();
  if (db) {
    try {
      const snap = await db
        .collection('users')
        .doc(userId)
        .collection('activities')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      if (!snap.empty) {
        const loaded: UserActivity[] = snap.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            type: data.type || 'watched_ep',
            title: data.title || '',
            description: data.description || '',
            timestamp: data.timestamp || 'Recentemente',
            createdAtTimestamp: data.createdAt ? Number(data.createdAt) : undefined,
            score: data.score,
            episode: data.episode,
            isPrivate: data.isPrivate,
          };
        });
        memoryActivitiesByUid.set(userId, loaded);
        return loaded;
      }
    } catch {
      // Falha graciosa se Firestore Admin não estiver configurado
    }
  }

  if (syncedRecord) {
    return syncedRecord.activities;
  }

  if (userId === CURRENT_USER.id) {
    return [...INITIAL_ACTIVITIES];
  }

  return [];
}

async function resolveTargetProfilePrivacy(targetUserId: string): Promise<{
  found: boolean;
  resolvedUid: string;
  isPrivate: boolean;
  showActivity: boolean;
}> {
  const synced = socialStore.getUserRecord(targetUserId);
  if (synced) {
    return {
      found: true,
      resolvedUid: synced.uid,
      isPrivate: Boolean(synced.profile.isPrivate),
      showActivity: synced.profile.privacySettings?.showActivity !== false,
    };
  }

  const db = getAdminFirestore();
  if (db) {
    try {
      const userSnap = await db.collection('users').doc(targetUserId).get();
      if (userSnap.exists) {
        const data = userSnap.data() || {};
        return {
          found: true,
          resolvedUid: targetUserId,
          isPrivate: Boolean(data.isPrivate),
          showActivity: data.privacySettings?.showActivity !== false,
        };
      }
    } catch {
      // ignore
    }
  }

  const mockProfile: UserProfile | undefined =
    targetUserId === CURRENT_USER.id ? CURRENT_USER : OTHER_USERS[targetUserId];
  if (mockProfile) {
    return {
      found: true,
      resolvedUid: mockProfile.id,
      isPrivate: Boolean(mockProfile.isPrivate),
      showActivity: mockProfile.privacySettings?.showActivity !== false,
    };
  }

  if (memoryActivitiesByUid.has(targetUserId)) {
    return {
      found: true,
      resolvedUid: targetUserId,
      isPrivate: false,
      showActivity: true,
    };
  }

  return {
    found: false,
    resolvedUid: targetUserId,
    isPrivate: false,
    showActivity: true,
  };
}

/**
 * Handler centralizado para responder requisições de atividades com verificação criptográfica
 * do chamador e bloqueio real no backend para perfis privados ou com showActivity === false.
 * Nunca aceita `x-client-uid` sem token verificado para contas reais.
 */
async function handleGetActivities(req: Request, res: Response) {
  const targetUserId = (
    req.params.userId ||
    req.query.userId ||
    req.headers['x-target-user-id'] ||
    ''
  )
    .toString()
    .trim();

  if (!targetUserId) {
    res.status(400).json({
      error: 'ID do usuário (userId) é obrigatório.',
      activities: [],
    });
    return;
  }

  const caller = await verifyRequestUser(req);
  if (caller.hadAuthHeader && !caller.authenticated) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: caller.reason || 'Token de autenticação inválido.',
      activities: [],
    });
    return;
  }

  const targetMeta = await resolveTargetProfilePrivacy(targetUserId);

  // Only allow unauthenticated x-client-uid in isolated offline Demo Mode for mock IDs
  let callerUid: string | null = caller.authenticated ? caller.uid ?? null : null;
  if (!callerUid && !caller.hadAuthHeader && isDemoMockUserId(targetMeta.resolvedUid)) {
    const rawDemoUid = req.headers['x-client-uid'];
    if (typeof rawDemoUid === 'string' && isDemoMockUserId(rawDemoUid.trim())) {
      callerUid = rawDemoUid.trim();
    }
  }

  const isOwner = Boolean(callerUid && callerUid === targetMeta.resolvedUid);

  if (!isOwner && targetMeta.isPrivate) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(403).json({
      success: false,
      error: 'PRIVATE_PROFILE',
      message: 'Este perfil é privado. As atividades não podem ser acessadas.',
      userId: targetMeta.resolvedUid,
      isOwner: false,
      total: 0,
      activities: [],
    });
    return;
  }

  if (!isOwner && !targetMeta.showActivity) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(403).json({
      success: false,
      error: 'ACTIVITIES_PRIVATE',
      message: 'Este usuário ocultou suas atividades públicas.',
      userId: targetMeta.resolvedUid,
      isOwner: false,
      total: 0,
      activities: [],
    });
    return;
  }

  const rawActivities = await getRawUserActivities(targetMeta.resolvedUid);
  const filteredActivities = filterActivitiesForViewer(rawActivities, isOwner, {
    showActivity: targetMeta.showActivity,
    isPrivate: targetMeta.isPrivate,
  });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json({
    success: true,
    userId: targetMeta.resolvedUid,
    isOwner,
    total: filteredActivities.length,
    activities: filteredActivities,
  });
}

// Endpoints suportados
activityRouter.get('/:userId/activities', handleGetActivities);
activityRouter.get('/user/:userId', handleGetActivities);
activityRouter.get('/:userId', handleGetActivities);
activityRouter.get('/', handleGetActivities);
