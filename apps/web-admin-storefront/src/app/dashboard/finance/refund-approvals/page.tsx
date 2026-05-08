'use client';

// Phase 12 (ADR-017) — finance approval queue.
//
// Refunds whose dispute decision exceeded the auto-approve threshold
// (default ₹10,000) or were issued as goodwill credit land here as
// PENDING_APPROVAL. The admin holding `refunds.approve` either
// approves (saga runs + wallet credits) or rejects with a reason
// (instruction CANCELLED; the dispute outcome itself is not reversed
// — that's a separate ops action).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminRefundApprovalsService,
  RefundInstructionRow,
  RefundInstructionStatus,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/services/admin-refund-approvals.service';

type Tab = RefundInstructionStatus | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'SUCCESS', label: 'Approved + paid' },
  { key: 'CANCELLED', label: 'Rejected' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'ALL', label: 'All' },
];

export default function RefundApprovalsPage() {
  const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
  const [rows, setRows] = useState<RefundInstructionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reject modal state — single in-flight at a time.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminRefundApprovalsService.list({
        status: tab === 'ALL' ? undefined : tab,
        page: 1,
        limit: 50,
      });
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onApprove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await adminRefundApprovalsService.approve(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async () => {
    if (!rejectingId || !rejectReason.trim() || busyId) return;
    setBusyId(rejectingId);
    try {
      await adminRefundApprovalsService.reject(
        rejectingId,
        rejectReason.trim(),
      );
      setRejectingId(null);
      setRejectReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
        Refund approvals
      </h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
        Refunds above the threshold or issued as goodwill credit need a
        finance signoff before the wallet is credited. Approving runs the
        saga; rejecting cancels the instruction (dispute decision stands
        unless an admin reverses it separately).
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '20px 0 12px' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 9999,
              border: tab === t.key ? '1px solid #0F1115' : '1px solid #D2D6DC',
              background: tab === t.key ? '#0F1115' : '#fff',
              color: tab === t.key ? '#fff' : '#0F1115',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        {loading && rows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
            Nothing in this tab.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
                <Th>Source</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rupees = (Number(r.amountInPaise) / 100).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
                const isPending = r.status === 'PENDING_APPROVAL';
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <Td>
                      {/* Stays inside Finance Approvals — the detail page
                          renders the dispute/return context inline using
                          the same `refunds.approve` permission, so finance
                          never bounces over to the disputes / returns
                          admin views (which need their own permissions). */}
                      <Link
                        href={`/dashboard/finance/refund-approvals/${r.id}`}
                        style={{ color: '#2A8595', fontWeight: 600 }}
                      >
                        {r.sourceType} — {r.sourceId.slice(0, 8)}…
                      </Link>
                    </Td>
                    <Td>{r.refundMethod}</Td>
                    <Td><strong>₹{rupees}</strong></Td>
                    <Td>
                      <span style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 9999,
                        background: STATUS_COLOR[r.status] + '22', color: STATUS_COLOR[r.status],
                        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.rejectionReason && (
                        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4 }}>
                          {r.rejectionReason}
                        </div>
                      )}
                      {r.failureReason && (
                        <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
                          {r.failureReason}
                        </div>
                      )}
                    </Td>
                    <Td style={{ color: '#525A65' }}>
                      {new Date(r.createdAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Td>
                    <Td>
                      {isPending ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => onApprove(r.id)}
                            disabled={busyId !== null}
                            style={{
                              height: 28, padding: '0 12px', border: 'none',
                              background: '#15803d', color: '#fff',
                              borderRadius: 9999, fontSize: 12, fontWeight: 600,
                              cursor: busyId ? 'wait' : 'pointer',
                              opacity: busyId === r.id ? 0.6 : 1,
                            }}
                          >
                            {busyId === r.id ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(r.id);
                              setRejectReason('');
                            }}
                            disabled={busyId !== null}
                            style={{
                              height: 28, padding: '0 12px', border: '1px solid #fca5a5',
                              background: '#fff', color: '#b91c1c',
                              borderRadius: 9999, fontSize: 12, fontWeight: 600,
                              cursor: busyId ? 'wait' : 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#7A828F' }}>
                          {r.approvedAt ? `Approved ${new Date(r.approvedAt).toLocaleDateString('en-IN')}` :
                           r.rejectedAt ? `Rejected ${new Date(r.rejectedAt).toLocaleDateString('en-IN')}` :
                           '—'}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {total} total · showing up to 50
      </p>

      {rejectingId && (
        <div
          onClick={() => {
            if (!busyId) {
              setRejectingId(null);
              setRejectReason('');
            }
          }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 24,
              width: '100%', maxWidth: 480, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Reject refund
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: '#525A65', lineHeight: 1.5 }}>
              The customer will not receive the refund. The underlying dispute
              decision is <strong>not</strong> reversed — if it should be,
              do that separately on the dispute page.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (visible in audit log)"
              rows={3}
              disabled={busyId !== null}
              style={{
                width: '100%', padding: 10, border: '1px solid #D2D6DC',
                borderRadius: 12, fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setRejectingId(null);
                  setRejectReason('');
                }}
                disabled={busyId !== null}
                style={{
                  height: 36, padding: '0 16px', border: '1px solid #D2D6DC',
                  background: '#fff', color: '#0F1115',
                  borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={busyId !== null || !rejectReason.trim()}
                style={{
                  height: 36, padding: '0 16px', border: 'none',
                  background: '#b91c1c', color: '#fff',
                  borderRadius: 9999, fontSize: 13, fontWeight: 600,
                  cursor: busyId ? 'wait' : 'pointer',
                  opacity: !rejectReason.trim() ? 0.6 : 1,
                }}
              >
                {busyId ? 'Rejecting…' : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '12px 14px', verticalAlign: 'top', ...style }}>{children}</td>;
}
