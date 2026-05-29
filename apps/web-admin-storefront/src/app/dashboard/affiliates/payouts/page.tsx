'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '@/lib/permissions';
import {
  adminAffiliatePayoutsService as svc,
  AffiliatePayoutRow,
  AFFILIATE_PAYOUT_STATUS_COLOR,
} from '@/services/admin-affiliate-payouts.service';

const STATUS_FILTERS = ['REQUESTED', 'APPROVED', 'PAID', 'FAILED', 'REJECTED', 'ALL'] as const;

export default function AffiliatePayoutsQueuePage() {
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('affiliates.payouts.approve');
  const canReject = hasPermission('affiliates.payouts.reject');
  const canMarkPaid = hasPermission('affiliates.payouts.mark_paid');
  const canMarkFailed = hasPermission('affiliates.payouts.mark_failed');

  const [rows, setRows] = useState<AffiliatePayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('REQUESTED');
  const [busy, setBusy] = useState<string | null>(null);

  // Mark-paid modal (UTR required).
  const [payFor, setPayFor] = useState<AffiliatePayoutRow | null>(null);
  const [utr, setUtr] = useState('');
  // Reason modal (reject / mark-failed).
  const [reasonFor, setReasonFor] = useState<{ row: AffiliatePayoutRow; kind: 'reject' | 'fail' } | null>(null);
  const [reason, setReason] = useState('');
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await svc.list({ status: statusFilter === 'ALL' ? undefined : statusFilter });
      setRows(res?.data?.requests ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load payout requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (row: AffiliatePayoutRow) => {
    if (!window.confirm(`Approve payout of ₹${row.netAmount} to ${affName(row)}?`)) return;
    setBusy(row.id);
    setError('');
    try {
      await svc.approve(row.id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const submitMarkPaid = async () => {
    if (!payFor) return;
    setModalErr('');
    if (!/^[A-Za-z0-9]{8,40}$/.test(utr.trim())) {
      setModalErr('UTR must be 8–40 alphanumeric characters.');
      return;
    }
    setBusy(payFor.id);
    try {
      await svc.markPaid(payFor.id, utr.trim());
      setPayFor(null);
      setUtr('');
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? 'Mark-paid failed');
    } finally {
      setBusy(null);
    }
  };

  const submitReason = async () => {
    if (!reasonFor) return;
    setModalErr('');
    if (reason.trim().length < 1) {
      setModalErr('A reason is required.');
      return;
    }
    setBusy(reasonFor.row.id);
    try {
      if (reasonFor.kind === 'reject') await svc.reject(reasonFor.row.id, reason.trim());
      else await svc.markFailed(reasonFor.row.id, reason.trim());
      setReasonFor(null);
      setReason('');
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Affiliate payouts</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
        Review affiliate payout requests: approve → mark paid (with UTR), or reject / mark failed.
      </p>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #e2e8f0',
              background: statusFilter === s ? '#0F1115' : '#fff',
              color: statusFilter === s ? '#fff' : '#475569',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#64748b' }}>No payout requests in this view.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
              <th style={th}>Affiliate</th>
              <th style={{ ...th, textAlign: 'right' }}>Gross</th>
              <th style={{ ...th, textAlign: 'right' }}>TDS</th>
              <th style={{ ...th, textAlign: 'right' }}>Net</th>
              <th style={th}>Method</th>
              <th style={th}>Status</th>
              <th style={th}>Requested</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = AFFILIATE_PAYOUT_STATUS_COLOR[r.status];
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <strong>{affName(r)}</strong>
                    <br />
                    <small style={{ color: '#94a3b8' }}>{r.affiliate?.email ?? r.affiliateId.slice(0, 8)}</small>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>₹{r.grossAmount}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#92400e' }}>₹{r.tdsAmount}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>₹{r.netAmount}</td>
                  <td style={td}>{r.payoutMethodType ?? '—'}</td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: meta?.bg, color: meta?.fg }}>
                      {r.status}
                    </span>
                    {r.transactionRef && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>UTR {r.transactionRef}</div>}
                    {(r.failureReason || r.rejectionReason) && (
                      <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>{r.failureReason || r.rejectionReason}</div>
                    )}
                  </td>
                  <td style={{ ...td, color: '#64748b', fontSize: 11 }}>
                    {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {r.status === 'REQUESTED' && canApprove && (
                        <button disabled={busy === r.id} onClick={() => approve(r)} style={{ ...btn, borderColor: '#15803d', color: '#15803d' }}>
                          Approve
                        </button>
                      )}
                      {r.status === 'REQUESTED' && canReject && (
                        <button disabled={busy === r.id} onClick={() => { setReasonFor({ row: r, kind: 'reject' }); setReason(''); setModalErr(''); }} style={{ ...btn, borderColor: '#b91c1c', color: '#b91c1c' }}>
                          Reject
                        </button>
                      )}
                      {r.status === 'APPROVED' && canMarkPaid && (
                        <button disabled={busy === r.id} onClick={() => { setPayFor(r); setUtr(''); setModalErr(''); }} style={{ ...btn, borderColor: '#15803d', color: '#15803d' }}>
                          Mark paid
                        </button>
                      )}
                      {r.status === 'APPROVED' && canMarkFailed && (
                        <button disabled={busy === r.id} onClick={() => { setReasonFor({ row: r, kind: 'fail' }); setReason(''); setModalErr(''); }} style={btn}>
                          Mark failed
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Mark-paid modal */}
      {payFor && (
        <div style={backdrop} onClick={() => !busy && setPayFor(null)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Mark payout paid</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 12px' }}>
              ₹{payFor.netAmount} to {affName(payFor)}. Enter the bank UTR / transaction reference (required).
            </p>
            <input
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="UTR (8–40 alphanumeric)"
              autoFocus
              style={input}
            />
            {modalErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{modalErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setPayFor(null)} disabled={!!busy} style={btn}>Cancel</button>
              <button onClick={submitMarkPaid} disabled={!!busy} style={{ ...btn, background: '#15803d', color: '#fff', borderColor: '#15803d' }}>
                {busy ? 'Saving…' : 'Confirm paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reason modal (reject / mark-failed) */}
      {reasonFor && (
        <div style={backdrop} onClick={() => !busy && setReasonFor(null)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
              {reasonFor.kind === 'reject' ? 'Reject payout' : 'Mark payout failed'}
            </h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 12px' }}>
              {reasonFor.kind === 'reject'
                ? 'Commissions are released back to CONFIRMED so the affiliate can re-request.'
                : 'The payout is marked FAILED; commissions are released for re-request.'}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              rows={3}
              autoFocus
              style={{ ...input, resize: 'vertical' }}
            />
            {modalErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{modalErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setReasonFor(null)} disabled={!!busy} style={btn}>Cancel</button>
              <button onClick={submitReason} disabled={!!busy} style={{ ...btn, background: '#b91c1c', color: '#fff', borderColor: '#b91c1c' }}>
                {busy ? 'Saving…' : reasonFor.kind === 'reject' ? 'Reject' : 'Mark failed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function affName(r: AffiliatePayoutRow): string {
  const n = `${r.affiliate?.firstName ?? ''} ${r.affiliate?.lastName ?? ''}`.trim();
  return n || r.affiliate?.email || r.affiliateId.slice(0, 8);
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
const btn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#475569',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,17,21,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  padding: 16,
};
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  padding: 22,
  width: '100%',
  maxWidth: 440,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  fontFamily: 'inherit',
};
