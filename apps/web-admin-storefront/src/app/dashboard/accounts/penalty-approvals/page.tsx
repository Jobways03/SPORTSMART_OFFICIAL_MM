'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  adminFranchiseFinanceService as svc,
  paiseToINR,
  PenaltyApproval,
} from '@/services/admin-franchise-finance.service';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', ''];

/**
 * Phase 181 (#11) — two-person control queue for high-value franchise penalties.
 * A penalty above the env threshold lands here as PENDING; a DIFFERENT admin
 * (with franchise.penalty.approve) approves (posts it) or rejects it. `amount`
 * is a rupee Decimal string from the API.
 */
export default function PenaltyApprovalsPage() {
  const [status, setStatus] = useState('PENDING');
  const [items, setItems] = useState<PenaltyApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await svc.listPenaltyApprovals({ status: status || undefined, limit: 50 });
      if (r.data) setItems(r.data.items);
      else setErr(r.message || 'Failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load approvals');
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id); setErr(null); setMsg(null);
    try {
      const reason = action === 'reject' ? (window.prompt('Rejection reason (optional):') ?? undefined) : undefined;
      const r = action === 'approve' ? await svc.approvePenalty(id) : await svc.rejectPenalty(id, reason || undefined);
      if (r.success) { setMsg(action === 'approve' ? 'Penalty approved & posted.' : 'Penalty rejected.'); await load(); }
      else setErr(r.message || 'Failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '12px 0 4px', color: '#0F1115' }}>Penalty approvals</h1>
      <p style={{ marginTop: 0, fontSize: 14, color: '#525A65' }}>High-value franchise penalties awaiting a second admin. You cannot approve a penalty you requested.</p>

      <div style={{ margin: '16px 0' }}>
        <label style={{ fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 }}>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
        </select>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {msg && <div style={{ color: '#15803d', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#F9FAFB' }}>
            <tr>
              <th style={th}>Requested</th><th style={th}>Franchise</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Reason</th>
              <th style={th}>Requested by</th><th style={th}>Status</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, color: '#7A828F', textAlign: 'center' }}>No approvals.</td></tr>
            ) : items.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={td}>{new Date(a.createdAt).toLocaleDateString('en-IN')}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{a.franchiseId.slice(0, 8)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>{paiseToINR(String(Math.round(Number(a.amount) * 100)))}</td>
                <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.reason}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{a.requestedByAdminId.slice(0, 8)}</td>
                <td style={td}>{a.status}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {a.status === 'PENDING' ? (
                    <>
                      <button disabled={busy === a.id} onClick={() => decide(a.id, 'approve')} style={{ ...actBtn('#15803d'), opacity: busy === a.id ? 0.5 : 1 }}>Approve</button>
                      <button disabled={busy === a.id} onClick={() => decide(a.id, 'reject')} style={{ ...actBtn('#b91c1c'), marginLeft: 6, opacity: busy === a.id ? 0.5 : 1 }}>Reject</button>
                    </>
                  ) : <span style={{ color: '#9CA3AF' }}>{a.approvedByAdminId ? a.approvedByAdminId.slice(0, 8) : '—'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#111827' };
const actBtn = (color: string): React.CSSProperties => ({ background: '#fff', color, border: `1px solid ${color}55`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 });
