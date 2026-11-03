import type { AnimeItem, AnimeProvenance } from '../types';

/**
 * Resultado da auditoria e remoção de animes na desconexão de provedor externo.
 */
export interface DisconnectPruneResult {
  nextAnimes: AnimeItem[];
  removedCount: number;
  preservedDualLinkedCount: number;
  preservedManualCount: number;
  preservedOtherProviderCount: number;
  ambiguousPreservedCount: number;
  removedAnimeIds: string[];
  ambiguousRecords: AnimeItem[];
}

/**
 * Afinidade comprovada ou inferida de um anime com provedores externos e registros locais.
 */
export interface AnimeProviderAffinity {
  isAniList: boolean;
  isMAL: boolean;
  isManual: boolean;
  isAmbiguous: boolean;
  aniListReasons: string[];
  malReasons: string[];
  manualReasons: string[];
}

/**
 * Identifica com precisão as afinidades e a proveniência estrutural de um AnimeItem.
 * Avalia:
 * 1. Objeto provenance (originProvider, linkedProviders, usernames).
 * 2. Prefixos de IDs canônicos (ani_al_, ani_mal_, manual_).
 * 3. Identificadores externos numéricos (anilistId, malId).
 * 4. URLs de pôster e CDNs oficiais (anilistcdn, s4.anilist.co, myanimelist.net, cdn.myanimelist.net).
 */
export function identifyAnimeProviderAffinity(item: AnimeItem): AnimeProviderAffinity {
  const aniListReasons: string[] = [];
  const malReasons: string[] = [];
  const manualReasons: string[] = [];

  const origin = item.provenance?.originProvider;
  const linked = item.provenance?.linkedProviders ?? [];
  const hasExplicitProvenance = Boolean(origin && origin !== 'legacy_unknown');

  // 1. Evidências de criação manual no Hikari
  if (origin === 'manual') {
    manualReasons.push('provenance.originProvider === manual');
  }
  if (typeof item.id === 'string' && item.id.startsWith('manual_')) {
    manualReasons.push('id.startsWith(manual_)');
  }

  // 2. Evidências de vínculo ou origem no AniList
  if (origin === 'anilist') {
    aniListReasons.push('provenance.originProvider === anilist');
  }
  if (linked.includes('anilist')) {
    aniListReasons.push('provenance.linkedProviders.includes(anilist)');
  }
  if (typeof item.anilistId === 'number' && item.anilistId > 0) {
    aniListReasons.push(`anilistId === ${item.anilistId}`);
  }
  if (typeof item.provenance?.anilistUsername === 'string' && item.provenance.anilistUsername.trim().length > 0) {
    aniListReasons.push(`anilistUsername === ${item.provenance.anilistUsername}`);
  }

  // Prefixos de ID e CDNs externas identificam animes legados ou sem proveniência explícita
  if (!hasExplicitProvenance) {
    if (typeof item.id === 'string' && (item.id.startsWith('ani_al_') || item.id.startsWith('al_'))) {
      aniListReasons.push('id.startsWith(ani_al_/al_)');
    }
    if (typeof item.posterUrl === 'string') {
      const p = item.posterUrl.toLowerCase();
      if (p.includes('anilistcdn') || p.includes('s4.anilist.co') || p.includes('anilist.co')) {
        aniListReasons.push('posterUrl matches anilist CDN');
      }
    }
  }

  // 3. Evidências de vínculo ou origem no MyAnimeList (MAL)
  if (origin === 'mal') {
    malReasons.push('provenance.originProvider === mal');
  }
  if (linked.includes('mal')) {
    malReasons.push('provenance.linkedProviders.includes(mal)');
  }
  if (typeof item.malId === 'number' && item.malId > 0) {
    malReasons.push(`malId === ${item.malId}`);
  }
  if (typeof item.provenance?.malUsername === 'string' && item.provenance.malUsername.trim().length > 0) {
    malReasons.push(`malUsername === ${item.provenance.malUsername}`);
  }

  if (!hasExplicitProvenance) {
    if (typeof item.id === 'string' && (item.id.startsWith('ani_mal_') || item.id.startsWith('mal_'))) {
      malReasons.push('id.startsWith(ani_mal_/mal_)');
    }
    if (typeof item.posterUrl === 'string') {
      const p = item.posterUrl.toLowerCase();
      if (p.includes('myanimelist.net') || p.includes('cdn.myanimelist.net')) {
        malReasons.push('posterUrl matches mal CDN');
      }
    }
  }

  const isManual = manualReasons.length > 0;
  const isAniList = aniListReasons.length > 0;
  const isMAL = malReasons.length > 0;
  const isAmbiguous = !isManual && !isAniList && !isMAL;

  return {
    isAniList,
    isMAL,
    isManual,
    isAmbiguous,
    aniListReasons,
    malReasons,
    manualReasons,
  };
}

/**
 * Remove animes importados exclusivamente da conta externa desconectada,
 * preservando animes com vínculos ativos, animes manuais e isolando registros ambíguos.
 *
 * Regras implementadas:
 * 1. Ao desconectar AniList:
 *    - Remove animes exclusivos do AniList.
 *    - Preserva animes duplamente vinculados (com MAL ativo), retirando o vínculo AniList.
 * 2. Ao desconectar MAL:
 *    - Remove animes exclusivos do MAL.
 *    - Preserva animes duplamente vinculados (com AniList ativo), retirando o vínculo MAL.
 * 3. Ao desconectar ambos:
 *    - Lista de importados de ambos torna-se vazia (incluindo ~300 registros legados com CDNs externas).
 * 4. Preserva estritamente dados locais manuais.
 * 5. Registros com alterações locais (hasUserModifications) são tratados conforme sua origem:
 *    - Se manual -> preservado.
 *    - Se dual-linked -> preservado no provedor ativo com suas modificações intactas.
 *    - Se exclusivo do provedor desconectado -> removido da coleção ativa pois sua origem exclusiva é a conta desconectada.
 * 6. Registros legados comprovadamente importados por CDNs ou IDs são removidos na desconexão correspondente.
 * 7. Registros verdadeiramente ambíguos (sem nenhuma evidência de provedor nem manual) são preservados para revisão
 *    sem reaparecer como importados ativos (linkedProviders = []).
 */
