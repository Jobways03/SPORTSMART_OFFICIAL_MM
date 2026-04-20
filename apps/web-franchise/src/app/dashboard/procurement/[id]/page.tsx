'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  franchiseProcurementService,
  ProcurementRequest,
  ProcurementItem,
  ConfirmReceiptPayload,
  getProcurementStatusColor,
  getProcurementStatusLabel,
  formatProcurementCurrency,
  formatProcurementDate,
} from '@/services/procurement.service';
import { ApiError } from '@/lib/api-client';

const TIMELINE_STEPS: Array<{ key: string; label: string; matches: string[] }> = [
  { key: 'draft', label: 'Draft', matches: ['DRAFT'] },
  { key: 'submitted', label: 'Submitted', matches: ['SUBMITTED'] },
  {
    key: 'approved',
    label: 'Approved',
    matches: ['APPROVED', 'PARTIALLY_APPROVED', 'SOURCING'],
  },
  { key: 'dispatched', label: 'Dispatched', matches: ['DISPATCHED'] },
  {
    key: 'received',
    label: 'Received',
    matches: ['PARTIALLY_RECEIVED', 'RECEIVED'],
  },
  { key: 'settled', label: 'Settled', matches: ['SETTLED'] },
];

const TIMELINE_ORDER = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'SOURCING',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'SETTLED',
];

function stageIndex(status: string): number {
  const i = TIMELINE_ORDER.indexOf(status);
  return i === -1 ? -1 : i;
}

function isStepReached(stepKey: string, status: string): boolean {
  const step = TIMELINE_STEPS.find((s) => s.key === stepKey);
  if (!step) return false;
  if (step.matches.includes(status)) return true;
  // earlier step reached if we've progressed past any of its matches
  const currentIdx = stageIndex(status);
  const stepMinIdx = Math.min(
    ...step.matches.map((m) => stageIndex(m)).filter((i) => i >= 0),
  );
  return currentIdx >= stepMinIdx;
}

