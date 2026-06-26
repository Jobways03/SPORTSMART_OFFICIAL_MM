'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  franchiseReturnsService,
  FranchiseReturnDetail,
  FranchiseShipmentEvidence,
} from '@/services/franchise-returns.service';
import SubmitQcModal from '../components/submit-qc-modal';
import ApproveReturnModal from '../components/approve-return-modal';
import RejectReturnModal from '../components/reject-return-modal';
import SchedulePickupModal from '../components/schedule-pickup-modal';
import InitiateRefundModal from '../components/initiate-refund-modal';
import ConfirmRefundModal from '../components/confirm-refund-modal';
import MarkRefundFailedModal from '../components/mark-refund-failed-modal';
import {
  formatCurrency,
  formatDateTime,
  formatStatus,
  getStatusBadgeClass,
} from '../utils';
import '../returns.css';
import '../../sellers/components/modal.css';

export default function FranchiseAdminReturnDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const returnId = (params?.returnId as string) || '';
  const franchiseId = search?.get('franchiseId') || '';

  const [ret, setRet] = useState<FranchiseReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Which action modal is open (null = none). Same set as the D2C admin.
  const [activeModal, setActiveModal] = useState<
    | 'approve'
    | 'reject'
    | 'schedulePickup'
    | 'submitQc'
    | 'initiateRefund'
    | 'confirmRefund'
    | 'markRefundFailed'
    | null
  >(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  // Bumped after any action to re-fetch the (now-updated) return.
  const [refreshKey, setRefreshKey] = useState(0);
  // Franchise's pre-ship photos (proof-of-dispatch, attached to the sub-order).
  const [shipmentEvidence, setShipmentEvidence] = useState<
    FranchiseShipmentEvidence[]
  >([]);

  useEffect(() => {
    if (!returnId || !franchiseId) {
      setError('Missing return or franchise reference');
      setLoading(false);
      return;
    }
    setLoading(true);
    franchiseReturnsService
      .get(returnId, franchiseId)
      .then((res) => {
        if (res.data) setRet(res.data);
        else setError('Return not found');
      })
      .catch(() => setError('Failed to load return'))
      .finally(() => setLoading(false));
  }, [returnId, franchiseId, refreshKey]);

  // Pull the franchise's pre-ship photos once we know the sub-order. Separate
  // from the main fetch so a missing/empty list never breaks the page.
  useEffect(() => {
    const subOrderId = ret?.subOrder?.id;
    if (!subOrderId) return;
    franchiseReturnsService
      .getShipmentEvidence(subOrderId)
      .then((res) => {
        setShipmentEvidence(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => setShipmentEvidence([]));
  }, [ret?.subOrder?.id]);

  const onActionSuccess = () => {
    setActiveModal(null);
    setActionSuccess('Action completed');
    setTimeout(() => setActionSuccess(''), 3000);
    setRefreshKey((k) => k + 1);
  };

  // Direct (no-modal) action — used for Retry Refund.
  const runDirectAction = async (key: string, action: () => Promise<unknown>) => {
    setActionLoading(key);
    setActionError('');
    try {
      await action();
      onActionSuccess();
    } catch (e: any) {
      setActionError(e?.body?.message || e?.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Status-gated lifecycle actions — the SAME set as the D2C/Retail admin,
   * scoped to this franchise's own returns by the backend node guard.
   */
  const renderActions = (status: string): React.ReactNode[] => {
    const a: React.ReactNode[] = [];
    if (status === 'REQUESTED') {
      a.push(
        <button key="approve" className="return-action-btn success" onClick={() => setActiveModal('approve')}>Approve Return</button>,
        <button key="reject" className="return-action-btn danger" onClick={() => setActiveModal('reject')}>Reject Return</button>,
      );
    }
    if (status === 'APPROVED') {
      a.push(
        <button key="schedule" className="return-action-btn primary" onClick={() => setActiveModal('schedulePickup')}>Schedule Pickup</button>,
        <button key="reject2" className="return-action-btn danger" onClick={() => setActiveModal('reject')}>Reject Return</button>,
      );
    }
    if (status === 'PICKUP_SCHEDULED') {
      a.push(
        <button key="edit-pickup" className="return-action-btn" onClick={() => setActiveModal('schedulePickup')}>Edit Pickup</button>,
        <button key="reject3" className="return-action-btn danger" onClick={() => setActiveModal('reject')}>Cancel &amp; Reject</button>,
      );
    }
    if (status === 'IN_TRANSIT') {
      a.push(
        <button
          key="mark-received"
          className="return-action-btn primary"
          disabled={actionLoading === 'markReceived'}
          onClick={() => runDirectAction('markReceived', () => franchiseReturnsService.markReceived(ret!.id, franchiseId))}
        >
          {actionLoading === 'markReceived' ? 'Updating…' : 'Mark Received'}
        </button>,
      );
    }
    if (status === 'RECEIVED') {
      a.push(
        <button key="qc" className="return-action-btn primary" onClick={() => setActiveModal('submitQc')}>Submit QC Decision</button>,
      );
    }
    if (status === 'QC_APPROVED' || status === 'PARTIALLY_APPROVED') {
      a.push(
        <button key="initiate-refund" className="return-action-btn primary" onClick={() => setActiveModal('initiateRefund')}>Initiate Refund</button>,
      );
    }
    if (status === 'REFUND_PROCESSING') {
      a.push(
        <button key="confirm-refund" className="return-action-btn success" onClick={() => setActiveModal('confirmRefund')}>Confirm Refund</button>,
        <button key="fail-refund" className="return-action-btn danger" onClick={() => setActiveModal('markRefundFailed')}>Mark Failed</button>,
        <button
          key="retry-refund"
          className="return-action-btn warning"
          disabled={actionLoading === 'retryRefund'}
          onClick={() => runDirectAction('retryRefund', () => franchiseReturnsService.retryRefund(ret!.id, franchiseId))}
        >
          {actionLoading === 'retryRefund' ? 'Retrying…' : 'Retry Refund'}
        </button>,
      );
    }
    if (a.length === 0) {
      a.push(
        <div key="none" style={{ fontSize: 13, color: '#64748b', padding: '10px 0', textAlign: 'center' }}>
          No actions available for this status.
        </div>,
      );
    }
    return a;
  };

  if (loading)
    return (
      <div className="return-detail-page">
        <div className="returns-loading">Loading return…</div>
      </div>
    );

  if (error || !ret)
    return (
      <div className="return-detail-page">
        <button
          className="return-detail-back"
          onClick={() => router.back()}
        >
          &larr; Back to returns
        </button>
        <div className="returns-empty">
          <h3>Return unavailable</h3>
          <p>{error || 'Return not found'}</p>
        </div>
      </div>
    );

  const items = ret.items ?? [];
  const returnNo = ret.returnNumber || ret.id.slice(0, 8);
  const history = ret.statusHistory ?? [];
  const evidence = ret.evidence ?? [];
  const customerName =
    `${ret.customer?.firstName ?? ''} ${ret.customer?.lastName ?? ''}`.trim();
  const orderNumber = ret.subOrder?.masterOrder?.orderNumber ?? '—';
  const refundValue = ret.refundAmount ?? ret.totalRefundAmount ?? null;
  const hasRefund = refundValue != null || !!ret.refundStatus;
  const totalQty = items.reduce((sum, i) => sum + (i.quantity || 0), 0);

  return (
    <div className="return-detail-page">
      <button className="return-detail-back" onClick={() => router.back()}>
        &larr; Back to returns
      </button>

      <div className="return-detail-header">
        <div className="return-detail-title">
          <h1>
            {ret.returnNumber || ret.id.slice(0, 8)}
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
            <span>
              Fulfilled by{' '}
              <strong>{ret.subOrder?.fulfillmentNodeType || 'FRANCHISE'}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="return-detail-layout">
        {/* ── Main content ─────────────────────────────────────────── */}
        <div className="return-detail-main">
          {/* Customer */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Customer</h2>
            </div>
            <div className="return-section-body">
              <div className="return-info-grid">
                <div className="return-info-item">
                  <span className="return-info-label">Name</span>
                  <span className="return-info-value">
                    {customerName || <span className="muted">Unknown</span>}
                  </span>
                </div>
                <div className="return-info-item">
                  <span className="return-info-label">Email</span>
                  <span className="return-info-value">
                    {ret.customer?.email || <span className="muted">—</span>}
                  </span>
                </div>
              </div>
              {ret.reason && (
                <div style={{ marginTop: 14 }}>
                  <div className="return-info-label">Return Reason</div>
                  <div className="return-info-value" style={{ marginTop: 4 }}>
                    {ret.reason}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Items ({items.length})</h2>
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
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8' }}>
                        No item rows
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
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
                        <td>{item.quantity ?? 1}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>
                            {formatStatus(item.reasonCategory)}
                          </div>
                          {item.reasonDetail && (
                            <div
                              style={{
                                fontSize: 11,
                                color: '#64748b',
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
                              <div style={{ fontSize: 11, color: '#64748b' }}>
                                Approved: {item.qcQuantityApproved ?? 0}/
                                {item.quantity ?? 1}
                              </div>
                              {item.qcNotes && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#64748b',
                                    marginTop: 2,
                                  }}
                                >
                                  {item.qcNotes}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Pending</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                          {item.refundAmount != null
                            ? formatCurrency(Number(item.refundAmount))
                            : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Refund */}
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
                      {refundValue != null
                        ? formatCurrency(Number(refundValue))
                        : '—'}
                    </span>
                  </div>
                  <div className="return-info-item">
                    <span className="return-info-label">Status</span>
                    <span className="return-info-value">
                      {ret.refundStatus ? (
                        formatStatus(ret.refundStatus)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Evidence (customer) */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Evidence ({evidence.length})</h2>
            </div>
            <div className="return-section-body">
              {evidence.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    textAlign: 'center',
                    padding: '12px 0',
                  }}
                >
                  No evidence uploaded yet.
                </div>
              ) : (
                <div className="return-evidence-grid">
                  {evidence.map((ev) => {
                    // The real column is `file_url` → `fileUrl`. Reading the
                    // wrong field left url null, so the tile became an
                    // `href="#"` target="_blank" link that opened a fresh
                    // franchise-admin tab (no sessionStorage token) → login.
                    const url = ev.fileUrl || ev.viewUrl || ev.url || null;
                    // No URL → render a plain tile, NOT a new-tab link to "#".
                    if (!url) {
                      return (
                        <div key={ev.id} className="return-evidence-item">
                          <div style={{ padding: 12, fontSize: 11, color: '#64748b' }}>
                            &#128247;
                          </div>
                          {ev.description && (
                            <div className="return-evidence-caption">
                              {ev.description}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <a
                        key={ev.id}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="return-evidence-item"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={ev.description || 'Evidence'} />
                        {ev.description && (
                          <div className="return-evidence-caption">
                            {ev.description}
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Franchise's pre-ship evidence — the "as shipped" baseline. */}
          {shipmentEvidence.length > 0 && (
            <div className="return-section">
              <div className="return-section-header">
                <h2>
                  Franchise&apos;s Pre-ship Evidence ({shipmentEvidence.length})
                </h2>
              </div>
              <div className="return-section-body">
                <div
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Photos the franchise uploaded <strong>before shipping</strong>{' '}
                  (the &ldquo;as shipped&rdquo; baseline). Compare against the
                  customer&apos;s evidence above before deciding a contested
                  return.
                </div>
                <div className="return-evidence-grid">
                  {shipmentEvidence.map((att, i) => {
                    const url = att.viewUrl ?? att.file?.providerUrl ?? '';
                    return (
                      <a
                        key={att.id}
                        href={url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="return-evidence-item"
                      >
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={`Pre-ship evidence ${i + 1}`} />
                        ) : (
                          <div style={{ padding: 12, fontSize: 11, color: '#64748b' }}>
                            {att.file?.fileName ?? 'Photo'}
                          </div>
                        )}
                        <div className="return-evidence-caption">
                          Franchise · before shipping
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Status Timeline */}
          <div className="return-section">
            <div className="return-section-header">
              <h2>Status Timeline</h2>
            </div>
            <div className="return-section-body">
              {history.length > 0 ? (
                <div className="return-timeline">
                  {[...history]
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
                            {formatStatus(entry.status)}
                          </div>
                          <div className="return-timeline-time">
                            {formatDateTime(entry.createdAt)}
                          </div>
                          {entry.note && (
                            <div className="return-timeline-notes">
                              {entry.note}
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
                    color: '#64748b',
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

        {/* ── Sticky sidebar ───────────────────────────────────────── */}
        <div className="return-detail-sidebar">
          <div className="return-sidebar-card">
            <h3>Actions</h3>
            {actionError && (
              <div className="modal-alert modal-alert-error" style={{ marginBottom: 10 }}>
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div className="modal-alert modal-alert-success" style={{ marginBottom: 10 }}>
                {actionSuccess}
              </div>
            )}
            <div className="return-sidebar-actions">{renderActions(ret.status)}</div>
          </div>

          <div className="return-sidebar-card" style={{ marginTop: 16 }}>
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
                <span style={{ color: '#64748b' }}>Items</span>
                <span style={{ fontWeight: 600 }}>{items.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Total Qty</span>
                <span style={{ fontWeight: 600 }}>{totalQty}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Refund</span>
                <span style={{ fontWeight: 600 }}>
                  {refundValue != null
                    ? formatCurrency(Number(refundValue))
                    : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Status</span>
                <span className={getStatusBadgeClass(ret.status)}>
                  {formatStatus(ret.status)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action modals (same set as D2C/Retail, franchise-scoped) ── */}
      {activeModal === 'approve' && (
        <ApproveReturnModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'reject' && (
        <RejectReturnModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'schedulePickup' && (
        <SchedulePickupModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'submitQc' && (
        <SubmitQcModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          items={ret.items ?? []}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'initiateRefund' && (
        <InitiateRefundModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'confirmRefund' && (
        <ConfirmRefundModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
      {activeModal === 'markRefundFailed' && (
        <MarkRefundFailedModal
          returnId={ret.id}
          franchiseId={franchiseId}
          returnNumber={returnNo}
          onClose={() => setActiveModal(null)}
          onSuccess={onActionSuccess}
        />
      )}
    </div>
  );
}
