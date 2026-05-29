'use client';

import { useCallback, useEffect, useState } from 'react';
import { paiseToRupeesString } from '@sportsmart/shared-utils';
import {
  adminSellerReversalsService,
  SellerReversal,
} from '@/services/admin-seller-reversals.service';
import { usePermissions } from '@/lib/permissions';

const STATUS_OPTIONS = [
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: '', label: 'All' },
];

const TONE: Record<string, { bg: string; border: string; color: string }> = {
  PENDING_APPROVAL: { bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
  APPROVED: { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' },
  REJECTED: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
  CANCELLED: { bg: '#f3f4f6', border: '#e5e7eb', color: '#374151' },
};

export default function AdminSellerReversalsPage() {
  const { hasPermission } = usePermissions();
  const canDecide = hasPermission('sellerReversals.approve');

  const [status, setStatus] = useState('PENDING_APPROVAL');
  const [rows, setRows] = useState<SellerReversal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminSellerReversalsService.list({ status: status || undefined, limit: 100 });
      setRows(res.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reversals');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const approve = async (id: string) => {
    if (!window.confirm('Approve this reversal? Stock, commission, and a settlement debit will be applied.')) return;
    setBusyId(id);
    setError(null);
    try {
      await adminSellerReversalsService.approve(id);
      await fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async (id: string) => {
    if (rejectReason.trim().length < 5) {
      setError('Rejection reason must be at least 5 characters.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await adminSellerReversalsService.reject(id, rejectReason.trim());
      setRejectingId(null);
      setRejectReason('');
      await fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Seller reversals</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
          B2B / off-platform reversal requests. Approving applies stock restore, commission
          reversal, and a settlement debit; the customer&apos;s order is unaffected.
        </p>
      </header>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: '#374151', marginRight: 8 }}>Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ margin: '12px 0', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>No reversals found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#6b7280' }}>
              <th style={{ padding: '8px 10px' }}>Requested</th>
              <th style={{ padding: '8px 10px' }}>Seller</th>
              <th style={{ padding: '8px 10px' }}>Sub-order</th>
              <th style={{ padding: '8px 10px' }}>Value</th>
              <th style={{ padding: '8px 10px' }}>Items</th>
              <th style={{ padding: '8px 10px' }}>Reason</th>
              <th style={{ padding: '8px 10px' }}>Status</th>
              <th style={{ padding: '8px 10px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = TONE[r.status] ?? TONE.CANCELLED;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(r.requestedAt).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{r.sellerId.slice(0, 8)}…</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{r.subOrderId.slice(0, 8)}…</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>₹{paiseToRupeesString(r.reversalValueInPaise)}</td>
                  <td style={{ padding: '8px 10px' }}>{r.items.length}</td>
                  <td style={{ padding: '8px 10px', maxWidth: 220 }}>{r.reason}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 12, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <div style={{ color: '#991b1b', fontSize: 12, marginTop: 4 }}>{r.rejectionReason}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {r.status === 'PENDING_APPROVAL' && canDecide ? (
                      rejectingId === r.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Rejection reason"
                            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
                          />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => submitReject(r.id)} disabled={busyId === r.id} style={btn('#991b1b')}>Confirm reject</button>
                            <button onClick={() => { setRejectingId(null); setRejectReason(''); }} style={btn('#6b7280')}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => approve(r.id)} disabled={busyId === r.id} style={btn('#065f46')}>Approve</button>
                          <button onClick={() => { setRejectingId(r.id); setRejectReason(''); }} disabled={busyId === r.id} style={btn('#991b1b')}>Reject</button>
                        </div>
                      )
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '4px 10px',
    border: `1px solid ${color}`,
    background: '#fff',
    color,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
