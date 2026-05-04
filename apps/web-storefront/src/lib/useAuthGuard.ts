'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type AuthStatus = 'checking' | 'authed' | 'unauthed';

/**
 * Gate a client page on the presence of an `accessToken` in sessionStorage.
 * Returns the current auth status; pages should branch their data effects on
 * `status === 'authed'` so requests don't fire before the check completes.
 *
 * Replaces the inline `if (!sessionStorage.getItem('accessToken')) router.push('/login')`
 * blocks that lived at the top of every protected page.
 */
export function useAuthGuard(redirectTo: string = '/login'): AuthStatus {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    try {
      if (sessionStorage.getItem('accessToken')) {
        setStatus('authed');
      } else {
        setStatus('unauthed');
        router.push(redirectTo);
      }
    } catch {
      setStatus('unauthed');
      router.push(redirectTo);
    }
  }, [router, redirectTo]);

  return status;
}
