'use client';

// Phase 11 (post-Phase-10) — see /account/disputes/page.tsx for the
// rationale. Detail-page hits are bounced to the support index since
// we don't have a 1:1 mapping from old dispute id → ticket id at this
// layer (the back-link lives on the server). Customers can pick the
// right ticket from the support list.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DisputeDetailRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/support');
  }, [router]);
  return null;
}
