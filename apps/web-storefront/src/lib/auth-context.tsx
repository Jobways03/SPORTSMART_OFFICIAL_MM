'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authService, type AuthMeData } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';

/**
 * Phase 17 (2026-05-20) — Customer auth context.
 *
 * Replaces the storefront's sessionStorage-based "am I signed in?"
 * check. The provider mounts once near the root, fires a single
 * `GET /auth/me` (cookie-based — no token ever touches JS), and
 * publishes:
 *
 *   • status: 'loading' | 'authed' | 'unauthed'
 *   • user:   AuthMeData | null
 *   • refresh(): re-probe /auth/me (e.g. immediately after login).
 *   • clearUser(): drop the local user state without calling the API
 *     (the logout button itself drives the network call so the
 *     server-side cookie clear happens before this fires).
 *
 * Consumers use `useSession()` to read; pages that want to "gate" on
 * auth read `status` directly + redirect when 'unauthed'. The
 * sessionStorage check (`useAuthGuard`) is being removed in favour
 * of this context.
 */
type AuthStatus = 'loading' | 'authed' | 'unauthed';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthMeData | null;
  refresh: () => Promise<void>;
  clearUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthMeData | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authService.me();
      if (res.data) {
        setUser(res.data);
        setStatus('authed');
      } else {
        setUser(null);
        setStatus('unauthed');
      }
    } catch (err) {
      // 401 is the common case — user not signed in. Anything else
      // (network, 500) we still treat as 'unauthed' so the app
      // renders the public state rather than spinning forever.
      if (!(err instanceof ApiError)) {
        // network failure — silent, public state
      }
      setUser(null);
      setStatus('unauthed');
    }
  }, []);

  const clearUser = useCallback(() => {
    setUser(null);
    setStatus('unauthed');
  }, []);

  // Initial probe on mount. The probe is a single GET; if Redis /
  // DB is slow, the rest of the page renders against `status =
  // 'loading'` and shows the public navbar until the probe resolves.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cross-tab sync — when another tab signs out (auth-changed event),
  // refresh this tab's session too so the navbar updates.
  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener('auth-changed', handler);
    return () => window.removeEventListener('auth-changed', handler);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refresh, clearUser }),
    [status, user, refresh, clearUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Read the current customer session. Returns the AuthContext value;
 * throws if used outside an `<AuthProvider>` (which would mean a
 * mounting bug).
 */
export function useSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      'useSession must be used inside <AuthProvider>. Wrap the app root in apps/web-storefront/src/app/layout.tsx.',
    );
  }
  return ctx;
}

/**
 * Fire a cross-tab notification so other open tabs re-probe /auth/me.
 * Call after login / logout. The event has no payload — receivers
 * decide what to fetch.
 */
export function broadcastAuthChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event('auth-changed'));
  } catch {
    // SSR / no-DOM environments
  }
}
