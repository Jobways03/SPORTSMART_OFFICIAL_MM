'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  adminProcurementService,
  AdminProcurementRequest,
  ApproveItemInput,
  statusPalette,
} from '@/services/admin-procurement.service';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';

function formatINR(n: number | string | null | undefined): string {
  // Procurement amounts (landed cost, approved total, procurement
  // fee, final payable, per-item final) are admin-entered at the
  // approve step. On a SUBMITTED request they come back as 0/null
  // — rendering "₹0" reads like a real zero and confuses the
  // reviewer. Em-dash signals "not set yet".
  if (n == null || Number(n) === 0) return '\u2014';
  return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type ApproveDraft = Record<
  string,
  { approvedQty: number; landedUnitCost: number }
>;

export default function AdminProcurementDetailPage() {
  const { notify, confirmDialog } = useModal();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [request, setRequest] = useState<AdminProcurementRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [working, setWorking] = useState<null | 'approve' | 'reject' | 'dispatch' | 'settle'>(null);

  // Approve modal state
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveDraft, setApproveDraft] = useState<ApproveDraft>({});

  // Reject modal state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Dispatch modal state
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [shipTracking, setShipTracking] = useState('');
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipEta, setShipEta] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminProcurementService.get(id);
      if (res.data) setRequest(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.body.message || 'Failed to load' : 'Failed to load',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const openApprove = () => {
    if (!request) return;
    const draft: ApproveDraft = {};
    for (const item of request.items) {
      // Pre-fill landed cost with the best-available default:
      //   1. Already-entered landedUnitCost (re-opening the modal)
      //   2. Per-franchise negotiated override (Option C — admin has
      //      set an explicit price for this franchise + SKU)
      //   3. The variant's saved procurementPrice (platform-wide
      //      default written back by approveRequest when no override
      //      exists)
      //   4. The product's saved procurementPrice (fallback for
      //      product-level mappings with no variant)
      //   5. 0 if nothing is known yet
      //
      // Note: costPrice is intentionally NOT part of this chain —
      // it's a display-only informational field per product policy.
      const prior = Number(item.landedUnitCost ?? 0);
      const franchisePrice = Number(
        (item as any).franchisePrice?.landedUnitCost ?? 0,
      );
      const variantProcurement = Number(
        (item as any).variant?.procurementPrice ?? 0,
      );
      const productProcurement = Number(
        (item as any).product?.procurementPrice ?? 0,
      );
      const landedUnitCost =
        prior || franchisePrice || variantProcurement || productProcurement || 0;
      draft[item.id] = {
        approvedQty: item.approvedQty || item.requestedQty,
        landedUnitCost,
      };
    }
    setApproveDraft(draft);
    setActionError('');
    setApproveOpen(true);
  };

  const handleApprove = async () => {
    if (!request) return;
    const items: ApproveItemInput[] = Object.entries(approveDraft).map(
      ([itemId, v]) => ({
        itemId,
        approvedQty: Number(v.approvedQty),
        landedUnitCost: Number(v.landedUnitCost),
      }),
    );
    // Validate each item; also require at least one item be approved
    // (approvedQty > 0). An "approve everything as zero" submission
    // is equivalent to rejection and should go through the Reject
    // flow instead — otherwise the procurement status moves to
    // APPROVED with nothing to dispatch.
    let anyApproved = false;
    for (const it of items) {
      if (it.approvedQty < 0) {
        setActionError('Approved quantity cannot be negative');
        return;
      }
      if (it.approvedQty > 0) {
        anyApproved = true;
        if (it.landedUnitCost <= 0) {
          setActionError(
            'Landed unit cost must be greater than 0 for approved items',
          );
          return;
        }
      }
    }
    if (!anyApproved) {
      setActionError(
        'Approve at least one item with quantity > 0, or use Reject to decline the request',
      );
      return;
    }
    setActionError('');
    setWorking('approve');
    try {
      await adminProcurementService.approve(request.id, items);
      setSuccessMsg('Request approved');
      setApproveOpen(false);
      await fetch();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.body.message || 'Approve failed' : 'Approve failed',
      );
    } finally {
      setWorking(null);
    }
  };

  const handleReject = async () => {
    if (!request) return;
    if (!rejectReason.trim()) {
      setActionError('Please provide a rejection reason');
      return;
    }
    setActionError('');
    setWorking('reject');
    try {
      await adminProcurementService.reject(request.id, rejectReason.trim());
      setSuccessMsg('Request rejected');
      setRejectOpen(false);
      setRejectReason('');
      await fetch();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.body.message || 'Reject failed' : 'Reject failed',
      );
    } finally {
      setWorking(null);
    }
  };

  const openDispatch = () => {
    setShipTracking(request?.trackingNumber ?? '');
    setShipCarrier(request?.carrierName ?? '');
    setShipEta(
      request?.expectedDeliveryAt
        ? new Date(request.expectedDeliveryAt).toISOString().slice(0, 10)
        : '',
    );
    setActionError('');
    setDispatchOpen(true);
  };

  const handleDispatch = async () => {
    if (!request) return;
    setActionError('');
    setWorking('dispatch');
    try {
      await adminProcurementService.dispatch(request.id, {
        trackingNumber: shipTracking.trim() || undefined,
        carrierName: shipCarrier.trim() || undefined,
        expectedDeliveryAt: shipEta
          ? new Date(shipEta).toISOString()
          : undefined,
      });
      setSuccessMsg('Marked as dispatched');
      setDispatchOpen(false);
      await fetch();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.body.message || 'Dispatch failed' : 'Dispatch failed',
      );
    } finally {
      setWorking(null);
    }
  };

  const handleSettle = async () => {if (!request) return;
    if (
      !(await confirmDialog(
        `Settle this request? Procurement fee ${formatINR(request.procurementFeeAmount)} will be recorded in the franchise finance ledger.`,
      ))
    )
      return;
    setActionError('');
    setWorking('settle');
    try {
      await adminProcurementService.settle(request.id);
      setSuccessMsg('Request settled');
      await fetch();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.body.message || 'Settle failed' : 'Settle failed',
      );
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
          Loading\u2026
        </div>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 16,
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: 8,
            border: '1px solid #fecaca',
          }}
        >
          {error || 'Procurement request not found'}
        </div>
      </div>
    );
  }

  const palette = statusPalette(request.status);
  const canApprove = request.status === 'SUBMITTED';
  const canReject = request.status === 'SUBMITTED';
  const canDispatch =
    request.status === 'APPROVED' ||
    request.status === 'PARTIALLY_APPROVED' ||
    request.status === 'SOURCING';
  const canSettle = request.status === 'RECEIVED';

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => router.push('/dashboard/procurement')}
        >
          &larr; Back to list
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{request.requestNumber}</h1>
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                background: palette.bg,
                color: palette.color,
              }}
            >
              {request.status}
            </span>
          </div>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            {request.franchise?.businessName ?? '\u2014'}
            {request.franchise?.franchiseCode && (
              <>
                {' '}
                &middot;{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {request.franchise.franchiseCode}
                </span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canApprove && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openApprove}
                disabled={working !== null}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: '#b91c1c' }}
                onClick={() => {
                  setRejectOpen(true);
                  setActionError('');
                }}
                disabled={working !== null}
              >
                Reject
              </button>
            </>
          )}
          {canDispatch && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openDispatch}
              disabled={working !== null}
            >
              Mark Dispatched
            </button>
          )}
          {canSettle && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSettle}
              disabled={working !== null}
            >
              {working === 'settle' ? 'Settling\u2026' : 'Settle'}
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div
          style={{
            padding: 12,
            background: '#f0fdf4',
            color: '#166534',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {successMsg}
        </div>
      )}
      {actionError && (
        <div
          style={{
            padding: 12,
            background: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {actionError}
        </div>
      )}

      {/* Timeline */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            fontSize: 13,
          }}
        >
          <TimelineCell label="Requested" value={formatDateTime(request.requestedAt)} />
          <TimelineCell label="Approved" value={formatDateTime(request.approvedAt)} />
          <TimelineCell label="Dispatched" value={formatDateTime(request.dispatchedAt)} />
          <TimelineCell label="Received" value={formatDateTime(request.receivedAt)} />
          <TimelineCell label="Settled" value={formatDateTime(request.settledAt)} />
        </div>
      </div>

      {/* Shipment tracking (visible once dispatched) */}
      {(request.trackingNumber || request.carrierName || request.expectedDeliveryAt) && (
        <div
          style={{
            background: '#ecfeff',
            border: '1px solid #a5f3fc',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <TimelineCell
            label="Tracking #"
            value={request.trackingNumber || '—'}
          />
          <TimelineCell label="Carrier" value={request.carrierName || '—'} />
          <TimelineCell
            label="Expected delivery"
            value={
              request.expectedDeliveryAt
                ? new Date(request.expectedDeliveryAt).toLocaleDateString()
                : '—'
            }
          />
        </div>
      )}

      {/* Rejection reason (only if rejected) */}
      {request.status === 'REJECTED' && request.rejectionReason && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#991b1b',
              textTransform: 'uppercase',
              letterSpacing: 0.3,
              marginBottom: 6,
            }}
          >
            Rejection reason
          </div>
          <div style={{ color: '#7f1d1d', fontSize: 14, lineHeight: 1.5 }}>
            {request.rejectionReason}
          </div>
        </div>
      )}

      {/* Totals */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <TotalCard label="Approved cost" value={formatINR(request.totalApprovedAmount)} />
        <TotalCard
          label={`Procurement fee (${Number(request.procurementFeeRate)}%)`}
          value={formatINR(request.procurementFeeAmount)}
        />
        <TotalCard
          label="Franchise payable"
          value={formatINR(request.finalPayableAmount)}
          strong
        />
      </div>

      {/* Items */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Items ({request.items.length})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                <Th>Product</Th>
                <Th alignRight>Requested</Th>
                <Th alignRight>Approved</Th>
                <Th alignRight>Dispatched</Th>
                <Th alignRight>Received / Dmg</Th>
                <Th alignRight>Landed ₹</Th>
                <Th alignRight>Fee ₹</Th>
                <Th alignRight>Final ₹</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((it) => {
                const ip = statusPalette(it.status);
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>
                        {it.product?.title ?? '\u2014'}
                      </div>
                      {it.variant?.title && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {it.variant.title}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          color: '#9ca3af',
                          fontFamily: 'monospace',
                        }}
                      >
                        {it.globalSku}
                      </div>
                    </Td>
                    <Td alignRight>{it.requestedQty}</Td>
                    <Td alignRight>{it.approvedQty}</Td>
                    <Td alignRight>{it.dispatchedQty}</Td>
                    <Td alignRight>
                      {it.receivedQty}
                      {it.damagedQty > 0 && (
                        <span style={{ color: '#b91c1c', fontSize: 12 }}>
                          {' '}
                          ({it.damagedQty} dmg)
                        </span>
                      )}
                    </Td>
                    <Td alignRight>{formatINR(it.landedUnitCost)}</Td>
                    <Td alignRight>{formatINR(it.procurementFeePerUnit)}</Td>
                    <Td alignRight>
                      <span style={{ fontWeight: 600 }}>
                        {formatINR(it.finalUnitCostToFranchise)}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 999,
                          background: ip.bg,
                          color: ip.color,
                        }}
                      >
                        {it.status}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve modal */}
      {approveOpen && (
        <Modal onClose={() => setApproveOpen(false)}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Approve procurement {request.requestNumber}
          </h2>
          <p style={{ marginTop: 4, marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
            Set an approved quantity and landed unit cost for each item. Set
            quantity to 0 to reject that item. The procurement fee ({Number(request.procurementFeeRate)}%)
            is added on top automatically.
          </p>
          {actionError && (
            <div
              style={{
                padding: 10,
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {actionError}
            </div>
          )}
          <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <Th>Product</Th>
                  <Th alignRight>Requested</Th>
                  <Th alignRight>Approve qty</Th>
                  <Th alignRight>Landed ₹</Th>
                </tr>
              </thead>
              <tbody>
                {request.items.map((it) => {
                  const draft = approveDraft[it.id] ?? {
                    approvedQty: 0,
                    landedUnitCost: 0,
                  };
                  return (
                    <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>
                          {it.product?.title ?? '\u2014'}
                        </div>
                        {it.variant?.title && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {it.variant.title}
                          </div>
                        )}
                      </Td>
                      <Td alignRight>{it.requestedQty}</Td>
                      <Td alignRight>
                        <input
                          type="number"
                          min={0}
                          max={it.requestedQty}
                          value={draft.approvedQty}
                          onChange={(e) =>
                            setApproveDraft((prev) => ({
                              ...prev,
                              [it.id]: {
                                ...prev[it.id],
                                approvedQty: Math.max(
                                  0,
                                  Math.min(it.requestedQty, Number(e.target.value) || 0),
                                ),
                              },
                            }))
                          }
                          style={inputStyle}
                        />
                      </Td>
                      <Td alignRight>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={draft.landedUnitCost}
                          onChange={(e) =>
                            setApproveDraft((prev) => ({
                              ...prev,
                              [it.id]: {
                                ...prev[it.id],
                                landedUnitCost: Math.max(0, Number(e.target.value) || 0),
                              },
                            }))
                          }
                          style={inputStyle}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setApproveOpen(false)}
              disabled={working === 'approve'}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={working === 'approve'}
            >
              {working === 'approve' ? 'Saving\u2026' : 'Confirm Approval'}
            </button>
          </div>
        </Modal>
      )}

      {/* Dispatch modal — capture tracking info so franchise knows where shipment is */}
      {dispatchOpen && (
        <Modal onClose={() => setDispatchOpen(false)}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Mark {request.requestNumber} as dispatched
          </h2>
          <p style={{ marginTop: 4, marginBottom: 16, color: '#6b7280', fontSize: 13 }}>
            Enter shipment tracking so the franchise can follow the goods. All
            fields are optional but highly recommended.
          </p>
          {actionError && (
            <div
              style={{
                padding: 10,
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {actionError}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Tracking #
              </label>
              <input
                type="text"
                value={shipTracking}
                onChange={(e) => setShipTracking(e.target.value)}
                placeholder="e.g. SR-AWB-12345"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Carrier
              </label>
              <input
                type="text"
                value={shipCarrier}
                onChange={(e) => setShipCarrier(e.target.value)}
                placeholder="e.g. Shiprocket / BlueDart"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                display: 'block',
                marginBottom: 6,
              }}
            >
              Expected delivery
            </label>
            <input
              type="date"
              value={shipEta}
              onChange={(e) => setShipEta(e.target.value)}
              style={{
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14,
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDispatchOpen(false)}
              disabled={working === 'dispatch'}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDispatch}
              disabled={working === 'dispatch'}
            >
              {working === 'dispatch' ? 'Dispatching\u2026' : 'Confirm Dispatch'}
            </button>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {rejectOpen && (
        <Modal onClose={() => setRejectOpen(false)}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Reject {request.requestNumber}
          </h2>
          <p style={{ marginTop: 4, marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
            This cancels the request. The franchise will need to submit a new
            one. Reason is stored in the notes field.
          </p>
          {actionError && (
            <div
              style={{
                padding: 10,
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {actionError}
            </div>
          )}
          <textarea
            rows={4}
            placeholder="Reason for rejection (required)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              border: '1px solid #d1d5db',
              borderRadius: 8,
              marginBottom: 16,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRejectOpen(false)}
              disabled={working === 'reject'}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: '#dc2626', borderColor: '#dc2626' }}
              onClick={handleReject}
              disabled={working === 'reject'}
            >
              {working === 'reject' ? 'Saving\u2026' : 'Confirm Rejection'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: 100,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  textAlign: 'right',
};

function Th({
  children,
  alignRight,
}: {
  children?: React.ReactNode;
  alignRight?: boolean;
}) {
  return (
    <th
      style={{
        textAlign: alignRight ? 'right' : 'left',
        padding: '10px 14px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  alignRight,
}: {
  children?: React.ReactNode;
  alignRight?: boolean;
}) {
  return (
    <td
      style={{
        padding: '10px 14px',
        verticalAlign: 'middle',
        textAlign: alignRight ? 'right' : 'left',
      }}
    >
      {children}
    </td>
  );
}

function TimelineCell({ label, value }: { label: string; value: string }) {
  const set = value !== '\u2014';
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
      <div style={{ color: set ? '#111827' : '#9ca3af', fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        background: strong ? '#eff6ff' : '#fff',
        border: strong ? '1px solid #bfdbfe' : '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
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
          fontSize: 20,
          fontWeight: 700,
          color: strong ? '#1e40af' : '#111827',
          fontFamily: 'monospace',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17, 24, 39, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 720,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