export function pruneAnimesOnDisconnect(
  currentAnimes: AnimeItem[],
  disconnectedProvider: 'anilist' | 'mal',
  _accountIdentifier?: string
): DisconnectPruneResult {
  const otherProvider = disconnectedProvider === 'anilist' ? 'mal' : 'anilist';
  const nextAnimes: AnimeItem[] = [];
  const removedAnimeIds: string[] = [];
  const ambiguousRecords: AnimeItem[] = [];

  let removedCount = 0;
  let preservedDualLinkedCount = 0;
  let preservedManualCount = 0;
  let preservedOtherProviderCount = 0;
  let ambiguousPreservedCount = 0;

  for (const item of currentAnimes) {
    const affinity = identifyAnimeProviderAffinity(item);

    // 1. Anime manual criado localmente no Hikari
    if (affinity.isManual) {
      // Se continha vínculo associado ao provedor desconectado, desfaz o vínculo mas preserva o anime
      const nextLinked = (item.provenance?.linkedProviders ?? []).filter(
        (p) => p !== disconnectedProvider
      );
      const cleaned: AnimeItem = {
        ...item,
        ...(disconnectedProvider === 'anilist' ? { anilistId: undefined } : { malId: undefined }),
        provenance: item.provenance
          ? {
              ...item.provenance,
              linkedProviders: nextLinked,
              ...(disconnectedProvider === 'anilist'
                ? { anilistUsername: undefined }
                : { malUsername: undefined }),
              accountIdentifier:
                item.provenance.originProvider === disconnectedProvider
                  ? undefined
                  : item.provenance.accountIdentifier,
            }
          : undefined,
      };
      nextAnimes.push(cleaned);
      preservedManualCount++;
      continue;
    }

    const isTargetProvider =
      disconnectedProvider === 'anilist' ? affinity.isAniList : affinity.isMAL;
    const isOtherProvider =
      disconnectedProvider === 'anilist' ? affinity.isMAL : affinity.isAniList;

    // 2. Registro com proveniência comprovadamente vinculada a AMBAS as plataformas (AniList + MAL)
    if (isTargetProvider && isOtherProvider) {
      // Preserva o anime com o provedor restante ativo e preserva todas as modificações manuais locais
      const nextLinked: ('anilist' | 'mal')[] = [otherProvider];
      const remainingAccount =
        otherProvider === 'anilist'
          ? item.provenance?.anilistUsername
          : item.provenance?.malUsername;

      const updatedProvenance: AnimeProvenance = {
        ...(item.provenance ?? {
          originProvider: otherProvider,
          hasUserModifications: false,
          linkedProviders: [otherProvider],
        }),
        originProvider: otherProvider,
        accountIdentifier: remainingAccount || undefined,
        linkedProviders: nextLinked,
        ...(disconnectedProvider === 'anilist'
          ? { anilistUsername: undefined }
          : { malUsername: undefined }),
      };

      const preservedDualItem: AnimeItem = {
        ...item,
        ...(disconnectedProvider === 'anilist' ? { anilistId: undefined } : { malId: undefined }),
        provenance: updatedProvenance,
      };

      nextAnimes.push(preservedDualItem);
      preservedDualLinkedCount++;
      continue;
    }

    // 3. Anime exclusivo do OUTRO provedor
    if (!isTargetProvider && isOtherProvider) {
      nextAnimes.push(item);
      preservedOtherProviderCount++;
      continue;
    }

    // 4. Registro com proveniência exclusiva do provedor desconectado
    if (isTargetProvider && !isOtherProvider) {
      // Anime importado exclusivamente desta plataforma: DEVE SER REMOVIDO!
      // Trata conforme sua origem: como sua origem exclusiva é a conta desconectada,
      // ele não pertence mais à coleção ativa do usuário após a desconexão.
      removedCount++;
      removedAnimeIds.push(item.id);
      continue;
    }

    // 5. Registro ambíguo sem evidência clara de nenhum dos provedores nem de criação manual
    if (affinity.isAmbiguous) {
      // REGRA: "Se a origem de um registro não puder ser comprovada, não o apague cegamente:
      // crie uma estratégia segura de identificação e informe quais registros não puderam ser classificados.
      // 8. Registros realmente ambíguos são preservados para revisão, sem reaparecer como importados ativos."
      const ambiguousPreservedItem: AnimeItem = {
        ...item,
        provenance: {
          originProvider: 'legacy_unknown',
          linkedProviders: [],
          hasUserModifications: Boolean(item.provenance?.hasUserModifications),
          importedAtMs: item.provenance?.importedAtMs,
          lastModifiedLocallyAtMs: item.provenance?.lastModifiedLocallyAtMs,
        },
      };
      nextAnimes.push(ambiguousPreservedItem);
      ambiguousPreservedCount++;
      ambiguousRecords.push(ambiguousPreservedItem);
      continue;
    }

    // Fallback defensivo: se não cair em nenhum dos casos acima, preserva
    nextAnimes.push(item);
  }

  return {
    nextAnimes,
    removedCount,
    preservedDualLinkedCount,
    preservedManualCount,
    preservedOtherProviderCount,
    ambiguousPreservedCount,
    removedAnimeIds,
    ambiguousRecords,
  };
}
