import express, { type Response } from 'express';
import { requireUserAuth, type AuthenticatedRequest } from './blobAuth.js';
import {
  uploadUserMedia,
  deleteUserMedia,
  getBlobReadWriteToken,
  getBlobStoreId,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_PURPOSES,
  type MediaPurpose,
} from './blobStorage.js';

export const blobRouter = express.Router();

/**
 * Endpoint de diagnóstico seguro da infraestrutura de Blob Storage.
 * Nunca expõe o token ou credenciais.
 */
blobRouter.get('/status', (_req, res: Response) => {
  const token = getBlobReadWriteToken();
  const storeId = getBlobStoreId();

  res.json({
    status: 'ok',
    storeId,
    configured: Boolean(token),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedPurposes: ALLOWED_PURPOSES,
  });
});

/**
 * Endpoint de Upload Autenticado de Avatar e Banner
 * Requer sessão válida do Better Auth ou Firebase Auth.
 * O UID é extraído EXCLUSIVAMENTE da sessão do usuário.
 */
blobRouter.post('/upload', requireUserAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.uid) {
      res.status(401).json({
        error: 'Sessão de usuário não identificada.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const { purpose, file, contentType } = req.body || {};

    if (!purpose || !ALLOWED_PURPOSES.includes(purpose as MediaPurpose)) {
      res.status(400).json({
        error: `Parâmetro 'purpose' obrigatório. Valores permitidos: ${ALLOWED_PURPOSES.join(', ')}.`,
        code: 'INVALID_PURPOSE',
      });
      return;
    }

    if (!file || typeof file !== 'string') {
      res.status(400).json({
        error: "Arquivo não enviado. Forneça o arquivo em base64 no campo 'file'.",
        code: 'MISSING_FILE',
      });
      return;
    }

    // Limpeza de prefixo de Data URL se fornecido (ex.: "data:image/png;base64,...")
    let rawBase64 = file.trim();
    let declaredMime: string | undefined = typeof contentType === 'string' ? contentType.trim() : undefined;

    if (rawBase64.startsWith('data:')) {
      const commaIndex = rawBase64.indexOf(',');
      if (commaIndex !== -1) {
        const meta = rawBase64.slice(5, commaIndex);
        const mimeMatch = meta.match(/^([^;]+)/);
        if (mimeMatch && !declaredMime) {
          declaredMime = mimeMatch[1];
        }
        rawBase64 = rawBase64.slice(commaIndex + 1);
      }
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(rawBase64, 'base64');
    } catch {
      res.status(400).json({
        error: 'Falha ao decodificar arquivo em base64.',
        code: 'INVALID_BASE64',
      });
      return;
    }

    if (buffer.length === 0) {
      res.status(400).json({
        error: 'O arquivo decodificado está vazio.',
        code: 'EMPTY_FILE',
      });
      return;
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      res.status(413).json({
        error: `Arquivo excede o limite máximo permitido de 5 MB.`,
        code: 'FILE_TOO_LARGE',
        maxBytes: MAX_FILE_SIZE_BYTES,
        actualBytes: buffer.length,
      });
      return;
    }

    // Upload seguro com validações profundas de assinatura mágica e isolamento de caminhos
    const result = await uploadUserMedia({
      userId: user.uid,
      purpose: purpose as MediaPurpose,
      buffer,
      clientMimeType: declaredMime,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao processar upload de imagem.';

    if (
      message.includes('não suportado') ||
      message.includes('Inconsistência') ||
      message.includes('inválido')
    ) {
      res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
      return;
    }

    if (message.includes('Muitos uploads')) {
      res.status(429).json({ error: message, code: 'RATE_LIMIT_EXCEEDED' });
      return;
    }

    if (message.includes('indisponível')) {
      res.status(503).json({ error: message, code: 'STORAGE_UNAVAILABLE' });
      return;
    }

    res.status(500).json({
      error: 'Erro interno ao processar upload.',
      code: 'UPLOAD_FAILED',
    });
  }
});

/**
 * Endpoint de Exclusão Segura de Imagens
 * Requer sessão válida do usuário proprietário da imagem.
 * Bloqueia estritamente remoção de arquivos de outros usuários ou do Hikari principal.
 */
blobRouter.delete('/delete', requireUserAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.uid) {
      res.status(401).json({
        error: 'Sessão de usuário não identificada.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const targetUrl = (req.body?.url || req.query?.url) as string | undefined;

    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
      res.status(400).json({
        error: "URL da imagem a ser excluída é obrigatória no campo 'url'.",
        code: 'MISSING_URL',
      });
      return;
    }

    const result = await deleteUserMedia(user.uid, targetUrl.trim());

    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao excluir imagem.';

    if (
      message.includes('Acesso negado') ||
      message.includes('Operação bloqueada') ||
      message.includes('não autorizado')
    ) {
      res.status(403).json({ error: message, code: 'FORBIDDEN' });
      return;
    }

    if (
      message.includes('inválido') ||
      message.includes('não informada') ||
      message.includes('Domínio') ||
      message.includes('travessia') ||
      message.includes('ofuscamento') ||
      message.includes('malformada') ||
      message.includes('Esquema')
    ) {
      res.status(400).json({ error: message, code: 'BAD_REQUEST' });
      return;
    }

    if (message.includes('indisponível')) {
      res.status(503).json({ error: message, code: 'STORAGE_UNAVAILABLE' });
      return;
    }

    res.status(500).json({
      error: 'Erro interno ao processar exclusão de imagem.',
      code: 'DELETE_FAILED',
    });
  }
});
