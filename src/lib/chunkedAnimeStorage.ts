import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db, firebaseConfigStatus } from './firebase';
import type { AnimeItem, AnimeStatus } from '../types';
import type { FirestoreSyncStatus } from './userWorkspaceStorage';
import { computeAnimeStatusCounts } from '../utils/animeStats';

/**
 * Constantes de dimensionamento e controle dos blocos de animes.
 *
 * Justificativa técnica:
 * - O Firestore impõe um limite estrito de 1.048.576 bytes (1 MiB) por documento.
 * - Um registro de AnimeItem serializado varia tipicamente entre 350 e 700 bytes.
 * - 300 animes por bloco ocupam entre 105 KiB e 210 KiB (~15% a 20% do limite máximo),
 *   proporcionando ampla margem de segurança contra estouro e permitindo perfis
 *   com 2.000, 5.000 ou 10.000 animes particionados em blocos de alta performance.
 */
export const DEFAULT_CHUNK_SIZE = 300;
export const MAX_ALLOWED_CHUNK_SIZE = 450;

export interface AnimeStorageManifest {
  version: 1;
  storageEngine: 'chunked_v1';
  ownerUid: string;
  totalAnimes: number;
  chunkIds: string[];
  chunkCounts: Record<string, number>;
  statusCounts: Record<AnimeItem['status'], number>;
  animeToChunkMap?: Record<string, string>;
  migratedFromLegacy: boolean;
  legacyItemCount: number;
  lastMigratedAtMs?: number;
  updatedAtMs: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface AnimeChunkDocument {
  ownerUid: string;
  chunkId: string;
  chunkIndex: number;
  animes: AnimeItem[];
  count: number;
  updatedAtMs: number;
  updatedAt?: unknown;
}

export interface ChunkedStorageMetrics {
  manifestReads: number;
  manifestWrites: number;
  chunkReads: number;
  chunkWrites: number;
  singleAnimeUpdates: number;
  migrationsExecuted: number;
}

const storageMetrics: ChunkedStorageMetrics = {
  manifestReads: 0,
  manifestWrites: 0,
  chunkReads: 0,
  chunkWrites: 0,
  singleAnimeUpdates: 0,
  migrationsExecuted: 0,
};

export function getChunkedStorageMetrics(): ChunkedStorageMetrics {
  return { ...storageMetrics };
}

export function resetChunkedStorageMetrics(): void {
  storageMetrics.manifestReads = 0;
  storageMetrics.manifestWrites = 0;
  storageMetrics.chunkReads = 0;
  storageMetrics.chunkWrites = 0;
  storageMetrics.singleAnimeUpdates = 0;
  storageMetrics.migrationsExecuted = 0;
}

// In-Memory cache of manifests and loaded chunks to avoid repetitive remote network calls
const manifestMemoryCache = new Map<string, { manifest: AnimeStorageManifest; cachedAtMs: number }>();
const chunksMemoryCache = new Map<string, Map<string, AnimeItem[]>>();

export function clearChunkedStorageMemoryCache(uid?: string): void {
  if (uid) {
    manifestMemoryCache.delete(uid);
    chunksMemoryCache.delete(uid);
  } else {
    manifestMemoryCache.clear();
    chunksMemoryCache.clear();
  }
}

/**
 * Divide uma lista de animes em blocos de tamanho controlado (padrão: 300).
 */
export function partitionAnimesIntoChunks(
  animes: AnimeItem[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): AnimeItem[][] {
  const size = Math.max(50, Math.min(chunkSize, MAX_ALLOWED_CHUNK_SIZE));
  const chunks: AnimeItem[][] = [];
  for (let i = 0; i < animes.length; i += size) {
    chunks.push(animes.slice(i, i + size));
  }
  return chunks;
}

/**
 * Constrói o mapa de alocação de animes para chunks: animeId -> chunkId.
 */
export function buildAnimeToChunkMap(
  chunks: AnimeItem[][],
  chunkPrefix = 'chunk_'
): { chunkIds: string[]; chunkCounts: Record<string, number>; animeToChunkMap: Record<string, string> } {
  const chunkIds: string[] = [];
  const chunkCounts: Record<string, number> = {};
  const animeToChunkMap: Record<string, string> = {};

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkId = `${chunkPrefix}${idx}`;
    chunkIds.push(chunkId);
    chunkCounts[chunkId] = chunks[idx].length;
    for (const item of chunks[idx]) {
      if (item && item.id) {
        animeToChunkMap[item.id] = chunkId;
      }
    }
  }

  return { chunkIds, chunkCounts, animeToChunkMap };
}

/**
 * Carrega o manifesto de armazenamento particionado do Firestore.
 */
export async function loadAnimeManifestFromFirestore(
  userId: string
): Promise<{ manifest: AnimeStorageManifest | null; status: FirestoreSyncStatus }> {
  const cleanUid = userId.trim();
  if (!cleanUid) {
    return { manifest: null, status: 'error' };
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return { manifest: null, status: 'unconfigured' };
  }

  try {
    const manifestRef = doc(db, 'users', cleanUid, 'anime_storage', 'manifest');
    storageMetrics.manifestReads++;
    const snap = await getDoc(manifestRef);

    if (!snap.exists()) {
      return { manifest: null, status: 'empty_remote' };
    }

    const data = snap.data();
    if (data.ownerUid !== cleanUid || data.storageEngine !== 'chunked_v1') {
      return { manifest: null, status: 'error' };
    }

    const updatedAtTimestamp = data.updatedAt as Timestamp | undefined;
    const updatedAtMs =
      typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
        ? data.updatedAtMs
        : updatedAtTimestamp && typeof updatedAtTimestamp.toMillis === 'function'
        ? updatedAtTimestamp.toMillis()
        : Date.now();

    const manifest: AnimeStorageManifest = {
      version: 1,
      storageEngine: 'chunked_v1',
      ownerUid: cleanUid,
      totalAnimes: typeof data.totalAnimes === 'number' ? data.totalAnimes : 0,
      chunkIds: Array.isArray(data.chunkIds) ? data.chunkIds : [],
      chunkCounts: typeof data.chunkCounts === 'object' && data.chunkCounts !== null ? data.chunkCounts : {},
      statusCounts: typeof data.statusCounts === 'object' && data.statusCounts !== null ? data.statusCounts : {
        watching: 0,
        completed: 0,
        planned: 0,
        on_hold: 0,
        dropped: 0,
      },
      animeToChunkMap: typeof data.animeToChunkMap === 'object' && data.animeToChunkMap !== null ? data.animeToChunkMap : undefined,
      migratedFromLegacy: Boolean(data.migratedFromLegacy),
      legacyItemCount: typeof data.legacyItemCount === 'number' ? data.legacyItemCount : 0,
      lastMigratedAtMs: typeof data.lastMigratedAtMs === 'number' ? data.lastMigratedAtMs : undefined,
      updatedAtMs,
    };

    manifestMemoryCache.set(cleanUid, { manifest, cachedAtMs: Date.now() });
    return { manifest, status: 'synced' };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') {
      return { manifest: null, status: 'permission_denied' };
    }
    return { manifest: null, status: 'error' };
  }
}

