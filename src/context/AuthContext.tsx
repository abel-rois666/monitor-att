import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { BLUEPRINT_LIMITS, sanitizeText } from '../lib/validation';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  workspaceReady: boolean;
  authError: string | null;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setWorkspaceReady(false);
        return;
      }

      // Garantiza que el documento raíz /users/{uid} exista antes de escribir subcolecciones (Master Gate)
      const userPath = `users/${nextUser.uid}`;
      try {
        const userRef = doc(db, 'users', nextUser.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const displayName =
            sanitizeText(
              nextUser.displayName || 'Analista AT&T',
              BLUEPRINT_LIMITS.displayNameMaxLength
            ) || 'Analista AT&T';

          await setDoc(userRef, {
            uid: nextUser.uid,
            displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        setWorkspaceReady(true);
      } catch (err) {
        setWorkspaceReady(false);
        setAuthError('No fue posible inicializar tu perfil de espacio de trabajo en Firestore.');
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed')
          ? 'Inicio de sesión cancelado.'
          : 'No se pudo completar el inicio de sesión con Google.';
      setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    setAuthError(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        workspaceReady,
        authError,
        signingIn,
        signInWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider');
  }
  return ctx;
}
