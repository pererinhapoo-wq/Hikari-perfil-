const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginFields(email: string, password: string): string | null {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return 'Informe o seu endereço de e-mail.';
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return 'Digite um endereço de e-mail válido (ex.: voce@dominio.com).';
  }
  if (!password) {
    return 'Informe a sua senha.';
  }
  if (password.length < 6) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  return null;
}

export function validateSignUpFields(params: {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): string | null {
  const trimmedName = params.displayName.trim();
  if (!trimmedName) {
    return 'Informe o seu nome de exibição para o perfil.';
  }
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return 'O nome de exibição deve ter entre 2 e 50 caracteres.';
  }

  const trimmedEmail = params.email.trim();
  if (!trimmedEmail) {
    return 'Informe o seu endereço de e-mail.';
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return 'Digite um endereço de e-mail válido (ex.: voce@dominio.com).';
  }

  if (!params.password) {
    return 'Crie uma senha para a sua conta.';
  }
  if (params.password.length < 6) {
    return 'A senha deve conter no mínimo 6 caracteres.';
  }
  if (!params.confirmPassword) {
    return 'Confirme a senha digitada.';
  }
  if (params.password !== params.confirmPassword) {
    return 'A confirmação de senha não coincide com a senha digitada.';
  }

  return null;
}

export type AuthErrorContext = 'email' | 'google';

export function extractConflictEmailFromAuthError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('customData' in error)) {
    return null;
  }
  const customData = (error as { customData?: unknown }).customData;
  if (typeof customData !== 'object' || customData === null || !('email' in customData)) {
    return null;
  }
  const email = (customData as { email?: unknown }).email;
  return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null;
}

export function mapFirebaseAuthError(
  error: unknown,
  context: AuthErrorContext = 'email'
): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'O login com Google foi cancelado antes da conclusão. Tente novamente quando quiser.';
    case 'auth/cancelled-popup-request':
      return 'Já existe uma janela de login em andamento. Conclua ou feche a janela aberta antes de tentar novamente.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela de login do Google. Permita pop-ups para este site e tente novamente.';
    case 'auth/unauthorized-domain':
      return 'Este domínio ainda não está autorizado para login com Google no Firebase Authentication. Adicione o domínio em Authentication > Configurações > Domínios autorizados no Console do Firebase.';
    case 'auth/account-exists-with-different-credential':
      return 'Já existe uma conta cadastrada com este e-mail usando outro método de acesso. Entre com seu e-mail e senha abaixo para acessar sua conta existente e vincular o Google com segurança.';
    case 'auth/credential-already-in-use':
      return 'Esta credencial do Google já está vinculada a outra conta.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'O login por janela pop-up não é suportado neste ambiente ou navegador.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials':
      return context === 'google'
        ? 'Não foi possível validar a credencial do Google. Tente novamente.'
        : 'E-mail ou senha incorretos. Verifique os dados informados e tente novamente.';
    case 'auth/user-not-found':
      return 'Nenhuma conta foi encontrada com este endereço de e-mail.';
    case 'auth/email-already-in-use':
      return 'Este endereço de e-mail já está em uso. Entre na sua conta existente com senha ou com Google.';
    case 'auth/weak-password':
      return 'A senha escolhida é muito fraca. Utilize pelo menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'O endereço de e-mail informado não é válido.';
    case 'auth/user-disabled':
      return 'Esta conta foi desativada.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas consecutivas. Aguarde alguns instantes antes de tentar novamente.';
    case 'auth/network-request-failed':
      return 'Falha de conexão com a rede. Verifique sua internet e tente novamente.';
    case 'auth/operation-not-allowed':
      return context === 'google'
        ? 'O login com Google não está habilitado no Firebase Authentication. Ative o provedor Google no Console do Firebase.'
        : 'O método de login por e-mail e senha não está habilitado no Firebase.';
    case 'auth/configuration-not-found':
    case 'auth/invalid-api-key':
      return 'A configuração do Firebase Authentication está ausente ou inválida.';
    default:
      if (error instanceof Error && error.message.startsWith('PT_AUTH:')) {
        return error.message.replace(/^PT_AUTH:/, '');
      }
      return context === 'google'
        ? 'Não foi possível concluir o login com Google. Tente novamente em instantes.'
        : 'Não foi possível concluir a autenticação. Tente novamente em instantes.';
  }
}
