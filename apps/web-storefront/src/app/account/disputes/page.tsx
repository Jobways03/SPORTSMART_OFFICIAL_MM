'use client';

// Phase 11 (post-Phase-10) — customer-side disputes are no longer a
// thing the customer sees. Internally the formal-resolution path is
// still the Dispute model, but the customer's only window is their
// support ticket. Anyone hitting this URL (old bookmark, stale email
// link) is bounced to /account/support.
//
// We don't 404 because (a) the route used to exist and may still
// appear in transactional emails until the next mailer template
// refresh, and (b) the customer didn't do anything wrong — a soft
// redirect to the live equivalent is the right experience.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DisputesIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/support');
  }, [router]);
  return null;
}
