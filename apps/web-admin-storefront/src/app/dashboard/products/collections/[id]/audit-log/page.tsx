'use client';

/**
 * Phase 37 (2026-05-21) — admin collection audit log page. Pulls from
 * GET /admin/collections/:id/audit-log (Phase 37 backend).
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminProductsService } from '@/services/admin-products.service';
import { AuditLogTimeline, PAGE_SIZE } from '../../../_components/AuditLogTimeline';
import { apiClient } from '@/lib/api-client';

interface CollectionSummary {
  name?: string;
}

export default function CollectionAuditLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    apiClient<CollectionSummary>(`/admin/collections/${id}`)
      .then((res) => setName(res.data?.name ?? null))
      .catch(() => undefined);
  }, [id]);

  const load = useCallback(
    async (page: number) => {
      const res = await adminProductsService.getCollectionAuditLog(id, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      return (res.data ?? []) as Parameters<typeof AuditLogTimeline>[0]['load'] extends (p: number) => Promise<infer R> ? R : never;
    },
    [id],
  );

  return (
    <div>
      <div style={{ padding: '12px 32px', borderBottom: '1px solid #e5e7eb' }}>
        <Link href={`/dashboard/products/collections/${id}`} style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
          ← Back to collection
        </Link>
      </div>
      <AuditLogTimeline load={load} subjectLabel={name ? `Collection: ${name}` : `Collection ${id}`} />
    </div>
  );
}
