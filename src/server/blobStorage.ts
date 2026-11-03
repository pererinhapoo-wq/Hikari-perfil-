import crypto from 'node:crypto';
import path from 'node:path';
import { put, del, type PutBlobResult } from '@vercel/blob';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_PURPOSES = ['avatar', 'banner'] as const;
export type MediaPurpose = (typeof ALLOWED_PURPOSES)[number];

/**
 * Expressão regular estrita para validação de domínios legítimos do Vercel Blob.
 * Aceita:
 * - [store-id].public.blob.vercel-storage.com
 * - [store-id].blob.vercel-storage.com
 * - public.blob.vercel-storage.com
 * - blob.vercel-storage.com
 * - mock.blob.vercel-storage.com (ambiente de testes)
 * Rejeita categoricamente:
 * - evil-blob.vercel-storage.com (hífen em vez de ponto antes de blob)
 * - attacker.com
 * - .blob.vercel-storage.com.attacker.com (domínio sufixado por terceiro)
 */
export const VERCEL_BLOB_HOST_REGEX =
  /^([a-z0-9_-]+\.)?(public\.)?blob\.vercel-storage\.com$/i;

export interface DetectedImageInfo {
  ext: 'jpg' | 'png' | 'webp';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface UploadOptions {
  userId: string;
  purpose: MediaPurpose;
  buffer: Buffer;
  clientMimeType?: string;
  tokenOverride?: string;
}

export interface UploadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  purpose: MediaPurpose;
  uploadedAt: string;
}

export interface DeleteResult {
  success: boolean;
  deletedUrl: string;
}

/**
 * Obtém o token de escrita exclusivo da Store "hikari-perfil-media",
 * priorizando a variável segura HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN.
 */
export function getBlobReadWriteToken(tokenOverride?: string): string | null {
  if (tokenOverride && typeof tokenOverride === 'string' && tokenOverride.trim()) {
    return tokenOverride.trim();
  }

  const token =
    process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    '';

  return token || null;
}

/**
 * Retorna o identificador da Store configurada para o Hikari Perfil.
 */
export function getBlobStoreId(): string {
  return process.env.HIKARI_PERFIL_BLOB_STORE_ID?.trim() || 'hikari-perfil-media';
}

/**
 * Validação profunda de assinatura mágica de bytes para garantir que o arquivo
 * é autenticamente JPEG, PNG ou WebP e não um binário executável malicioso.
 */
export function detectImageFormat(buffer: Buffer): DetectedImageInfo | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }

  // 3. WebP: RIFF [4 bytes tamanho] WEBP
  // Bytes 0-3: 0x52 0x49 0x46 0x46 ("RIFF")
  // Bytes 8-11: 0x57 0x45 0x42 0x50 ("WEBP")
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

/**
 * Limpador e validador de UID para caminhos de armazenamento
 */
export function sanitizeUserIdForPath(userId: string): string {
  const clean = userId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!clean || clean.length > 128) {
    throw new Error('Identificador de usuário inválido para armazenamento.');
  }
  return clean;
}

/**
 * Constrói o prefixo seguro de armazenamento isolado por usuário e finalidade.
 */
export function getStoragePrefix(userId: string, purpose: MediaPurpose): string {
  const cleanUid = sanitizeUserIdForPath(userId);
  const subFolder = purpose === 'avatar' ? 'avatars' : 'banners';
  return `hikari-perfil/${subFolder}/${cleanUid}/`;
}

/**
 * Gera um nome de arquivo criptograficamente único e imprevisível.
 */
export function generateSecureFilename(ext: string): string {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(12).toString('hex');
  return `${timestamp}-${randomSuffix}.${ext}`;
}

/**
 * ============================================================================
 * RATE LIMITER LOCAL EM MEMÓRIA (ANTI-BURST)
 * ============================================================================
 * 
 * LIMITAÇÃO IMPORTANTE DE ARQUITETURA SERVERLESS:
 * Este controle é mantido na memória volátil do processo Node.js / contêiner local.
 * Ele serve para absorver disparos em rajada de uma única sessão em um mesmo nó.
 * Em ambientes Serverless como Vercel (onde requisições são balanceadas dinamicamente
 * entre múltiplas funções Lambda isoladas com escala para zero), este Map NÃO é
 * compartilhado entre instâncias e NÃO garante cota global distribuída.
 * Para controle de cota global persistente em produção, deve-se adotar Vercel WAF
 * ou Upstash Redis.
 */
const uploadRateLimiter = new Map<string, number[]>();

/**
 * Remove entradas antigas e limpa completamente UIDs cujos timestamps expiraram,
 * prevenindo vazamento de memória e crescimento indefinido do Map.
 */
