'use client';

/**
 * Phase 21 (2026-05-20) — Seller session guard hook.
 *
 * Replaces the sessionStorage-based "am I logged in?" check that
 * previously gated /dashboard/* routes. Calls GET /seller/auth/me
 * (cookie-validated) on mount and exposes the seller profile, a
 * loading flag, and a redirect-on-failure side-effect.
 *
 * Modes:
 *   - default — redirect to /login on any auth failure.
 *   - { requireFullyApproved: true } — also redirect to
 *     /dashboard/onboarding when the seller is missing
 *     isEmailVerified, status=ACTIVE, or verificationStatus=VERIFIED.
 *     Pass the dashboard layout option for any route that requires a
 *     fully-active seller (Catalog, Inventory, Orders, etc.).
 *
 * Cross-tab / wizard updates: listens for the
 * `seller-profile-updated` window event so the onboarding wizard can
 * poke the guard to re-fetch after a status change.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sellerAuthService, type SellerMeData } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';

interface UseSellerGuardOptions {
  requireFullyApproved?: boolean;
  /**
   * Routes that should NOT trigger the onboarding redirect even when
   * `requireFullyApproved` is true. Defaults to the standard set
   * (onboarding, profile, support).
   */
  exemptPaths?: string[];
  /** Current pathname; provided by the caller so the hook doesn't
   * have to depend on next/navigation's usePathname (which would
   * couple this to client routing in ways that break tests). */
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
      // Any other transport failure — leave the seller null so the
      // caller can render a "session check failed" state rather than
      // silently treating the user as logged in.
      setSeller(null);
    } finally {
      setLoading(false);
    }
  }, [router, requireFullyApproved, exemptPaths, pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Phase 21 — listen for in-app profile updates (onboarding wizard
  // dispatches this after submit / email verify) so consumers don't
  // see stale state without a hard reload.
  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener('seller-profile-updated', handler);
    return () => window.removeEventListener('seller-profile-updated', handler);
  }, [refresh]);

  return { seller, loading, refresh };
}
