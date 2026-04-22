'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  returnsService,
  ReturnDetail,
  getReturnStatusLabel,
  getReturnStatusColor,
} from '@/services/returns.service';
import { useModal } from '@sportsmart/ui';
import { REASON_CATEGORIES } from '@/services/returns.service';

const getReasonLabel = (value: string) => {
  const found = REASON_CATEGORIES.find((r) => r.value === value);
  return found ? found.label : value;
};

export default function ReturnDetailPage() {
  const { notify, confirmDialog } = useModal();
const { returnId } = useParams<{ returnId: string }>();
  const router = useRouter();
  const [ret, setRet] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchReturn = useCallback(() => {
    setLoading(true);
    returnsService
      .get(returnId)
      .then((res) => {
        if (res.data) setRet(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [returnId]);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchReturn();
  }, [fetchReturn]);

  const handleCancel = async () => {if (!(await confirmDialog('Are you sure you want to cancel this return request?'))) return;
    setActionLoading(true);
    try {
      const res = await returnsService.cancel(returnId);
      if (res.success) {
        fetchReturn();
      } else {
        void notify(res.message || 'Failed to cancel return');
      }
    } catch {
      void notify('Failed to cancel return');
    } finally {
      setActionLoading(false);
    }
  };

  const handleHandedOver = async () => {if (!(await confirmDialog('Confirm that you have handed over the package to the courier?'))) return;
    setActionLoading(true);
    try {
      const res = await returnsService.markHandedOver(returnId);
      if (res.success) {
        fetchReturn();
      } else {
        void notify(res.message || 'Failed to update return');
      }
    } catch {
      void notify('Failed to update return');
    } finally {
      setActionLoading(false);
    }
  };

  const formatPrice = (price: number | null) =>
    price == null ? '-' : `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading return...</div>
      </>
    );
  }

  if (!ret) {
    return (
      <>
        <Navbar />
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '60px 16px',
            textAlign: 'center',
          }}
        >
          <h3>Return not found</h3>
          <Link href="/returns" style={{ marginTop: 16, display: 'inline-block' }}>
            Back to Returns
          </Link>
        </div>
      </>
    );
  }

  const statusLabel = getReturnStatusLabel(ret.status);
  const statusColor = getReturnStatusColor(ret.status);

  const canCancel = ret.status === 'REQUESTED';
  const canMarkHandedOver = ['APPROVED', 'PICKUP_SCHEDULED'].includes(ret.status);

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <Link
          href="/returns"
          style={{
            fontSize: 14,
            color: '#6b7280',
            textDecoration: 'none',
            marginBottom: 16,
            display: 'inline-block',
          }}
        >
          &#8592; Back to Returns
        </Link>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              Return {ret.returnNumber}
            </h1>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Order {ret.masterOrder?.orderNumber || '-'} &middot; Created{' '}
              {formatDate(ret.createdAt)}
            </div>
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: 6,
              background: statusColor + '20',
              color: statusColor,
            }}
          >
            {statusLabel}
          </span>
        </div>

        {/* Rejection reason */}
        {ret.rejectionReason && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>
              Rejection Reason
            </div>
            <div style={{ fontSize: 13, color: '#7f1d1d' }}>{ret.rejectionReason}</div>
          </div>
        )}

        {/* Customer Notes */}
        {ret.customerNotes && (
          <div
            style={{
              background: '#f9fafb',
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your Notes</div>
            <div style={{ fontSize: 13, color: '#374151' }}>{ret.customerNotes}</div>
          </div>
        )}

        {/* Items */}
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Return Items</h3>
          {ret.items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                gap: 12,
                paddingTop: 10,
                paddingBottom: 10,
                borderTop: '1px solid #f3f4f6',
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 8,
                  background: '#f3f4f6',
                  overflow: 'hidden',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #e5e7eb',
                }}
              >
                {item.orderItem?.imageUrl ? (
                  <img
                    src={item.orderItem.imageUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ fontSize: 22, color: '#d1d5db' }}>&#128722;</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>
                  {item.orderItem?.productTitle || 'Product'}
                </div>
                {item.orderItem?.variantTitle && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {item.orderItem.variantTitle}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Qty: {item.quantity}
                  {item.orderItem?.unitPrice != null &&
                    ` x ${formatPrice(Number(item.orderItem.unitPrice))}`}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                  <strong>Reason:</strong> {getReasonLabel(item.reasonCategory)}
                </div>
                {item.reasonDetail && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {item.reasonDetail}
                  </div>
                )}
              </div>
              {item.orderItem?.unitPrice != null && (
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>
                  {formatPrice(Number(item.orderItem.unitPrice) * item.quantity)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Refund Info */}
        {(ret.refundAmount != null ||
          ret.refundMethod ||
          ret.refundReference ||
          ret.refundProcessedAt) && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 16,
              marginBottom: 16,
              background: '#f0fdf4',
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#16a34a' }}>
              Refund Information
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {ret.refundAmount != null && (
                <div>
                  <span style={{ color: '#6b7280' }}>Amount: </span>
                  <strong>{formatPrice(Number(ret.refundAmount))}</strong>
                </div>
              )}
              {ret.refundMethod && (
                <div>
                  <span style={{ color: '#6b7280' }}>Method: </span>
                  <strong>{ret.refundMethod}</strong>
                </div>
              )}
              {ret.refundReference && (
                <div>
                  <span style={{ color: '#6b7280' }}>Reference: </span>
                  <strong>{ret.refundReference}</strong>
                </div>
              )}
              {ret.refundProcessedAt && (
                <div>
                  <span style={{ color: '#6b7280' }}>Processed on: </span>
                  <strong>{formatDate(ret.refundProcessedAt)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pickup Info */}
        {(ret.pickupScheduledAt || ret.pickupCourier || ret.pickupTrackingNumber) && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 16,
              marginBottom: 16,
              background: '#eff6ff',
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#2563eb' }}>
              Pickup Information
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {ret.pickupScheduledAt && (
                <div>
                  <span style={{ color: '#6b7280' }}>Scheduled: </span>
                  <strong>{formatDate(ret.pickupScheduledAt)}</strong>
                </div>
              )}
              {ret.pickupCourier && (
                <div>
                  <span style={{ color: '#6b7280' }}>Courier: </span>
                  <strong>{ret.pickupCourier}</strong>
                </div>
              )}
              {ret.pickupTrackingNumber && (
                <div>
                  <span style={{ color: '#6b7280' }}>Tracking: </span>
                  <strong>{ret.pickupTrackingNumber}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status Timeline */}
        {ret.statusHistory && ret.statusHistory.length > 0 && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Status Timeline</h3>
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              {ret.statusHistory.map((entry, idx) => {
                const entryColor = getReturnStatusColor(entry.toStatus);
                const isLast = idx === ret.statusHistory!.length - 1;
                return (
                  <div
                    key={entry.id}
                    style={{ position: 'relative', paddingBottom: isLast ? 0 : 16 }}
                  >
                    {/* Vertical line */}
                    {!isLast && (
                      <div
                        style={{
                          position: 'absolute',
                          left: -14,
                          top: 12,
                          bottom: -4,
                          width: 2,
                          background: '#e5e7eb',
                        }}
                      />
                    )}
                    {/* Dot */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -19,
                        top: 2,
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: entryColor,
                        border: '2px solid #fff',
                        boxShadow: '0 0 0 1px ' + entryColor,
                      }}
                    />
                    <div style={{ fontSize: 13, fontWeight: 600, color: entryColor }}>
                      {getReturnStatusLabel(entry.toStatus)}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {formatDate(entry.createdAt)}
                      {entry.changedBy && entry.changedBy !== 'SYSTEM' && ` \u00B7 by ${entry.changedBy}`}
                    </div>
                    {entry.notes && (
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                        {entry.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        {(canCancel || canMarkHandedOver) && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'flex-end',
              marginTop: 20,
              flexWrap: 'wrap',
            }}
          >
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #dc2626',
                  background: '#fff',
                  color: '#dc2626',
                  borderRadius: 8,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? 'Cancelling...' : 'Cancel Return'}
              </button>
            )}
            {canMarkHandedOver && (
              <button
                onClick={handleHandedOver}
                disabled={actionLoading}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #2563eb',
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? 'Updating...' : 'Mark Handed Over to Courier'}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
