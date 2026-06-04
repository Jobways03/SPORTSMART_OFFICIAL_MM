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
  RefundSourceType,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/services/admin-refund-approvals.service';

type Tab = RefundInstructionStatus | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'NEEDS_CLARIFICATION', label: 'Needs clarification' },
  { key: 'SUCCESS', label: 'Approved + paid' },
  { key: 'CANCELLED', label: 'Rejected' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'ALL', label: 'All' },
];

const SOURCE_OPTIONS: { value: RefundSourceType | ''; label: string }[] = [
  { value: '', label: 'All sources' },
  { value: 'RETURN', label: 'Return' },
  { value: 'DISPUTE', label: 'Dispute' },
  { value: 'GOODWILL', label: 'Goodwill' },
];

function isOverdue(r: RefundInstructionRow): boolean {
  return (
    (r.status === 'PENDING_APPROVAL' || r.status === 'NEEDS_CLARIFICATION') &&
    !!r.approvalDueBy &&
    new Date(r.approvalDueBy).getTime() < Date.now()
  );
}

export default function RefundApprovalsPage() {
  const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
  const [rows, setRows] = useState<RefundInstructionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Phase 170 (#8/#6) — source filter + overdue-only toggle.
  const [sourceFilter, setSourceFilter] = useState<RefundSourceType | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Phase 172 (#17) — goodwill-only toggle.
  const [goodwillOnly, setGoodwillOnly] = useState(false);
  // Phase 170 (#9) — bulk-approve selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Reject modal state — single in-flight at a time.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelected(new Set());
    try {
      const res = await adminRefundApprovalsService.list({
        status: tab === 'ALL' ? undefined : tab,
        page: 1,
        limit: 50,
        sourceType: sourceFilter || undefined,
        overdue: overdueOnly || undefined,
        goodwill: goodwillOnly || undefined,
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
  }, [tab, sourceFilter, overdueOnly, goodwillOnly]);

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

  // Phase 170 (#9) — bulk approve the selected pending instructions.
  const onBulkApprove = async () => {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await adminRefundApprovalsService.bulkApprove(Array.from(selected));
      if (res.data && res.data.failed > 0) {
        setError(`Bulk approve: ${res.data.approved} approved, ${res.data.failed} skipped (some may need a second approver or were already actioned).`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk approve failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
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

      {/* Phase 170 (#8/#6) — source filter + overdue toggle. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as RefundSourceType | '')}
          style={{ height: 32, padding: '0 10px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 13 }}
        >
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only (past SLA)
        </label>
        {/* Phase 172 (#17) — goodwill-only filter. */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
          <input type="checkbox" checked={goodwillOnly} onChange={(e) => setGoodwillOnly(e.target.checked)} />
          Goodwill only
        </label>
      </div>

      {/* Phase 170 (#9) — bulk-approve bar (pending/clarification tabs only). */}
      {(tab === 'PENDING_APPROVAL' || tab === 'NEEDS_CLARIFICATION') && selected.size > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>{selected.size} selected</span>
          <button
            type="button"
            onClick={onBulkApprove}
            disabled={bulkBusy}
            style={{ height: 30, padding: '0 14px', border: 'none', background: '#15803d', color: '#fff', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: bulkBusy ? 'wait' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}
          >
            {bulkBusy ? 'Approving…' : `Approve ${selected.size}`}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} style={{ height: 30, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115', borderRadius: 9999, fontSize: 12, cursor: 'pointer' }}>Clear</button>
        </div>
      )}

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
                <Th> </Th>
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
                const isPending = r.status === 'PENDING_APPROVAL' || r.status === 'NEEDS_CLARIFICATION';
                const overdue = isOverdue(r);
                const selectable = r.status === 'PENDING_APPROVAL';
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6', background: overdue ? '#fffbeb' : undefined }}>
                    <Td>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                          aria-label="select for bulk approve"
                        />
                      )}
                    </Td>
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
                      {/* Phase 172 (#17) — goodwill badge (non-recoverable platform expense). */}
                      {r.isGoodwill && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            padding: '2px 7px',
                            borderRadius: 9999,
                            background: '#f3e8ff',
                            color: '#7c3aed',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Goodwill
                        </span>
                      )}
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
                      {overdue && (
                        <span style={{
                          marginLeft: 6, fontSize: 11, padding: '3px 9px', borderRadius: 9999,
                          background: '#fef3c7', color: '#b45309', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>Overdue</span>
                      )}
                      {r.status === 'NEEDS_CLARIFICATION' && r.clarificationNote && (
                        <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 4 }}>
                          Q: {r.clarificationNote}
                        </div>
                      )}
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
