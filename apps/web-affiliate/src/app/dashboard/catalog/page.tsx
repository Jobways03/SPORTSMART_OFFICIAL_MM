'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

// Must match the server-side MappingApprovalStatus enum in
// prisma/schema/_base.prisma. Keep in sync if the enum ever gains
// new values.
type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'STOPPED';

interface CatalogMapping {
  id: string;
  globalSku?: string | null;
  franchiseSku?: string | null;
  barcode?: string | null;
  approvalStatus: ApprovalStatus;
  isActive: boolean;
  createdAt: string;
  franchise?: {
    id: string;
    franchiseCode?: string | null;
    businessName?: string | null;
    ownerName?: string | null;
  } | null;
  product?: {
    id: string;
    title: string;
  } | null;
  variant?: {
    id: string;
    sku?: string | null;
  } | null;
}

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  STOPPED: 'Stopped',
};

const APPROVAL_COLORS: Record<ApprovalStatus, { bg: string; fg: string }> = {
  PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dcfce7', fg: '#15803d' },
  STOPPED: { bg: '#e5e7eb', fg: '#374151' },
};

export default function FranchiseCatalogPage() {
  const [mappings, setMappings] = useState<CatalogMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFranchisesService.listCatalog({
        page,
        limit: 20,
        approvalStatus: statusFilter || undefined,
      });
      // Backend now wraps in the standard pagination envelope — the
      // admin-franchise-catalog controller was retrofitted earlier
      // this session. Pre-envelope `{ mappings, total }` fallback
      // removed.
      const data = res.data as any;
      setMappings(data?.mappings ?? []);
      setTotalPages(data?.pagination?.totalPages ?? 1);
    } catch {
      // Soft-fail — render the empty-state rather than crashing
      // the page. The admin can retry with the filter or refresh.
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (mappingId: string) => {
    setPendingAction(mappingId);
    try {
      await adminFranchisesService.approveCatalogMapping(mappingId);
      await load();
    } catch {
      /* swallow — row stays pending; operator can retry */
    } finally {
      setPendingAction(null);
    }
  };

  const handleStop = async (mappingId: string) => {
    if (!confirm('Stop this franchise catalog mapping? The franchise will no longer sell this product.')) return;
    setPendingAction(mappingId);
    try {
      await adminFranchisesService.stopCatalogMapping(mappingId);
      await load();
    } catch {
      /* swallow */
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Catalog Mappings</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Review and manage product mappings across all franchises.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff' }}
        >
          <option value="">All approval statuses</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="STOPPED">Stopped</option>
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : mappings.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No catalog mappings found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Franchise', 'Product', 'SKU', 'Approval', 'Created', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => {
                const franchiseLabel = m.franchise?.businessName || m.franchise?.franchiseCode || '\u2014';
                const sku = m.franchiseSku || m.globalSku || m.variant?.sku || '\u2014';
                const color = APPROVAL_COLORS[m.approvalStatus];
                const isBusy = pendingAction === m.id;

                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 500 }}>
                      {franchiseLabel}
                      {m.franchise?.franchiseCode && m.franchise?.businessName ? (
                        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                          {m.franchise.franchiseCode}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{m.product?.title || '\u2014'}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{sku}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        {APPROVAL_LABELS[m.approvalStatus] || m.approvalStatus}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {m.approvalStatus === 'PENDING_APPROVAL' ? (
                        <button
                          disabled={isBusy}
                          onClick={() => handleApprove(m.id)}
                          style={{
                            padding: '6px 12px',
                            border: '1px solid #15803d',
                            background: isBusy ? '#e5e7eb' : '#16a34a',
                            color: '#fff',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: isBusy ? 'default' : 'pointer',
                          }}
                        >
                          {isBusy ? '...' : 'Approve'}
                        </button>
                      ) : m.approvalStatus === 'APPROVED' ? (
                        <button
                          disabled={isBusy}
                          onClick={() => handleStop(m.id)}
                          style={{
                            padding: '6px 12px',
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            color: '#991b1b',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: isBusy ? 'default' : 'pointer',
                          }}
                        >
                          {isBusy ? '...' : 'Stop'}
                        </button>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page <= 1 ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Prev
          </button>
          <span style={{ padding: '8px 12px', fontSize: 13 }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page >= totalPages ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
