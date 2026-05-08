'use client';

// Phase 12 (ADR-017) — finance approval detail page.
//
// Stays inside the Finance Approvals area instead of bouncing the user
// to /dashboard/disputes/<id>. The dispute / return summary is bundled
// into the detail GET so finance only needs `refunds.approve` to read
// the context.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminRefundApprovalsService,
  RefundInstructionDetail,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/services/admin-refund-approvals.service';

export default function RefundApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<RefundInstructionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRefundApprovalsService.get(id);
      if (res.data) setRow(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onApprove = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await adminRefundApprovalsService.approve(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (busy) return;
    if (!rejectReason.trim()) return setError('Reason is required');
    setError('');
    setBusy(true);
    try {
      await adminRefundApprovalsService.reject(id, rejectReason.trim());
      setShowReject(false);
      setRejectReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !row) {
    return (
      <div style={{ padding: '32px', color: '#525A65' }}>
        Loading…
      </div>
    );
  }
  if (!row) {
    return (
      <div style={{ padding: '32px' }}>
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error || 'Not found'}
        </div>
        <Link href="/dashboard/finance/refund-approvals" style={{ color: '#2A8595', fontSize: 13, fontWeight: 600 }}>
          ← Back to refund approvals
        </Link>
      </div>
    );
  }

  const rupees = (Number(row.amountInPaise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const isPending = row.status === 'PENDING_APPROVAL';
  const src = row.source;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100 }}>
      <Link href="/dashboard/finance/refund-approvals" style={{ color: '#2A8595', fontSize: 13, fontWeight: 600 }}>
        ← Back to refund approvals
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Refund instruction
        </h1>
        <span style={{
          fontSize: 11, padding: '3px 9px', borderRadius: 9999,
          background: STATUS_COLOR[row.status] + '22', color: STATUS_COLOR[row.status],
          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {STATUS_LABEL[row.status]}
        </span>
      </div>
      <p style={{ marginTop: 0, fontSize: 13, color: '#525A65' }}>
        <code>{row.id}</code>
      </p>

      {error && (
        <div style={{ marginTop: 12, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, marginTop: 20 }}>
        {/* LEFT — source context (read-only) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {src && src.sourceType === 'DISPUTE' && (
            <Card title="Dispute summary">
              <KV label="Dispute number" value={src.number} />
              <KV label="Kind" value={src.kind ?? '—'} />
              <KV label="Status" value={src.status.replace(/_/g, ' ').toLowerCase()} />
              <KV label="Filed by" value={`${src.filedByName ?? '—'} (${(src.filedByType ?? '').toLowerCase()})`} />
              {src.orderNumber && <KV label="Order" value={src.orderNumber} />}
              {src.returnNumber && <KV label="Return" value={src.returnNumber} />}
              <div style={{ paddingTop: 8, borderTop: '1px solid #F3F4F6', marginTop: 8 }}>
                <div style={{ fontSize: 11, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Customer wrote
                </div>
                <div style={{ fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap', background: '#FAFAFA', padding: 10, borderRadius: 8 }}>
                  {src.summary || '—'}
                </div>
              </div>
              {src.decisionRationale && (
                <div style={{ paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Decision rationale
                  </div>
                  <div style={{ fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap', background: '#FAFAFA', padding: 10, borderRadius: 8 }}>
                    {src.decisionRationale}
                  </div>
                  {src.decisionAt && (
                    <p style={{ fontSize: 11, color: '#7A828F', marginTop: 4 }}>
                      Decided {new Date(src.decisionAt).toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Full chat thread for DISPUTE sources. Admin-only internal
              notes are filtered out server-side — finance only sees the
              customer-facing exchange. */}
          {src && src.sourceType === 'DISPUTE' && src.messages && src.messages.length > 0 && (
            <Card title="Conversation">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {src.messages.map((m) => {
                  const isAdmin = m.senderType === 'ADMIN';
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isAdmin ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#7A828F', marginBottom: 2 }}>
                        <strong>{m.senderName}</strong>
                        {' · '}
                        {new Date(m.createdAt).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                      <div
                        style={{
                          maxWidth: '85%',
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: isAdmin ? '#0F1115' : '#FAFAFA',
                          color: isAdmin ? '#fff' : '#0F1115',
                          fontSize: 13,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {src && src.sourceType === 'RETURN' && (
            <Card title="Return summary">
              <KV label="Return number" value={src.number} />
              <KV label="Status" value={src.status.replace(/_/g, ' ').toLowerCase()} />
              {src.orderNumber && <KV label="Order" value={src.orderNumber} />}
              {src.refundAmount && <KV label="Approved refund" value={`₹${src.refundAmount}`} />}
              {src.customerNotes && (
                <div style={{ paddingTop: 8, borderTop: '1px solid #F3F4F6', marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Customer notes
                  </div>
                  <div style={{ fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap', background: '#FAFAFA', padding: 10, borderRadius: 8 }}>
                    {src.customerNotes}
                  </div>
                </div>
              )}
              {src.qcNotes && (
                <div style={{ paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    QC notes
                  </div>
                  <div style={{ fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap', background: '#FAFAFA', padding: 10, borderRadius: 8 }}>
                    {src.qcNotes}
                  </div>
                </div>
              )}
            </Card>
          )}

          {!src && (
            <Card title="Source">
              <p style={{ margin: 0, fontSize: 13, color: '#7A828F' }}>
                Source data unavailable ({row.sourceType} {row.sourceId.slice(0, 8)}…).
              </p>
            </Card>
          )}
        </div>

        {/* RIGHT — money + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Refund">
            <KV label="Amount" value={<strong style={{ fontSize: 18 }}>₹{rupees}</strong>} />
            <KV label="Method" value={row.refundMethod} />
            <KV label="Currency" value={row.currency} />
            <KV label="Created" value={new Date(row.createdAt).toLocaleString('en-IN')} />
            {row.processedAt && <KV label="Processed" value={new Date(row.processedAt).toLocaleString('en-IN')} />}
            {row.walletTransactionId && (
              <KV label="Wallet tx" value={<code style={{ fontSize: 11 }}>{row.walletTransactionId.slice(0, 12)}…</code>} />
            )}
            {row.failureReason && (
              <div style={{ marginTop: 8, padding: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 12 }}>
                {row.failureReason}
              </div>
            )}
            {row.rejectionReason && (
              <div style={{ marginTop: 8, padding: 8, background: '#FAFAFA', color: '#525A65', borderRadius: 8, fontSize: 12 }}>
                <strong>Rejected:</strong> {row.rejectionReason}
              </div>
            )}
          </Card>

          {isPending && (
            <Card title="Decide">
              <p style={{ margin: 0, marginBottom: 12, fontSize: 12, color: '#525A65', lineHeight: 1.5 }}>
                Approving runs the saga and credits the customer wallet.
                Rejecting cancels the instruction; the underlying
                dispute decision stands unless ops reverses it separately.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={busy}
                  style={{
                    height: 38, border: 'none', background: '#15803d', color: '#fff',
                    borderRadius: 9999, fontSize: 13, fontWeight: 600,
                    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Approving…' : `Approve — release ₹${rupees}`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject(true)}
                  disabled={busy}
                  style={{
                    height: 38, border: '1px solid #fca5a5',
                    background: '#fff', color: '#b91c1c',
                    borderRadius: 9999, fontSize: 13, fontWeight: 600,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Reject
                </button>
              </div>
            </Card>
          )}

          {!isPending && (
            <Card title="Status">
              <p style={{ margin: 0, fontSize: 12, color: '#525A65' }}>
                {row.status === 'SUCCESS' && row.approvedAt && (
                  <>Approved on {new Date(row.approvedAt).toLocaleString('en-IN')}.</>
                )}
                {row.status === 'CANCELLED' && row.rejectedAt && (
                  <>Rejected on {new Date(row.rejectedAt).toLocaleString('en-IN')}.</>
                )}
                {row.status === 'FAILED' && (
                  <>Saga failed — manual ops review required.</>
                )}
              </p>
            </Card>
          )}
        </div>
      </div>

      {showReject && (
        <div
          onClick={() => { if (!busy) setShowReject(false); }}
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
              The customer will not receive the refund. The underlying
              dispute / return decision is <strong>not</strong> reversed
              — that is a separate ops action.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (visible in audit log)"
              rows={3}
              disabled={busy}
              style={{
                width: '100%', padding: 10, border: '1px solid #D2D6DC',
                borderRadius: 12, fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowReject(false); setRejectReason(''); }}
                disabled={busy}
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
                disabled={busy || !rejectReason.trim()}
                style={{
                  height: 36, padding: '0 16px', border: 'none',
                  background: '#b91c1c', color: '#fff',
                  borderRadius: 9999, fontSize: 13, fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: !rejectReason.trim() ? 0.6 : 1,
                }}
              >
                {busy ? 'Rejecting…' : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, marginBottom: 12 }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: '#525A65' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#0F1115', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