export function pruneRateLimiter(now = Date.now(), windowMs = 60_000): void {
  for (const [uid, timestamps] of uploadRateLimiter.entries()) {
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length === 0) {
      uploadRateLimiter.delete(uid);
    } else if (valid.length !== timestamps.length) {
      uploadRateLimiter.set(uid, valid);
    }
  }
}

export function checkUploadRateLimit(userId: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();

  // Executa expurgo se o Map acumular entradas para evitar vazamentos
  if (uploadRateLimiter.size > 50) {
    pruneRateLimiter(now, windowMs);
  }

  const timestamps = uploadRateLimiter.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= limit) {
    uploadRateLimiter.set(userId, validTimestamps);
    return false;
  }

  validTimestamps.push(now);
  uploadRateLimiter.set(userId, validTimestamps);
  return true;
}

export function getRateLimiterSize(): number {
  return uploadRateLimiter.size;
}

export function resetRateLimiter(): void {
  uploadRateLimiter.clear();
}

/**
 * Executa o upload autenticado no Vercel Blob com validações obrigatórias
 */
export async function uploadUserMedia(options: UploadOptions): Promise<UploadResult> {
  const { userId, purpose, buffer, clientMimeType, tokenOverride } = options;

  // 1. Validação da finalidade
  if (!ALLOWED_PURPOSES.includes(purpose)) {
    throw new Error(`Finalidade de mídia inválida. Permitido somente: ${ALLOWED_PURPOSES.join(', ')}.`);
  }

  // 2. Validação do tamanho
  if (!buffer || buffer.length === 0) {
    throw new Error('Arquivo vazio ou não fornecido.');
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Arquivo excede o limite máximo permitido de 5 MB (tamanho atual: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB).`
    );
  }

  // 3. Validação do formato real via Magic Bytes
  const detected = detectImageFormat(buffer);
  if (!detected) {
    throw new Error(
      'Formato de arquivo não suportado. Somente imagens autênticas nos formatos JPEG, PNG e WebP são aceitas.'
    );
  }

  // Se o cliente declarou um MIME incompatível com o binário real, bloqueia
  if (clientMimeType && typeof clientMimeType === 'string') {
    const norm = clientMimeType.trim().toLowerCase();
    if (
      norm !== detected.mime &&
      !(norm === 'image/jpg' && detected.mime === 'image/jpeg')
    ) {
      throw new Error(
        `Inconsistência de formato: o cabeçalho '${clientMimeType}' diverge do conteúdo binário '${detected.mime}'.`
      );
    }
  }

  // 4. Rate limiting por usuário com expurgo automático
  if (!checkUploadRateLimit(userId)) {
    throw new Error('Muitos uploads em sequência. Aguarde um momento antes de tentar novamente.');
  }

  // 5. Verificação da disponibilidade do token
  const token = getBlobReadWriteToken(tokenOverride);
  if (!token || token.startsWith('mock_')) {
    // Modo de teste / mock seguro para validação em testes unitários e ambientes sem secret
    if (
      process.env.NODE_ENV !== 'production' &&
      (token?.startsWith('mock_') || tokenOverride?.startsWith('mock_') || !process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN)
    ) {
      const filename = generateSecureFilename(detected.ext);
      const prefix = getStoragePrefix(userId, purpose);
      const pathname = `${prefix}${filename}`;
      const mockUrl = `https://mock.blob.vercel-storage.com/${pathname}`;

      return {
        url: mockUrl,
        pathname,
        contentType: detected.mime,
        size: buffer.length,
        purpose,
        uploadedAt: new Date().toISOString(),
      };
    }

    throw new Error(
      'Armazenamento de mídia indisponível no servidor: token HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN não configurado.'
    );
  }

  // 6. Geração do caminho estrito e envio ao Vercel Blob
  const filename = generateSecureFilename(detected.ext);
  const prefix = getStoragePrefix(userId, purpose);
  const pathname = `${prefix}${filename}`;

  try {
    const blobResult: PutBlobResult = await put(pathname, buffer, {
      access: 'public',
      contentType: detected.mime,
      token,
      addRandomSuffix: false,
    });

    return {
      url: blobResult.url,
      pathname: blobResult.pathname,
      contentType: detected.mime,
      size: buffer.length,
      purpose,
      uploadedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao salvar imagem no Vercel Blob: ${msg}`);
  }
}

/**
 * Validação rigorosa de segurança para URLs de deleção do Vercel Blob:
 * - Valida esquema (HTTPS estrito).
 * - Valida hostname (pertencente estritamente ao Vercel Blob).
 * - Decodifica percent-encoding e rejeita sequências maliciosas/duplas.
 * - Normaliza o caminho canônico com path.posix.normalize para eliminar '..' e '.'.
 * - Garante que o caminho pertença ao prefixo exato do usuário autenticado.
 * - Bloqueia arquivos de outros usuários ou do Hikari principal.
 */
export function validateAndNormalizeBlobUrlForDeletion(userId: string, rawUrl: string): {
  parsedUrl: URL;
  canonicalPath: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('URL da imagem não informada.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL da imagem fornecida em formato inválido.');
  }

  // 1. Validação de protocolo
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Esquema de URL inválido. Apenas HTTPS é permitido para mídias do Vercel Blob.');
  }

  // 2. Validação estrita do Hostname
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!VERCEL_BLOB_HOST_REGEX.test(hostname)) {
    throw new Error(
      `Domínio de armazenamento não autorizado ('${hostname}'). Somente URLs oficiais do Vercel Blob são permitidas.`
    );
  }

  // 3. Validação e decodificação percentual do caminho
  const rawPath = parsedUrl.pathname;
  if (rawPath.includes('\0') || rawUrl.includes('%00')) {
    throw new Error('Caminho da URL contém caracteres nulos inválidos.');
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new Error('URL da imagem contém codificação percentual malformada.');
  }

  if (decodedPath.includes('\0')) {
    throw new Error('Caminho da URL contém caracteres nulos inválidos.');
  }

  // Rejeita tentativas de dupla codificação (ex.: %252e) ou sequências ofuscadas
  if (
    decodedPath.includes('%2e') ||
    decodedPath.includes('%2E') ||
    decodedPath.includes('%2f') ||
    decodedPath.includes('%2F')
  ) {
    throw new Error('Tentativa de ofuscamento ou codificação dupla de caminho detectada.');
  }

  // 4. Normalização canônica do caminho
  const normalizedPath = path.posix.normalize(decodedPath);

  // Rejeita qualquer tentativa de travessia de diretório
  if (
    normalizedPath.includes('/../') ||
    normalizedPath.startsWith('../') ||
    normalizedPath.endsWith('/..') ||
    normalizedPath === '..'
  ) {
    throw new Error('Tentativa de travessia de diretório (path traversal) detectada.');
  }

  const canonicalPath = normalizedPath.replace(/^\/+/, '');

  // 5. Proibição categórica de deletar arquivos do Hikari principal ou de terceiros
  if (
    canonicalPath.startsWith('hikari-main/') ||
    canonicalPath.startsWith('main/') ||
    canonicalPath.startsWith('animes/') ||
    canonicalPath.startsWith('episodes/')
  ) {
    throw new Error('Operação bloqueada: não é permitido excluir mídias do sistema principal Hikari.');
  }

  // 6. Confirmação do prefixo estrito do usuário autenticado
  const cleanUid = sanitizeUserIdForPath(userId);
  const avatarPrefix = `hikari-perfil/avatars/${cleanUid}/`;
  const bannerPrefix = `hikari-perfil/banners/${cleanUid}/`;

  const isOwnAvatar = canonicalPath.startsWith(avatarPrefix);
  const isOwnBanner = canonicalPath.startsWith(bannerPrefix);

  if (!isOwnAvatar && !isOwnBanner) {
    throw new Error(
      'Acesso negado: a imagem informada não pertence ao seu perfil ou possui caminho não autorizado.'
    );
  }

  // 7. Confirmação de que o arquivo alvo é um único arquivo dentro do diretório do usuário
  const subPath = isOwnAvatar
    ? canonicalPath.slice(avatarPrefix.length)
    : canonicalPath.slice(bannerPrefix.length);

  if (!subPath || subPath.includes('/') || subPath === '.' || subPath === '..') {
    throw new Error('Caminho de arquivo inválido ou não autorizado dentro do diretório do usuário.');
  }

  return { parsedUrl, canonicalPath };
}

/**
 * Validação de propriedade e exclusão estrita de imagem no Vercel Blob
 */
export async function deleteUserMedia(
  userId: string,
  rawUrl: string,
  tokenOverride?: string
): Promise<DeleteResult> {
  // Executa validações profundas de domínio, caminho, travessia e propriedade
  validateAndNormalizeBlobUrlForDeletion(userId, rawUrl);

  // Verificação do token do Vercel Blob
  const token = getBlobReadWriteToken(tokenOverride);
  if (!token || token.startsWith('mock_')) {
    if (
      process.env.NODE_ENV !== 'production' &&
      (token?.startsWith('mock_') || tokenOverride?.startsWith('mock_') || !process.env.HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN)
    ) {
      return {
        success: true,
        deletedUrl: rawUrl,
      };
    }

    throw new Error(
      'Armazenamento de mídia indisponível no servidor: token HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN não configurado.'
    );
  }

  try {
    await del(rawUrl, { token });
    return {
      success: true,
      deletedUrl: rawUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao excluir imagem do Vercel Blob: ${msg}`);
  }
}
