import { Router, type Request, type Response } from 'express';
import { INITIAL_ACTIVITIES, CURRENT_USER, OTHER_USERS } from '../data/mockData.js';
import { isImportSyncActivity, filterActivitiesForViewer } from '../utils/activityPrivacy.js';
import type { UserActivity, UserProfile } from '../types/index.js';
import { getAdminFirestore } from './firebaseAdmin.js';
import { verifyAdminToken } from './adminAuth.js';

export const activityRouter = Router();

// Store em memória de atividades para simulação e persistência local no backend
const memoryActivitiesByUid = new Map<string, UserActivity[]>();

// Inicializa o usuário atual com as atividades padrão mockadas
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
 * Obtém todas as atividades brutas de um usuário
 */
export async function getRawUserActivities(userId: string): Promise<UserActivity[]> {
  const inMemory = memoryActivitiesByUid.get(userId);
  if (inMemory) {
    return inMemory;
  }

  // Tenta carregar do Firestore se disponível
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
      // Falha graciosa se Firestore não estiver configurado
    }
  }

  // Fallback padrão se for usuário mock
  if (userId === CURRENT_USER.id) {
    return [...INITIAL_ACTIVITIES];
  }

  return [];
}

/**
 * Extrai o UID autenticado da requisição a partir de:
 * 1. Header Authorization Bearer token (verificado via Firebase Admin se presente)
 * 2. Header x-client-uid (usado em requisições de desenvolvimento/sessão autenticada)
 */
async function extractCallerUid(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const verified = await verifyAdminToken(token);
        if (verified.uid) {
          return verified.uid;
        }
      } catch {
        // Ignora erro de verificação e tenta x-client-uid
      }
    }
  }

  const clientUid = req.headers['x-client-uid'];
  if (typeof clientUid === 'string' && clientUid.trim()) {
    return clientUid.trim();
  }

  return null;
}

/**
 * Handler centralizado para responder requisições de atividades com filtro estrito de privacidade
 */
async function handleGetActivities(req: Request, res: Response) {
  const targetUserId = (req.params.userId || req.query.userId || req.headers['x-target-user-id'] || '').toString().trim();

  if (!targetUserId) {
    res.status(400).json({
      error: 'ID do usuário (userId) é obrigatório.',
      activities: [],
    });
    return;
  }

  const callerUid = await extractCallerUid(req);
  const isOwner = Boolean(callerUid && callerUid === targetUserId);

  const rawActivities = await getRawUserActivities(targetUserId);

  // Busca configurações de privacidade do usuário alvo
  const targetProfile: UserProfile | undefined =
    targetUserId === CURRENT_USER.id
      ? CURRENT_USER
      : OTHER_USERS[targetUserId];

  const privacySettings = targetProfile?.privacySettings;
  const isProfilePrivate = Boolean(targetProfile?.isPrivate);

  // Aplica filtragem estrita no backend:
  // - Proprietário: recebe 100% dos dados, incluindo eventos de sincronização MAL e AniList
  // - Outros usuários / público: NUNCA recebem eventos de importação/sincronização
  const filteredActivities = filterActivitiesForViewer(rawActivities, isOwner, {
    showActivity: privacySettings?.showActivity,
    isPrivate: isProfilePrivate,
  });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json({
    success: true,
    userId: targetUserId,
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
