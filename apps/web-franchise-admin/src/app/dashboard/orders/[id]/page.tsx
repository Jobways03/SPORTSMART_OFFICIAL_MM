'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  adminFranchisesService,
  FranchiseSubOrderDetail,
} from '@/services/admin-franchises.service';
import { ShipmentPanel } from './_components/ShipmentPanel';
import { adminShippingService } from '@/services/admin-shipping.service';

const money = (v: unknown) =>
  `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const statusColor = (s?: string): { bg: string; fg: string } => {
  switch (s) {
    case 'DELIVERED':
      return { bg: '#dcfce7', fg: '#15803d' };
    case 'SHIPPED':
    case 'PACKED':
      return { bg: '#dbeafe', fg: '#1d4ed8' };
    case 'CANCELLED':
      return { bg: '#fee2e2', fg: '#b91c1c' };
    default:
      return { bg: '#f3f4f6', fg: '#374151' };
  }
};

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
};
const h2: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#111827',
  marginBottom: 12,
};
export default function FranchiseAdminOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || '';
  const [order, setOrder] = useState<FranchiseSubOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const reloadOrder = async () => {
    const r = await adminFranchisesService.getFranchiseOrder(id);
    if (r.data) setOrder(r.data);
  };

  const submitCancel = async () => {
    const trimmed = cancelReason.trim();
    if (trimmed.length < 10) {
      setCancelError('Cancellation reason is required (minimum 10 characters)');
      return;
    }
    setCancelError('');
    setCancelling(true);
    // SHIPPED/FULFILLED (in-transit) cancels need force=true (and the
    // orders.subOrder.cancel.force permission) server-side.
    const needsForce =
      order?.fulfillmentStatus === 'SHIPPED' ||
      order?.fulfillmentStatus === 'FULFILLED';
    try {
      await adminShippingService.cancelOrder(id, trimmed, needsForce);
      setCancelOpen(false);
      setCancelReason('');
      await reloadOrder();
    } catch (e: unknown) {
      setCancelError(
        (e as { body?: { message?: string } })?.body?.message ||
          'Cancel failed',
      );
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    adminFranchisesService
      .getFranchiseOrder(id)
      .then((res) => {
        if (res.data) setOrder(res.data);
        else setError('Order not found');
      })
      .catch(() => setError('Failed to load order'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return <p style={{ color: '#9ca3af', padding: 40 }}>Loading order...</p>;
  if (error || !order)
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.back()}
          style={{
            border: 'none',
            background: 'none',
            color: '#2563eb',
            cursor: 'pointer',
            marginBottom: 16,
          }}
        >
          &larr; Back to Orders
        </button>
        <p style={{ color: '#9ca3af' }}>{error || 'Order not found'}</p>
      </div>
    );

  const mo = order.masterOrder;
  const addr = mo?.shippingAddressSnapshot ?? null;
  const items = order.items ?? [];
  const fStatus = statusColor(order.fulfillmentStatus);

  return (
    <div style={{ maxWidth: 900 }}>
      <button
        onClick={() => router.back()}
        style={{
          border: 'none',
          background: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        &larr; Back to Orders
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            Order {mo?.orderNumber ?? order.id.slice(0, 8)}
          </h1>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            Fulfilled by {order.franchise?.businessName ?? 'Franchise'} ·{' '}
            {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 6,
              background: fStatus.bg,
              color: fStatus.fg,
            }}
          >
            {order.fulfillmentStatus?.replace(/_/g, ' ')}
          </span>
          {order.fulfillmentStatus !== 'CANCELLED' &&
            order.fulfillmentStatus !== 'DELIVERED' &&
            order.acceptStatus !== 'REJECTED' && (
              <button
                onClick={() => {
                  setCancelReason('');
                  setCancelError('');
                  setCancelOpen(true);
                }}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#b91c1c',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Cancel sub-order
              </button>
            )}
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Order Items</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              {['', 'Product', 'SKU', 'Qty', 'Unit', 'Total'].map((c, i) => (
                <th
                  key={i}
                  style={{
                    padding: '8px 10px',
                    fontSize: 11,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const url = it.imageUrl || null;
              return (
                <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '1px solid #e5e7eb',
                        background: '#f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: 15, color: '#9ca3af' }}>
                          &#128722;
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                    {it.productTitle}
                    {it.variantTitle ? (
                      <span style={{ color: '#6b7280' }}> — {it.variantTitle}</span>
                    ) : null}
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      fontFamily: 'monospace',
                      color: '#6b7280',
                    }}
                  >
                    {it.sku || '—'}
                  </td>
                  <td style={{ padding: '8px 10px' }}>{it.quantity}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                    {money(it.unitPrice)}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                    {money(it.totalPrice)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div
          style={{
            textAlign: 'right',
            marginTop: 12,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Sub-order total: {money(order.subTotal)}
        </div>
      </div>

      {order.fulfillmentStatus !== 'CANCELLED' && (
        <div style={{ marginBottom: 16 }}>
          {/* Full carrier panel (same component the seller/super admins use):
              AWB + tracking link, override status, download label, NDR/RTO,
              and carrier actions — refresh tracking, re-attempt, cancel order +
              shipment, request pickup, force RTO. */}
          <ShipmentPanel subOrderId={order.id} onChange={reloadOrder} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <div style={card}>
          <h2 style={h2}>Customer Shipping Address</h2>
          {addr ? (
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>
                {addr.fullName ?? addr.name ?? '—'}
              </div>
              {addr.phone && <div>{addr.phone}</div>}
              <div>{addr.addressLine1 ?? addr.line1 ?? ''}</div>
              {(addr.addressLine2 ?? addr.line2) && (
                <div>{addr.addressLine2 ?? addr.line2}</div>
              )}
              <div>
                {[addr.city, addr.state, addr.pincode]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            </div>
          ) : (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No address snapshot</p>
          )}
        </div>

        <div style={card}>
          <h2 style={h2}>Order Info</h2>
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.9 }}>
            <div>Order #: {mo?.orderNumber ?? '—'}</div>
            <div>
              Payment:{' '}
              {mo?.paymentMethodLabel ??
                (mo?.paymentMethod === 'COD'
                  ? 'Cash on Delivery'
                  : mo?.paymentMethod === 'ONLINE'
                    ? 'Online'
                    : (mo?.paymentMethod ?? '—'))}
            </div>
            <div>Payment status: {mo?.paymentStatus ?? '—'}</div>
            <div>Accept status: {order.acceptStatus?.replace(/_/g, ' ')}</div>
            <div>Delivery: {order.deliveryMethod ?? '—'}</div>
            {order.trackingNumber && (
              <div>
                Tracking: {order.courierName ? `${order.courierName} · ` : ''}
                {order.trackingNumber}
              </div>
            )}
            <div>Order total: {money(mo?.totalAmount)}</div>
          </div>
        </div>
      </div>

      {cancelOpen && (
        <div
          onClick={() => !cancelling && setCancelOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: 'min(480px, 92vw)',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              Cancel sub-order
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
              Cancels this franchise sub-order and its Delhivery shipment.
              {(order.fulfillmentStatus === 'SHIPPED' ||
                order.fulfillmentStatus === 'FULFILLED') &&
                ' This order is in transit — a force cancel will be attempted (needs elevated permission).'}
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation (min 10 characters)"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 13,
                resize: 'vertical',
                marginBottom: 8,
              }}
            />
            {cancelError && (
              <div style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 8 }}>
                {cancelError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setCancelOpen(false)}
                disabled={cancelling}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#374151',
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                onClick={submitCancel}
                disabled={cancelling}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  background: cancelling ? '#9ca3af' : '#b91c1c',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel sub-order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
