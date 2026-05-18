'use client';

// Phase 13 GST — Wallet adjustment approvals.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  WalletAdjustmentItem,
} from '@/services/admin-tax.service';

type StatusFilter = 'ALL' | 'PENDING_APPROVAL' | 'FIRST_APPROVED' | 'APPROVED' | 'REJECTED' | 'REVERSED';

export default function WalletAdjustmentsPage() {
  const { confirmDialog } = useModal();
  const [filter, setFilter] = useState<StatusFilter>('PENDING_APPROVAL');
  const [items, setItems] = useState<WalletAdjustmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listWalletAdjustments(filter === 'ALL' ? undefined : filter);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const approve = async (a: WalletAdjustmentItem) => {
    const isSecondStep = a.status === 'FIRST_APPROVED';
    const isFirstOfDual = a.status === 'PENDING_APPROVAL' && a.requiresDualApproval;
    const messageBody = isSecondStep
      ? 'This is the SECOND approval. Money will move immediately once you confirm.'
      : isFirstOfDual
        ? 'This is the FIRST approval. A second distinct admin must also approve before money moves.'
        : 'Approve this wallet adjustment? Money will move immediately.';
    const ok = await confirmDialog({
      title: isSecondStep ? 'Provide second approval?' : isFirstOfDual ? 'Provide first approval?' : 'Approve wallet adjustment?',
      message: messageBody,
      confirmText: 'Approve',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(a.id);
    try {
      const res = await adminTaxService.approveWalletAdjustment(a.id);
      const text =
        res.data?.status === 'FIRST_APPROVED'
          ? `First approval recorded — awaiting second approver.`
          : `Approved — wallet transaction ${res.data?.walletTransactionId}`;
      setMsg({ kind: 'ok', text });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Approval failed' });
    } finally { setBusy(null); }
  };

  const reject = async (id: string) => {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    setBusy(id);
    try {
      await adminTaxService.rejectWalletAdjustment(id, reason);
      setMsg({ kind: 'ok', text: 'Rejected' });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Rejection failed' });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>&larr; Tax / GST</Link>
      <h1>Wallet adjustments</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Goodwill credits + Section-34 time-barred refunds + manual debits.
        High-value adjustments require dual approval — two distinct admins
        must sign off (neither can be the requester) before money moves.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['PENDING_APPROVAL', 'FIRST_APPROVED', 'APPROVED', 'REJECTED', 'REVERSED', 'ALL'] as StatusFilter[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)} style={filter === s ? btnFilterActive : btnFilter}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
        <button onClick={load} style={btnSecondary}>Refresh</button>
      </div>

      {msg && (
        <div style={{ ...note, background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.kind === 'ok' ? '#166534' : '#991b1b' }}>
          {msg.text}
        </div>
      )}

      {loading ? <p>Loading…</p> : items.length === 0 ? (
        <p style={{ color: '#666' }}>No adjustments in this state.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Kind</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={{ ...th, textAlign: 'right' }}>Absorbed GST</th>
              <th style={th}>Reason</th>
              <th style={th}>Requested</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}>
                  <div style={kindBadge(a.kind)}>{a.kind}</div>
                  {a.requiresDualApproval && (
                    <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>⚠ dual-approval</div>
                  )}
                </td>
                <td style={td}>
                  <span style={statusBadge(a.status)}>{a.status.replace(/_/g, ' ')}</span>
                  {a.status === 'FIRST_APPROVED' && a.firstApprovedByAdminId && (
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                      1st by {a.firstApprovedByAdminId}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: BigInt(a.amountInPaise) < 0n ? '#dc2626' : '#16a34a' }}>
                  ₹{paiseToRupees(a.amountInPaise)}
                </td>
                <td style={{ ...td, textAlign: 'right', fontSize: 11 }}>
                  {hasGstSnapshot(a)
                    ? `₹${paiseToRupees(a.wouldHaveBeenTaxableInPaise ?? '0')} taxable / ₹${paiseToRupees(a.wouldHaveBeenCgstInPaise ?? '0')} CGST / ₹${paiseToRupees(a.wouldHaveBeenSgstInPaise ?? '0')} SGST / ₹${paiseToRupees(a.wouldHaveBeenIgstInPaise ?? '0')} IGST`
                    : '—'}
                </td>
                <td style={{ ...td, fontSize: 11, maxWidth: 320 }}>{a.reason}</td>
                <td style={{ ...td, fontSize: 11 }}>{new Date(a.requestedAt).toLocaleString('en-IN')}</td>
                <td style={td}>
                  {a.status === 'PENDING_APPROVAL' || a.status === 'FIRST_APPROVED' ? (
                    <>
                      <button
                        onClick={() => approve(a)}
                        disabled={busy === a.id}
                        style={busy === a.id ? { ...btnPrimary, ...busyStyle } : btnPrimary}
                      >
                        {busy === a.id
                          ? 'Approving…'
                          : approveLabel(a)}
                      </button>
                      <button
                        onClick={() => reject(a.id)}
                        disabled={busy === a.id}
                        style={busy === a.id ? { ...btnDanger, ...busyStyle } : btnDanger}
                      >
                        {busy === a.id ? 'Rejecting…' : 'Reject'}
                      </button>
                    </>
                  ) : (
                    <span style={{ color: '#666', fontSize: 11 }}>—</span>
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

function approveLabel(a: WalletAdjustmentItem): string {
  // Label reflects approvals already collected, not the step about to fire.
  // 0/2 = no sign-offs yet (this click becomes the first).
  // 1/2 = first sign-off recorded (this click becomes the second and posts).
  if (a.status === 'FIRST_APPROVED') return 'Approve (1/2)';
  if (a.requiresDualApproval) return 'Approve (0/2)';
  return 'Approve';
}

function hasGstSnapshot(a: WalletAdjustmentItem): boolean {
  return Boolean(
    a.wouldHaveBeenTaxableInPaise || a.wouldHaveBeenCgstInPaise ||
    a.wouldHaveBeenSgstInPaise || a.wouldHaveBeenIgstInPaise,
  );
}

function statusBadge(s: string): React.CSSProperties {
  const color =
    s === 'APPROVED' ? '#16a34a'
      : s === 'REJECTED' ? '#dc2626'
      : s === 'REVERSED' ? '#6b7280'
      : s === 'FIRST_APPROVED' ? '#2563eb'
      : '#d97706';
  return { background: color, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
}
function kindBadge(k: string): React.CSSProperties {
  const color = k === 'TIME_BARRED_CREDIT_NOTE' ? '#dc2626' : k === 'GOODWILL' ? '#16a34a' : '#6b7280';
  return { fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#f3f4f6', color, fontWeight: 600, display: 'inline-block' };
}
function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const n = BigInt(p);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return (neg ? '-' : '') + whole.toString() + '.' + cents.toString().padStart(2, '0');
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#16a34a', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 };
const btnDanger: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
