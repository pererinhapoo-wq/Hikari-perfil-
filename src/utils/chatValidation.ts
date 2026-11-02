import type {
  MessageType,
  HikariLinkPreview,
  DirectMessagesPrivacy,
  AnimeItem,
} from '../types/index.js';
import { INITIAL_ANIMES } from '../data/mockData.js';

export interface UserCheckContext {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  allowDirectMessages?: boolean;
  directMessagesFrom?: DirectMessagesPrivacy;
  showOnlineStatus?: boolean;
  followingIds: string[];
  followerIds: string[];
  blockedIds: string[];
}

export function getDeterministicConversationId(userA: string, userB: string): string {
  const cleanA = userA.trim();
  const cleanB = userB.trim();
  if (!cleanA || !cleanB) {
    throw new Error('IDs de participantes inválidos.');
  }
  const sorted = [cleanA, cleanB].sort();
  return `conv_${sorted[0]}__${sorted[1]}`;
}

export function canUserMessageRecipient(
  sender: UserCheckContext,
  recipient: UserCheckContext
): { allowed: boolean; reason?: string } {
  if (sender.id === recipient.id) {
    return { allowed: false, reason: 'Você não pode iniciar uma conversa consigo mesmo.' };
  }

  // Verificação de bloqueios mútuos
  if (recipient.blockedIds.includes(sender.id)) {
    return {
      allowed: false,
      reason: 'Você foi bloqueado por este usuário e não pode enviar mensagens para ele.',
    };
  }

  if (sender.blockedIds.includes(recipient.id)) {
    return {
      allowed: false,
      reason: 'Você bloqueou este usuário. Desbloqueie-o para poder enviar mensagens.',
    };
  }

  // Verificação de recebimento de mensagens ativado
  const recipientAllowsDMs = recipient.allowDirectMessages !== false;
  if (!recipientAllowsDMs) {
    return {
      allowed: false,
      reason: `${recipient.displayName} desativou o recebimento de mensagens privadas.`,
    };
  }

  // Verificação do escopo de privacidade do destinatário
  const privacyScope = recipient.directMessagesFrom || 'everyone';

  if (privacyScope === 'followers') {
    const isSenderFollowingRecipient = recipient.followerIds.includes(sender.id);
    if (!isSenderFollowingRecipient) {
      return {
        allowed: false,
        reason: `${recipient.displayName} permite mensagens apenas de usuários que o seguem. Comece a seguir este perfil para enviar uma mensagem.`,
      };
    }
  }

  if (privacyScope === 'mutual') {
    const isSenderFollowerOfRecipient = recipient.followerIds.includes(sender.id);
    const isRecipientFollowerOfSender = sender.followerIds.includes(recipient.id);
    const isMutual = isSenderFollowerOfRecipient && isRecipientFollowerOfSender;

    if (!isMutual) {
      return {
        allowed: false,
        reason: `${recipient.displayName} permite mensagens apenas de seguidores mútuos. Ambos precisam se seguir.`,
      };
    }
  }

  return { allowed: true };
}

export function validateMediaPayload(
  mediaUrl: string | undefined,
  type: MessageType
): { valid: boolean; error?: string } {
  if (type === 'text' || type === 'link') {
    if (!mediaUrl) return { valid: true };
  }

  if (!mediaUrl || typeof mediaUrl !== 'string') {
    return { valid: false, error: 'URL de mídia ausente para mensagem do tipo mídia.' };
  }

  const trimmed = mediaUrl.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'URL de mídia vazia.' };
  }

  // Prevenção estrita de esquemas inseguros
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html') ||
    lower.startsWith('data:application/')
  ) {
    return { valid: false, error: 'Formato ou esquema de URL não seguro detectado.' };
  }

  // Suporte a Data URLs de imagens seguras
  if (lower.startsWith('data:image/')) {
    const validDataHeader = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed);
    if (!validDataHeader) {
      return { valid: false, error: 'Apenas imagens PNG, JPEG, WEBP e GIF em Base64 são suportadas.' };
    }
    // Limite de 8MB para data URLs (aprox. 11MB em base64)
    if (trimmed.length > 11 * 1024 * 1024) {
      return { valid: false, error: 'O arquivo de imagem ou GIF excede o limite máximo permitido de 8MB.' };
    }
    if (type === 'gif') {
      if (!lower.startsWith('data:image/gif')) {
        return { valid: false, error: 'O arquivo enviado deve ser um GIF animado.' };
      }
      // Validação do conteúdo real dos bytes do arquivo (Magic bytes: GIF87a ou GIF89a)
      // Em Base64: 'GIF89a' = 'R0lGODlh', 'GIF87a' = 'R0lGODdh'
      const base64Index = trimmed.indexOf(';base64,');
      if (base64Index !== -1) {
        const rawBase64 = trimmed.slice(base64Index + 8).trim();
        const isRealGifHeader = rawBase64.startsWith('R0lGODlh') || rawBase64.startsWith('R0lGODdh');
        if (!isRealGifHeader) {
          return {
            valid: false,
            error: 'Arquivo inválido: o conteúdo real não corresponde à assinatura binária de um GIF animado.',
          };
        }
      }
    }
    return { valid: true };
  }

  // Suporte a URLs HTTPS
  if (!lower.startsWith('https://') && !lower.startsWith('http://localhost') && !lower.startsWith('/')) {
    return { valid: false, error: 'A URL da imagem/GIF deve utilizar o protocolo seguro HTTPS.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, error: 'A URL da mídia excede o tamanho máximo de 2048 caracteres.' };
  }

  return { valid: true };
}

