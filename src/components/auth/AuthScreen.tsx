import React, { useState } from 'react';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  validateLoginFields,
  validateSignUpFields,
  mapFirebaseAuthError,
  extractConflictEmailFromAuthError,
} from '../../utils/authErrors';

interface AuthScreenProps {
  initialMode?: 'login' | 'signup';
  onEnterDemoMode: () => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4 shrink-0' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'login',
  onEnterDemoMode,
}) => {
  const { status, configStatus, signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activeAction, setActiveAction] = useState<'idle' | 'email' | 'google'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSubmitting = activeAction !== 'idle';
  const isEmailSubmitting = activeAction === 'email';
  const isGoogleSubmitting = activeAction === 'google';
  const isUnconfigured = status === 'unconfigured' || !configStatus.isInitialized;

  const handleSwitchMode = (nextMode: 'login' | 'signup') => {
    if (isSubmitting) return;
    setMode(nextMode);
    setErrorMessage(null);
  };

  const handleGoogleSignIn = async () => {
    if (isSubmitting || isUnconfigured) return;
    setErrorMessage(null);
    setActiveAction('google');
    try {
      await signInWithGoogle();
    } catch (err) {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : '';

      if (code === 'auth/account-exists-with-different-credential') {
        const conflictEmail = extractConflictEmailFromAuthError(err);
        setMode('login');
        if (conflictEmail) {
          setEmail(conflictEmail);
        }
      }
      setErrorMessage(mapFirebaseAuthError(err, 'google'));
    } finally {
      setActiveAction('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || isUnconfigured) return;

    setErrorMessage(null);

    if (mode === 'login') {
      const validationError = validateLoginFields(email, password);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setActiveAction('email');
      try {
        await signInWithEmail(email, password);
      } catch (err) {
        setErrorMessage(mapFirebaseAuthError(err, 'email'));
      } finally {
        setActiveAction('idle');
      }
    } else {
      const validationError = validateSignUpFields({
        displayName,
        email,
        password,
        confirmPassword,
      });
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setActiveAction('email');
      try {
        await signUpWithEmail({
          displayName,
          email,
          password,
        });
      } catch (err) {
        setErrorMessage(mapFirebaseAuthError(err, 'email'));
      } finally {
        setActiveAction('idle');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5] flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8">
      {/* Subtle ambient background accent matching Hikari theme */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-80 w-[36rem] rounded-full bg-purple-900/15 blur-3xl" />
      </div>

      {/* Top Brand Header */}
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-500 shadow-md shadow-purple-900/40 ring-1 ring-purple-400/30">
            <span className="text-lg font-black tracking-tighter text-white">H</span>
          </div>
          <span className="hikari-profile-aurora text-xl font-extrabold tracking-tight">Hikari Perfil</span>
        </div>

        <button
          type="button"
          onClick={onEnterDemoMode}
          className="text-xs font-medium text-purple-300/80 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Ver perfil de demonstração
        </button>
      </header>

      {/* Main Centered Auth Card */}
      <main className="relative z-10 mx-auto my-8 w-full max-w-md">
        <div className="rounded-2xl border border-purple-900/40 bg-[#130E24] p-6 sm:p-8 shadow-2xl shadow-black/80">
          {isUnconfigured ? (
            <div className="space-y-4" data-testid="auth-unconfigured-state">
              <div className="flex items-center gap-2.5 text-amber-300">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <h1 className="text-lg font-bold text-white">
                  Autenticação não configurada
                </h1>
              </div>

              <p className="text-xs leading-relaxed text-purple-200/80">
                Não foi possível inicializar o Firebase Authentication neste ambiente porque
                variáveis obrigatórias do SDK Web estão ausentes ou inválidas.
              </p>

              {configStatus.missingEnvVars.length > 0 && (
                <div className="rounded-xl border border-purple-900/40 bg-[#0A0713] p-3.5 space-y-1.5">
                  <p className="text-[11px] font-semibold text-purple-300">
                    Variáveis pendentes no ambiente:
                  </p>
                  <ul className="space-y-1 font-mono text-[11px] text-purple-200/75">
                    {configStatus.missingEnvVars.map((envKey) => (
                      <li key={envKey}>{envKey}</li>
                    ))}
                  </ul>
                </div>
              )}

              {configStatus.initializationError && (
                <p className="text-xs text-rose-300">
                  Detalhe técnico: {configStatus.initializationError}
                </p>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onEnterDemoMode}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-800/50 bg-purple-950/50 hover:bg-purple-900/40 px-4 py-2.5 text-xs font-semibold text-purple-200 hover:text-white transition-colors cursor-pointer"
                >
                  <span>Visualizar perfil de demonstração (sem sessão)</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Title & Description */}
              <div className="space-y-1.5 text-center">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  {mode === 'login' ? 'Entrar na sua conta' : 'Criar conta no Hikari'}
                </h1>
                <p className="text-xs text-purple-300/70">
                  {mode === 'login'
                    ? 'Acesse seu perfil social da comunidade de animes Hikari.'
                    : 'Cadastre-se com e-mail e senha para criar seu perfil no Hikari.'}
                </p>
              </div>

              {/* Segmented Mode Switcher */}
              <div
                role="tablist"
                aria-label="Modo de autenticação"
                className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-[#0A0713] p-1 border border-purple-900/30"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  disabled={isSubmitting}
                  onClick={() => handleSwitchMode('login')}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'login'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-purple-300/70 hover:text-white'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  disabled={isSubmitting}
                  onClick={() => handleSwitchMode('signup')}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-purple-300/70 hover:text-white'
                  }`}
                >
                  Criar conta
                </button>
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3.5 py-3 text-xs text-rose-200"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              )}

              {/* Google Sign-In Button */}
              <div className="mt-5">
                <button
                  type="button"
                  data-testid="google-signin-button"
                  disabled={isSubmitting}
                  onClick={handleGoogleSignIn}
                  className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-purple-800/50 bg-[#0A0713] hover:bg-purple-950/45 hover:border-purple-600/60 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed cursor-pointer"
                >
                  {isGoogleSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                      <span>Conectando com Google...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Entrar com Google</span>
                    </>
                  )}
                </button>
              </div>

              {/* Divider */}
              <div className="mt-4 flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-purple-900/40" />
                <span className="text-[11px] font-medium text-purple-400/60">
                  ou com e-mail e senha
                </span>
                <div className="h-px flex-1 bg-purple-900/40" />
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="hikari-auth-name"
                      className="block text-xs font-medium text-purple-200"
                    >
                      Nome de exibição
                    </label>
                    <div className="relative flex items-center">
                      <User className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
                      <input
                        id="hikari-auth-name"
                        name="displayName"
                        type="text"
                        autoComplete="name"
                        disabled={isSubmitting}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Como seu nome aparecerá no perfil"
                        maxLength={50}
                        className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-purple-300/35 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-60 transition-colors"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="hikari-auth-email"
                    className="block text-xs font-medium text-purple-200"
                  >
                    E-mail
                  </label>
                  <div className="relative flex items-center">
                    <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
                    <input
                      id="hikari-auth-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      disabled={isSubmitting}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@exemplo.com"
                      className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-purple-300/35 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-60 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="hikari-auth-password"
                    className="block text-xs font-medium text-purple-200"
                  >
                    Senha
                  </label>
                  <div className="relative flex items-center">
                    <Lock className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
                    <input
                      id="hikari-auth-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      disabled={isSubmitting}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo de 6 caracteres"
                      className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-purple-300/35 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-60 transition-colors"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 text-purple-400/70 hover:text-purple-200 transition-colors cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="hikari-auth-confirm-password"
                      className="block text-xs font-medium text-purple-200"
                    >
                      Confirmar senha
                    </label>
                    <div className="relative flex items-center">
                      <Lock className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
                      <input
                        id="hikari-auth-confirm-password"
                        name="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        disabled={isSubmitting}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha escolhida"
                        className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-purple-300/35 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-60 transition-colors"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-purple-700/60 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-950/80 transition-colors disabled:cursor-not-allowed cursor-pointer"
                >
                  {isEmailSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{mode === 'login' ? 'Entrando...' : 'Criando conta...'}</span>
                    </>
                  ) : (
                    <span>{mode === 'login' ? 'Entrar' : 'Criar conta'}</span>
                  )}
                </button>
              </form>


            </>
          )}
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 mx-auto w-full max-w-7xl text-center text-[11px] text-purple-400/45">
        Hikari Perfil
      </footer>
    </div>
  );
};
