'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  adminReturnsService,
  ReturnDetail,
  ReturnStatus,
} from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import ApproveReturnModal from '../components/approve-return-modal';
import RejectReturnModal from '../components/reject-return-modal';
import SchedulePickupModal from '../components/schedule-pickup-modal';
import SubmitQcModal from '../components/submit-qc-modal';
import ConfirmRefundModal from '../components/confirm-refund-modal';
import InitiateRefundModal from '../components/initiate-refund-modal';
import MarkRefundFailedModal from '../components/mark-refund-failed-modal';
import UploadEvidenceModal from '../components/upload-evidence-modal';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatStatus,
  getStatusBadgeClass,
} from '../utils';
import '../returns.css';
import '../../sellers/components/modal.css';

type ModalKey =
  | 'approve'
  | 'reject'
  | 'schedulePickup'
  | 'submitQc'
  | 'confirmRefund'
  | 'initiateRefund'
  | 'markRefundFailed'
  | 'uploadEvidence'
  | null;

const REFUND_ACTIVE_STATUSES: ReturnStatus[] = [
  'REFUND_PROCESSING',
  'REFUNDED',
  'COMPLETED',
];

export default function ReturnDetailPage() {
  const router = useRouter();
  const params = useParams();
  const returnId = params.returnId as string;

  const [ret, setRet] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const [activeModal, setActiveModal] = useState<ModalKey>(null);

  const fetchReturn = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminReturnsService.getReturn(returnId);
      if (res.data) {
        setRet(res.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Failed to load return',
      );
    } finally {
      setLoading(false);
    }
  }, [returnId, router]);

  useEffect(() => {
    fetchReturn();
  }, [fetchReturn]);

  const onActionSuccess = () => {
    setActiveModal(null);
    setActionSuccess('Action completed');
    setTimeout(() => setActionSuccess(''), 3000);
    fetchReturn();
  };

  const runDirectAction = async (
    key: string,
    action: () => Promise<unknown>,
  ) => {
    setActionLoading(key);
    setActionError('');
    try {
      await action();
      setActionSuccess('Action completed');
      setTimeout(() => setActionSuccess(''), 3000);
      await fetchReturn();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Action failed',
      );
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="return-detail-page">
        <div className="returns-loading">Loading return...</div>
      </div>
    );
  }

  if (error || !ret) {
    return (
      <div className="return-detail-page">
        <button
          className="return-detail-back"
          onClick={() => router.push('/dashboard/returns')}
        >
          &larr; Back to returns
        </button>
        <div className="returns-error">
          <p>{error || 'Return not found'}</p>
          <button onClick={fetchReturn}>Retry</button>
        </div>
      </div>
    );
  }

  const orderNumber =
    ret.masterOrder?.orderNumber ||
    ret.subOrder?.masterOrder?.orderNumber ||
    '—';

  const customerName =
    ret.customer &&
    [ret.customer.firstName, ret.customer.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

  const hasEvidence = (ret.evidence || []).length > 0;
  const hasPickup =
    ret.pickupScheduledAt || ret.pickupTrackingNumber || ret.pickupCourier;
  const hasQc = ret.qcCompletedAt || ret.qcDecision;
  const hasRefund =
    ret.refundAmount != null ||
    ret.refundReference ||
    ret.refundMethod ||
    REFUND_ACTIVE_STATUSES.includes(ret.status);

  const canSubmitQc = ret.status === 'RECEIVED';

  // Action button visibility based on status
  const renderActions = () => {
    const status = ret.status;
    const actions: React.ReactNode[] = [];

    if (status === 'REQUESTED') {
      actions.push(
        <button
          key="approve"
          className="return-action-btn success"
          onClick={() => setActiveModal('approve')}
        >
          Approve Return
        </button>,
        <button
          key="reject"
          className="return-action-btn danger"
          onClick={() => setActiveModal('reject')}
        >
          Reject Return
        </button>,
      );
    }

    if (status === 'APPROVED') {
      actions.push(
        <button
          key="schedule"
          className="return-action-btn primary"
          onClick={() => setActiveModal('schedulePickup')}
        >
          Schedule Pickup
        </button>,
      );
    }

    if (status === 'PICKUP_SCHEDULED') {
      actions.push(
        <button
          key="in-transit"
          className="return-action-btn primary"
          disabled={actionLoading === 'inTransit'}
          onClick={() =>
            runDirectAction('inTransit', () =>
              adminReturnsService.markInTransit(returnId),
            )
          }
        >
          {actionLoading === 'inTransit' ? 'Updating...' : 'Mark In Transit'}
        </button>,
        <button
          key="edit-pickup"
          className="return-action-btn"
          onClick={() => setActiveModal('schedulePickup')}
        >
          Edit Pickup
        </button>,
      );
    }

    if (status === 'IN_TRANSIT') {
      actions.push(
        <button
          key="receive"
          className="return-action-btn primary"
          disabled={actionLoading === 'markReceived'}
          onClick={() =>
            runDirectAction('markReceived', () =>
              adminReturnsService.markReceived(returnId),
            )
          }
        >
          {actionLoading === 'markReceived'
            ? 'Updating...'
            : 'Mark Received'}
        </button>,
      );
    }

    if (status === 'RECEIVED') {
      actions.push(
        <button
          key="qc"
          className="return-action-btn primary"
          onClick={() => setActiveModal('submitQc')}
        >
          Submit QC Decision
        </button>,
        <button
          key="upload"
          className="return-action-btn"
          onClick={() => setActiveModal('uploadEvidence')}
        >
          Upload Evidence
        </button>,
      );
    }

    if (
      (status === 'QC_APPROVED' || status === 'PARTIALLY_APPROVED') &&
      !ret.refundInitiatedAt
    ) {
      actions.push(
        <button
          key="initiate-refund"
          className="return-action-btn primary"
          onClick={() => setActiveModal('initiateRefund')}
        >
          Initiate Refund
        </button>,
      );
    }

    if (status === 'REFUND_PROCESSING') {
      actions.push(
        <button
          key="confirm-refund"
          className="return-action-btn success"
          onClick={() => setActiveModal('confirmRefund')}
        >
          Confirm Refund
        </button>,
        <button
          key="fail-refund"
          className="return-action-btn danger"
          onClick={() => setActiveModal('markRefundFailed')}
        >
          Mark Failed
        </button>,
        <button
          key="retry-refund"
          className="return-action-btn warning"
          disabled={actionLoading === 'retryRefund'}
          onClick={() =>
            runDirectAction('retryRefund', () =>
              adminReturnsService.retryRefund(returnId),
            )
          }
        >
          {actionLoading === 'retryRefund' ? 'Retrying...' : 'Retry Refund'}
        </button>,
      );
    }

    if (status === 'REFUNDED') {
      actions.push(
        <button
          key="close"
          className="return-action-btn primary"
          disabled={actionLoading === 'closeReturn'}
          onClick={() =>
            runDirectAction('closeReturn', () =>
              adminReturnsService.closeReturn(returnId),
            )
          }
        >
          {actionLoading === 'closeReturn' ? 'Closing...' : 'Close Return'}
        </button>,
      );
    }

    if (status === 'COMPLETED') {
      actions.push(
        <div
          key="view-only"
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            padding: '10px 0',
            textAlign: 'center',
          }}
        >
          This return is completed. View only.
        </div>,
      );
    }

    if (actions.length === 0) {
      actions.push(
        <div
          key="none"
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            padding: '10px 0',
            textAlign: 'center',
          }}
        >
          No actions available for this status.
        </div>,
      );
    }

    return actions;
  };

  return (
    <div className="return-detail-page">
      <button
        className="return-detail-back"
        onClick={() => router.push('/dashboard/returns')}
      >
        &larr; Back to returns
      </button>

      <div className="return-detail-header">
        <div className="return-detail-title">
          <h1>
            {ret.returnNumber}
            <span className={getStatusBadgeClass(ret.status)}>
              {formatStatus(ret.status)}
            </span>
          </h1>
          <div className="return-detail-meta">
            <span>
              Order <strong>{orderNumber}</strong>
            </span>
            <span>
              Created <strong>{formatDateTime(ret.createdAt)}</strong>
            </span>
            {ret.subOrder?.fulfillmentNodeType && (
              <span>
                Fulfilled by{' '}
                <strong>{ret.subOrder.fulfillmentNodeType}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <div
          className="modal-alert modal-alert-error"
          style={{ marginBottom: 16 }}
        >
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div
          className="modal-alert modal-alert-success"
          style={{ marginBottom: 16 }}
        >
          {actionSuccess}
        </div>
      )}

      <div className="return-detail-layout">
        {/* Main content */}
        <div className="return-detail-main">
          {/* Customer Info */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Customer</h2>
            </div>
            <div className="return-section-body">
              <div className="return-info-grid">
                <div className="return-info-item">
                  <span className="return-info-label">Name</span>
                  <span className="return-info-value">
                    {customerName || (
                      <span className="muted">Unknown</span>
                    )}
                  </span>
                </div>
                <div className="return-info-item">
                  <span className="return-info-label">Email</span>
                  <span className="return-info-value">
                    {ret.customer?.email || (
                      <span className="muted">—</span>
                    )}
                  </span>
                </div>
                <div className="return-info-item">
                  <span className="return-info-label">Phone</span>
                  <span className="return-info-value">
                    {ret.customer?.phone || (
                      <span className="muted">—</span>
                    )}
                  </span>
                </div>
                <div className="return-info-item">
                  <span className="return-info-label">Customer ID</span>
                  <span
                    className="return-info-value"
                    style={{ fontSize: 12, fontFamily: 'monospace' }}
                  >
                    {ret.customerId}
                  </span>
                </div>
              </div>
              {ret.customerNotes && (
                <div style={{ marginTop: 14 }}>
                  <div className="return-info-label">Customer Notes</div>
                  <div
                    className="return-info-value"
                    style={{ marginTop: 4 }}
                  >
                    {ret.customerNotes}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Items ({ret.items?.length || 0})</h2>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="return-items-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Reason</th>
                    <th>QC</th>
                    <th style={{ textAlign: 'right' }}>Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {(ret.items || []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="return-item-product">
                          {item.orderItem?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="return-item-image"
                              src={item.orderItem.imageUrl}
                              alt=""
                            />
                          ) : (
                            <div className="return-item-image-placeholder">
                              &#128230;
                            </div>
                          )}
                          <div>
                            <div className="return-item-name">
                              {item.orderItem?.productTitle || 'Item'}
                            </div>
                            {item.orderItem?.variantTitle && (
                              <div className="return-item-variant">
                                {item.orderItem.variantTitle}
                              </div>
                            )}
                            {item.orderItem?.sku && (
                              <div className="return-item-variant">
                                SKU: {item.orderItem.sku}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{item.quantity}</td>
                      <td>
                        <div style={{ fontSize: 13 }}>
                          {formatStatus(item.reasonCategory)}
                        </div>
                        {item.reasonDetail && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--color-text-secondary)',
                              marginTop: 2,
                            }}
                          >
                            {item.reasonDetail}
                          </div>
                        )}
                      </td>
                      <td>
                        {item.qcOutcome ? (
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>
                              {item.qcOutcome}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--color-text-secondary)',
                              }}
                            >
                              Approved: {item.qcQuantityApproved ?? 0}/
                              {item.quantity}
                            </div>
                            {item.qcNotes && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--color-text-secondary)',
                                  marginTop: 2,
                                }}
                              >
                                {item.qcNotes}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-text-secondary)' }}>
                            Pending
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 500,
                        }}
                      >
                        {item.refundAmount != null
                          ? formatCurrency(Number(item.refundAmount))
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pickup Info */}
          {hasPickup && (
            <div className="return-section">
              <div className="return-section-header">
                <h2>Pickup</h2>
              </div>
              <div className="return-section-body">
                <div className="return-info-grid">
                  <div className="return-info-item">
                    <span className="return-info-label">Scheduled At</span>
                    <span className="return-info-value">
                      {formatDateTime(ret.pickupScheduledAt)}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Courier</span>
                    <span className="return-info-value">
                      {ret.pickupCourier || (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Tracking #</span>
                    <span className="return-info-value">
                      {ret.pickupTrackingNumber || (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Received At</span>
                    <span className="return-info-value">
                      {ret.receivedAt ? formatDateTime(ret.receivedAt) : (
                        <span className="muted">Not received yet</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* QC Info */}
          {hasQc && (
            <div className="return-section">
              <div className="return-section-header">
                <h2>Quality Check</h2>
              </div>
              <div className="return-section-body">
                <div className="return-info-grid">
                  <div className="return-info-item">
                    <span className="return-info-label">Decision</span>
                    <span className="return-info-value">
                      {ret.qcDecision || (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Completed At</span>
                    <span className="return-info-value">
                      {formatDateTime(ret.qcCompletedAt)}
                    </span>
                  </div>
                </div>
                {ret.qcNotes && (
                  <div style={{ marginTop: 14 }}>
                    <div className="return-info-label">Overall Notes</div>
                    <div
                      className="return-info-value"
                      style={{ marginTop: 4 }}
                    >
                      {ret.qcNotes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Refund Info */}
          {hasRefund && (
            <div className="return-section">
              <div className="return-section-header">
                <h2>Refund</h2>
              </div>
              <div className="return-section-body">
                <div className="return-info-grid">
                  <div className="return-info-item">
                    <span className="return-info-label">Amount</span>
                    <span className="return-info-value">
                      {ret.refundAmount != null
                        ? formatCurrency(Number(ret.refundAmount))
                        : '—'}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Method</span>
                    <span className="return-info-value">
                      {ret.refundMethod?.replace(/_/g, ' ') || (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Reference</span>
                    <span className="return-info-value">
                      {ret.refundReference || (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Initiated At</span>
                    <span className="return-info-value">
                      {formatDateTime(ret.refundInitiatedAt)}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Processed At</span>
                    <span className="return-info-value">
                      {formatDateTime(ret.refundProcessedAt)}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Attempts</span>
                    <span className="return-info-value">
                      {ret.refundAttempts ?? 0}
                    </span>
                  </div>
                </div>
                {ret.refundFailureReason && (
                  <div
                    className="modal-alert modal-alert-error"
                    style={{ marginTop: 14, marginBottom: 0 }}
                  >
                    Last failure: {ret.refundFailureReason}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Evidence */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Evidence ({ret.evidence?.length || 0})</h2>
            </div>
            <div className="return-section-body">
              {hasEvidence ? (
                <div className="return-evidence-grid">
                  {ret.evidence.map((ev) => (
                    <a
                      key={ev.id}
                      href={ev.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="return-evidence-item"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ev.fileUrl} alt={ev.description || 'Evidence'} />
                      {ev.description && (
                        <div className="return-evidence-caption">
                          {ev.description}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    padding: '12px 0',
                  }}
                >
                  No evidence uploaded yet.
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Status Timeline</h2>
            </div>
            <div className="return-section-body">
              {ret.statusHistory && ret.statusHistory.length > 0 ? (
                <div className="return-timeline">
                  {[...ret.statusHistory]
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                    )
                    .map((entry, idx) => (
                      <div key={entry.id} className="return-timeline-item">
                        <div
                          className={`return-timeline-dot${
                            idx === 0 ? '' : ' neutral'
                          }`}
                        />
                        <div className="return-timeline-content">
                          <div className="return-timeline-status">
                            {formatStatus(entry.toStatus)}
                            {entry.fromStatus && (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: 'var(--color-text-secondary)',
                                  fontWeight: 400,
                                  marginLeft: 8,
                                }}
                              >
                                from {formatStatus(entry.fromStatus)}
                              </span>
                            )}
                          </div>
                          <div className="return-timeline-time">
                            {formatDateTime(entry.createdAt)} &middot;{' '}
                            {entry.changedBy}
                          </div>
                          {entry.notes && (
                            <div className="return-timeline-notes">
                              {entry.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    padding: '12px 0',
                  }}
                >
                  No status history available.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sticky sidebar */}
        <div className="return-detail-sidebar">
          <div className="return-sidebar-card">
            <h3>Actions</h3>
            <div className="return-sidebar-actions">{renderActions()}</div>
          </div>

          <div
            className="return-sidebar-card"
            style={{ marginTop: 16 }}
          >
            <h3>Summary</h3>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Items
                </span>
                <span style={{ fontWeight: 600 }}>
                  {ret.items?.length || 0}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Total Qty
                </span>
                <span style={{ fontWeight: 600 }}>
                  {(ret.items || []).reduce(
                    (sum, i) => sum + (i.quantity || 0),
                    0,
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Refund
                </span>
                <span style={{ fontWeight: 600 }}>
                  {ret.refundAmount != null
                    ? formatCurrency(Number(ret.refundAmount))
                    : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Initiated By
                </span>
                <span style={{ fontWeight: 600 }}>{ret.initiatedBy}</span>
              </div>
              {ret.closedAt && (
                <div
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    Closed
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {formatDate(ret.closedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {activeModal === 'approve' && (
        <ApproveReturnModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'reject' && (
        <RejectReturnModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'schedulePickup' && (
        <SchedulePickupModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'submitQc' && canSubmitQc && (
        <SubmitQcModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          items={ret.items}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'initiateRefund' && (
        <InitiateRefundModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'confirmRefund' && (
        <ConfirmRefundModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'markRefundFailed' && (
        <MarkRefundFailedModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'uploadEvidence' && (
        <UploadEvidenceModal
          returnId={ret.id}
          returnNumber={ret.returnNumber}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
    </div>
  );
}