/**
 * Carrega todos os animes do usuário a partir dos blocos particionados no Firestore.
 */
export async function loadAllChunkedAnimesFromFirestore(
  userId: string
): Promise<{ animes: AnimeItem[] | null; manifest: AnimeStorageManifest | null; status: FirestoreSyncStatus }> {
  const cleanUid = userId.trim();
  if (!cleanUid) {
    return { animes: null, manifest: null, status: 'error' };
  }

  const { manifest, status } = await loadAnimeManifestFromFirestore(cleanUid);
  if (!manifest || status !== 'synced') {
    return { animes: null, manifest: null, status };
  }

  if (manifest.chunkIds.length === 0) {
    return { animes: [], manifest, status: 'synced' };
  }

  if (!firebaseConfigStatus.isInitialized || !db) {
    return { animes: null, manifest: null, status: 'unconfigured' };
  }

  const activeDb = db;
  try {
    const chunkPromises = manifest.chunkIds.map(async (chunkId) => {
      const chunkRef = doc(activeDb, 'users', cleanUid, 'anime_chunks', chunkId);
      storageMetrics.chunkReads++;
      const snap = await getDoc(chunkRef);
      if (!snap.exists()) {
        return [];
      }
      const data = snap.data();
      return Array.isArray(data.animes) ? (data.animes as AnimeItem[]) : [];
    });

    const chunkResults = await Promise.all(chunkPromises);
    const combinedAnimes: AnimeItem[] = [];
    const seenIds = new Set<string>();

    for (const chunkList of chunkResults) {
      for (const item of chunkList) {
        if (item && item.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          combinedAnimes.push(item);
        }
      }
    }

    return { animes: combinedAnimes, manifest, status: 'synced' };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') {
      return { animes: null, manifest: null, status: 'permission_denied' };
    }
    return { animes: null, manifest: null, status: 'error' };
  }
}

