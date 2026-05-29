'use client';

/**
 * Phase 21 (2026-05-20) — Seller session guard hook (retail-seller).
 * Mirror of the D2C portal hook; see that file for full docs.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sellerAuthService, type SellerMeData } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';

interface UseSellerGuardOptions {
  requireFullyApproved?: boolean;
  exemptPaths?: string[];
  pathname?: string;
}

const DEFAULT_EXEMPT_PATHS = [
  '/dashboard/onboarding',
  '/dashboard/profile',
  '/dashboard/support',
];

function isExempt(pathname: string | undefined, exempt: string[]): boolean {
  if (!pathname) return false;
  return exempt.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface UseSellerGuardResult {
  seller: SellerMeData | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSellerGuard(
  options: UseSellerGuardOptions = {},
): UseSellerGuardResult {
  const router = useRouter();
  const [seller, setSeller] = useState<SellerMeData | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    requireFullyApproved = false,
    exemptPaths = DEFAULT_EXEMPT_PATHS,
    pathname,
  } = options;

  const refresh = useCallback(async () => {
    try {
      const res = await sellerAuthService.me();
      if (res?.data) {
        setSeller(res.data);
        if (requireFullyApproved && !isExempt(pathname, exemptPaths)) {
          const fullyApproved =
            res.data.isEmailVerified === true &&
            res.data.status === 'ACTIVE' &&
            res.data.verificationStatus === 'VERIFIED';
          if (!fullyApproved) {
            router.replace('/dashboard/onboarding');
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setSeller(null);
    } finally {
      setLoading(false);
    }
  }, [router, requireFullyApproved, exemptPaths, pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener('seller-profile-updated', handler);
    return () => window.removeEventListener('seller-profile-updated', handler);
  }, [refresh]);

  return { seller, loading, refresh };
}
