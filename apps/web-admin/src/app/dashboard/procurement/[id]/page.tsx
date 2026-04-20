'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  adminProcurementService,
  ProcurementDetail,
  ProcurementItem,
  getProcurementStatusLabel,
  getProcurementStatusColor,
  getProcurementItemStatusLabel,
  getProcurementItemStatusColor,
  formatCurrency,
  formatProcurementDate,
} from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';
import RejectProcurementModal from '../components/reject-procurement-modal';
import DispatchProcurementModal from '../components/dispatch-procurement-modal';
import SettleProcurementModal from '../components/settle-procurement-modal';
import '../procurement.css';

type ModalType = 'reject' | 'dispatch' | 'settle' | null;

interface EditableItemState {
  approvedQty: string;
  landedUnitCost: string;
  sourceSellerId: string;
}

interface ItemErrors {
  approvedQty?: string;
  landedUnitCost?: string;
}

export default function ProcurementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<ProcurementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editState, setEditState] = useState<Record<string, EditableItemState>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, ItemErrors>>({});
  const [approveError, setApproveError] = useState('');
  const [isApproving, setIsApproving] = useState(false);

  const [activeModal, setActiveModal] = useState<ModalType>(null);

  const fetchRequest = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await adminProcurementService.get(id);
      if (res.data) {
        setRequest(res.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setFetchError(err instanceof ApiError ? err.message : 'Failed to load procurement request');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  const resetEditState = useCallback((items: ProcurementItem[]) => {
    const initial: Record<string, EditableItemState> = {};
    items.forEach(item => {
      initial[item.id] = {
        approvedQty: String(item.requestedQty),
        landedUnitCost: item.landedUnitCost != null ? String(item.landedUnitCost) : '',
        sourceSellerId: item.sourceSellerId || '',
      };
    });
    setEditState(initial);
    setItemErrors({});
    setApproveError('');
  }, []);

  const startEditing = () => {
    if (!request) return;
    resetEditState(request.items);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditState({});
    setItemErrors({});
    setApproveError('');
  };

  const updateItemField = (itemId: string, field: keyof EditableItemState, value: string) => {
    setEditState(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }));
    if (itemErrors[itemId]?.[field as keyof ItemErrors]) {
      setItemErrors(prev => {
        const next = { ...prev };
        if (next[itemId]) {
          const nextItem = { ...next[itemId] };
          delete nextItem[field as keyof ItemErrors];
          next[itemId] = nextItem;
        }
        return next;
      });
    }
  };

  const feeRate = request?.procurementFeeRate ?? 0;

  // Compute live totals based on editable state
  const liveTotals = useMemo(() => {
    if (!request) {
      return { requested: 0, approved: 0, fee: 0, final: 0 };
    }
    let requested = 0;
    let approved = 0;
    request.items.forEach(item => {
      const edit = editState[item.id];
      const requestedUnit = item.landedUnitCost ?? 0;
      requested += item.requestedQty * requestedUnit;

      if (isEditing && edit) {
        const qty = Number(edit.approvedQty) || 0;
        const cost = Number(edit.landedUnitCost) || 0;
        approved += qty * cost;
      } else {
        const qty = item.approvedQty || 0;
        const cost = item.landedUnitCost ?? 0;
        approved += qty * cost;
      }
    });
    const fee = (approved * feeRate) / 100;
    const final = approved + fee;
    return { requested, approved, fee, final };
  }, [request, editState, isEditing, feeRate]);

  const validateItems = (): boolean => {
    if (!request) return false;
    const errs: Record<string, ItemErrors> = {};
    let hasError = false;
    let anyApproved = false;
    request.items.forEach(item => {
      const edit = editState[item.id];
      if (!edit) return;
      const approvedQty = Number(edit.approvedQty);
      const landedCost = Number(edit.landedUnitCost);
      const itemErr: ItemErrors = {};
      if (edit.approvedQty === '' || Number.isNaN(approvedQty) || approvedQty < 0) {
        itemErr.approvedQty = 'Must be 0 or more';
      } else if (approvedQty > item.requestedQty) {
        itemErr.approvedQty = `Cannot exceed ${item.requestedQty}`;
      } else if (!Number.isInteger(approvedQty)) {
        itemErr.approvedQty = 'Must be a whole number';
      }
      if (approvedQty > 0) {
        anyApproved = true;
        if (edit.landedUnitCost === '' || Number.isNaN(landedCost) || landedCost < 0) {
          itemErr.landedUnitCost = 'Required when approving';
        }
      }
      if (Object.keys(itemErr).length > 0) {
        errs[item.id] = itemErr;
        hasError = true;
      }
    });
    setItemErrors(errs);
    if (!anyApproved) {
      setApproveError('At least one item must have approvedQty > 0. Use Reject to reject the entire request.');
      return false;
    }
    if (hasError) {
      setApproveError('Please fix the errors above before submitting.');
      return false;
    }
    setApproveError('');
    return true;
  };

  const handleApprove = async () => {
    if (!request) return;
    if (!validateItems()) return;
    setIsApproving(true);
    setApproveError('');
    try {
      const payload = request.items.map(item => {
        const edit = editState[item.id];
        const approvedQty = Number(edit.approvedQty);
        const landedUnitCost = Number(edit.landedUnitCost) || 0;
        const entry: {
          itemId: string;
          approvedQty: number;
          landedUnitCost: number;
          sourceSellerId?: string;
        } = {
          itemId: item.id,
          approvedQty,
          landedUnitCost,
        };
        if (edit.sourceSellerId) entry.sourceSellerId = edit.sourceSellerId;
        return entry;
      });
      await adminProcurementService.approve(request.id, payload);
      setIsEditing(false);
      setEditState({});
      setItemErrors({});
      await fetchRequest();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        const msg = Array.isArray(err.body.message) ? err.body.message.join('. ') : err.body.message;
        setApproveError(typeof msg === 'string' ? msg : 'Failed to approve request');
      } else {
        setApproveError('Something went wrong. Please try again.');
      }
    } finally {
      setIsApproving(false);
    }
  };

  const closeModal = () => setActiveModal(null);
  const onActionComplete = async () => {
    closeModal();
    await fetchRequest();
  };

  if (loading) {
    return (
      <div className="procurement-detail-page">
        <div className="procurement-loading">Loading procurement request...</div>
      </div>
    );
  }

  if (fetchError || !request) {
    return (
      <div className="procurement-detail-page">
        <button className="procurement-detail-back" onClick={() => router.push('/dashboard/procurement')}>
          &larr; Back to procurement
        </button>
        <div className="procurement-error">
          <p>{fetchError || 'Procurement request not found'}</p>
          <button onClick={fetchRequest}>Retry</button>
        </div>
      </div>
    );
  }

  const status = request.status;
  const canApprove = status === 'SUBMITTED';
  const canReject = status === 'SUBMITTED';
  const canDispatch = ['APPROVED', 'PARTIALLY_APPROVED', 'SOURCING'].includes(status);
  const canSettle = ['RECEIVED', 'PARTIALLY_RECEIVED'].includes(status);
  const showReceiveColumns = ['DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'SETTLED'].includes(status);

  const statusColor = getProcurementStatusColor(status);

  return (
    <div className="procurement-detail-page">
      <button className="procurement-detail-back" onClick={() => router.push('/dashboard/procurement')}>
        &larr; Back to procurement
      </button>

      <div className="procurement-detail-layout">
        <div className="procurement-detail-main">
          {/* Header */}
          <div className="procurement-detail-header-card">
            <div className="procurement-detail-header-row">
              <div>
                <div className="procurement-detail-title">{request.requestNumber}</div>
                {request.franchise && (
                  <div className="procurement-detail-subtitle">
                    <strong>{request.franchise.franchiseCode}</strong> &middot; {request.franchise.businessName}
                  </div>
                )}
              </div>
              <span
                className="procurement-status-badge"
                style={{
                  background: `${statusColor}15`,
                  color: statusColor,
                  border: `1px solid ${statusColor}40`,
                  padding: '6px 14px',
                  fontSize: 12,
                }}
              >
                {getProcurementStatusLabel(status)}
              </span>
            </div>

            <div className="procurement-timeline">
              <div className="procurement-timeline-item">
                <span className="procurement-timeline-label">Requested</span>
                <span className={`procurement-timeline-value${request.requestedAt ? '' : ' muted'}`}>
                  {formatProcurementDate(request.requestedAt)}
                </span>
              </div>
              <div className="procurement-timeline-item">
                <span className="procurement-timeline-label">Approved</span>
                <span className={`procurement-timeline-value${request.approvedAt ? '' : ' muted'}`}>
                  {formatProcurementDate(request.approvedAt)}
                </span>
              </div>
              <div className="procurement-timeline-item">
                <span className="procurement-timeline-label">Dispatched</span>
                <span className={`procurement-timeline-value${request.dispatchedAt ? '' : ' muted'}`}>
                  {formatProcurementDate(request.dispatchedAt)}
                </span>
              </div>
              <div className="procurement-timeline-item">
                <span className="procurement-timeline-label">Received</span>
                <span className={`procurement-timeline-value${request.receivedAt ? '' : ' muted'}`}>
                  {formatProcurementDate(request.receivedAt)}
                </span>
              </div>
              <div className="procurement-timeline-item">
                <span className="procurement-timeline-label">Settled</span>
                <span className={`procurement-timeline-value${request.settledAt ? '' : ' muted'}`}>
                  {formatProcurementDate(request.settledAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="procurement-detail-card">
            <h3>Items ({request.items.length})</h3>

            {isEditing && (
              <div className="procurement-approve-banner">
                <strong>Approval mode:</strong> Adjust approved quantities and enter landed unit costs for each item. Set <strong>approvedQty = 0</strong> to reject an item. Procurement fee rate:{' '}
                <strong>{feeRate}%</strong>
              </div>
            )}

            {approveError && (
              <div className="modal-alert modal-alert-error" style={{ marginBottom: 16 }}>
                {approveError}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="procurement-items-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="numeric">Req Qty</th>
                    <th className="numeric">Approved Qty</th>
                    <th className="numeric">Landed Cost/Unit</th>
                    <th className="numeric">Fee/Unit</th>
                    <th className="numeric">Final Cost/Unit</th>
                    {showReceiveColumns && (
                      <>
                        <th className="numeric">Received</th>
                        <th className="numeric">Damaged</th>
                      </>
                    )}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map(item => {
                    const edit = editState[item.id];
                    const errs = itemErrors[item.id] || {};
                    const liveCost = isEditing && edit
                      ? Number(edit.landedUnitCost) || 0
                      : item.landedUnitCost ?? 0;
                    const feePerUnit = (liveCost * feeRate) / 100;
                    const finalPerUnit = liveCost + feePerUnit;
                    const itemStatusColor = getProcurementItemStatusColor(item.status);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="procurement-item-product">
                            <span className="procurement-item-product-title">{item.productTitle}</span>
                            {item.variantTitle && (
                              <span className="procurement-item-product-variant">{item.variantTitle}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="procurement-item-sku">{item.globalSku}</span>
                        </td>
                        <td className="numeric">{item.requestedQty}</td>
                        <td className="numeric">
                          {isEditing ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                max={item.requestedQty}
                                step={1}
                                className={`procurement-item-input${errs.approvedQty ? ' error' : ''}`}
                                value={edit?.approvedQty ?? ''}
                                onChange={e => updateItemField(item.id, 'approvedQty', e.target.value)}
                              />
                              {errs.approvedQty && (
                                <span className="procurement-item-error-text">{errs.approvedQty}</span>
                              )}
                            </>
                          ) : (
                            item.approvedQty
                          )}
                        </td>
                        <td className="numeric">
                          {isEditing ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className={`procurement-item-input wide${errs.landedUnitCost ? ' error' : ''}`}
                                value={edit?.landedUnitCost ?? ''}
                                onChange={e => updateItemField(item.id, 'landedUnitCost', e.target.value)}
                                placeholder="0.00"
                              />
                              {errs.landedUnitCost && (
                                <span className="procurement-item-error-text">{errs.landedUnitCost}</span>
                              )}
                            </>
                          ) : item.landedUnitCost != null ? (
                            formatCurrency(item.landedUnitCost)
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                        <td className="numeric">
                          {liveCost > 0 ? formatCurrency(feePerUnit) : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td className="numeric">
                          {liveCost > 0 ? (
                            <strong>{formatCurrency(finalPerUnit)}</strong>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                        {showReceiveColumns && (
                          <>
                            <td className="numeric">{item.receivedQty}</td>
                            <td className="numeric">
                              {item.damagedQty > 0 ? (
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>{item.damagedQty}</span>
                              ) : (
                                item.damagedQty
                              )}
                            </td>
                          </>
                        )}
                        <td>
                          <span
                            className="procurement-item-status-badge"
                            style={{
                              background: `${itemStatusColor}15`,
                              color: itemStatusColor,
                              border: `1px solid ${itemStatusColor}40`,
                            }}
                          >
                            {getProcurementItemStatusLabel(item.status)}
                          </span>
                          {isEditing && edit && Number(edit.approvedQty) === 0 && (
                            <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4, fontWeight: 600 }}>
                              WILL BE REJECTED
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="procurement-totals">
              <div className="procurement-total-row">
                <span className="procurement-total-label">Requested Total</span>
                <span className="procurement-total-value">{formatCurrency(liveTotals.requested)}</span>
              </div>
              <div className="procurement-total-row">
                <span className="procurement-total-label">Approved Total</span>
                <span className="procurement-total-value">{formatCurrency(liveTotals.approved)}</span>
              </div>
              <div className="procurement-total-row">
                <span className="procurement-total-label">Procurement Fee ({feeRate}%)</span>
                <span className="procurement-total-value">{formatCurrency(liveTotals.fee)}</span>
              </div>
              <div className="procurement-total-row final">
                <span className="procurement-total-label">Final Payable</span>
                <span className="procurement-total-value">{formatCurrency(liveTotals.final)}</span>
              </div>
            </div>

            {isEditing && (
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  justifyContent: 'flex-end',
                  paddingTop: 20,
                  marginTop: 20,
                  borderTop: '1px solid #f3f4f6',
                }}
              >
                <button className="modal-btn" onClick={cancelEditing} disabled={isApproving}>
                  Cancel
                </button>
                <button
                  className="modal-btn modal-btn-primary"
                  onClick={handleApprove}
                  disabled={isApproving}
                >
                  {isApproving ? 'Submitting...' : 'Confirm Approval'}
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          {request.notes && (
            <div className="procurement-detail-card">
              <h3>Franchise Notes</h3>
              <div className="procurement-notes-box">{request.notes}</div>
            </div>
          )}
        </div>

        {/* Sticky Sidebar */}
        <div className="procurement-detail-sidebar">
          <div className="procurement-actions-card">
            <h3>Actions</h3>

            {status === 'SUBMITTED' && (
              <>
                {!isEditing ? (
                  <button
                    className="procurement-action-btn success"
                    onClick={startEditing}
                    disabled={!canApprove}
                  >
                    Approve Request
                  </button>
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      padding: '10px 12px',
                      background: 'var(--color-bg-page)',
                      borderRadius: 'var(--radius)',
                      marginBottom: 10,
                      lineHeight: 1.5,
                    }}
                  >
                    Edit the items table, then click <strong>Confirm Approval</strong> below the table.
                  </div>
                )}
                <button
                  className="procurement-action-btn danger"
                  onClick={() => setActiveModal('reject')}
                  disabled={!canReject || isEditing}
                >
                  Reject Request
                </button>
              </>
            )}

            {canDispatch && (
              <button
                className="procurement-action-btn primary"
                onClick={() => setActiveModal('dispatch')}
              >
                Mark as Dispatched
              </button>
            )}

            {['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(status) && !canSettle && (
              <div className="procurement-actions-note">
                Waiting for the franchise to confirm receipt of goods. Once received, you can settle this request.
              </div>
            )}

            {canSettle && (
              <button
                className="procurement-action-btn success"
                onClick={() => setActiveModal('settle')}
              >
                Settle Procurement
              </button>
            )}

            {['REJECTED', 'CANCELLED', 'SETTLED'].includes(status) && (
              <div className="procurement-actions-note">
                This request is <strong>{getProcurementStatusLabel(status).toLowerCase()}</strong>. No further actions are available.
              </div>
            )}

            {!isEditing && status === 'SUBMITTED' && (
              <div className="procurement-actions-note">
                Review each item&apos;s requested quantity before approving. You can partially approve items by adjusting the approved quantity.
              </div>
            )}
          </div>

          {/* Summary card */}
          <div className="procurement-actions-card" style={{ marginTop: 16 }}>
            <h3>Summary</h3>
            <div className="procurement-info-grid">
              <div className="procurement-info-item">
                <span className="procurement-info-label">Items</span>
                <span className="procurement-info-value">{request.items.length}</span>
              </div>
              <div className="procurement-info-item">
                <span className="procurement-info-label">Fee Rate</span>
                <span className="procurement-info-value">{feeRate}%</span>
              </div>
              <div className="procurement-info-item">
                <span className="procurement-info-label">Requested</span>
                <span className="procurement-info-value">{formatCurrency(request.totalRequestedAmount)}</span>
              </div>
              <div className="procurement-info-item">
                <span className="procurement-info-label">Final Payable</span>
                <span className="procurement-info-value">{formatCurrency(request.finalPayableAmount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {activeModal === 'reject' && (
        <RejectProcurementModal request={request} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'dispatch' && (
        <DispatchProcurementModal request={request} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'settle' && (
        <SettleProcurementModal request={request} onClose={closeModal} onSuccess={onActionComplete} />
      )}
    </div>
  );
}