export default function ProcurementDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [request, setRequest] = useState<ProcurementRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptItems, setReceiptItems] = useState<
    Record<string, { receivedQty: number; damagedQty: number }>
  >({});

  const loadRequest = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await franchiseProcurementService.get(id);
      if (res.data) setRequest(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Failed to load procurement request.');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  const items = request?.items || [];
  const isCancelled = request?.status === 'CANCELLED';
  const isRejected = request?.status === 'REJECTED';

  const canSubmit = request?.status === 'DRAFT';
  const canCancel = request?.status === 'DRAFT' || request?.status === 'SUBMITTED';
  const canReceive =
    request?.status === 'DISPATCHED' || request?.status === 'PARTIALLY_RECEIVED';

  // Determine if we show approved/landed columns
  const showApprovedColumns = useMemo(() => {
    if (!request) return false;
    return [
      'APPROVED',
      'PARTIALLY_APPROVED',
      'SOURCING',
      'DISPATCHED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'SETTLED',
    ].includes(request.status);
  }, [request]);

  const showReceivedColumns = useMemo(() => {
    if (!request) return false;
    return [
      'DISPATCHED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'SETTLED',
    ].includes(request.status);
  }, [request]);

  const handleSubmit = async () => {
    if (!request) return;
    if (!confirm('Submit this request for admin approval?')) return;
    setActionLoading(true);
    try {
      await franchiseProcurementService.submit(request.id);
      await loadRequest();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.body.message || 'Failed to submit request.');
      } else {
        alert('Failed to submit request.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const openCancelModal = () => {
    setCancelReason('');
    setShowCancelModal(true);
  };

  const handleCancelConfirm = async () => {
    if (!request) return;
    setActionLoading(true);
    try {
      await franchiseProcurementService.cancel(
        request.id,
        cancelReason.trim() || undefined,
      );
      setShowCancelModal(false);
      await loadRequest();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.body.message || 'Failed to cancel request.');
      } else {
        alert('Failed to cancel request.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const openReceiptModal = () => {
    if (!request) return;
    const dispatchedItems = items.filter(
      (it) =>
        it.status === 'DISPATCHED' ||
        it.status === 'APPROVED' ||
        it.status === 'SOURCED',
    );
    const initial: Record<string, { receivedQty: number; damagedQty: number }> = {};
    dispatchedItems.forEach((it) => {
      initial[it.id] = {
        receivedQty: it.approvedQty - it.receivedQty,
        damagedQty: 0,
      };
    });
    setReceiptItems(initial);
    setShowReceiptModal(true);
  };

  const handleReceiptItemChange = (
    itemId: string,
    field: 'receivedQty' | 'damagedQty',
    rawValue: string,
    maxReceived: number,
  ) => {
    const value = Math.max(0, Math.floor(Number(rawValue) || 0));
    setReceiptItems((prev) => {
      const current = prev[itemId] || { receivedQty: 0, damagedQty: 0 };
      let next = { ...current };
      if (field === 'receivedQty') {
        next.receivedQty = Math.min(value, maxReceived);
        if (next.damagedQty > next.receivedQty) {
          next.damagedQty = next.receivedQty;
        }
      } else {
        next.damagedQty = Math.min(value, current.receivedQty);
      }
      return { ...prev, [itemId]: next };
    });
  };

  const handleReceiptSubmit = async () => {
    if (!request) return;
    const payload: ConfirmReceiptPayload = {
      items: Object.entries(receiptItems)
        .filter(([, v]) => v.receivedQty > 0 || v.damagedQty > 0)
        .map(([itemId, v]) => ({
          itemId,
          receivedQty: v.receivedQty,
          damagedQty: v.damagedQty || undefined,
        })),
    };
    if (payload.items.length === 0) {
      alert('Please enter received quantities for at least one item.');
      return;
    }
    setActionLoading(true);
    try {
      await franchiseProcurementService.confirmReceipt(request.id, payload);
      setShowReceiptModal(false);
      await loadRequest();
      alert('Receipt confirmed. Saleable items have been added to your inventory.');
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.body.message || 'Failed to confirm receipt.');
      } else {
        alert('Failed to confirm receipt.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Procurement Request</h1>
          </div>
        </div>
        <div className="card">Loading...</div>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Procurement Request</h1>
          </div>
          <Link
            href="/dashboard/procurement"
            className="btn btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            Back to list
          </Link>
        </div>
        <div className="card">
          <div
            style={{
              background: '#fef2f2',
              color: '#991b1b',
              padding: 16,
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            {error || 'Request not found.'}
          </div>
        </div>
      </div>
    );
  }

  const statusColor = getProcurementStatusColor(request.status);

  return (
    <div>
      <div className="page-header">
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <h1 style={{ margin: 0 }}>{request.requestNumber}</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                background: `${statusColor}15`,
                color: statusColor,
                border: `1px solid ${statusColor}40`,
              }}
            >
              {getProcurementStatusLabel(request.status)}
            </span>
          </div>
          <p>Created on {formatProcurementDate(request.createdAt)}</p>
        </div>
        <Link
          href="/dashboard/procurement"
          className="btn btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          Back to list
        </Link>
      </div>

      {/* Timeline */}
      {!isCancelled && !isRejected && (
        <div className="card">
          <h2>Status Timeline</h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 8,
            }}
          >
            {TIMELINE_STEPS.map((step, idx) => {
              const reached = isStepReached(step.key, request.status);
              return (
                <div
                  key={step.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: reached ? '#2563eb' : '#e5e7eb',
                        color: reached ? '#fff' : '#9ca3af',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: reached ? '#1d4ed8' : '#9ca3af',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                  {idx < TIMELINE_STEPS.length - 1 && (
                    <div
                      style={{
                        width: 36,
                        height: 2,
                        background: reached ? '#2563eb' : '#e5e7eb',
                        marginBottom: 18,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shipment tracking — visible once dispatched */}
      {(request.trackingNumber ||
        request.carrierName ||
        request.expectedDeliveryAt) && (
        <div
          className="card"
          style={{
            background: '#ecfeff',
            borderColor: '#a5f3fc',
          }}
        >
          <h2 style={{ color: '#0c4a6e', margin: 0 }}>Shipment</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            <InfoPair label="Tracking #" value={request.trackingNumber} mono />
            <InfoPair label="Carrier" value={request.carrierName} />
            <InfoPair
              label="Expected delivery"
              value={
                request.expectedDeliveryAt
                  ? new Date(request.expectedDeliveryAt).toLocaleDateString(
                      undefined,
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    )
                  : null
              }
            />
          </div>
        </div>
      )}

      {(isCancelled || isRejected) && (
        <div
          className="card"
          style={{
            background: '#fef2f2',
            borderColor: '#fecaca',
          }}
        >
          <h2 style={{ color: '#991b1b' }}>
            This request was {isCancelled ? 'cancelled' : 'rejected'}
          </h2>
          {isRejected && request.rejectionReason && (
            <div
              style={{
                marginTop: 8,
                padding: '10px 12px',
                background: '#fff',
                border: '1px solid #fecaca',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#991b1b',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  marginBottom: 4,
                }}
              >
                Reason
              </div>
              <div style={{ color: '#7f1d1d', fontSize: 14, lineHeight: 1.5 }}>
                {request.rejectionReason}
              </div>
            </div>
          )}
          <p style={{ color: '#7f1d1d', fontSize: 13, margin: '10px 0 0' }}>
            No further actions are available for this request.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* Items Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ margin: 0 }}>Items ({items.length})</h2>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#f9fafb',
                      borderBottom: '1px solid #e5e7eb',
                    }}
                  >
                    {['Product', 'Requested']
                      .concat(
                        showApprovedColumns
                          ? ['Approved', 'Base Cost', 'Platform Fee', 'Your Cost']
                          : [],
                      )
                      .concat(showReceivedColumns ? ['Received', 'Damaged'] : [])
                      .concat(['Status'])
                      .map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '10px 14px',
                            textAlign: 'left',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#6b7280',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const itemColor = getProcurementStatusColor(it.status);
                    return (
                      <tr
                        key={it.id}
                        style={{ borderBottom: '1px solid #f3f4f6' }}
                      >
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 600, color: '#111827' }}>
                            {it.productTitle}
                          </div>
                          {it.variantTitle && (
                            <div style={{ fontSize: 12, color: '#6b7280' }}>
                              {it.variantTitle}
                            </div>
                          )}
                          <div
                            style={{
                              fontFamily:
                                'ui-monospace, SFMono-Regular, Menlo, monospace',
                              fontSize: 11,
                              color: '#9ca3af',
                              marginTop: 2,
                            }}
                          >
                            {it.globalSku}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', color: '#111827' }}>
                          {it.requestedQty}
                        </td>
                        {showApprovedColumns && (
                          <>
                            <td style={{ padding: '12px 14px', color: '#111827' }}>
                              {it.approvedQty}
                            </td>
                            {/* Base cost (what admin paid to source) */}
                            <td
                              style={{
                                padding: '12px 14px',
                                color: '#111827',
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                                fontSize: 13,
                              }}
                            >
                              {it.landedUnitCost != null
                                ? formatProcurementCurrency(it.landedUnitCost)
                                : '—'}
                            </td>
                            {/* Platform procurement fee on top */}
                            <td
                              style={{
                                padding: '12px 14px',
                                color: '#6b7280',
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                                fontSize: 13,
                              }}
                            >
                              {it.procurementFeePerUnit != null
                                ? `+ ${formatProcurementCurrency(it.procurementFeePerUnit)}`
                                : '—'}
                            </td>
                            {/* Final cost to franchise — what they actually pay per unit */}
                            <td
                              style={{
                                padding: '12px 14px',
                                color: '#111827',
                                fontWeight: 600,
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                                fontSize: 13,
                              }}
                            >
                              {it.finalUnitCostToFranchise != null
                                ? formatProcurementCurrency(
                                    it.finalUnitCostToFranchise,
                                  )
                                : '—'}
                            </td>
                          </>
                        )}
                        {showReceivedColumns && (
                          <>
                            <td style={{ padding: '12px 14px', color: '#111827' }}>
                              {it.receivedQty}
                            </td>
                            <td style={{ padding: '12px 14px', color: '#111827' }}>
                              {it.damagedQty}
                            </td>
                          </>
                        )}
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.4px',
                              background: `${itemColor}15`,
                              color: itemColor,
                              border: `1px solid ${itemColor}40`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="card">
            <h2>Totals</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
              }}
            >
              <TotalBlock
                label="Requested"
                value={formatProcurementCurrency(request.totalRequestedAmount)}
              />
              <TotalBlock
                label="Total Payable"
                value={formatProcurementCurrency(request.finalPayableAmount)}
                highlight
              />
            </div>
          </div>

          {/* Notes */}
          {request.notes && (
            <div className="card">
              <h2>Notes</h2>
              <p
                style={{
                  fontSize: 14,
                  color: '#374151',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {request.notes}
              </p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div>
          <div className="card">
            <h2>Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {canSubmit && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={actionLoading}
                >
                  Submit for Approval
                </button>
              )}
              {canReceive && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openReceiptModal}
                  disabled={actionLoading}
                >
                  Confirm Receipt
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: '#dc2626', borderColor: '#fecaca' }}
                  onClick={openCancelModal}
                  disabled={actionLoading}
                >
                  Cancel Request
                </button>
              )}
              {!canSubmit && !canCancel && !canReceive && (
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                  No actions available for this request.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Milestones</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Milestone label="Requested" value={request.requestedAt} />
              <Milestone label="Approved" value={request.approvedAt} />
              <Milestone label="Dispatched" value={request.dispatchedAt} />
              <Milestone label="Received" value={request.receivedAt} />
              <Milestone label="Settled" value={request.settledAt} />
            </div>
          </div>
        </div>
      </div>

      {showCancelModal && (
        <CancelModal
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancelConfirm}
          loading={actionLoading}
        />
      )}

      {showReceiptModal && (
        <ReceiptModal
          items={items.filter(
            (it) =>
              it.approvedQty - it.receivedQty > 0 &&
              (it.status === 'DISPATCHED' ||
                it.status === 'APPROVED' ||
                it.status === 'SOURCED'),
          )}
          values={receiptItems}
          onChange={handleReceiptItemChange}
          onClose={() => setShowReceiptModal(false)}
          onConfirm={handleReceiptSubmit}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

function TotalBlock({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        background: highlight ? '#eff6ff' : '#fff',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: highlight ? '#1d4ed8' : '#111827',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Milestone({ label, value }: { label: string; value: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: value ? '#111827' : '#9ca3af',
          fontWeight: value ? 600 : 400,
        }}
      >
        {value ? formatProcurementDate(value) : '—'}
      </span>
    </div>
  );
}

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function CancelModal({
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  loading,
}: {
  reason: string;
  onReasonChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 24 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 8,
          }}
        >
          Cancel Procurement Request
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
          Are you sure you want to cancel this procurement request? This action
          cannot be undone.
        </p>

        <label
          htmlFor="cancelReason"
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 6,
          }}
        >
          Reason (optional)
        </label>
        <textarea
          id="cancelReason"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={4}
          placeholder="Provide a reason for cancellation..."
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
          disabled={loading}
        />

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Keep Request
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: '#dc2626', borderColor: '#dc2626' }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Cancelling...' : 'Cancel Request'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function ReceiptModal({
  items,
  values,
  onChange,
  onClose,
  onConfirm,
  loading,
}: {
  items: ProcurementItem[];
  values: Record<string, { receivedQty: number; damagedQty: number }>;
  onChange: (
    itemId: string,
    field: 'receivedQty' | 'damagedQty',
    value: string,
    max: number,
  ) => void;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 24 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 8,
          }}
        >
          Confirm Receipt
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
          Enter the quantities you actually received. This will add the saleable
          items to your inventory.
        </p>

        {items.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              background: '#f9fafb',
              borderRadius: 8,
              color: '#6b7280',
              fontSize: 14,
            }}
          >
            No pending dispatched items to receive.
          </div>
        ) : (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  {['Product', 'Approved', 'Received', 'Damaged', 'Saleable'].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: '10px 12px',
                          textAlign: 'left',
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#6b7280',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const maxReceived = it.approvedQty - it.receivedQty;
                  const current = values[it.id] || { receivedQty: 0, damagedQty: 0 };
                  const saleable = Math.max(
                    0,
                    current.receivedQty - current.damagedQty,
                  );
                  return (
                    <tr
                      key={it.id}
                      style={{ borderBottom: '1px solid #f3f4f6' }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>
                          {it.productTitle}
                        </div>
                        {it.variantTitle && (
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            {it.variantTitle}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#111827' }}>
                        {maxReceived}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          type="number"
                          min={0}
                          max={maxReceived}
                          value={current.receivedQty}
                          onChange={(e) =>
                            onChange(
                              it.id,
                              'receivedQty',
                              e.target.value,
                              maxReceived,
                            )
                          }
                          disabled={loading}
                          style={{
                            width: 70,
                            padding: '6px 8px',
                            fontSize: 13,
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          type="number"
                          min={0}
                          max={current.receivedQty}
                          value={current.damagedQty}
                          onChange={(e) =>
                            onChange(
                              it.id,
                              'damagedQty',
                              e.target.value,
                              maxReceived,
                            )
                          }
                          disabled={loading}
                          style={{
                            width: 70,
                            padding: '6px 8px',
                            fontSize: 13,
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                          }}
                        />
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontWeight: 700,
                          color: '#16a34a',
                        }}
                      >
                        {saleable}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={loading || items.length === 0}
          >
            {loading ? 'Confirming...' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function InfoPair({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          color: value ? '#111827' : '#9ca3af',
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
            : 'inherit',
        }}
      >
        {value || '—'}
      </div>
    </div>
  );
}
