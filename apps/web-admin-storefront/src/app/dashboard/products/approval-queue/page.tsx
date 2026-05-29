'use client';

/**
 * Phase 32 (2026-05-21) — dedicated admin approval queue route.
 *
 * The product list page already supports filtering by
 * moderationStatus=PENDING via the URL, but the moderator's mental
 * model is "approval queue is a thing", not "products list with a
 * filter tab." A dedicated route gives ops a shareable URL and lets
 * the sidebar host a queue-count badge.
 *
 * This is a thin redirect — it forwards to the list page with the
 * filter pre-applied. Keeping it a redirect (rather than a parallel
 * implementation) means the queue automatically inherits every fix
 * + bulk-action improvement landed on the canonical list.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ApprovalQueuePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/products?moderationStatus=PENDING');
  }, [router]);
  return null;
}
