'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';
import {
  adminReturnsService,
  ReturnDetail,
  QcOutcome,
  LiabilityParty,
  CustomerRemedy,
} from '@/services/admin-returns.service';
import CaseTimeline from '@/components/CaseTimeline';

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
  const [qcLiabilityParty, setQcLiabilityParty] = useState<LiabilityParty | ''>('');
  const [qcCustomerRemedy, setQcCustomerRemedy] = useState<CustomerRemedy | ''>('');

  // Initiate Refund modal — returns always credit the wallet, so no
  // method-picker state is needed; the modal just confirms the amount.
  const [initiateOpen, setInitiateOpen] = useState(false);

  // Shipment evidence (proof-of-dispatch photos uploaded by the seller
  // at packing time). Surfaced here so the admin has the as-shipped
  // baseline when comparing against the customer's claim photos at
  // the REQUESTED stage. Loaded by sub-order ID once the return data
  // is in hand.
  const [shipmentEvidence, setShipmentEvidence] = useState<
    Array<{
      id: string;
      // viewUrl is enriched server-side because SHIPMENT_EVIDENCE
      // is PRIVATE and providerUrl is null in the DB.
      viewUrl?: string;
      file: { id: string; fileName: string; providerUrl?: string | null };
    }>
  >([]);

  // Confirm Refund modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refundRefInput, setRefundRefInput] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');

  // Mark Refund Failed modal
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');

  // Schedule Pickup modal — APPROVED → PICKUP_SCHEDULED. The "Approve &
  // Schedule Pickup" button label on the REQUESTED step is misleading
  // — backend's `approveReturn` only flips to APPROVED. Pickup scheduling
  // is a separate call. Without this UI an APPROVED return has nowhere
  // to go from the admin side and stalls the lifecycle.
  const [pickupOpen, setPickupOpen] = useState(false);
  const [pickupAt, setPickupAt] = useState('');
  const [pickupCourier, setPickupCourier] = useState('');
  const [pickupTracking, setPickupTracking] = useState('');

  // Mark In Transit modal — PICKUP_SCHEDULED → IN_TRANSIT. Tracking
  // number is optional (the courier integration may set it
  // out-of-band).
  const [inTransitOpen, setInTransitOpen] = useState(false);
  const [inTransitTracking, setInTransitTracking] = useState('');

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

  // Once we know the return's sub-order, pull the seller's pre-ship
  // photos. Independent of the main return fetch so a missing/empty
  // evidence list doesn't fail the page.
  useEffect(() => {
    if (!data?.subOrderId) return;
    apiClient<typeof shipmentEvidence>(
      `/admin/sub-orders/${data.subOrderId}/shipment-evidence`,
    )
      .then((res) => {
        if (Array.isArray(res.data)) setShipmentEvidence(res.data);
      })
      .catch(() => {
        setShipmentEvidence([]);
      });
  }, [data?.subOrderId]);

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

  const submitPickup = async () => {
    if (!pickupAt) {
      void notify('Pickup date is required');
      return;
    }
    setBusy(true);
    try {
      const res = await adminReturnsService.schedulePickup(returnId, {
        pickupScheduledAt: new Date(pickupAt).toISOString(),
        pickupCourier: pickupCourier.trim() || undefined,
        pickupTrackingNumber: pickupTracking.trim() || undefined,
      });
      if (res.success) {
        void notify('Pickup scheduled');
        setPickupOpen(false);
        setPickupAt('');
        setPickupCourier('');
        setPickupTracking('');
        load();
      } else {
        void notify(res.message || 'Failed to schedule pickup');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to schedule pickup');
    } finally {
      setBusy(false);
    }
  };

  const submitInTransit = async () => {
    setBusy(true);
    try {
      const res = await adminReturnsService.markInTransit(
        returnId,
        inTransitTracking.trim() || undefined,
      );
      if (res.success) {
        void notify('Return marked in transit');
        setInTransitOpen(false);
        setInTransitTracking('');
        load();
      } else {
        void notify(res.message || 'Failed to mark in transit');
      }
    } catch (e: any) {
      void notify(e?.body?.message || e?.message || 'Failed to mark in transit');
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
    // Suggest a liability default from the seller's own response so the
    // common case ("seller accepted fault") is one click. Admin can
    // always override before submitting.
    setQcLiabilityParty(
      data.sellerResponseStatus === 'ACCEPTED' ? 'SELLER' : '',
    );
    // Default remedy to FULL_REFUND since the per-item rows initialise
    // every item to APPROVED. The submit-time validator will recompute
    // a guard against mismatches (e.g. all rejected → NO_REFUND).
    setQcCustomerRemedy('FULL_REFUND');
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
    // Liability + remedy are required when at least one item is
    // approved/partial — that's when money or goods leave the platform
    // and the ledger needs an attribution. Pure-rejection paths can
    // skip them since nothing is owed.
    const anyApproved = qcRows.some(
      (r) => r.qcOutcome === 'APPROVED' || r.qcOutcome === 'PARTIAL',
    );
    if (anyApproved) {
      if (!qcLiabilityParty) {
        void notify('Pick a liability party — who absorbs the cost of this refund/replacement.');
        return;
      }
      if (!qcCustomerRemedy) {
        void notify('Pick a customer remedy — how the customer is made whole.');
        return;
      }
      if (qcCustomerRemedy === 'NO_REFUND') {
        void notify('NO_REFUND only applies when all items are rejected. Pick another remedy.');
        return;
      }
    } else if (qcCustomerRemedy && qcCustomerRemedy !== 'NO_REFUND') {
      void notify('All items rejected — remedy must be NO_REFUND (or leave it blank).');
      return;
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
        liabilityParty: qcLiabilityParty || undefined,
        customerRemedy: qcCustomerRemedy || undefined,
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
      // Returns always credit the wallet — see ReturnService.initiateRefund.
      // The backend ignores any other value passed here, but we send WALLET
      // explicitly so the request shape stays self-documenting.
      const res = await adminReturnsService.initiateRefund(returnId, 'WALLET');
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
  // Phase-after-Phase-9 fix — APPROVED has no path forward without
  // scheduling a pickup; PICKUP_SCHEDULED has both "in transit" and
  // "received" paths (the courier-skip shortcut keeps Mark Received
  // available too). Adding these flags is what stopped APPROVED returns
  // from appearing as "no actions available" in the admin UI.
  const canSchedulePickup = data.status === 'APPROVED';
  const canMarkInTransit = data.status === 'PICKUP_SCHEDULED';
  const canMarkReceived = ['IN_TRANSIT', 'PICKUP_SCHEDULED'].includes(data.status);
  const canRunQc = data.status === 'RECEIVED';
  // Wallet-only policy: the entire payout pipeline is automated through
  // Finance Approvals (RefundInstruction → approve → wallet credit), so
  // the manual Initiate / Confirm / Mark-Failed / Retry buttons would
  // race that flow. Hide them when the refund is going to the wallet
  // (default when method is unset). Non-wallet methods still need the
  // manual gateway-reference workflow, so keep the buttons for those.
  const isWalletRefund = !data.refundMethod || data.refundMethod === 'WALLET';
  const canInitiateRefund = !isWalletRefund && ['QC_APPROVED', 'PARTIALLY_APPROVED'].includes(data.status);
  const canConfirmOrFail = !isWalletRefund && data.status === 'REFUND_PROCESSING';
  const canRetryRefund = !isWalletRefund && data.status === 'REFUND_PROCESSING' && (data.refundAttempts ?? 0) > 0;
  const inWalletRefundFlow =
    isWalletRefund &&
    ['QC_APPROVED', 'PARTIALLY_APPROVED', 'REFUND_PROCESSING'].includes(data.status);
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
    <div style={{ padding: '24px 32px', maxWidth: 1320, margin: '0 auto', background: '#f8fafc', minHeight: 'calc(100vh - 56px)' }}>
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
        {canSchedulePickup && (
          <button onClick={() => setPickupOpen(true)} disabled={busy} style={approveBtn}>
            Schedule Pickup
          </button>
        )}
        {canMarkInTransit && (
          <button onClick={() => setInTransitOpen(true)} disabled={busy} style={approveBtn}>
            Mark In Transit
          </button>
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
        {inWalletRefundFlow && (
          <div
            style={{
              padding: '10px 12px',
              border: '1px solid #c7d2fe',
              background: '#eef2ff',
              borderRadius: 8,
              color: '#3730a3',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Wallet refund — no manual action needed here. The refund
            instruction is queued under{' '}
            <Link href="/dashboard/finance" style={{ color: '#3730a3', fontWeight: 600 }}>
              Finance Approvals
            </Link>
            ; once finance approves it the customer&rsquo;s wallet is
            credited automatically and the return moves to Refunded.
          </div>
        )}
        {!isRequested &&
          !canSchedulePickup &&
          !canMarkInTransit &&
          !canMarkReceived &&
          !canRunQc &&
          !canInitiateRefund &&
          !canConfirmOrFail &&
          !canRetryRefund &&
          !canClose &&
          !inWalletRefundFlow && (
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

              {/* Side-by-side comparison: the product as it was sold vs.
                  what the customer is showing. At the REQUESTED stage
                  there's no warehouse photo yet, so the admin has to
                  decide off the customer claim alone — surfacing the
                  expected product image next to the customer's photo
                  catches the obvious "wrong product" / "wrong size"
                  fraud cases in a single glance, before any pickup is
                  paid for. */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                {data.items.slice(0, 3).map((it) =>
                  it.orderItem?.imageUrl ? (
                    <div key={`expected-${it.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#047857',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                          <path d="m3.3 7 8.7 5 8.7-5" />
                          <path d="M12 22V12" />
                        </svg>
                        Product as sold
                      </div>
                      <div
                        style={{
                          width: 128,
                          height: 128,
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: '1px solid #d1fae5',
                          boxShadow: 'inset 0 0 0 1px #ecfdf5',
                          background: '#f3f4f6',
                          position: 'relative',
                        }}
                        title={it.orderItem.productTitle ?? 'Product image'}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#9ca3af',
                          }}
                        >
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="m21 15-5-5L5 21" />
                          </svg>
                        </div>
                        <img
                          src={it.orderItem.imageUrl}
                          alt={it.orderItem.productTitle ?? 'Product'}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#047857',
                          maxWidth: 128,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.orderItem.productTitle ?? '—'}
                      </div>
                    </div>
                  ) : null,
                )}
                {customerPhotos.map((ev, i) => (
                  <div key={ev.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#4338ca',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                        <circle cx="12" cy="13" r="3" />
                      </svg>
                      Customer claim
                    </div>
                    <button
                      onClick={() => { setGalleryIdx(i); setGalleryOpen(true); }}
                      style={{
                        width: 128,
                        height: 128,
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid #c7d2fe',
                        boxShadow: 'inset 0 0 0 1px #eef2ff',
                        padding: 0,
                        cursor: 'pointer',
                        background: '#f3f4f6',
                      }}
                      title={`Open photo ${i + 1} in full view`}
                    >
                      <img
                        src={ev.fileUrl}
                        alt={`Customer evidence ${i + 1}`}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                    <div style={{ fontSize: 10, color: '#3730a3' }}>
                      Photo {i + 1} of {customerPhotos.length}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick-scan checklist — turns "stare at the photos" into
                  a structured comparison the admin can answer in 10s. */}
              <div
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: '#374151',
                  marginBottom: 12,
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#111827' }}>
                  Quick comparison checklist
                </div>
                <ol style={{ margin: 0, paddingLeft: 16 }}>
                  {shipmentEvidence.length > 0 && (
                    <li>
                      Does the customer photo <strong>differ from the seller&apos;s
                      pre-ship photos</strong> below? Look for new damage / different item.
                    </li>
                  )}
                  <li>Does the customer photo show the <strong>same product</strong> we sold? (model, brand, colour)</li>
                  <li>Is the reported issue (<em>{data.items[0]?.reasonCategory?.replace(/_/g, ' ').toLowerCase() ?? '—'}</em>) <strong>visible</strong> in the photo?</li>
                  <li>Are there signs the damage happened <strong>after delivery</strong> (use marks, missing tags, dirt)?</li>
                </ol>
                <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
                  Two or more "no"s → <strong>Reject Return</strong>. Any "unsure" → <strong>Approve &amp; Schedule Pickup</strong> for in-person QC at the warehouse — that&apos;s the safer call when the photo is ambiguous.
                  {shipmentEvidence.length === 0 && (
                    <>
                      {' '}<em>(No pre-ship photos on file for this order — checklist
                      starts at item 1.)</em>
                    </>
                  )}
                </div>
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

      {/* Shipment Evidence card — pre-ship "proof of dispatch" photos
          uploaded by the seller before the order shipped. These are the
          as-shipped baseline; compare them against the Customer Evidence
          card (the customer's claim photos) to spot fake "damaged in
          transit" claims at the REQUESTED stage, before paying for a
          courier pickup. The seller's portal (web-d2c-seller / web-retail-seller) collects them
          on the order detail page. */}
      {shipmentEvidence.length > 0 && (
        <div style={{ ...cardStyleV2, marginBottom: 20, borderLeft: '4px solid #8b5cf6' }}>
          <div style={cardHeaderV2}>
            <span>Shipment Evidence (as shipped)</span>
            <span
              style={{
                padding: '2px 10px',
                borderRadius: 999,
                background: '#ede9fe',
                color: '#5b21b6',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {shipmentEvidence.length} photo
              {shipmentEvidence.length === 1 ? '' : 's'}
            </span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 10, lineHeight: 1.5 }}>
              Uploaded by the seller at packing time. Use these as the
              as-shipped baseline when comparing against the customer's
              claim photos above — anything visible here that isn't in
              the customer's photo (or vice versa) is a strong signal.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {shipmentEvidence.map((att, i) => {
                // PRIVATE files have providerUrl=null in the DB; the
                // admin shipment-evidence GET endpoint enriches each
                // attachment with a derived `viewUrl` so we can render
                // thumbnails. Falling back to providerUrl preserves
                // compat with PUBLIC-classified files.
                const url = att.viewUrl ?? att.file?.providerUrl ?? '';
                return (
                  <a
                    key={att.id}
                    href={url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Pre-ship photo ${i + 1} • opens in new tab`}
                    style={{
                      position: 'relative',
                      width: 120,
                      height: 120,
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: '2px solid #8b5cf6',
                      background: '#fff',
                      textDecoration: 'none',
                    }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={`Pre-ship evidence ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#6b7280',
                          fontSize: 11,
                        }}
                      >
                        {att.file?.fileName ?? 'file'}
                      </div>
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        left: 4,
                        bottom: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(91, 33, 182, 0.85)',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                      }}
                    >
                      Pre-ship
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Evidence card — photos uploaded by the seller /
          franchise / admin after the package arrived. The seller can
          contribute evidence but doesn't make the QC decision (admin
          does). Showing these photos here is what lets the admin
          inspect what arrived before clicking Submit QC Decision.
          Click a thumb to open the original in a new tab. */}
      {(() => {
        const warehousePhotos = (data.evidence ?? []).filter(
          (e) =>
            e.uploadedBy === 'SELLER' ||
            e.uploadedBy === 'FRANCHISE' ||
            e.uploadedBy === 'ADMIN',
        );
        if (warehousePhotos.length === 0) return null;
        return (
          <div style={{ ...cardStyleV2, marginBottom: 20, borderLeft: '4px solid #10b981' }}>
            <div style={cardHeaderV2}>
              <span>Warehouse Evidence</span>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: '#d1fae5',
                  color: '#065f46',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {warehousePhotos.length} photo
                {warehousePhotos.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  color: '#374151',
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                Photos contributed by the fulfillment node after the package
                arrived. Use these alongside the customer's evidence to decide
                the QC outcome.
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {warehousePhotos.map((ev, i) => {
                  const sourceLabel =
                    ev.uploadedBy === 'SELLER'
                      ? 'Seller'
                      : ev.uploadedBy === 'FRANCHISE'
                      ? 'Franchise'
                      : 'Admin';
                  return (
                    <a
                      key={ev.id}
                      href={ev.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${sourceLabel} upload • photo ${i + 1} • opens in new tab`}
                      style={{
                        position: 'relative',
                        width: 120,
                        height: 120,
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        textDecoration: 'none',
                      }}
                    >
                      <img
                        src={ev.fileUrl}
                        alt={`${sourceLabel} evidence ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          left: 4,
                          bottom: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(15, 23, 42, 0.78)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {sourceLabel}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Seller Response — surfaces the seller's accept/contest decision
          and free-text note so admin can weigh the seller's side before
          issuing a QC decision. Hidden until the seller has responded. */}
      {data.sellerResponseStatus && (
        <div
          style={{
            ...cardStyleV2,
            marginBottom: 20,
            borderLeft: `4px solid ${
              data.sellerResponseStatus === 'CONTESTED' ? '#dc2626' : '#16a34a'
            }`,
          }}
        >
          <div style={cardHeaderV2}>
            <span>Seller Response</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 999,
                background:
                  data.sellerResponseStatus === 'CONTESTED'
                    ? '#fee2e2'
                    : '#d1fae5',
                color:
                  data.sellerResponseStatus === 'CONTESTED'
                    ? '#991b1b'
                    : '#065f46',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {data.sellerResponseStatus === 'CONTESTED' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              {data.sellerResponseStatus === 'CONTESTED' ? 'Contested' : 'Accepted'}
            </span>
          </div>
          <div style={{ padding: 16 }}>
            {/* The seller's statement is the primary content — render it as a
                quote with a status-coloured accent, not an input-looking box. */}
            {data.sellerResponseNotes ? (
              <blockquote
                style={{
                  margin: 0,
                  background: '#f9fafb',
                  border: '1px solid #eef0f2',
                  borderLeft: `3px solid ${
                    data.sellerResponseStatus === 'CONTESTED' ? '#dc2626' : '#16a34a'
                  }`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: '#1f2937',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {data.sellerResponseNotes}
              </blockquote>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                The seller responded without leaving a note.
              </div>
            )}

            {/* Secondary metadata — small + muted, not competing with the note. */}
            <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
              Responded{' '}
              {data.sellerRespondedAt
                ? new Date(data.sellerRespondedAt).toLocaleString()
                : '—'}
            </div>

            {/* Actionable advisory for a contested claim — icon + tint so it
                reads as a callout and doesn't rely on colour alone. */}
            {data.sellerResponseStatus === 'CONTESTED' && (
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 10,
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.5 }}>
                  The seller is contesting this claim. Compare their notes and
                  pre-ship photos against the customer&rsquo;s evidence before
                  issuing a QC decision.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lifecycle progress — full-width horizontal stepper. Reads at a glance
          across the top instead of a tall vertical list squeezed into the side
          rail (which left the column beside it empty). */}
      {(() => {
        const historyByStatus = new Map<string, string>();
        for (const h of [...(data.statusHistory ?? [])].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )) {
          if (!historyByStatus.has(h.toStatus)) historyByStatus.set(h.toStatus, h.createdAt);
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
        if (milestones.length === 0) return null;
        return (
          <div style={{ ...cardStyleV2, marginBottom: 20 }}>
            <div style={cardHeaderV2}>Progress</div>
            <div style={{ padding: '22px 24px', overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'min-content' }}>
                {milestones.map((m, i) => {
                  const isLast = i === milestones.length - 1;
                  return (
                    <div
                      key={m.label}
                      style={{ flex: '1 0 116px', position: 'relative', textAlign: 'center', paddingInline: 4 }}
                    >
                      {!isLast && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 6,
                            left: '50%',
                            right: '-50%',
                            height: 2,
                            background: '#10b981',
                            zIndex: 0,
                          }}
                        />
                      )}
                      <div
                        style={{
                          position: 'relative',
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: isLast ? '#2563eb' : '#10b981',
                          margin: '0 auto',
                          border: '2px solid #fff',
                          boxShadow: '0 0 0 2px #e5e7eb',
                          zIndex: 1,
                        }}
                      />
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginTop: 10 }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{fmtDT(m.at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)', gap: 20, alignItems: 'start' }}>
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
                  <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0 }}>
                    {/* Placeholder sits behind the image; the <img> covers it
                        when it loads and hides itself onError — so a missing or
                        broken URL degrades to this glyph, never the browser's
                        broken-image icon. */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 10,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                      }}
                    >
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                    </div>
                    {it.orderItem?.imageUrl && (
                      <img
                        src={it.orderItem.imageUrl}
                        alt={it.orderItem?.productTitle ?? 'Returned item'}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                        style={{
                          position: 'relative',
                          display: 'block',
                          width: 84,
                          height: 84,
                          borderRadius: 10,
                          objectFit: 'cover',
                          border: '1px solid #e5e7eb',
                        }}
                      />
                    )}
                  </div>
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
                  background: refunded ? '#ecfdf5' : '#f0f9ff',
                  border: refunded ? '1px solid #6ee7b7' : '1px solid #bae6fd',
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

          {qcOpen && (
            <ModalShell onClose={() => !busy && setQcOpen(false)} width={620} title="Submit QC Decision">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Decide the outcome for each returned item. Approved quantity drives the refund amount.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
                {qcRows.map((row, idx) => {
                  const item = data.items.find((it) => it.id === row.returnItemId);
                  // Phase C (P0.2) — refund preview math. Look up the
                  // tax snapshot for this item; if none exists, the
                  // order is legacy and the preview shows the gross
                  // calculation only.
                  const orderItemId = (item as any)?.orderItemId ?? item?.orderItem?.id;
                  const snapshot = data.refundPreview?.taxSnapshots.find(
                    (s) => s.orderItemId === orderItemId,
                  );
                  const purchasedQty = item?.orderItem?.quantity ?? 0;
                  const approvedQty = row.qcQuantityApproved ?? 0;
                  const willRefund =
                    (row.qcOutcome === 'APPROVED' || row.qcOutcome === 'PARTIAL') &&
                    approvedQty > 0;
                  const preview = (() => {
                    if (!willRefund) return null;
                    if (!snapshot || purchasedQty === 0) return null;
                    const ratio = approvedQty / purchasedQty;
                    const gross = Number(snapshot.grossLineAmountInPaise) * ratio;
                    const discount = Number(snapshot.discountAmountInPaise) * ratio;
                    const taxable = Number(snapshot.taxableAmountInPaise) * ratio;
                    const cgst = Number(snapshot.cgstAmountInPaise) * ratio;
                    const sgst = Number(snapshot.sgstAmountInPaise) * ratio;
                    const igst = Number(snapshot.igstAmountInPaise) * ratio;
                    const totalTax = cgst + sgst + igst;
                    const refund = taxable + totalTax;
                    return { gross, discount, taxable, cgst, sgst, igst, totalTax, refund };
                  })();
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

                      {/* Phase C (P0.2) — discount-aware refund preview.
                          Recomputes live from the per-item tax snapshot
                          as admin adjusts the approved quantity.

                          Three states:
                            1. willRefund + snapshot → full preview with
                               GST split.
                            2. willRefund + no snapshot → legacy order;
                               show gross-only line.
                            3. !willRefund (REJECTED/DAMAGED/qty=0) →
                               "no refund" pill. */}
                      {willRefund && preview && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 10,
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: '#15803d',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              marginBottom: 6,
                            }}
                          >
                            Refund preview
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 4 }}>
                            <div style={{ color: '#374151' }}>Gross ({approvedQty}/{purchasedQty})</div>
                            <div style={{ textAlign: 'right' }}>₹{(preview.gross / 100).toFixed(2)}</div>
                            <div style={{ color: '#dc2626' }}>Allocated discount</div>
                            <div style={{ textAlign: 'right', color: '#dc2626' }}>−₹{(preview.discount / 100).toFixed(2)}</div>
                            <div style={{ color: '#374151', fontWeight: 600 }}>Net taxable refundable</div>
                            <div style={{ textAlign: 'right', fontWeight: 600 }}>₹{(preview.taxable / 100).toFixed(2)}</div>
                            {preview.totalTax > 0 && (
                              <>
                                <div style={{ color: '#6b7280' }}>
                                  GST reversal{preview.cgst > 0 ? ' (CGST + SGST)' : ' (IGST)'}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  +₹{(preview.totalTax / 100).toFixed(2)}
                                </div>
                              </>
                            )}
                            <div style={{ borderTop: '1px solid #bbf7d0', gridColumn: '1 / -1', marginTop: 4 }} />
                            <div style={{ color: '#15803d', fontWeight: 700 }}>
                              Total refund / credit note
                            </div>
                            <div
                              style={{
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#15803d',
                                fontSize: 13,
                              }}
                            >
                              ₹{(preview.refund / 100).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      )}
                      {willRefund && !preview && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            background: '#fef3c7',
                            border: '1px solid #fde68a',
                            borderRadius: 6,
                            fontSize: 11,
                            color: '#92400e',
                          }}
                        >
                          Legacy order — no per-item discount snapshot. Refund will use
                          gross unit price × {approvedQty} ={' '}
                          <strong>
                            ₹{((Number(item?.orderItem?.unitPrice ?? 0) || 0) * approvedQty).toFixed(2)}
                          </strong>
                        </div>
                      )}
                      {!willRefund && (
                        <div
                          style={{
                            marginTop: 10,
                            display: 'inline-block',
                            padding: '3px 10px',
                            background: '#f3f4f6',
                            color: '#374151',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          No refund
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#fafbfc',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 8,
                  }}
                >
                  Liability &amp; Remedy
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                      Liability Party
                    </label>
                    <select
                      value={qcLiabilityParty}
                      onChange={(e) =>
                        setQcLiabilityParty(e.target.value as LiabilityParty | '')
                      }
                      style={{ ...qcInputStyle, marginTop: 2 }}
                    >
                      <option value="">— Select —</option>
                      <option value="SELLER">Seller</option>
                      <option value="LOGISTICS">Logistics (courier)</option>
                      <option value="PLATFORM">Platform</option>
                      <option value="CUSTOMER">Customer</option>
                      <option value="FRANCHISE">Franchise</option>
                      <option value="BRAND">Brand</option>
                      <option value="INCONCLUSIVE">Inconclusive</option>
                      <option value="NONE">None</option>
                    </select>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                      Who absorbs the cost. Drives the ledger entry and seller chargeback.
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                      Customer Remedy
                    </label>
                    <select
                      value={qcCustomerRemedy}
                      onChange={(e) =>
                        setQcCustomerRemedy(e.target.value as CustomerRemedy | '')
                      }
                      style={{ ...qcInputStyle, marginTop: 2 }}
                    >
                      <option value="">— Select —</option>
                      <option value="FULL_REFUND">Full refund</option>
                      <option value="PARTIAL_REFUND">Partial refund</option>
                      <option value="NO_REFUND">No refund</option>
                      <option value="GOODWILL_CREDIT">Goodwill credit</option>
                      {/* REPLACEMENT / EXCHANGE options hidden — feature disabled in UI for now. */}
                      {/* <option value="REPLACEMENT">Replacement (same SKU)</option> */}
                      {/* <option value="EXCHANGE">Exchange (different SKU)</option> */}
                    </select>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                      How the customer is made whole.
                    </div>
                  </div>
                </div>
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

          {pickupOpen && (
            <ModalShell onClose={() => !busy && setPickupOpen(false)} width={440} title="Schedule Pickup">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Set the pickup date the courier will collect the item from the customer.
                Tracking and courier are optional and can be added later via the courier
                integration.
              </div>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                Pickup date &amp; time
              </label>
              <input
                type="datetime-local"
                autoFocus
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
                style={{ ...qcInputStyle, marginTop: 4 }}
              />
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 10, display: 'block' }}>
                Courier (optional)
              </label>
              <input
                type="text"
                value={pickupCourier}
                onChange={(e) => setPickupCourier(e.target.value)}
                placeholder="e.g. Delhivery"
                style={{ ...qcInputStyle, marginTop: 4 }}
              />
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 10, display: 'block' }}>
                Tracking number (optional)
              </label>
              <input
                type="text"
                value={pickupTracking}
                onChange={(e) => setPickupTracking(e.target.value)}
                placeholder="e.g. AWB1234567"
                style={{ ...qcInputStyle, marginTop: 4 }}
              />
              <ModalFooter
                onCancel={() => !busy && setPickupOpen(false)}
                onSubmit={submitPickup}
                busy={busy}
                submitLabel="Schedule"
                disabled={!pickupAt}
              />
            </ModalShell>
          )}

          {inTransitOpen && (
            <ModalShell onClose={() => !busy && setInTransitOpen(false)} width={420} title="Mark In Transit">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Confirm the courier has picked up the item. Tracking number is optional —
                add it now if you have it, or skip and let the courier-integration update
                it later.
              </div>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                Tracking number (optional)
              </label>
              <input
                type="text"
                autoFocus
                value={inTransitTracking}
                onChange={(e) => setInTransitTracking(e.target.value)}
                placeholder="e.g. AWB1234567"
                style={{ ...qcInputStyle, marginTop: 4 }}
              />
              <ModalFooter
                onCancel={() => !busy && setInTransitOpen(false)}
                onSubmit={submitInTransit}
                busy={busy}
                submitLabel="Mark In Transit"
              />
            </ModalShell>
          )}

          {initiateOpen && (
            <ModalShell onClose={() => !busy && setInitiateOpen(false)} width={440} title="Initiate Refund">
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Returns are refunded directly to the customer's Sportsmart
                wallet. The credit settles synchronously — no gateway round-trip,
                no UTR to record. The customer can then spend the wallet balance
                on their next purchase or request a wallet-to-bank transfer
                from their account.
              </div>
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #10b981',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 13,
                  color: '#065f46',
                  marginBottom: 4,
                }}
              >
                <strong>Method: Wallet credit</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Amount {fmtCurrency(Number(data.refundAmount ?? 0))} will be credited
                  to {customerName()}&apos;s wallet on confirm.
                </div>
              </div>
              <ModalFooter
                onCancel={() => !busy && setInitiateOpen(false)}
                onSubmit={submitInitiateRefund}
                busy={busy}
                submitLabel="Credit wallet"
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

        </div>
      </div>

      {/* Activity & audit logs — full width below the two-column grid so the
          detailed timelines use the whole row instead of stacking in the narrow
          right rail (which otherwise left the page bottom-left empty). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20, marginTop: 20, alignItems: 'start' }}>
        <CaseTimeline caseKind="return" caseId={data.id} refreshKey={data.updatedAt} />

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
