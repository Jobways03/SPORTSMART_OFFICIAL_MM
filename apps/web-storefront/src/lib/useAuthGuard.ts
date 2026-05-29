'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-context';

export type AuthStatus = 'checking' | 'authed' | 'unauthed';

/**
 * Phase 17 (2026-05-20) — cookie-based auth guard.
 *
 * Replaces the pre-Phase-17 sessionStorage check. The new
 * implementation reads from the AuthContext, which itself is fed
 * by GET /auth/me — so the source of truth is the server-validated
 * httpOnly cookie, not anything in JS-readable storage.
 *
 * Behaviour:
 *   • returns 'checking' while the initial /auth/me probe is in
 *     flight (one short tick on first mount; cached thereafter via
 *     the shared context).
 *   • returns 'authed' once the probe resolves with a user.
 *   • returns 'unauthed' on probe failure + redirects to the
 *     configured login path (default /login).
 *
 * The redirect uses `router.replace` so the back button does not
 * land the user on the protected page again.
 */
export function useAuthGuard(redirectTo: string = '/login'): AuthStatus {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'unauthed') {
      router.replace(redirectTo);
    }
  }, [status, router, redirectTo]);

  switch (status) {
    case 'loading':
      return 'checking';
    case 'authed':
      return 'authed';
    case 'unauthed':
    default:
      return 'unauthed';
  }
}
