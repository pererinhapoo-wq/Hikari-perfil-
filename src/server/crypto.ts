import crypto from 'node:crypto';

export interface EncryptedPayload {
  iv: string; // Base64 (12 bytes nonce)
  ciphertext: string; // Base64
  tag: string; // Base64 (16 bytes auth tag)
  v: 1; // Schema version
}

/**
 * Valida rigorosamente a chave de criptografia de 256 bits (32 bytes).
 * Suporta representação em Hexadecimal (64 caracteres) ou Base64 (44 caracteres).
 * Rejeita chaves ausentes, vazias, incompletas ou de tamanho incorreto.
 */
export function parseAndValidateKey(rawKey: string | undefined | null): Buffer {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new Error(
      'Chave de criptografia ausente. Defina a variável de ambiente MAL_TOKEN_ENCRYPTION_KEY com exatamente 32 bytes (64 caracteres hexadecimais ou 44 em base64).'
    );
  }

  let trimmed = rawKey.trim();

  // Desencapsular aspas externas se existirem de forma inequívoca ('...' ou "...")
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // 1. Tentar decodificar como Hexadecimal (64 caracteres = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const keyBuf = Buffer.from(trimmed, 'hex');
    if (keyBuf.length === 32) {
      return keyBuf;
    }
  }

  // 2. Tentar decodificar como Base64 (32 bytes decodificados)
  try {
    const keyBuf = Buffer.from(trimmed, 'base64');
    if (keyBuf.length === 32) {
      return keyBuf;
    }
  } catch {
    // Falha na conversão de base64
  }

  throw new Error(
    'Chave de criptografia inválida. A chave deve conter exatamente 32 bytes (256 bits), codificada em 64 caracteres hexadecimais ou base64 válido.'
  );
}

/**
 * Criptografa dados em texto plano utilizando AES-256-GCM.
 * Gera um IV/nonce criptograficamente aleatório de 12 bytes para cada operação.
 * Retorna o payload com IV, texto cifrado e tag de autenticação em Base64.
 */
export function encryptData(
  plaintext: string,
  keyInput: string | Buffer
): EncryptedPayload {
  if (typeof plaintext !== 'string') {
    throw new Error('O conteúdo para criptografia deve ser uma string válida.');
  }

  const keyBuffer = Buffer.isBuffer(keyInput) ? keyInput : parseAndValidateKey(keyInput);
  if (keyBuffer.length !== 32) {
    throw new Error('A chave de criptografia deve ter exatamente 32 bytes.');
  }

  // IV padrão de 12 bytes (96 bits) recomendado pelo NIST para AES-GCM
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
    v: 1,
  };
}

/**
 * Descriptografa um payload AES-256-GCM validando a autenticidade e integridade.
 * Rejeita qualquer adulteração no texto cifrado, IV ou tag de autenticação.
 */
export function decryptData(
  payload: EncryptedPayload,
  keyInput: string | Buffer
): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload criptografado inválido.');
  }

  if (
    typeof payload.iv !== 'string' ||
    typeof payload.ciphertext !== 'string' ||
    typeof payload.tag !== 'string' ||
    payload.v !== 1
  ) {
    throw new Error('Estrutura de payload criptografado incompatível ou adulterada.');
  }

  const keyBuffer = Buffer.isBuffer(keyInput) ? keyInput : parseAndValidateKey(keyInput);
  if (keyBuffer.length !== 32) {
    throw new Error('A chave de criptografia deve ter exatamente 32 bytes.');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  if (iv.length !== 12) {
    throw new Error('Comprimento do IV inválido (esperado: 12 bytes).');
  }

  if (tag.length !== 16) {
    throw new Error('Comprimento da tag de autenticação inválido (esperado: 16 bytes).');
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    throw new Error(
      'Falha de autenticação criptográfica: dados adulterados ou chave de descriptografia incorreta.'
    );
  }
}

/**
 * Helper tipado para criptografar o conjunto de tokens OAuth do MyAnimeList.
 */
export interface MALTokenSet {
  accessToken: string;
  refreshToken?: string;
}

export function encryptMALTokens(
  tokens: MALTokenSet,
  keyInput: string | Buffer
): EncryptedPayload {
  if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken.trim()) {
    throw new Error('Conjunto de tokens inválido: access_token é obrigatório.');
  }

  const serialized = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
  });

  return encryptData(serialized, keyInput);
}

/**
 * Helper tipado para descriptografar o conjunto de tokens OAuth do MyAnimeList.
 */
export function decryptMALTokens(
  payload: EncryptedPayload,
  keyInput: string | Buffer
): MALTokenSet {
  const decryptedJson = decryptData(payload, keyInput);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptedJson);
  } catch {
    throw new Error('Falha ao interpretar dados descriptografados como JSON válido.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { accessToken?: unknown }).accessToken !== 'string'
  ) {
    throw new Error('Estrutura de tokens recuperada inválida.');
  }

  const p = parsed as { accessToken: string; refreshToken?: string | null };
  return {
    accessToken: p.accessToken,
    refreshToken: p.refreshToken ? p.refreshToken : undefined,
  };
}
