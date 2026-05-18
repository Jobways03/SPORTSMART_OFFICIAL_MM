'use client';

// Phase 12 GST — Time-bar review queue.
// Lists returns where the Phase-12 cron flagged Section-34 eligibility
// as REQUIRES_FINANCE_REVIEW or TIME_BARRED.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  TimebarReviewItem,
} from '@/services/admin-tax.service';

type Status = 'ALL' | 'REQUIRES_FINANCE_REVIEW' | 'TIME_BARRED';

export default function TimebarReviewPage() {
  const [filter, setFilter] = useState<Status>('ALL');
  const [items, setItems] = useState<TimebarReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listTimebarReview(filter === 'ALL' ? undefined : filter);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed to load queue' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const action = async (id: string, op: 'wallet' | 'credit', reason?: string) => {
    setBusy(id);
    setMsg(null);
    try {
      if (op === 'wallet') {
        const res = await adminTaxService.routeReturnToWallet(id, reason);
        setMsg({ kind: 'ok', text: `Routed to wallet adjustment ${res.data?.adjustmentId} (${res.data?.status})` });
      } else {
        const res = await adminTaxService.issueCreditNoteOverride(id, reason);
        setMsg({ kind: 'ok', text: `Credit note ${res.data?.documentNumber} issued (₹${paiseToRupees(res.data?.totalInPaise ?? '0')})` });
      }
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Action failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <Link href="/dashboard/tax" style={crumb}>&larr; Tax / GST</Link>
      <h1>Section 34 — Time-bar review</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Returns flagged by the Phase-12 daily cron. <strong>REQUIRES_FINANCE_REVIEW</strong> are within 7 days of cutoff
        or have unusual source-invoice state — pick a path manually.
        <strong>TIME_BARRED</strong> are past Section-34 cutoff — must route via wallet adjustment.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['ALL', 'REQUIRES_FINANCE_REVIEW', 'TIME_BARRED'] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={filter === s ? btnFilterActive : btnFilter}
          >
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
        <p style={{ color: '#666' }}>Queue empty — no returns awaiting review.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Return #</th>
              <th style={th}>Status</th>
              <th style={th}>Refund</th>
              <th style={th}>Reason</th>
              <th style={th}>Reviewed by</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const reviewed = Boolean(r.financeReviewedAt);
              const timeBarred = r.creditNoteEligibilityStatus === 'TIME_BARRED';
              const walletDisabled = busy === r.id || reviewed;
              const creditDisabled = busy === r.id || reviewed || timeBarred;
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.returnNumber}</td>
                  <td style={td}>
                    <span style={statusBadge(r.creditNoteEligibilityStatus)}>
                      {r.creditNoteEligibilityStatus ?? '—'}
                    </span>
                    {reviewed && (
                      <div style={{ marginTop: 4 }}>
                        <span style={reviewedBadge}>✓ REVIEWED</span>
                      </div>
                    )}
                  </td>
                  <td style={td}>₹{paiseToRupees(r.refundAmountInPaise)}</td>
                  <td style={{ ...td, fontSize: 12, maxWidth: 350 }}>{r.creditNoteTimeBarReason ?? '—'}</td>
                  <td style={{ ...td, fontSize: 11 }}>
                    {r.financeReviewedBy ? (
                      <>
                        <div style={{ fontFamily: 'monospace' }}>{r.financeReviewedBy.slice(0, 8)}…</div>
                        {r.financeReviewedAt && (
                          <div style={{ color: '#666', fontSize: 10 }}>
                            {new Date(r.financeReviewedAt).toLocaleString('en-IN')}
                          </div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => {
                        const reason = prompt('Reason for routing to wallet:');
                        if (reason !== null) void action(r.id, 'wallet', reason || undefined);
                      }}
                      disabled={walletDisabled}
                      style={walletDisabled ? { ...btnPrimary, ...busyStyle } : btnPrimary}
                      title={reviewed
                        ? 'Already handled — see Wallet adjustments queue'
                        : 'Create a wallet adjustment for this return'}
                    >
                      {busy === r.id ? 'Routing…' : reviewed ? 'Already routed' : 'Route to wallet'}
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Reason for issuing credit note despite time-bar:');
                        if (reason !== null) void action(r.id, 'credit', reason || undefined);
                      }}
                      disabled={creditDisabled}
                      style={creditDisabled ? btnDisabled : btnSecondary}
                      title={
                        reviewed
                          ? 'Already handled — see Wallet adjustments queue'
                          : timeBarred
                          ? 'Past Sec 34 cutoff — credit note path will throw'
                          : 'Issue credit note via override permission'
                      }
                    >
                      {busy === r.id ? 'Working…' : 'Issue credit note'}
                    </button>
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

function statusBadge(s: string | null): React.CSSProperties {
  const color =
    s === 'TIME_BARRED' ? '#dc2626' :
    s === 'REQUIRES_FINANCE_REVIEW' ? '#d97706' :
    s === 'ELIGIBLE' ? '#16a34a' : '#6b7280';
  return { background: color, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
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
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnDisabled: React.CSSProperties = { background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', padding: '5px 10px', borderRadius: 4, cursor: 'not-allowed', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const reviewedBadge: React.CSSProperties = { background: '#16a34a', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, display: 'inline-block' };
