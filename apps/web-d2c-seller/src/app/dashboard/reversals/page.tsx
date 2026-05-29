'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  sellerReversalsService,
  SellerReversal,
} from '@/services/seller-reversals.service';

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: '#92400e',
  APPROVED: '#065f46',
  REJECTED: '#991b1b',
  CANCELLED: '#374151',
};

export default function SellerReversalsPage() {
  const [rows, setRows] = useState<SellerReversal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sellerReversalsService.list({ limit: 100 });
      setRows(res.data?.items ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Failed to load reversals'
          : 'Network error. Please try again.',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this reversal request?')) return;
    setBusyId(id);
    setError(null);
    try {
      await sellerReversalsService.cancel(id);
      await fetchRows();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Cancel failed'
          : 'Network error. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reversals</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
        B2B / off-platform reversal requests. Stock and commission adjust only
        after an admin approves — the customer&apos;s order is unaffected.
      </p>

      {error && (
        <div style={{ margin: '12px 0', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No reversal requests yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#6b7280' }}>
              <th style={{ padding: '8px 10px' }}>Requested</th>
              <th style={{ padding: '8px 10px' }}>Sub-order</th>
              <th style={{ padding: '8px 10px' }}>Value</th>
              <th style={{ padding: '8px 10px' }}>Items</th>
              <th style={{ padding: '8px 10px' }}>Reason</th>
              <th style={{ padding: '8px 10px' }}>Status</th>
              <th style={{ padding: '8px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(r.requestedAt).toLocaleString()}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{r.subOrderId.slice(0, 8)}…</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>₹{(Number(r.reversalValueInPaise) / 100).toFixed(2)}</td>
                <td style={{ padding: '8px 10px' }}>{r.items.length}</td>
                <td style={{ padding: '8px 10px', maxWidth: 220 }}>{r.reason}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ color: STATUS_COLOR[r.status] ?? '#374151', fontWeight: 600 }}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <div style={{ color: '#991b1b', fontSize: 12, marginTop: 4 }}>{r.rejectionReason}</div>
                  )}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {r.status === 'PENDING_APPROVAL' ? (
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={busyId === r.id}
                      style={{ padding: '4px 10px', border: '1px solid #6b7280', background: '#fff', color: '#374151', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
