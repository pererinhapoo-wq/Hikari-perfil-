import type { FavoriteCharacter, FavoriteCompany, FavoritePerson } from '../types';

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
let lastFetchedAniListCompanies: FavoriteCompany[] = [];
let lastFetchedAniListPeople: FavoritePerson[] = [];

export function getLastFetchedAniListCharacters(): FavoriteCharacter[] {
  return [...lastFetchedAniListCharacters];
}

export function setLastFetchedAniListCharacters(chars: FavoriteCharacter[]): void {
  lastFetchedAniListCharacters = [...chars];
}

export function getLastFetchedAniListCompanies(): FavoriteCompany[] {
  return [...lastFetchedAniListCompanies];
}

export function setLastFetchedAniListCompanies(companies: FavoriteCompany[]): void {
  lastFetchedAniListCompanies = [...companies];
}

export function getLastFetchedAniListPeople(): FavoritePerson[] {
  return [...lastFetchedAniListPeople];
}

export function setLastFetchedAniListPeople(people: FavoritePerson[]): void {
  lastFetchedAniListPeople = [...people];
}

export function clearLastFetchedAniListFavorites(): void {
  lastFetchedAniListCharacters = [];
  lastFetchedAniListCompanies = [];
  lastFetchedAniListPeople = [];
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

/**
 * Mescla empresas e estúdios favoritos locais com os favoritos importados do AniList:
 * - Preserva a ordem original dos favoritos manuais e evita duplicatas.
 * - Identifica itens preferencialmente pelo ID externo do AniList (anilistId ou comp_al_${id}), ou pelo nome normalizado.
 * - Preserva logos existentes, descrições e edições manuais realizadas no Hikari Perfil.
 * - Substitui logos genéricos ou ausentes por logos oficiais válidos se disponíveis.
 * - Nunca mistura estúdios com pessoas.
 * - Trata listas vazias e falhas da API sem apagar favoritos manuais existentes.
 */
export function mergeFavoriteCompanies(
  existingCompanies: FavoriteCompany[],
  incomingCompanies: FavoriteCompany[]
): FavoriteCompany[] {
  if (!Array.isArray(incomingCompanies) || incomingCompanies.length === 0) {
    return existingCompanies.map((comp) => ({ ...comp }));
  }

  const result: FavoriteCompany[] = existingCompanies.map((comp) => ({ ...comp }));
  const idIndexMap = new Map<string, number>();
  const nameIndexMap = new Map<string, number>();
  const anilistIdIndexMap = new Map<number, number>();

  result.forEach((comp, idx) => {
    if (comp.id) idIndexMap.set(comp.id, idx);
    const normName = normalizeTitle(comp.name);
    if (normName && !nameIndexMap.has(normName)) {
      nameIndexMap.set(normName, idx);
    }
    let effectiveAniId = comp.anilistId;
    if (!effectiveAniId && typeof comp.id === 'string') {
      const match = comp.id.match(/^comp_al_(\d+)$/i);
      if (match) {
        effectiveAniId = parseInt(match[1], 10);
      }
    }
    if (effectiveAniId && !anilistIdIndexMap.has(effectiveAniId)) {
      anilistIdIndexMap.set(effectiveAniId, idx);
    }
  });

  for (const inc of incomingCompanies) {
    let incAniId = inc.anilistId;
    if (!incAniId && typeof inc.id === 'string') {
      const match = inc.id.match(/^comp_al_(\d+)$/i);
      if (match) {
        incAniId = parseInt(match[1], 10);
      }
    }

    const normName = normalizeTitle(inc.name);
    let matchIdx = -1;

    // Prioridade 1: Identificador numérico do AniList
    if (incAniId && anilistIdIndexMap.has(incAniId)) {
      matchIdx = anilistIdIndexMap.get(incAniId)!;
    } else if (inc.id && idIndexMap.has(inc.id)) {
      matchIdx = idIndexMap.get(inc.id)!;
    } else if (normName && nameIndexMap.has(normName)) {
      matchIdx = nameIndexMap.get(normName)!;
    }

    if (matchIdx >= 0) {
      // Atualiza enriquecendo metadados mantendo integridade dos dados manuais
      const existing = result[matchIdx];
      const updated: FavoriteCompany = { ...existing };
      if (incAniId && !updated.anilistId) {
        updated.anilistId = incAniId;
      }
      if (isGenericOrMissingPoster(existing.logoUrl) && isValidPosterUrl(inc.logoUrl)) {
        updated.logoUrl = inc.logoUrl;
      }
      if (
        (!existing.notableWorks || existing.notableWorks === 'Produções notáveis no AniList') &&
        inc.notableWorks
      ) {
        updated.notableWorks = inc.notableWorks;
      }
      result[matchIdx] = updated;
    } else {
      result.push({ ...inc });
      const newIdx = result.length - 1;
      if (inc.id) idIndexMap.set(inc.id, newIdx);
      if (incAniId) anilistIdIndexMap.set(incAniId, newIdx);
      if (normName && !nameIndexMap.has(normName)) {
        nameIndexMap.set(normName, newIdx);
      }
    }
  }

  return result;
}

/**
 * Mescla pessoas favoritas (criadores, diretores e profissionais de voz) locais com os favoritos importados do AniList:
 * - Preserva a ordem original dos favoritos manuais e evita duplicatas.
 * - Identifica itens preferencialmente pelo ID externo do AniList (anilistId ou person_al_${id}), ou pelo nome normalizado.
 * - Preserva imagens customizadas, papéis/funções e obras notáveis manuais.
 * - Substitui imagens genéricas ou ausentes por foto oficial válida do AniList.
 * - Nunca mistura pessoas com estúdios.
 * - Trata listas vazias e falhas da API sem apagar favoritos manuais existentes.
 */
export function mergeFavoritePeople(
  existingPeople: FavoritePerson[],
  incomingPeople: FavoritePerson[]
): FavoritePerson[] {
  if (!Array.isArray(incomingPeople) || incomingPeople.length === 0) {
    return existingPeople.map((p) => ({ ...p }));
  }

  const result: FavoritePerson[] = existingPeople.map((p) => ({ ...p }));
  const idIndexMap = new Map<string, number>();
  const nameIndexMap = new Map<string, number>();
  const anilistIdIndexMap = new Map<number, number>();

  result.forEach((p, idx) => {
    if (p.id) idIndexMap.set(p.id, idx);
    const normName = normalizeTitle(p.name);
    if (normName && !nameIndexMap.has(normName)) {
      nameIndexMap.set(normName, idx);
    }
    let effectiveAniId = p.anilistId;
    if (!effectiveAniId && typeof p.id === 'string') {
      const match = p.id.match(/^person_al_(\d+)$/i);
      if (match) {
        effectiveAniId = parseInt(match[1], 10);
      }
    }
    if (effectiveAniId && !anilistIdIndexMap.has(effectiveAniId)) {
      anilistIdIndexMap.set(effectiveAniId, idx);
    }
  });

  for (const inc of incomingPeople) {
    let incAniId = inc.anilistId;
    if (!incAniId && typeof inc.id === 'string') {
      const match = inc.id.match(/^person_al_(\d+)$/i);
      if (match) {
        incAniId = parseInt(match[1], 10);
      }
    }

    const normName = normalizeTitle(inc.name);
    let matchIdx = -1;

    // Prioridade 1: Identificador numérico do AniList
    if (incAniId && anilistIdIndexMap.has(incAniId)) {
      matchIdx = anilistIdIndexMap.get(incAniId)!;
    } else if (inc.id && idIndexMap.has(inc.id)) {
      matchIdx = idIndexMap.get(inc.id)!;
    } else if (normName && nameIndexMap.has(normName)) {
      matchIdx = nameIndexMap.get(normName)!;
    }

    if (matchIdx >= 0) {
      const existing = result[matchIdx];
      const updated: FavoritePerson = { ...existing };
      if (incAniId && !updated.anilistId) {
        updated.anilistId = incAniId;
      }
      if (isGenericOrMissingPoster(existing.imageUrl) && isValidPosterUrl(inc.imageUrl)) {
        updated.imageUrl = inc.imageUrl;
      }
      if (
        (!existing.notableWork || existing.notableWork === 'Trabalhos notáveis no AniList') &&
        inc.notableWork
      ) {
        updated.notableWork = inc.notableWork;
      }
      result[matchIdx] = updated;
    } else {
      result.push({ ...inc });
      const newIdx = result.length - 1;
      if (inc.id) idIndexMap.set(inc.id, newIdx);
      if (incAniId) anilistIdIndexMap.set(incAniId, newIdx);
      if (normName && !nameIndexMap.has(normName)) {
        nameIndexMap.set(normName, newIdx);
      }
    }
  }

  return result;
}
