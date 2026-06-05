import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {keychainStorage} from '../lib/storage';
import {authService, LoginResponseData} from '../services/auth.service';
import {Events, identifyUser, resetAnalytics, track} from '../lib/analytics';

type AuthUser = LoginResponseData['user'];

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Patch the cached user (e.g. after a profile edit) and persist it so
   *  anything reading `user` — like the Home greeting — updates right
   *  away, without a re-login. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from Keychain on cold start so a returning user lands on the
  // app shell instead of the login screen if their refresh token is still
  // alive. We only trust the user-profile blob; the access token may have
  // expired but the api-client's first 401 will trigger a silent refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await keychainStorage.getItem('user');
        if (!cancelled && raw) {
          setUser(JSON.parse(raw) as AuthUser);
        }
      } catch {
        // Corrupt stored payload — fall through to logged-out state.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    let res;
    try {
      res = await authService.login({email, password});
    } catch (err) {
      track(Events.AuthLoginFailed, {reason: 'network'});
      throw err;
    }
    if (!res.success || !res.data) {
      track(Events.AuthLoginFailed, {reason: res?.message ?? 'unknown'});
      throw new Error(res.message || 'Login failed');
    }
    const {accessToken, refreshToken, user: nextUser} = res.data;
    await Promise.all([
      keychainStorage.setItem('accessToken', accessToken),
      keychainStorage.setItem('refreshToken', refreshToken),
      keychainStorage.setItem('user', JSON.stringify(nextUser)),
    ]);
    setUser(nextUser);
    // Identify must come before track so the event back-fills the
    // anon → distinct alias inside PostHog.
    identifyUser(nextUser.userId, {
      email: nextUser.email,
      // Sportsmart customers are always CUSTOMER role; passing it
      // lets us segment by role-mix in PostHog dashboards if the app
      // grows to serve other personas later.
      roles: nextUser.roles,
    });
    track(Events.AuthLoginCompleted);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    track(Events.AuthLogout);
    // Reset MUST come after the final event so that event still
    // associates with the user — reset moves us to a fresh anon id.
    resetAnalytics();
  }, []);

  // Merge fields into the cached user and persist them, so a profile edit
  // is reflected immediately by everything reading `user` (e.g. the Home
  // greeting) and survives a cold-start re-hydration.
  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = {...prev, ...patch};
      void keychainStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        updateUser,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
