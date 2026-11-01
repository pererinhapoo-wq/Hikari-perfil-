import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  linkWithCredential,
  GoogleAuthProvider,
  updateProfile,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
  type Auth,
  type AuthProvider as FirebaseAuthProvider,
  type OAuthCredential,
} from 'firebase/auth';
import {
  auth,
  createGoogleAuthProvider,
  firebaseConfigStatus,
  type FirebaseConfigStatus,
} from '../lib/firebase';
import { extractConflictEmailFromAuthError } from '../utils/authErrors';

export type AuthSessionStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'unconfigured';

export interface SignUpParams {
  displayName: string;
  email: string;
  password: string;
}

export interface AuthContextValue {
  status: AuthSessionStatus;
  user: User | null;
  userRevision: number;
  isLoading: boolean;
  isAuthenticated: boolean;
  configStatus: FirebaseConfigStatus;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (params: SignUpParams) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signOutUser: () => Promise<void>;
  refreshUserProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type PopupSignInFn = (
  authInstance: Auth,
  provider: FirebaseAuthProvider
) => Promise<UserCredential>;

interface AuthProviderProps {
  children: React.ReactNode;
  configStatusOverride?: FirebaseConfigStatus;
  popupSignInImpl?: PopupSignInFn;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  configStatusOverride,
  popupSignInImpl,
}) => {
  const effectiveConfig = configStatusOverride ?? firebaseConfigStatus;
  const runPopupSignIn: PopupSignInFn = popupSignInImpl ?? signInWithPopup;

  const [user, setUser] = useState<User | null>(null);
  const [userRevision, setUserRevision] = useState(0);
  const [status, setStatus] = useState<AuthSessionStatus>(() =>
    effectiveConfig.isInitialized && auth ? 'loading' : 'unconfigured'
  );

  // Prevents duplicate concurrent popup requests
  const googlePopupInFlightRef = useRef(false);

  // Holds a pending Google OAuthCredential strictly in memory when auth/account-exists-with-different-credential occurs
  const pendingGoogleLinkRef = useRef<{
    credential: OAuthCredential;
    email: string | null;
  } | null>(null);

  useEffect(() => {
    if (!effectiveConfig.isInitialized || !auth) {
      setUser(null);
      setStatus('unconfigured');
      return;
    }

    setStatus('loading');

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        if (firebaseUser) {
          setUser(firebaseUser);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      },
      () => {
        setUser(null);
        setStatus('unauthenticated');
      }
    );

    return () => {
      unsubscribe();
    };
  }, [effectiveConfig.isInitialized]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<User> => {
      if (!effectiveConfig.isInitialized || !auth) {
        throw new Error('PT_AUTH:O Firebase Authentication não está configurado neste ambiente.');
      }
      const trimmedEmail = email.trim();
      const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);

      // If the user previously attempted Google Sign-In on this same email and proved password ownership, link safely without duplicating accounts
      const pending = pendingGoogleLinkRef.current;
      if (
        pending &&
        (!pending.email || pending.email.toLowerCase() === trimmedEmail.toLowerCase())
      ) {
        pendingGoogleLinkRef.current = null;
        try {
          await linkWithCredential(credential.user, pending.credential);
          setUserRevision((prev) => prev + 1);
        } catch {
          // Keep authenticated session active even if credential was already linked
        }
      }

      return credential.user;
    },
    [effectiveConfig.isInitialized]
  );

  const signUpWithEmail = useCallback(
    async ({ displayName, email, password }: SignUpParams): Promise<User> => {
      if (!effectiveConfig.isInitialized || !auth) {
        throw new Error('PT_AUTH:O Firebase Authentication não está configurado neste ambiente.');
      }
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const trimmedName = displayName.trim();
      if (trimmedName) {
        await updateProfile(credential.user, { displayName: trimmedName });
        setUserRevision((prev) => prev + 1);
      }
      return credential.user;
    },
    [effectiveConfig.isInitialized]
  );

  const signInWithGoogle = useCallback(async (): Promise<User> => {
    if (!effectiveConfig.isInitialized || !auth) {
      throw new Error('PT_AUTH:O Firebase Authentication não está configurado neste ambiente.');
    }
    if (googlePopupInFlightRef.current) {
      const busyError = new Error('cancelled-popup-request') as Error & { code: string };
      busyError.code = 'auth/cancelled-popup-request';
      throw busyError;
    }

    googlePopupInFlightRef.current = true;
    try {
      const provider = createGoogleAuthProvider();
      const credential = await runPopupSignIn(auth, provider);
      pendingGoogleLinkRef.current = null;
      setUserRevision((prev) => prev + 1);
      return credential.user;
    } catch (err) {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : '';

      if (code === 'auth/account-exists-with-different-credential') {
        const oauthCred = GoogleAuthProvider.credentialFromError(err as never);
        const conflictEmail = extractConflictEmailFromAuthError(err);
        if (oauthCred) {
          pendingGoogleLinkRef.current = {
            credential: oauthCred,
            email: conflictEmail,
          };
        }
      }
      throw err;
    } finally {
      googlePopupInFlightRef.current = false;
    }
  }, [effectiveConfig.isInitialized, runPopupSignIn]);

  const signOutUser = useCallback(async () => {
    pendingGoogleLinkRef.current = null;
    if (!effectiveConfig.isInitialized || !auth) return;
    await firebaseSignOut(auth);
  }, [effectiveConfig.isInitialized]);

  const refreshUserProfile = useCallback(() => {
    setUserRevision((prev) => prev + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      userRevision,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated' && user !== null,
      configStatus: effectiveConfig,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOutUser,
      refreshUserProfile,
    }),
    [
      status,
      user,
      userRevision,
      effectiveConfig,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOutUser,
      refreshUserProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um <AuthProvider>.');
  }
  return context;
}