export function extractHikariLinkPreview(
  text: string,
  catalog: AnimeItem[] = INITIAL_ANIMES
): HikariLinkPreview | undefined {
  if (!text || typeof text !== 'string') return undefined;

  // 1. Detecção de URLs do domínio Hikari (ex: https://hikari.app/anime/solo_leveling, /anime/frieren)
  const hikariUrlRegex =
    /(?:https?:\/\/(?:[a-zA-Z0-9-]+\.)?hikari\.(?:app|tv|moe|local)\/|^\/|\s\/)(anime|perfil|comentario)\/([a-zA-Z0-9_-]+)/i;
  const match = text.match(hikariUrlRegex);

  if (match) {
    const kind = match[1].toLowerCase();
    const id = match[2].toLowerCase();

    if (kind === 'anime') {
      const found = catalog.find(
        (a) =>
          a.id.toLowerCase() === id ||
          a.id.toLowerCase() === `anime_${id}` ||
          a.title.toLowerCase().includes(id.replace(/[-_]/g, ' '))
      );

      if (found) {
        return {
          url: match[0].trim(),
          type: 'anime',
          title: found.title,
          description: found.titleRomaji || `Ano ${found.year} • ${found.genres.join(', ')}`,
          imageUrl: found.posterUrl,
          badge: `★ ${found.rating.toFixed(1)} • ${found.currentEpisode}/${found.totalEpisodes} eps`,
          extraInfo: {
            rating: found.rating,
            status: found.status,
            episodes: `${found.totalEpisodes} episódios`,
            year: found.year,
            genres: found.genres,
          },
        };
      }
    }
  }

  // 2. Detecção inteligente de títulos do catálogo oficial Hikari citados na mensagem
  for (const anime of catalog) {
    const lowerTitle = anime.title.toLowerCase();
    const baseTitle = anime.title.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    const cleanText = text.toLowerCase();
    if (
      (cleanText.includes(lowerTitle) || (baseTitle.length >= 4 && cleanText.includes(baseTitle))) &&
      lowerTitle.length >= 4
    ) {
      return {
        url: `https://hikari.tv/anime/${anime.id}`,
        type: 'anime',
        title: anime.title,
        description: anime.titleRomaji ? `${anime.titleRomaji} (${anime.year})` : `Lançamento: ${anime.year}`,
        imageUrl: anime.posterUrl,
        badge: `★ ${anime.rating.toFixed(1)} Hikari`,
        extraInfo: {
          rating: anime.rating,
          status: anime.status,
          episodes: `${anime.totalEpisodes} eps`,
          year: anime.year,
          genres: anime.genres,
        },
      };
    }
  }

  // 3. Detecção de URLs genéricas externas seguras (apenas exibição sem simulação falsa de metadados)
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const rawUrl = urlMatch[0];
    try {
      const parsed = new URL(rawUrl);
      return {
        url: parsed.href,
        type: 'external',
        title: parsed.hostname,
        description: parsed.pathname.length > 1 ? parsed.pathname : 'Link externo verificado',
      };
    } catch {
      return undefined;
    }
  }

  return undefined;
}
