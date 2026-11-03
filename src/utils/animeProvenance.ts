import type { AnimeItem, AnimeProvenance, AnimeOriginProvider } from '../types';

/**
 * Classifica a origem de registros legados de forma estrita e conservadora.
 * Regra obrigatória: Se a origem não puder ser comprovada de forma inequívoca pelos
 * metadados estruturais do item (como IDs canônicos do gerador de importação),
 * o registro DEVE receber a classificação 'legacy_unknown'.
 * Não inventa a origem e não atribui automaticamente à conta atualmente conectada.
 */
export function classifyLegacyAnimeOrigin(item: AnimeItem): AnimeOriginProvider {
  if (item.provenance?.originProvider) {
    return item.provenance.originProvider;
  }

  // Identificadores gerados comprovadamente pelo importador do AniList (ani_al_<anilistId>_<timestamp>_...)
  if (typeof item.id === 'string' && item.id.startsWith('ani_al_')) {
    return 'anilist';
  }

  // Identificadores gerados comprovadamente pelo importador do MyAnimeList (ani_mal_<malId>_<timestamp>_...)
  if (typeof item.id === 'string' && item.id.startsWith('ani_mal_')) {
    return 'mal';
  }

  // Identificadores gerados comprovadamente por criação manual no Hikari
  if (typeof item.id === 'string' && item.id.startsWith('manual_')) {
    return 'manual';
  }

  // Classificação conservadora de registros anteriores cuja origem não pode ser comprovada
  return 'legacy_unknown';
}

/**
 * Deriva a lista de provedores externos vinculados ao anime com base nos identificadores externos presentes.
 */
export function deriveLinkedProviders(
  item: AnimeItem,
  additional?: ('anilist' | 'mal')[]
): ('anilist' | 'mal')[] {
  const providersSet = new Set<'anilist' | 'mal'>(item.provenance?.linkedProviders ?? []);

  if (typeof item.anilistId === 'number' && item.anilistId > 0) {
    providersSet.add('anilist');
  }

  if (typeof item.malId === 'number' && item.malId > 0) {
    providersSet.add('mal');
  }

  if (additional) {
    for (const p of additional) {
      providersSet.add(p);
    }
  }

  return Array.from(providersSet);
}

/**
 * Constrói um objeto AnimeProvenance padronizado e validado.
 */
export function createAnimeProvenance(
  origin: AnimeOriginProvider,
  options: {
    accountIdentifier?: string;
    importedAtMs?: number;
    linkedProviders?: ('anilist' | 'mal')[];
    anilistUsername?: string;
    malUsername?: string;
    hasUserModifications?: boolean;
    lastModifiedLocallyAtMs?: number;
  } = {}
): AnimeProvenance {
  const linked = new Set<'anilist' | 'mal'>(options.linkedProviders ?? []);
  if (origin === 'anilist') linked.add('anilist');
  if (origin === 'mal') linked.add('mal');

  return {
    originProvider: origin,
    accountIdentifier: options.accountIdentifier?.trim() || undefined,
    importedAtMs: options.importedAtMs ?? Date.now(),
    linkedProviders: Array.from(linked),
    anilistUsername: options.anilistUsername?.trim() || undefined,
    malUsername: options.malUsername?.trim() || undefined,
    hasUserModifications: Boolean(options.hasUserModifications),
    lastModifiedLocallyAtMs: options.lastModifiedLocallyAtMs,
  };
}

/**
 * Normaliza um AnimeItem garantindo a presença do campo de proveniência sem alterar dados existentes.
 */
