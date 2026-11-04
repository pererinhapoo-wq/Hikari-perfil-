import { auth } from '../lib/firebase';

export type ProfileMediaPurpose = 'avatar' | 'banner';

/** Envia a imagem selecionada ao armazenamento persistente e retorna a URL pública. */
export async function uploadProfileMedia(
  dataUrl: string,
  purpose: ProfileMediaPurpose
): Promise<string> {
  if (!auth?.currentUser) {
    throw new Error('Entre na sua conta para salvar a imagem do perfil.');
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('Imagem inválida. Selecione novamente o arquivo.');
  }

  const idToken = await auth.currentUser.getIdToken();
  if (!idToken) throw new Error('Não foi possível validar sua sessão. Entre novamente.');

  const response = await fetch('/api/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ purpose, file: dataUrl }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true || typeof result?.url !== 'string') {
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : 'Não foi possível salvar a imagem. Tente novamente.'
    );
  }

  return result.url;
}
