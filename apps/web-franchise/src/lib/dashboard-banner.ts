/**
 * Phase 20 (2026-05-20) — Dashboard banner derivation.
 *
 * Pure function so it can be unit-tested without booting React or
 * Next.js. The shape mirrors the FranchiseProfile fields the
 * /franchise/profile endpoint returns. Anything not covered here
 * intentionally renders no banner (the dashboard is the home state).
 */

export interface BannerProfile {
  email: string;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  gstNumber: string | null;
  panNumber: string | null;
}

export interface Banner {
  kind: 'warning' | 'info' | 'success' | 'error';
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
}

export function deriveBanner(profile: BannerProfile): Banner | null {
  if (!profile.isEmailVerified) {
    return {
      kind: 'warning',
      text: 'Please verify your email to unlock onboarding.',
      ctaHref: `/register/verify?email=${encodeURIComponent(profile.email)}`,
      ctaLabel: 'Verify email →',
    };
  }
  if (!profile.gstNumber || !profile.panNumber) {
    return {
      kind: 'info',
      text: 'Complete your KYC details to start the franchise approval process.',
      ctaHref: '/dashboard/onboarding',
      ctaLabel: 'Submit KYC →',
    };
  }
  if (profile.verificationStatus === 'REJECTED') {
    return {
      kind: 'error',
      text: 'Your KYC submission was rejected. Please review and resubmit.',
      ctaHref: '/dashboard/onboarding',
      ctaLabel: 'Review and resubmit →',
    };
  }
  if (profile.verificationStatus === 'UNDER_REVIEW') {
    return {
      kind: 'info',
      text: 'Your KYC is under review. We will email you when a decision is made.',
    };
  }
  if (profile.verificationStatus === 'VERIFIED' && profile.status === 'PENDING') {
    return {
      kind: 'info',
      text: 'KYC verified. Awaiting admin approval to activate your franchise.',
    };
  }
  if (profile.status === 'APPROVED') {
    return {
      kind: 'warning',
      text: 'Your franchise is approved. Add bank details to start receiving payouts.',
      ctaHref: '/dashboard/profile',
      ctaLabel: 'Add bank details →',
    };
  }
  if (profile.status === 'SUSPENDED') {
    return {
      kind: 'error',
      text: 'Your franchise is currently suspended. Contact support for details.',
    };
  }
  return null;
}