export function normalizeAnimeProvenance(
  item: AnimeItem,
  fallbackContext?: {
    accountIdentifier?: string;
    activeProvider?: 'anilist' | 'mal';
  }
): AnimeItem {
  if (item.provenance && item.provenance.originProvider) {
    // Garante sincronismo entre linkedProviders e anilistId / malId existentes
    const linked = deriveLinkedProviders(item);
    if (linked.length !== item.provenance.linkedProviders.length) {
      return {
        ...item,
        provenance: {
          ...item.provenance,
          linkedProviders: linked,
        },
      };
    }
    return item;
  }

  const origin = classifyLegacyAnimeOrigin(item);
  const linked = deriveLinkedProviders(item);

  // Para registros legados de origem confirmada por ID onde a conta não foi persistida,
  // não presume a conta atual a menos que haja contexto explícito de importação ativa.
  let accountId = item.provenance?.accountIdentifier;
  if (!accountId && origin === fallbackContext?.activeProvider) {
    accountId = fallbackContext.accountIdentifier;
  }

  const provenance = createAnimeProvenance(origin, {
    accountIdentifier: accountId,
    importedAtMs: item.provenance?.importedAtMs ?? Date.now(),
    linkedProviders: linked,
    anilistUsername: item.provenance?.anilistUsername,
    malUsername: item.provenance?.malUsername,
    hasUserModifications: item.provenance?.hasUserModifications ?? false,
    lastModifiedLocallyAtMs: item.provenance?.lastModifiedLocallyAtMs,
  });

  return {
    ...item,
    provenance,
  };
}

/**
 * Migra com segurança uma lista completa de animes, garantindo que nenhum item seja perdido,
 * duplicado ou tenha seus identificadores originais alterados.
 */
export function migrateAnimeListProvenance(list: AnimeItem[]): {
  list: AnimeItem[];
  migratedCount: number;
  alreadyTaggedCount: number;
  byOriginCount: Record<AnimeOriginProvider, number>;
} {
  let migratedCount = 0;
  let alreadyTaggedCount = 0;
  const byOriginCount: Record<AnimeOriginProvider, number> = {
    anilist: 0,
    mal: 0,
    manual: 0,
    legacy_unknown: 0,
  };

  const migratedList = list.map((item) => {
    const hadProvenance = Boolean(item.provenance && item.provenance.originProvider);
    if (hadProvenance) {
      alreadyTaggedCount++;
    } else {
      migratedCount++;
    }

    const normalized = normalizeAnimeProvenance(item);
    const origin = normalized.provenance!.originProvider;
    byOriginCount[origin] = (byOriginCount[origin] || 0) + 1;
    return normalized;
  });

  return {
    list: migratedList,
    migratedCount,
    alreadyTaggedCount,
    byOriginCount,
  };
}

/**
 * Marca um anime como modificado manualmente pelo usuário no Hikari Perfil.
 * Preserva estritamente a proveniência original e registra a data da alteração local.
 */
export function markAnimeLocallyModified(item: AnimeItem, timestamp = Date.now()): AnimeItem {
  const currentProvenance = item.provenance
    ? { ...item.provenance }
    : createAnimeProvenance(classifyLegacyAnimeOrigin(item), {
        linkedProviders: deriveLinkedProviders(item),
      });

  currentProvenance.hasUserModifications = true;
  currentProvenance.lastModifiedLocallyAtMs = timestamp;

  return {
    ...item,
    provenance: currentProvenance,
  };
}

/**
 * Atualiza a proveniência de um anime existente quando ele é correspondido durante uma nova importação.
 * Preserva o originProvider inicial (ex: se foi criado manualmente, continua como 'manual')
 * e adiciona o novo provedor a linkedProviders.
 */
export function mergeAnimeProvenanceOnImport(
  existingItem: AnimeItem,
  incomingProvider: 'anilist' | 'mal',
  accountIdentifier?: string,
  extraExternalId?: { anilistId?: number; malId?: number }
): AnimeProvenance {
  const baseItem = normalizeAnimeProvenance(existingItem);
  const baseProv = baseItem.provenance!;

  const linked = new Set<'anilist' | 'mal'>(baseProv.linkedProviders);
  linked.add(incomingProvider);
  if (extraExternalId?.anilistId) linked.add('anilist');
  if (extraExternalId?.malId) linked.add('mal');

  const updated: AnimeProvenance = {
    ...baseProv,
    linkedProviders: Array.from(linked),
  };

  if (incomingProvider === 'anilist' && accountIdentifier) {
    updated.anilistUsername = accountIdentifier;
    if (!updated.accountIdentifier && updated.originProvider === 'anilist') {
      updated.accountIdentifier = accountIdentifier;
    }
  } else if (incomingProvider === 'mal' && accountIdentifier) {
    updated.malUsername = accountIdentifier;
    if (!updated.accountIdentifier && updated.originProvider === 'mal') {
      updated.accountIdentifier = accountIdentifier;
    }
  }

  return updated;
}
