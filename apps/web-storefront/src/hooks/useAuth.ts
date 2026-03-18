'use client';

import { useState, useCallback } from 'react';

interface AuthUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    user: null,
    accessToken: null,
    isAuthenticated: false,
  });

  const login = useCallback((accessToken: string, refreshToken: string, user: AuthUser) => {
    setAuth({ user, accessToken, isAuthenticated: true });
    // Store refresh token securely
    try {
      sessionStorage.setItem('refreshToken', refreshToken);
    } catch {
      // Storage unavailable — tokens live in memory only
    }
  }, []);

  const logout = useCallback(() => {
    setAuth({ user: null, accessToken: null, isAuthenticated: false });
    try {
      sessionStorage.removeItem('refreshToken');
    } catch {
      // Ignore
    }
  }, []);

  return { ...auth, login, logout };
}
