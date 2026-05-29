'use client';

/**
 * Phase 36 (2026-05-21) — admin category audit log page.
 * Pulls from the GET /admin/categories/:id/audit-log endpoint (Phase 34).
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminProductsService } from '@/services/admin-products.service';
import { AuditLogTimeline, PAGE_SIZE } from '../../../_components/AuditLogTimeline';
import { apiClient } from '@/lib/api-client';

interface CategorySummary {
  category?: { id: string; name: string };
}

export default function CategoryAuditLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    apiClient<CategorySummary>(`/admin/categories/${id}`)
      .then((res) => setName(res.data?.category?.name ?? null))
      .catch(() => undefined);
  }, [id]);

  const load = useCallback(
    async (page: number) => {
      const res = await adminProductsService.getCategoryAuditLog(id, {
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
        <Link href="/dashboard/products/categories" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
          ← Back to categories
        </Link>
      </div>
      <AuditLogTimeline load={load} subjectLabel={name ? `Category: ${name}` : `Category ${id}`} />
    </div>
  );
}
