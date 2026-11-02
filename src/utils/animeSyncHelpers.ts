import type { FavoriteCharacter } from '../types';

/**
 * Normaliza um título removendo pontuações, acentos e espaços em branco para busca sem ambiguidade.
 */
export function normalizeTitle(t: string): string {
  if (!t) return '';
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Determina se a capa ou imagem é genérica (comprovadamente do domínio images.unsplash.com) ou está ausente/vazia.
 */
export function isGenericOrMissingPoster(posterUrl?: string | null): boolean {
  if (!posterUrl || typeof posterUrl !== 'string' || !posterUrl.trim()) {
    return true;
  }
  const trimmed = posterUrl.trim().toLowerCase();
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === 'images.unsplash.com' || parsed.hostname.endsWith('.unsplash.com');
  } catch {
    return trimmed.includes('images.unsplash.com') || trimmed.includes('unsplash.com');
  }
}

export const isGenericOrMissingImage = isGenericOrMissingPoster;

/**
 * Valida se a capa ou imagem recebida da plataforma externa é uma URL válida (HTTP/HTTPS) e não-vazia.
 */
export function isValidPosterUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isValidImageUrl = isValidPosterUrl;

let lastFetchedAniListCharacters: FavoriteCharacter[] = [];

export function getLastFetchedAniListCharacters(): FavoriteCharacter[] {
  return [...lastFetchedAniListCharacters];
}

export function setLastFetchedAniListCharacters(chars: FavoriteCharacter[]): void {
  lastFetchedAniListCharacters = [...chars];
}

/**
 * Mescla personagens favoritos locais com os favoritos importados do AniList:
 * - Preserva a ordem original dos favoritos manuais e evita duplicatas.
 * - Substitui imagens genéricas do Unsplash ou ausentes por imagem oficial válida recebida.
 * - Preserva imagens oficiais existentes e imagens personalizadas pelo usuário (Data URLs, serviços externos, caminhos locais).
 * - Proteção contra URLs vazias ou inválidas da API (nunca sobrescrevem uma imagem válida).
 * - Mantém rigorosamente intactos todos os demais campos (id, name, originalName, animeName, role).
 */
export function mergeFavoriteCharacters(
  existingCharacters: FavoriteCharacter[],
  incomingCharacters: FavoriteCharacter[]
): FavoriteCharacter[] {
  const result: FavoriteCharacter[] = existingCharacters.map((char) => ({ ...char }));
  const idIndexMap = new Map<string, number>();
  const nameIndexMap = new Map<string, number>();

  result.forEach((char, idx) => {
    if (char.id) idIndexMap.set(char.id, idx);
    const normName = normalizeTitle(char.name);
    if (normName && !nameIndexMap.has(normName)) {
      nameIndexMap.set(normName, idx);
    }
  });

  for (const inc of incomingCharacters) {
    const normName = normalizeTitle(inc.name);
    let matchIdx = -1;

    if (inc.id && idIndexMap.has(inc.id)) {
      matchIdx = idIndexMap.get(inc.id)!;
    } else if (normName && nameIndexMap.has(normName)) {
      matchIdx = nameIndexMap.get(normName)!;
    }

    if (matchIdx >= 0) {
      const existingChar = result[matchIdx];
      if (isGenericOrMissingPoster(existingChar.imageUrl) && isValidPosterUrl(inc.imageUrl)) {
        result[matchIdx] = {
          ...existingChar,
          imageUrl: inc.imageUrl,
        };
      }
    } else {
      result.push({ ...inc });
      const newIdx = result.length - 1;
      if (inc.id) idIndexMap.set(inc.id, newIdx);
      if (normName && !nameIndexMap.has(normName)) {
        nameIndexMap.set(normName, newIdx);
      }
    }
  }

  return result;
}
