'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminReturnsService,
  ReturnDetail,
  QcOutcome,
} from '@/services/admin-returns.service';

type QcRow = { returnItemId: string; qcOutcome: QcOutcome; qcQuantityApproved: number; qcNotes: string };

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  REQUESTED: { bg: '#fef3c7', color: '#92400e' },
  APPROVED: { bg: '#dbeafe', color: '#1e40af' },
  REJECTED: { bg: '#fee2e2', color: '#991b1b' },
  PICKUP_SCHEDULED: { bg: '#e0e7ff', color: '#3730a3' },
  IN_TRANSIT: { bg: '#e0e7ff', color: '#3730a3' },
  RECEIVED: { bg: '#ccfbf1', color: '#115e59' },
  QC_APPROVED: { bg: '#d1fae5', color: '#065f46' },
  QC_REJECTED: { bg: '#fee2e2', color: '#991b1b' },
  PARTIALLY_APPROVED: { bg: '#fef3c7', color: '#92400e' },
  REFUND_PROCESSING: { bg: '#e0e7ff', color: '#3730a3' },
  REFUNDED: { bg: '#d1fae5', color: '#065f46' },
  COMPLETED: { bg: '#d1fae5', color: '#065f46' },
  CANCELLED: { bg: '#f3f4f6', color: '#374151' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || { bg: '#f3f4f6', color: '#374151' };
  const label = status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return (
    <span
      style={{
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}
    >
      {label}
    </span>
  );
}

export default function AdminReturnDetailPage() {
  const { returnId } = useParams<{ returnId: string }>();
  const router = useRouter();
  const { notify, confirmDialog } = useModal();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReturnDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Customer-evidence lightbox — opens a full-screen photo viewer when
  // admin clicks "View Customer Photos". Admin can scroll through every
  // photo + caption the customer submitted and use that to decide
  // whether to approve or reject before paying for a pickup.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  // QC modal
  const [qcOpen, setQcOpen] = useState(false);
  const [qcRows, setQcRows] = useState<QcRow[]>([]);
  const [qcOverallNotes, setQcOverallNotes] = useState('');

  // Initiate Refund modal
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [refundMethodSel, setRefundMethodSel] = useState<string>('ORIGINAL_PAYMENT');

  // Confirm Refund modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refundRefInput, setRefundRefInput] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');

  // Mark Refund Failed modal
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminReturnsService.getReturn(returnId);
      if (res.data) setData(res.data);
    } catch {
      void notify('Failed to load return');
    } finally {
      setLoading(false);
    }
  }, [returnId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async () => {
    const ok = await confirmDialog({
      message: 'Approve this return request?',
      title: 'Approve Return',
      confirmText: 'Approve',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await adminReturnsService.approveReturn(returnId);
      if (res.success) {
        void notify('Return approved');
        load();
      } else {
        void notify(res.message || 'Failed to approve');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to approve');
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      void notify('Please enter a rejection reason');
      return;
    }
    setBusy(true);
    try {
      const res = await adminReturnsService.rejectReturn(returnId, reason);
      if (res.success) {
        void notify('Return rejected');
        setRejectOpen(false);
        setRejectReason('');
        load();
      } else {
        void notify(res.message || 'Failed to reject');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to reject');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReceived = async () => {
    const ok = await confirmDialog({
      message: 'Mark this return as received at the warehouse?',
      title: 'Mark Received',
      confirmText: 'Mark Received',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await adminReturnsService.markReceived(returnId);
      if (res.success) {
        void notify('Return marked received');
        load();
      } else {
        void notify(res.message || 'Failed to update');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to update');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    const ok = await confirmDialog({
      message: 'Close this return? This action cannot be undone.',
      title: 'Close Return',
      confirmText: 'Close Return',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await adminReturnsService.closeReturn(returnId);
      if (res.success) {
        void notify('Return closed');
        load();
      } else {
        void notify(res.message || 'Failed to close');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to close');
    } finally {
      setBusy(false);
    }
  };

  const openQcModal = () => {
    if (!data) return;
    setQcRows(
      data.items.map((it) => ({
        returnItemId: it.id,
        qcOutcome: 'APPROVED' as QcOutcome,
        qcQuantityApproved: it.quantity,
        qcNotes: '',
      })),
    );
    setQcOverallNotes('');
    setQcOpen(true);
  };

  const submitQc = async () => {
    for (const r of qcRows) {
      if (r.qcOutcome === 'APPROVED' || r.qcOutcome === 'PARTIAL') {
        if (r.qcQuantityApproved < 0) {
          void notify('Approved quantity cannot be negative');
          return;
        }
      }
      // Rejecting / marking damaged forfeits the customer's item + refund.
      // Require a substantive inspector note — accept it from EITHER the
      // per-item Notes field or the Overall Notes field (admin may write
      // wherever is convenient; customer sees whichever is populated).
      if (r.qcOutcome === 'REJECTED' || r.qcOutcome === 'DAMAGED') {
        const perItemOk = (r.qcNotes ?? '').trim().length >= 15;
        const overallOk = qcOverallNotes.trim().length >= 15;
        if (!perItemOk && !overallOk) {
          void notify(
            'Please write at least 15 characters explaining why the item was ' +
              (r.qcOutcome === 'REJECTED' ? 'rejected' : 'marked damaged') +
              '. You can use the per-item Notes field or the Overall Notes field — the customer will see this.',
          );
          return;
        }
      }
    }
    setBusy(true);
    try {
      const res = await adminReturnsService.submitQcDecision(returnId, {
        decisions: qcRows.map((r) => ({
          returnItemId: r.returnItemId,
          qcOutcome: r.qcOutcome,
          qcQuantityApproved:
            r.qcOutcome === 'REJECTED' || r.qcOutcome === 'DAMAGED' ? 0 : r.qcQuantityApproved,
          qcNotes: r.qcNotes || undefined,
        })),
        overallNotes: qcOverallNotes || undefined,
      });
      if (res.success) {
        void notify('QC decision submitted');
        setQcOpen(false);
        load();
      } else {
        void notify(res.message || 'Failed to submit QC decision');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to submit QC decision');
    } finally {
      setBusy(false);
    }
  };

  const submitInitiateRefund = async () => {
    setBusy(true);
    try {
      const res = await adminReturnsService.initiateRefund(returnId, refundMethodSel);
      if (res.success) {
        void notify('Refund initiated');
        setInitiateOpen(false);
        load();
      } else {
        void notify(res.message || 'Failed to initiate refund');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to initiate refund');
    } finally {
      setBusy(false);
    }
  };

  const submitConfirmRefund = async () => {
    const ref = refundRefInput.trim();
    if (!ref) {
      void notify('Please enter the refund reference (UTR / gateway ID)');
      return;
    }
    setBusy(true);
    try {
      const res = await adminReturnsService.confirmRefund(returnId, {
        refundReference: ref,
        notes: confirmNotes || undefined,
      });
      if (res.success) {
        void notify('Refund confirmed');
        setConfirmOpen(false);
        setRefundRefInput('');
        setConfirmNotes('');
        load();
      } else {
        void notify(res.message || 'Failed to confirm refund');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to confirm refund');
    } finally {
      setBusy(false);
    }
  };

  const submitMarkFailed = async () => {
    const reason = failReason.trim();
    if (!reason) {
      void notify('Please enter a failure reason');
      return;
    }
    setBusy(true);
    try {
      const res = await adminReturnsService.markRefundFailed(returnId, reason);
      if (res.success) {
        void notify('Refund marked as failed');
        setFailOpen(false);
        setFailReason('');
        load();
      } else {
        void notify(res.message || 'Failed to mark refund failed');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to mark refund failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryRefund = async () => {
    const ok = await confirmDialog({
      message: 'Retry the refund attempt?',
      title: 'Retry Refund',
      confirmText: 'Retry',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await adminReturnsService.retryRefund(returnId);
      if (res.success) {
        void notify('Refund retry attempted');
        load();
      } else {
        void notify(res.message || 'Failed to retry refund');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to retry refund');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#6b7280' }}>Loading return...</div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ marginBottom: 12 }}>Return not found.</div>
        <Link href="/dashboard/returns" style={{ color: '#2563eb' }}>
          ← Back to Returns
        </Link>
      </div>
    );
  }

  const fmtCurrency = (v: string | number | null | undefined) =>
    v == null || v === ''
      ? '--'
      : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDT = (d?: string | null) =>
    d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '--';

  const customerName = () => {
    const c = data.customer;
    if (!c) return 'Unknown';
    return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';
  };

  const isRequested = data.status === 'REQUESTED';
  const canMarkReceived = ['IN_TRANSIT', 'PICKUP_SCHEDULED'].includes(data.status);
  const canRunQc = data.status === 'RECEIVED';
  const canInitiateRefund = ['QC_APPROVED', 'PARTIALLY_APPROVED'].includes(data.status);
  const canConfirmOrFail = data.status === 'REFUND_PROCESSING';
  const canRetryRefund = data.status === 'REFUND_PROCESSING' && (data.refundAttempts ?? 0) > 0;
  // Only return-terminal states awaiting admin closure — matches the
  // backend guard (`REFUNDED`, `QC_REJECTED`). Once closed the return
  // moves to `COMPLETED`, which should not show the button.
  const canClose = ['REFUNDED', 'QC_REJECTED'].includes(data.status);
  // Admin can still cancel/reject a return any time before the item
  // actually moves (covers auto-approved returns that need overrule).
  // Backend allows reject from REQUESTED, APPROVED, PICKUP_SCHEDULED.
  const canRejectPostApproval = ['APPROVED', 'PICKUP_SCHEDULED'].includes(data.status);

  const orderNumber = data.masterOrder?.orderNumber ?? data.subOrder?.masterOrder?.orderNumber ?? '—';
  const totalReturnQty = data.items.reduce((s, it) => s + (it.quantity ?? 0), 0);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, background: '#f8fafc', minHeight: 'calc(100vh - 56px)' }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard/returns" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>
          ← Back to Returns
        </Link>
      </div>

      {/* Hero header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
          borderRadius: 14,
          padding: '22px 26px',
          color: '#fff',
          marginBottom: 20,
          boxShadow: '0 4px 14px rgba(37,99,235,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 4 }}>
              Return Request
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
              {data.returnNumber}
            </h1>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>
              Order <strong>{orderNumber}</strong> · Created {fmtDT(data.createdAt)} · {totalReturnQty} item{totalReturnQty === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <StatusBadge status={data.status} />
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              Last update {fmtDT(data.updatedAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Progress stepper */}
      <ProgressStepper status={data.status} />

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 20,
          padding: '14px 16px',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        {isRequested && (
          <>
            {(() => {
              const customerPhotos = (data.evidence ?? []).filter((e) => e.uploadedBy === 'CUSTOMER');
              return customerPhotos.length > 0 ? (
                <button
                  onClick={() => { setGalleryIdx(0); setGalleryOpen(true); }}
                  disabled={busy}
                  style={{
                    padding: '9px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid #6366f1',
                    borderRadius: 8,
                    background: '#eef2ff',
                    color: '#3730a3',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  View Customer Photos
                  <span
                    style={{
                      padding: '1px 8px',
                      background: '#6366f1',
                      color: '#fff',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {customerPhotos.length}
                  </span>
                </button>
              ) : null;
            })()}
            <button onClick={handleApprove} disabled={busy} style={approveBtn}>
              Approve & Schedule Pickup
            </button>
            <button onClick={() => setRejectOpen(true)} disabled={busy} style={rejectBtn}>
              Reject Return
            </button>
          </>
        )}
        {canMarkReceived && (
          <button onClick={handleMarkReceived} disabled={busy} style={approveBtn}>
            Mark Received
          </button>
        )}
        {canRejectPostApproval && (
          <button onClick={() => setRejectOpen(true)} disabled={busy} style={rejectBtn}>
            Cancel &amp; Reject
          </button>
        )}
        {canRunQc && (
          <button onClick={openQcModal} disabled={busy} style={approveBtn}>
            Submit QC Decision
          </button>
        )}
        {canInitiateRefund && (
          <button onClick={() => setInitiateOpen(true)} disabled={busy} style={approveBtn}>
            Initiate Refund
          </button>
        )}
        {canConfirmOrFail && (
          <>
            <button onClick={() => setConfirmOpen(true)} disabled={busy} style={approveBtn}>
              Confirm Refund
            </button>
            <button onClick={() => setFailOpen(true)} disabled={busy} style={rejectBtn}>
              Mark Refund Failed
            </button>
          </>
        )}
        {canRetryRefund && (
          <button onClick={handleRetryRefund} disabled={busy} style={approveBtn}>
            Retry Refund
          </button>
        )}
        {canClose && (
          <button onClick={handleClose} disabled={busy} style={rejectBtn}>
            Close Return
          </button>
        )}
        {!isRequested &&
          !canMarkReceived &&
          !canRunQc &&
          !canInitiateRefund &&
          !canConfirmOrFail &&
          !canRetryRefund &&
          !canClose && (
            <div style={{ color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
              No actions available for this state — waiting on customer or external event.
            </div>
          )}
      </div>

      {/* Customer Evidence card — shown only when the customer attached
          photos. Lets admin see exactly what the customer is claiming
          before spending money on a pickup. Click any thumb to open the
          full lightbox. Decision guidance is embedded in the footer so
          new admins know when to reject vs. when to receive for QC. */}
      {(() => {
        const customerPhotos = (data.evidence ?? []).filter((e) => e.uploadedBy === 'CUSTOMER');
        if (customerPhotos.length === 0) return null;
        return (
          <div style={{ ...cardStyleV2, marginBottom: 20, borderLeft: '4px solid #6366f1' }}>
            <div style={cardHeaderV2}>
              <span>Customer Evidence</span>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: '#eef2ff',
                  color: '#3730a3',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {customerPhotos.length} photo{customerPhotos.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ padding: 16 }}>
              {/* Customer's own reason snippet — pulled from the first
                  item's reasonDetail (or the order-level customerNotes
                  fallback) so admin doesn't have to scroll to find it. */}
              {(() => {
                const firstDetail = data.items.find((i) => i.reasonDetail)?.reasonDetail;
                const headline = firstDetail || data.customerNotes;
                if (!headline) return null;
                return (
                  <div
                    style={{
                      background: '#fafbfc',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: '10px 12px',
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: 4,
                      }}
                    >
                      Customer's Stated Reason
                    </div>
                    <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.5 }}>
                      {headline}
                    </div>
                  </div>
                );
              })()}

              {/* Thumbnails */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {customerPhotos.map((ev, i) => (
                  <button
                    key={ev.id}
                    onClick={() => { setGalleryIdx(i); setGalleryOpen(true); }}
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: '1px solid #e5e7eb',
                      padding: 0,
                      cursor: 'pointer',
                      background: '#fff',
                    }}
                    title={`Open photo ${i + 1} in full view`}
                  >
                    <img
                      src={ev.fileUrl}
                      alt={`Customer evidence ${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>

              {/* Decision guidance — reminds the admin when to use each
                  button, keeps the flow consistent across operators. */}
              {isRequested && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 12,
                    color: '#78350f',
                    lineHeight: 1.5,
                  }}
                >
                  <strong>Decision guide:</strong> If these photos <strong>clearly show</strong> the
                  item is used, damaged post-delivery, or doesn't match the reported
                  issue, use <strong>Reject Return</strong> — no pickup will be booked and the
                  customer keeps the item (they acknowledged forfeit at submission).{' '}
                  <strong>When in doubt</strong>, use <strong>Approve &amp; Schedule
                  Pickup</strong> so the item comes to the warehouse and you can run QC
                  in person.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        {/* Left: Items */}
        <div style={cardStyleV2}>
          <div style={cardHeaderV2}>
            <span>Items Being Returned</span>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
              {data.items.length} item{data.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div>
            {data.items.map((it, idx) => {
              const reasonLabel = it.reasonCategory
                .toLowerCase()
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (ch) => ch.toUpperCase());
              const unit = Number(it.orderItem?.unitPrice ?? 0);
              const lineTotal = unit * (it.quantity ?? 0);
              return (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '18px 20px',
                    borderTop: idx === 0 ? 'none' : '1px solid #f3f4f6',
                  }}
                >
                  {it.orderItem?.imageUrl ? (
                    <img
                      src={it.orderItem.imageUrl}
                      alt=""
                      style={{
                        width: 84,
                        height: 84,
                        borderRadius: 10,
                        objectFit: 'cover',
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 84,
                        height: 84,
                        borderRadius: 10,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
                        {it.orderItem?.productTitle ?? 'Unknown item'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#111827', whiteSpace: 'nowrap' }}>
                        {fmtCurrency(lineTotal)}
                      </div>
                    </div>
                    {it.orderItem?.variantTitle && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {it.orderItem.variantTitle}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                      Qty <strong style={{ color: '#374151' }}>{it.quantity}</strong>
                      {it.orderItem?.unitPrice != null && (
                        <> · Unit {fmtCurrency(it.orderItem.unitPrice)}</>
                      )}
                      {it.orderItem?.sku && (
                        <> · SKU <code style={{ fontFamily: 'monospace' }}>{it.orderItem.sku}</code></>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: '#fef9c3',
                        borderLeft: '3px solid #eab308',
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#713f12', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Reason · {reasonLabel}
                      </div>
                      {it.reasonDetail && (
                        <div style={{ fontSize: 13, color: '#422006', marginTop: 4 }}>
                          {it.reasonDetail}
                        </div>
                      )}
                    </div>

                    {it.qcOutcome && (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: qcPillBg(it.qcOutcome),
                          color: qcPillColor(it.qcOutcome),
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        QC {it.qcOutcome} · {it.qcQuantityApproved ?? 0} of {it.quantity} approved
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {data.customerNotes && (
            <div style={{ padding: '14px 20px', background: '#eff6ff', borderTop: '1px solid #dbeafe' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Customer Notes
              </div>
              <div style={{ fontSize: 13, color: '#1e40af' }}>{data.customerNotes}</div>
            </div>
          )}

          {data.rejectionReason && (
            <div style={{ padding: '14px 20px', background: '#fee2e2', borderTop: '1px solid #fecaca' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Rejection Reason
              </div>
              <div style={{ fontSize: 13, color: '#7f1d1d' }}>{data.rejectionReason}</div>
            </div>
          )}
        </div>

        {/* Right: Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Refund card — moved to top, visually prominent */}
          {(() => {
            const locked = data.refundAmount != null && data.refundAmount !== '';
            let computed = 0;
            for (const it of data.items) {
              const unit = Number(it.orderItem?.unitPrice ?? 0);
              const qty = Number(it.qcQuantityApproved ?? it.quantity ?? 0);
              computed += unit * qty;
            }
            const displayAmount = locked ? Number(data.refundAmount) : computed;
            const refunded = ['REFUNDED', 'COMPLETED'].includes(data.status);
            return (
              <div
                style={{
                  ...cardStyleV2,
                  background: refunded
                    ? 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)'
                    : 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                  border: refunded ? '1px solid #34d399' : '1px solid #bae6fd',
                  padding: 20,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: refunded ? '#065f46' : '#075985',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 6,
                  }}
                >
                  {refunded ? 'Refund Paid' : locked ? 'Refund Amount' : 'Expected Refund'}
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: refunded ? '#064e3b' : '#0c4a6e', lineHeight: 1.1 }}>
                  {displayAmount > 0 ? fmtCurrency(displayAmount) : '--'}
                </div>
                <div style={{ marginTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12, fontSize: 12 }}>
                  <Row label="Method" value={data.refundMethod ?? '--'} />
                  <Row label="Reference" value={data.refundReference ?? '--'} />
                  <Row label="QC Decision" value={data.qcDecision ?? '--'} />
                  {(data.refundAttempts ?? 0) > 0 && (
                    <Row label="Attempts" value={String(data.refundAttempts)} />
                  )}
                </div>
                {data.refundFailureReason && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 10px',
                      background: '#fee2e2',
                      border: '1px solid #fecaca',
                      borderRadius: 6,
                      fontSize: 11,
                      color: '#991b1b',
                    }}
                  >
                    <strong>Last failure:</strong> {data.refundFailureReason}
                  </div>
                )}
              </div>
            );
          })()}

          <div style={cardStyleV2}>
            <div style={cardHeaderV2}>Customer</div>
            <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #2563eb)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {customerName()
                  .split(' ')
                  .filter(Boolean)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{customerName()}</div>
                {data.customer?.email && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {data.customer.email}
                  </div>
                )}
                {data.customer?.phone && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{data.customer.phone}</div>
                )}
              </div>
            </div>
          </div>

          <div style={cardStyleV2}>
            <div style={cardHeaderV2}>Timeline</div>
            <div style={{ padding: 16 }}>
              {(() => {
                const historyByStatus = new Map<string, string>();
                for (const h of [...(data.statusHistory ?? [])].sort(
                  (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                )) {
                  if (!historyByStatus.has(h.toStatus)) {
                    historyByStatus.set(h.toStatus, h.createdAt);
                  }
                }

                const milestones: Array<{ label: string; at?: string | null }> = [
                  { label: 'Created', at: data.createdAt },
                  { label: 'Approved', at: historyByStatus.get('APPROVED') },
                  { label: 'Rejected', at: historyByStatus.get('REJECTED') },
                  { label: 'Pickup Scheduled', at: data.pickupScheduledAt ?? historyByStatus.get('PICKUP_SCHEDULED') },
                  { label: 'In Transit', at: historyByStatus.get('IN_TRANSIT') },
                  { label: 'Received', at: data.receivedAt ?? historyByStatus.get('RECEIVED') },
                  { label: 'QC Completed', at: historyByStatus.get('QC_APPROVED') ?? historyByStatus.get('QC_REJECTED') ?? historyByStatus.get('PARTIALLY_APPROVED') },
                  { label: 'Refund Processing', at: historyByStatus.get('REFUND_PROCESSING') },
                  { label: 'Refunded', at: data.refundProcessedAt ?? historyByStatus.get('REFUNDED') },
                  { label: 'Completed', at: historyByStatus.get('COMPLETED') },
                  { label: 'Closed', at: data.closedAt },
                ].filter((m) => m.at);

                if (milestones.length === 0) {
                  return <div style={{ color: '#9ca3af', fontSize: 12 }}>No timeline events yet.</div>;
                }
                return (
                  <div style={{ position: 'relative', paddingLeft: 20 }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: 5,
                        top: 6,
                        bottom: 6,
                        width: 2,
                        background: '#e5e7eb',
                      }}
                    />
                    {milestones.map((m, i) => (
                      <div
                        key={m.label}
                        style={{ position: 'relative', paddingBottom: i === milestones.length - 1 ? 0 : 14 }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: -20,
                            top: 3,
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: i === milestones.length - 1 ? '#2563eb' : '#10b981',
                            border: '2px solid #fff',
                            boxShadow: '0 0 0 2px #e5e7eb',
                          }}
                        />
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{m.label}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{fmtDT(m.at)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {qcOpen && (
            <ModalShell onClose={() => !busy && setQcOpen(false)} width={620} title="Submit QC Decision">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Decide the outcome for each returned item. Approved quantity drives the refund amount.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
                {qcRows.map((row, idx) => {
                  const item = data.items.find((it) => it.id === row.returnItemId);
                  return (
                    <div
                      key={row.returnItemId}
                      style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                        {item?.orderItem?.productTitle ?? 'Item'} · Qty {item?.quantity ?? 0}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Outcome</label>
                          <select
                            value={row.qcOutcome}
                            onChange={(e) => {
                              const val = e.target.value as QcOutcome;
                              setQcRows((prev) => prev.map((r, i) =>
                                i === idx
                                  ? {
                                      ...r,
                                      qcOutcome: val,
                                      qcQuantityApproved:
                                        val === 'REJECTED' || val === 'DAMAGED'
                                          ? 0
                                          : val === 'APPROVED'
                                            ? (item?.quantity ?? r.qcQuantityApproved)
                                            : r.qcQuantityApproved,
                                    }
                                  : r,
                              ));
                            }}
                            style={{ ...qcInputStyle, marginTop: 2 }}
                          >
                            <option value="APPROVED">Approved</option>
                            <option value="PARTIAL">Partial</option>
                            <option value="REJECTED">Rejected</option>
                            <option value="DAMAGED">Damaged</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Approved Qty</label>
                          <input
                            type="number"
                            min={0}
                            max={item?.quantity ?? 0}
                            disabled={row.qcOutcome === 'REJECTED' || row.qcOutcome === 'DAMAGED'}
                            value={row.qcQuantityApproved}
                            onChange={(e) => {
                              const n = Math.max(0, Math.min(item?.quantity ?? 0, Number(e.target.value) || 0));
                              setQcRows((prev) => prev.map((r, i) => (i === idx ? { ...r, qcQuantityApproved: n } : r)));
                            }}
                            style={{ ...qcInputStyle, marginTop: 2 }}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <label
                          style={{
                            fontSize: 11,
                            color:
                              (row.qcOutcome === 'REJECTED' || row.qcOutcome === 'DAMAGED')
                                ? '#b91c1c'
                                : '#6b7280',
                            fontWeight: 600,
                          }}
                        >
                          {row.qcOutcome === 'REJECTED' || row.qcOutcome === 'DAMAGED'
                            ? 'Reason (required, min 15 chars — customer will see this)'
                            : 'Notes (optional)'}
                        </label>
                        <input
                          type="text"
                          value={row.qcNotes}
                          onChange={(e) =>
                            setQcRows((prev) => prev.map((r, i) => (i === idx ? { ...r, qcNotes: e.target.value } : r)))
                          }
                          placeholder="Inspection notes (optional)"
                          style={{ ...qcInputStyle, marginTop: 2 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Overall notes (optional)</label>
                <textarea
                  value={qcOverallNotes}
                  onChange={(e) => setQcOverallNotes(e.target.value)}
                  rows={2}
                  style={{ ...qcInputStyle, marginTop: 2, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
              <ModalFooter
                onCancel={() => !busy && setQcOpen(false)}
                onSubmit={submitQc}
                busy={busy}
                submitLabel="Submit QC"
              />
            </ModalShell>
          )}

          {initiateOpen && (
            <ModalShell onClose={() => !busy && setInitiateOpen(false)} width={440} title="Initiate Refund">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Choose how the refund will be paid to the customer.
              </div>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Refund method</label>
              <select
                value={refundMethodSel}
                onChange={(e) => setRefundMethodSel(e.target.value)}
                style={{ ...qcInputStyle, marginTop: 4 }}
              >
                <option value="ORIGINAL_PAYMENT">Original Payment</option>
                <option value="WALLET">Wallet</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CASH">Cash</option>
              </select>
              <ModalFooter
                onCancel={() => !busy && setInitiateOpen(false)}
                onSubmit={submitInitiateRefund}
                busy={busy}
                submitLabel="Initiate"
              />
            </ModalShell>
          )}

          {confirmOpen && (
            <ModalShell onClose={() => !busy && setConfirmOpen(false)} width={440} title="Confirm Refund">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Record the payout so the refund is marked complete.
              </div>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                Refund reference (UTR / gateway id)
              </label>
              <input
                type="text"
                autoFocus
                value={refundRefInput}
                onChange={(e) => setRefundRefInput(e.target.value)}
                placeholder="e.g. UTR123456789"
                style={{ ...qcInputStyle, marginTop: 4 }}
              />
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 10, display: 'block' }}>
                Notes (optional)
              </label>
              <textarea
                value={confirmNotes}
                onChange={(e) => setConfirmNotes(e.target.value)}
                rows={2}
                style={{ ...qcInputStyle, marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <ModalFooter
                onCancel={() => !busy && setConfirmOpen(false)}
                onSubmit={submitConfirmRefund}
                busy={busy}
                submitLabel="Confirm"
                disabled={!refundRefInput.trim()}
              />
            </ModalShell>
          )}

          {failOpen && (
            <ModalShell onClose={() => !busy && setFailOpen(false)} width={440} title="Mark Refund Failed">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Record why the refund attempt failed. Admin can retry after fixing the issue.
              </div>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Failure reason</label>
              <textarea
                autoFocus
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                rows={3}
                placeholder="e.g. Gateway declined — insufficient balance"
                style={{ ...qcInputStyle, marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <ModalFooter
                onCancel={() => !busy && setFailOpen(false)}
                onSubmit={submitMarkFailed}
                busy={busy}
                submitLabel="Mark Failed"
                disabled={!failReason.trim()}
                danger
              />
            </ModalShell>
          )}

          {galleryOpen && (() => {
            const customerPhotos = (data.evidence ?? []).filter((e) => e.uploadedBy === 'CUSTOMER');
            if (customerPhotos.length === 0) return null;
            const cur = customerPhotos[Math.min(galleryIdx, customerPhotos.length - 1)];
            const prev = () => setGalleryIdx((i) => (i - 1 + customerPhotos.length) % customerPhotos.length);
            const next = () => setGalleryIdx((i) => (i + 1) % customerPhotos.length);
            return (
              <div
                onClick={() => setGalleryOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') prev();
                  if (e.key === 'ArrowRight') next();
                  if (e.key === 'Escape') setGalleryOpen(false);
                }}
                tabIndex={-1}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1100,
                  padding: 24,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: '#fff',
                    fontSize: 13,
                    marginBottom: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    Photo {Math.min(galleryIdx, customerPhotos.length - 1) + 1} of {customerPhotos.length}
                  </span>
                  <button
                    onClick={() => setGalleryOpen(false)}
                    style={{
                      padding: '6px 14px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      color: '#fff',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Close (Esc)
                  </button>
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    maxWidth: '100%',
                    maxHeight: '75vh',
                  }}
                >
                  {customerPhotos.length > 1 && (
                    <button
                      onClick={prev}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: 20,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      aria-label="Previous"
                    >
                      ‹
                    </button>
                  )}
                  <img
                    src={cur.fileUrl}
                    alt=""
                    style={{
                      maxWidth: 'min(1100px, 85vw)',
                      maxHeight: '75vh',
                      borderRadius: 10,
                      background: '#000',
                      objectFit: 'contain',
                    }}
                  />
                  {customerPhotos.length > 1 && (
                    <button
                      onClick={next}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: 20,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      aria-label="Next"
                    >
                      ›
                    </button>
                  )}
                </div>

                {cur.description && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: '#e5e7eb',
                      fontSize: 13,
                      marginTop: 14,
                      textAlign: 'center',
                      maxWidth: 700,
                    }}
                  >
                    {cur.description}
                  </div>
                )}

                {/* Action shortcuts from inside the gallery — lets admin
                    decide without closing the lightbox. Only visible when
                    the return is still awaiting a decision. */}
                {isRequested && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      gap: 10,
                      marginTop: 20,
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      onClick={() => { setGalleryOpen(false); handleApprove(); }}
                      disabled={busy}
                      style={{
                        padding: '9px 18px',
                        fontSize: 13,
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: 8,
                        background: '#16a34a',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      Approve &amp; Schedule Pickup
                    </button>
                    <button
                      onClick={() => { setGalleryOpen(false); setRejectOpen(true); }}
                      disabled={busy}
                      style={{
                        padding: '9px 18px',
                        fontSize: 13,
                        fontWeight: 600,
                        border: '1px solid #fecaca',
                        borderRadius: 8,
                        background: '#fff',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      Reject — No Pickup
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {rejectOpen && (
            <div
              onClick={() => !busy && setRejectOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: 24,
                  width: 440,
                  maxWidth: '90vw',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                  {data.status === 'APPROVED' || data.status === 'PICKUP_SCHEDULED'
                    ? 'Cancel & Reject Return'
                    : 'Reject Return — No Pickup'}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#991b1b',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 6,
                    padding: '8px 10px',
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {data.status === 'APPROVED' || data.status === 'PICKUP_SCHEDULED' ? (
                    <>
                      <strong>This cancels the return.</strong> Any pickup scheduled will
                      be aborted. The customer keeps the item and receives no refund.
                      Seller's commission will be reinstated (PENDING). Use this when
                      the system auto-approved but manual review finds the claim
                      invalid.
                    </>
                  ) : (
                    <>
                      <strong>This skips pickup entirely.</strong> Only use this when the
                      customer's photos clearly show the item is used/damaged and the
                      claim is invalid. The customer keeps the item and receives no
                      refund. If you're unsure, close this and use{' '}
                      <strong>Approve &amp; Schedule Pickup</strong> instead so the item
                      comes to the warehouse for QC.
                    </>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 8, fontWeight: 600 }}>
                  Reason shown to the customer
                </div>
                <textarea
                  autoFocus
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="e.g. Photos show item has been used — soles are worn, tags removed."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                  <button
                    onClick={() => {
                      setRejectOpen(false);
                      setRejectReason('');
                    }}
                    disabled={busy}
                    style={{
                      padding: '8px 18px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      background: '#fff',
                      color: '#374151',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReject}
                    disabled={busy || !rejectReason.trim()}
                    style={{
                      padding: '8px 18px',
                      border: 'none',
                      borderRadius: 6,
                      background: '#dc2626',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: busy || !rejectReason.trim() ? 'not-allowed' : 'pointer',
                      opacity: busy || !rejectReason.trim() ? 0.6 : 1,
                    }}
                  >
                    {busy ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {data.statusHistory && data.statusHistory.length > 0 && (
            <div style={cardStyleV2}>
              <div style={cardHeaderV2}>
                <span>Status History</span>
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
                  {data.statusHistory.length} event{data.statusHistory.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ position: 'relative', paddingLeft: 20 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 5,
                      top: 6,
                      bottom: 6,
                      width: 2,
                      background: '#e5e7eb',
                    }}
                  />
                  {data.statusHistory.map((h, i) => {
                    const c = STATUS_COLORS[h.toStatus] || { bg: '#f3f4f6', color: '#374151' };
                    return (
                      <div
                        key={h.id}
                        style={{ position: 'relative', paddingBottom: i === data.statusHistory.length - 1 ? 0 : 14 }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: -20,
                            top: 3,
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: c.color,
                            border: '2px solid #fff',
                            boxShadow: '0 0 0 2px #e5e7eb',
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {h.fromStatus && (
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>
                              {h.fromStatus
                                .toLowerCase()
                                .replace(/_/g, ' ')
                                .replace(/\b\w/g, (ch) => ch.toUpperCase())}{' '}
                              →
                            </span>
                          )}
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: c.bg,
                              color: c.color,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {h.toStatus
                              .toLowerCase()
                              .replace(/_/g, ' ')
                              .replace(/\b\w/g, (ch) => ch.toUpperCase())}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
                          {fmtDT(h.createdAt)} · by <strong>{h.changedBy}</strong>
                        </div>
                        {h.notes && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              color: '#4b5563',
                              background: '#f9fafb',
                              padding: '6px 8px',
                              borderRadius: 4,
                            }}
                          >
                            {h.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: 500, color: '#111827' }}>{value}</span>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  overflow: 'hidden',
};

const cardHeader: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  background: '#fafbfc',
};

const cardStyleV2: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const cardHeaderV2: React.CSSProperties = {
  padding: '14px 20px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 13,
  fontWeight: 700,
  color: '#111827',
  background: '#fff',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  letterSpacing: '-0.01em',
};

function qcPillBg(outcome: string): string {
  switch (outcome) {
    case 'APPROVED': return '#d1fae5';
    case 'PARTIAL': return '#fef3c7';
    case 'REJECTED': return '#fee2e2';
    case 'DAMAGED': return '#fee2e2';
    default: return '#f3f4f6';
  }
}

function qcPillColor(outcome: string): string {
  switch (outcome) {
    case 'APPROVED': return '#065f46';
    case 'PARTIAL': return '#92400e';
    case 'REJECTED': return '#991b1b';
    case 'DAMAGED': return '#991b1b';
    default: return '#374151';
  }
}

const PROGRESS_STEPS: Array<{ label: string; matchesStatuses: string[] }> = [
  { label: 'Requested', matchesStatuses: ['REQUESTED'] },
  { label: 'Approved', matchesStatuses: ['APPROVED', 'PICKUP_SCHEDULED'] },
  { label: 'In Transit', matchesStatuses: ['IN_TRANSIT'] },
  { label: 'Received', matchesStatuses: ['RECEIVED'] },
  { label: 'QC', matchesStatuses: ['QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED'] },
  { label: 'Refund', matchesStatuses: ['REFUND_PROCESSING', 'REFUNDED'] },
  { label: 'Done', matchesStatuses: ['COMPLETED'] },
];

function ProgressStepper({ status }: { status: string }) {
  const isRejected = status === 'REJECTED' || status === 'CANCELLED';

  let activeIdx = PROGRESS_STEPS.findIndex((s) => s.matchesStatuses.includes(status));
  if (activeIdx === -1) activeIdx = 0;

  if (isRejected) {
    return (
      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 12,
          padding: '14px 20px',
          marginBottom: 20,
          color: '#991b1b',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        This return was {status === 'REJECTED' ? 'rejected' : 'cancelled'} — no further stages will run.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 20,
        overflowX: 'auto',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {PROGRESS_STEPS.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        const bg = done ? '#10b981' : active ? '#2563eb' : '#e5e7eb';
        const color = done || active ? '#fff' : '#6b7280';
        return (
          <div key={step.label} style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: bg,
                  color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#2563eb' : done ? '#065f46' : '#6b7280',
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {step.label}
              </div>
            </div>
            {i < PROGRESS_STEPS.length - 1 && (
              <div
                style={{
                  height: 2,
                  background: i < activeIdx ? '#10b981' : '#e5e7eb',
                  width: 32,
                  marginTop: -16,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const approveBtn: React.CSSProperties = {
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 8,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(37,99,235,0.3)',
  transition: 'background 0.15s',
};

const rejectBtn: React.CSSProperties = {
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #fecaca',
  borderRadius: 8,
  background: '#fff',
  color: '#dc2626',
  cursor: 'pointer',
};

const qcInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  boxSizing: 'border-box',
  background: '#fff',
  outline: 'none',
};

function ModalShell({
  onClose,
  title,
  width = 440,
  children,
}: {
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 10,
          padding: 24,
          width,
          maxWidth: '90vw',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSubmit,
  busy,
  submitLabel,
  disabled,
  danger,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  submitLabel: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const isDisabled = busy || !!disabled;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
      <button
        onClick={onCancel}
        disabled={busy}
        style={{
          padding: '8px 18px',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          background: '#fff',
          color: '#374151',
          fontWeight: 600,
          fontSize: 13,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={isDisabled}
        style={{
          padding: '8px 18px',
          border: 'none',
          borderRadius: 6,
          background: danger ? '#dc2626' : '#2563eb',
          color: '#fff',
          fontWeight: 600,
          fontSize: 13,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.6 : 1,
        }}
      >
        {busy ? 'Working…' : submitLabel}
      </button>
    </div>
  );
}
