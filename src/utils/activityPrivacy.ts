import type { UserActivity } from '../types/index.js';

/**
 * Identifica se uma atividade é um evento de sincronização, importação ou atualização
 * de listas de plataformas externas (MyAnimeList / AniList).
 */
export function isImportSyncActivity(activity: UserActivity): boolean {
  if (activity.isPrivate) return true;

  const idLower = (activity.id || '').toLowerCase();
  if (
    idLower.includes('anilist_sync') ||
    idLower.includes('mal_sync') ||
    idLower.includes('anilist_disconnect') ||
    idLower.includes('mal_disconnect')
  ) {
    return true;
  }

  const titleLower = (activity.title || '').toLowerCase();
  const descLower = (activity.description || '').toLowerCase();

  // Títulos típicos de integração:
  // "Sincronizou a lista com o MyAnimeList (@...)"
  // "Sincronizou a lista com o AniList (@...)"
  // "Desconectou a conta do MyAnimeList"
  // "Desconectou a conta do AniList"
  if (
    titleLower.includes('sincronizou a lista') ||
    titleLower.includes('myanimelist') ||
    titleLower.includes('anilist') ||
    titleLower.includes('desconectou a conta')
  ) {
    return true;
  }

  // Descrições típicas de integração:
  // "Lista atualizada com 1469 animes no perfil"
  // "... animes importados foram removidos da coleção"
  if (
    descLower.includes('animes no perfil') ||
    descLower.includes('animes importados') ||
    descLower.includes('sincronizou') ||
    descLower.includes('myanimelist') ||
    descLower.includes('anilist')
  ) {
    return true;
  }

  return false;
}

/**
 * Sanitiza e filtra as atividades com base na identidade do visualizador.
 * 
 * Regra:
 * - O proprietário (isOwner === true) tem acesso completo a todos os seus registros,
 *   incluindo eventos de sincronização com MyAnimeList e AniList.
 * - Outros usuários ou visitantes públicos (isOwner === false) NUNCA recebem nem visualizam
 *   mensagens ou eventos de sincronização/importação, recebendo apenas atividades normais
 *   (assistiu episódio, avaliou, concluiu, comentou, favoritou).
 * - Se as atividades estiverem marcadas como privadas no perfil (showActivity === false),
 *   visitantes recebem uma lista vazia.
 */
export function filterActivitiesForViewer(
  activities: UserActivity[],
  isOwner: boolean,
  privacySettings?: { showActivity?: boolean; isPrivate?: boolean }
): UserActivity[] {
  if (!Array.isArray(activities)) return [];

  // Se o proprietário está consultando seus próprios dados: preserva 100% dos registros
  if (isOwner) {
    return activities;
  }

  // Se o perfil do usuário for privado ou o feed de atividades estiver oculto para visitantes
  if (privacySettings?.isPrivate || privacySettings?.showActivity === false) {
    return [];
  }

  // Para outros usuários/público: remove estritamente todos os eventos de importação e sincronização
  return activities.filter((act) => !isImportSyncActivity(act));
}