/**
 * Salva a lista integral de animes distribuída em blocos no Firestore.
 * Cada bloco recebe aproximadamente 300 animes e um manifesto é mantido sincronizado.
 */
export async function saveAllAnimesToChunkedFirestore(
  userId: string,
  animes: AnimeItem[],
  options?: { migratedFromLegacy?: boolean; legacyItemCount?: number }
): Promise<FirestoreSyncStatus> {
  const cleanUid = userId.trim();
  if (!cleanUid) return 'error';
  if (!firebaseConfigStatus.isInitialized || !db) return 'unconfigured';

  try {
    const chunks = partitionAnimesIntoChunks(animes, DEFAULT_CHUNK_SIZE);
    const { chunkIds, chunkCounts, animeToChunkMap } = buildAnimeToChunkMap(chunks);
    const statusCounts = computeAnimeStatusCounts(animes);
    const nowMs = Date.now();

    // Divide as operações em lotes de gravação do Firestore (máximo 500 operações por lote)
    // Cada chunk é 1 setDoc. O manifesto é 1 setDoc.
    let currentBatch = writeBatch(db);
    let opCount = 0;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkId = chunkIds[idx];
      const chunkRef = doc(db, 'users', cleanUid, 'anime_chunks', chunkId);
      const chunkDoc: AnimeChunkDocument = {
        ownerUid: cleanUid,
        chunkId,
        chunkIndex: idx,
        animes: chunks[idx],
        count: chunks[idx].length,
        updatedAtMs: nowMs,
      };

      currentBatch.set(chunkRef, {
        ...chunkDoc,
        updatedAt: serverTimestamp(),
      });
      storageMetrics.chunkWrites++;
      opCount++;

      if (opCount >= 400) {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        opCount = 0;
      }
    }

    // Grava o manifesto apontando para todos os blocos alocados
    const manifestRef = doc(db, 'users', cleanUid, 'anime_storage', 'manifest');
    const manifestDoc: AnimeStorageManifest = {
      version: 1,
      storageEngine: 'chunked_v1',
      ownerUid: cleanUid,
      totalAnimes: animes.length,
      chunkIds,
      chunkCounts,
      statusCounts: {
        watching: statusCounts.watching,
        completed: statusCounts.completed,
        planned: statusCounts.planned,
        on_hold: statusCounts.on_hold,
        dropped: statusCounts.dropped,
      },
      // Para perfis com menos de 5.000 animes, manter o mapa no manifesto agiliza buscas O(1)
      animeToChunkMap: animes.length <= 5000 ? animeToChunkMap : undefined,
      migratedFromLegacy: options?.migratedFromLegacy ?? false,
      legacyItemCount: options?.legacyItemCount ?? animes.length,
      lastMigratedAtMs: options?.migratedFromLegacy ? nowMs : undefined,
      updatedAtMs: nowMs,
    };

    currentBatch.set(manifestRef, {
      ...manifestDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    storageMetrics.manifestWrites++;

    await currentBatch.commit();
    manifestMemoryCache.set(cleanUid, { manifest: manifestDoc, cachedAtMs: nowMs });

    return 'synced';
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') return 'permission_denied';
    return 'error';
  }
}

/**
 * Atualiza um único anime em seu bloco específico sem regravar ou ler os demais blocos.
 */
export async function updateSingleAnimeInChunkedFirestore(
  userId: string,
  animeId: string,
  updater: (prev: AnimeItem) => AnimeItem | null
): Promise<{ success: boolean; updatedAnime: AnimeItem | null }> {
  const cleanUid = userId.trim();
  if (!cleanUid || !animeId) {
    return { success: false, updatedAnime: null };
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return { success: false, updatedAnime: null };
  }

  const { manifest } = await loadAnimeManifestFromFirestore(cleanUid);
  if (!manifest) {
    return { success: false, updatedAnime: null };
  }

  // Tenta localizar o chunkId pelo mapa ou percorre os chunkIds conhecidos
  let targetChunkId = manifest.animeToChunkMap?.[animeId];
  let chunkAnimes: AnimeItem[] | null = null;
  let foundIndex = -1;

  if (targetChunkId) {
    const chunkRef = doc(db, 'users', cleanUid, 'anime_chunks', targetChunkId);
    storageMetrics.chunkReads++;
    const snap = await getDoc(chunkRef);
    if (snap.exists()) {
      const data = snap.data();
      const list = Array.isArray(data.animes) ? (data.animes as AnimeItem[]) : [];
      foundIndex = list.findIndex((a) => a.id === animeId);
      if (foundIndex >= 0) {
        chunkAnimes = list;
      }
    }
  }

  if (!chunkAnimes || foundIndex < 0) {
    // Procura entre os chunks do usuário
    for (const cid of manifest.chunkIds) {
      if (cid === targetChunkId) continue;
      const cRef = doc(db, 'users', cleanUid, 'anime_chunks', cid);
      storageMetrics.chunkReads++;
      const snap = await getDoc(cRef);
      if (snap.exists()) {
        const data = snap.data();
        const list = Array.isArray(data.animes) ? (data.animes as AnimeItem[]) : [];
        const idx = list.findIndex((a) => a.id === animeId);
        if (idx >= 0) {
          targetChunkId = cid;
          chunkAnimes = list;
          foundIndex = idx;
          break;
        }
      }
    }
  }

  if (!chunkAnimes || foundIndex < 0 || !targetChunkId) {
    return { success: false, updatedAnime: null };
  }

  const currentAnime = chunkAnimes[foundIndex];
  const updated = updater(currentAnime);
  if (!updated) {
    return { success: true, updatedAnime: currentAnime };
  }

  // Substitui no bloco específico e regrava SOMENTE este bloco
  const updatedChunkList = [...chunkAnimes];
  updatedChunkList[foundIndex] = updated;

  const nowMs = Date.now();
  const batch = writeBatch(db);
  const targetChunkRef = doc(db, 'users', cleanUid, 'anime_chunks', targetChunkId);

  batch.update(targetChunkRef, {
    animes: updatedChunkList,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  storageMetrics.chunkWrites++;
  storageMetrics.singleAnimeUpdates++;

  // Se o status foi alterado, atualiza as contagens no manifesto
  if (currentAnime.status !== updated.status) {
    const nextStatusCounts = { ...manifest.statusCounts };
    nextStatusCounts[currentAnime.status] = Math.max(0, (nextStatusCounts[currentAnime.status] || 1) - 1);
    nextStatusCounts[updated.status] = (nextStatusCounts[updated.status] || 0) + 1;

    const manifestRef = doc(db, 'users', cleanUid, 'anime_storage', 'manifest');
    batch.update(manifestRef, {
      statusCounts: nextStatusCounts,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
    storageMetrics.manifestWrites++;
  }

  await batch.commit();
  return { success: true, updatedAnime: updated };
}

/**
 * Remove um anime de seu bloco específico no Firestore e atualiza o manifesto.
 */
export async function deleteSingleAnimeFromChunkedFirestore(
  userId: string,
  animeId: string
): Promise<boolean> {
  const cleanUid = userId.trim();
  if (!cleanUid || !animeId) return false;
  if (!firebaseConfigStatus.isInitialized || !db) return false;

  const { manifest } = await loadAnimeManifestFromFirestore(cleanUid);
  if (!manifest) return false;

  let targetChunkId = manifest.animeToChunkMap?.[animeId];
  let chunkAnimes: AnimeItem[] | null = null;
  let foundIndex = -1;

  if (targetChunkId) {
    const chunkRef = doc(db, 'users', cleanUid, 'anime_chunks', targetChunkId);
    storageMetrics.chunkReads++;
    const snap = await getDoc(chunkRef);
    if (snap.exists()) {
      const data = snap.data();
      const list = Array.isArray(data.animes) ? (data.animes as AnimeItem[]) : [];
      foundIndex = list.findIndex((a) => a.id === animeId);
      if (foundIndex >= 0) {
        chunkAnimes = list;
      }
    }
  }

  if (!chunkAnimes || foundIndex < 0) {
    for (const cid of manifest.chunkIds) {
      if (cid === targetChunkId) continue;
      const cRef = doc(db, 'users', cleanUid, 'anime_chunks', cid);
      storageMetrics.chunkReads++;
      const snap = await getDoc(cRef);
      if (snap.exists()) {
        const data = snap.data();
        const list = Array.isArray(data.animes) ? (data.animes as AnimeItem[]) : [];
        const idx = list.findIndex((a) => a.id === animeId);
        if (idx >= 0) {
          targetChunkId = cid;
          chunkAnimes = list;
          foundIndex = idx;
          break;
        }
      }
    }
  }

  if (!chunkAnimes || foundIndex < 0 || !targetChunkId) return false;

  const deletedAnime = chunkAnimes[foundIndex];
  const nextChunkList = chunkAnimes.filter((a) => a.id !== animeId);

  const nowMs = Date.now();
  const batch = writeBatch(db);
  const targetChunkRef = doc(db, 'users', cleanUid, 'anime_chunks', targetChunkId);

  batch.update(targetChunkRef, {
    animes: nextChunkList,
    count: nextChunkList.length,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  storageMetrics.chunkWrites++;

  // Atualiza manifesto
  const manifestRef = doc(db, 'users', cleanUid, 'anime_storage', 'manifest');
  const nextChunkCounts = { ...manifest.chunkCounts, [targetChunkId]: nextChunkList.length };
  const nextStatusCounts = { ...manifest.statusCounts };
  nextStatusCounts[deletedAnime.status] = Math.max(0, (nextStatusCounts[deletedAnime.status] || 1) - 1);

  const nextMap = manifest.animeToChunkMap ? { ...manifest.animeToChunkMap } : undefined;
  if (nextMap) delete nextMap[animeId];

  batch.update(manifestRef, {
    totalAnimes: Math.max(0, manifest.totalAnimes - 1),
    chunkCounts: nextChunkCounts,
    statusCounts: nextStatusCounts,
    ...(nextMap ? { animeToChunkMap: nextMap } : {}),
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
  storageMetrics.manifestWrites++;

  await batch.commit();
  return true;
}

/**
 * Migração Idempotente, Segura e NÃO Destrutiva do documento legado "workspace/personal"
 * para o novo armazenamento particionado em blocos.
 *
 * Garantias fundamentais:
 * 1. O documento legado NÃO é apagado. Permanece intacto como cópia de segurança e ponto de restauração.
 * 2. Idempotência estrita: executada repetidas vezes, valida a integridade e não duplica animes.
 * 3. Validação prévia de integridade: compara a quantidade e todos os IDs antes de confirmar.
 * 4. Retomada em caso de falha: se interrompida, pode ser reexecutada sem inconsistência.
 */
export async function migrateLegacyWorkspaceToChunked(
  userId: string,
  options?: { force?: boolean }
): Promise<{
  success: boolean;
  migratedCount: number;
  alreadyMigrated: boolean;
  chunksCreated: number;
  status: FirestoreSyncStatus;
}> {
  const cleanUid = userId.trim();
  if (!cleanUid) {
    return { success: false, migratedCount: 0, alreadyMigrated: false, chunksCreated: 0, status: 'error' };
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return { success: false, migratedCount: 0, alreadyMigrated: false, chunksCreated: 0, status: 'unconfigured' };
  }

  try {
    // 1. Verifica se já existe um manifesto validado
    const { manifest: existingManifest } = await loadAnimeManifestFromFirestore(cleanUid);
    const personalRef = doc(db, 'users', cleanUid, 'workspace', 'personal');
    const personalSnap = await getDoc(personalRef);

    if (!personalSnap.exists()) {
      return {
        success: true,
        migratedCount: existingManifest ? existingManifest.totalAnimes : 0,
        alreadyMigrated: Boolean(existingManifest?.migratedFromLegacy),
        chunksCreated: existingManifest ? existingManifest.chunkIds.length : 0,
        status: 'synced',
      };
    }

    const legacyData = personalSnap.data();
    const legacyAnimes = Array.isArray(legacyData.animes) ? (legacyData.animes as AnimeItem[]) : [];

    // Idempotência: Se já foi migrado e a contagem coincide exatamente, não refaz
    if (
      !options?.force &&
      existingManifest &&
      existingManifest.migratedFromLegacy &&
      existingManifest.totalAnimes === legacyAnimes.length
    ) {
      return {
        success: true,
        migratedCount: existingManifest.totalAnimes,
        alreadyMigrated: true,
        chunksCreated: existingManifest.chunkIds.length,
        status: 'synced',
      };
    }

    if (legacyAnimes.length === 0) {
      return {
        success: true,
        migratedCount: 0,
        alreadyMigrated: false,
        chunksCreated: 0,
        status: 'synced',
      };
    }

    // 2. Particiona os animes legados em blocos de 300
    const chunks = partitionAnimesIntoChunks(legacyAnimes, DEFAULT_CHUNK_SIZE);
    const saveStatus = await saveAllAnimesToChunkedFirestore(cleanUid, legacyAnimes, {
      migratedFromLegacy: true,
      legacyItemCount: legacyAnimes.length,
    });

    if (saveStatus !== 'synced') {
      return {
        success: false,
        migratedCount: 0,
        alreadyMigrated: false,
        chunksCreated: 0,
        status: saveStatus,
      };
    }

    // 3. Validação de integridade pós-gravação
    const verifyResult = await loadAllChunkedAnimesFromFirestore(cleanUid);
    if (!verifyResult.animes || verifyResult.animes.length !== legacyAnimes.length) {
      return {
        success: false,
        migratedCount: verifyResult.animes?.length ?? 0,
        alreadyMigrated: false,
        chunksCreated: chunks.length,
        status: 'error',
      };
    }

    // Valida que todos os IDs do legado estão presentes
    const migratedIdSet = new Set(verifyResult.animes.map((a) => a.id));
    for (const legacyItem of legacyAnimes) {
      if (!migratedIdSet.has(legacyItem.id)) {
        return {
          success: false,
          migratedCount: verifyResult.animes.length,
          alreadyMigrated: false,
          chunksCreated: chunks.length,
          status: 'error',
        };
      }
    }

    storageMetrics.migrationsExecuted++;

    // NOTA DE SEGURANÇA OBRIGATÓRIA:
    // O documento legado `workspace/personal` NUNCA é apagado (deleteDoc não é chamado).
    // Ele permanece preservado como garantia de reversibilidade integral e backup oficial.
    return {
      success: true,
      migratedCount: legacyAnimes.length,
      alreadyMigrated: false,
      chunksCreated: chunks.length,
      status: 'synced',
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') {
      return { success: false, migratedCount: 0, alreadyMigrated: false, chunksCreated: 0, status: 'permission_denied' };
    }
    return { success: false, migratedCount: 0, alreadyMigrated: false, chunksCreated: 0, status: 'error' };
  }
}
