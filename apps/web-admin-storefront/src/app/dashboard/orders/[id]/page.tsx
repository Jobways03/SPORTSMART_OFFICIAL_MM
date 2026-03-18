'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ────────── types ────────── */
interface OrderItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

interface CommissionRecord {
  id: string;
  orderItemId: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  productEarning: number;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  refundedAdminEarning: number;
  createdAt: string;
}

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  commissionProcessed: boolean;
  items: OrderItem[];
  commissionRecords: CommissionRecord[];
  seller: { id: string; sellerShopName: string } | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  verified: boolean;
  verifiedAt: string | null;
  itemCount: number;
  createdAt: string;
  shippingAddressSnapshot: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  subOrders: SubOrder[];
}

/* ────────── helpers ────────── */
const fmt = (n: number) => `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) +
  ' at ' +
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/* ────────── badge components ────────── */
function StatusBadge({ label, variant }: { label: string; variant: 'warning' | 'success' | 'info' | 'danger' | 'neutral' }) {
  const colors: Record<string, { bg: string; fg: string; dot: string }> = {
    warning: { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
    success: { bg: '#dcfce7', fg: '#166534', dot: '#22c55e' },
    info:    { bg: '#ede9fe', fg: '#5b21b6', dot: '#8b5cf6' },
    danger:  { bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' },
    neutral: { bg: '#f3f4f6', fg: '#374151', dot: '#9ca3af' },
  };
  const c = colors[variant] || colors.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 600, padding: '4px 10px',
      borderRadius: 6, background: c.bg, color: c.fg,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot }} />
      {label}
    </span>
  );
}

function paymentBadgeVariant(s: string): 'warning' | 'success' | 'danger' | 'neutral' {
  if (s === 'PAID') return 'success';
  if (s === 'CANCELLED' || s === 'VOIDED') return 'danger';
  return 'warning';
}
function fulfillmentBadgeVariant(s: string): 'success' | 'info' {
  if (s === 'DELIVERED') return 'success';
  return s === 'FULFILLED' ? 'success' : 'info';
}

function fulfillmentLabel(s: string): string {
  if (s === 'DELIVERED') return 'Delivered';
  if (s === 'FULFILLED') return 'Fulfilled';
  return 'Unfulfilled';
}
function acceptBadgeVariant(s: string): 'success' | 'danger' | 'neutral' {
  if (s === 'ACCEPTED') return 'success';
  if (s === 'REJECTED') return 'danger';
  return 'neutral';
}

/* ────────── page ────────── */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrder = useCallback(() => {
    apiClient<OrderDetail>(`/admin/orders/${id}`)
      .then((res) => { if (res.data) setOrder(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const handleAction = async (endpoint: string, label: string) => {
    setActionLoading(label);
    try {
      await apiClient(endpoint, { method: 'PATCH' });
      fetchOrder();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading order...</div>;
  }

  if (!order) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Order not found</h3>
        <Link href="/dashboard/orders" style={{ color: '#2563eb' }}>Back to Orders</Link>
      </div>
    );
  }

  const addr = order.shippingAddressSnapshot;
  const allDelivered = order.subOrders.every((s) => s.fulfillmentStatus === 'DELIVERED');
  const allFulfilled = order.subOrders.every((s) => s.fulfillmentStatus === 'FULFILLED' || s.fulfillmentStatus === 'DELIVERED');
  const totalItems = order.subOrders.reduce((sum, s) => sum + s.items.reduce((a, i) => a + i.quantity, 0), 0);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard/orders"
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}
        >
          &#8592; Orders
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{order.orderNumber}</h1>
          <StatusBadge label={`Payment ${order.paymentStatus.toLowerCase()}`} variant={paymentBadgeVariant(order.paymentStatus)} />
          <StatusBadge label={allDelivered ? 'Delivered' : allFulfilled ? 'Fulfilled' : 'Unfulfilled'} variant={allFulfilled ? 'success' : 'info'} />
          {order.paymentStatus !== 'CANCELLED' && (
            <StatusBadge
              label={order.verified ? 'Verified' : 'Unverified'}
              variant={order.verified ? 'success' : 'warning'}
            />
          )}
        </div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{fmtDate(order.createdAt)} from Online Store</div>
      </div>

      {/* ── Verification Banner ── */}
      {!order.verified && order.paymentStatus !== 'CANCELLED' && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 10,
          padding: '16px 20px', marginBottom: 20, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e', marginBottom: 4 }}>
              Order Verification Required
            </div>
            <div style={{ fontSize: 13, color: '#78350f' }}>
              Please call the customer to verify this order. Once verified, it will be assigned to the seller.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleAction(`/admin/orders/${order.id}/verify`, 'verify')}
              disabled={!!actionLoading}
              style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
            >
              {actionLoading === 'verify' ? 'Verifying...' : 'Verify Order'}
            </button>
            <button
              onClick={() => handleAction(`/admin/orders/${order.id}/reject-order`, 'reject-order')}
              disabled={!!actionLoading}
              style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', background: '#dc2626', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
            >
              {actionLoading === 'reject-order' ? 'Rejecting...' : 'Reject Order'}
            </button>
          </div>
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>

          {/* ── Fulfillment cards (one per sub-order) ── */}
          {order.subOrders.map((so) => (
            <div key={so.id} style={cardStyle}>
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <StatusBadge
                  label={fulfillmentLabel(so.fulfillmentStatus)}
                  variant={fulfillmentBadgeVariant(so.fulfillmentStatus)}
                />
                <StatusBadge
                  label={so.acceptStatus}
                  variant={acceptBadgeVariant(so.acceptStatus)}
                />
              </div>

              {/* Seller + shipping info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, marginBottom: 14, fontSize: 13, color: '#374151' }}>
                <span>&#128666;</span>
                <span>Free Shipping</span>
                {so.seller && (
                  <span style={{ marginLeft: 'auto', fontWeight: 500, color: '#6b7280' }}>
                    Seller: {so.seller.sellerShopName}
                  </span>
                )}
              </div>

              {/* Line items */}
              {so.items.map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid #f3f4f6' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, background: '#f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', flexShrink: 0, border: '1px solid #e5e7eb',
                  }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 20, color: '#d1d5db' }}>&#128722;</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{item.productTitle}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {item.variantTitle && <span>{item.variantTitle}</span>}
                      {item.variantTitle && item.sku && <span> &middot; </span>}
                      {item.sku && <span>{item.sku}</span>}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', fontSize: 14, whiteSpace: 'nowrap', color: '#374151' }}>
                    {fmt(Number(item.unitPrice))} &times; {item.quantity}
                  </div>

                  <div style={{ fontWeight: 600, fontSize: 14, minWidth: 90, textAlign: 'right' }}>
                    {fmt(Number(item.totalPrice))}
                  </div>
                </div>
              ))}

              {/* Fulfillment / Accept actions (only after verification) */}
              {order.verified && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                  {so.acceptStatus === 'OPEN' && (
                    <>
                      <button
                        onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/accept`, `accept-${so.id}`)}
                        disabled={!!actionLoading}
                        style={btnOutline}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/reject`, `reject-${so.id}`)}
                        disabled={!!actionLoading}
                        style={{ ...btnOutline, color: '#dc2626', borderColor: '#fca5a5' }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {so.fulfillmentStatus === 'UNFULFILLED' && so.acceptStatus === 'ACCEPTED' && (
                    <button
                      onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/fulfill`, `fulfill-${so.id}`)}
                      disabled={!!actionLoading}
                      style={btnDark}
                    >
                      Mark as fulfilled
                    </button>
                  )}
                  {so.fulfillmentStatus === 'FULFILLED' && so.acceptStatus === 'ACCEPTED' && (
                    <button
                      onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/deliver`, `deliver-${so.id}`)}
                      disabled={!!actionLoading}
                      style={{ ...btnDark, background: '#7c3aed' }}
                    >
                      {actionLoading === `deliver-${so.id}` ? 'Updating...' : 'Mark as delivered'}
                    </button>
                  )}
                  {so.fulfillmentStatus === 'DELIVERED' && (
                    <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>&#10003; Delivered</span>
                  )}
                </div>
              )}
              {!order.verified && order.paymentStatus !== 'CANCELLED' && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>
                  Verify this order to enable actions
                </div>
              )}

              {/* Delivery & Commission Info */}
              {so.fulfillmentStatus === 'DELIVERED' && (
                <DeliveryInfoCard subOrder={so} onRefresh={fetchOrder} />
              )}
            </div>
          ))}

          {/* ── Payment card ── */}
          <div style={cardStyle}>
            <div style={{ marginBottom: 16 }}>
              <StatusBadge label={`Payment ${order.paymentStatus.toLowerCase()}`} variant={paymentBadgeVariant(order.paymentStatus)} />
            </div>

            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={payTd}>Subtotal</td>
                  <td style={payTdRight}>{totalItems} item{totalItems !== 1 ? 's' : ''}</td>
                  <td style={{ ...payTdRight, fontWeight: 600 }}>{fmt(Number(order.totalAmount))}</td>
                </tr>
                <tr>
                  <td style={payTd}>Shipping</td>
                  <td style={payTdRight}>Free Shipping</td>
                  <td style={{ ...payTdRight, fontWeight: 600 }}>{fmt(0)}</td>
                </tr>
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ ...payTd, fontWeight: 700, paddingTop: 12 }}>Total</td>
                  <td style={payTdRight} />
                  <td style={{ ...payTdRight, fontWeight: 700, paddingTop: 12 }}>{fmt(Number(order.totalAmount))}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 14, paddingTop: 14 }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={payTd}>Paid</td>
                    <td style={{ ...payTdRight, fontWeight: 600 }}>
                      {order.paymentStatus === 'PAID' ? fmt(Number(order.totalAmount)) : fmt(0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ ...payTd, fontWeight: 700 }}>Balance</td>
                    <td style={{ ...payTdRight, fontWeight: 700 }}>
                      {order.paymentStatus === 'PAID' ? fmt(0) : fmt(Number(order.totalAmount))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Payment actions (only after verification) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
              {order.verified && order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CANCELLED' && (
                <button
                  onClick={() => handleAction(`/admin/orders/${order.id}/mark-paid`, 'mark-paid')}
                  disabled={!!actionLoading}
                  style={btnDark}
                >
                  {actionLoading === 'mark-paid' ? 'Updating...' : 'Mark as paid'}
                </button>
              )}
              {order.paymentStatus === 'PAID' && (
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>&#10003; Paid</span>
              )}
              {order.paymentStatus === 'CANCELLED' && (
                <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>Order Cancelled</span>
              )}
            </div>
          </div>

          {/* ── Timeline ── */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Timeline</h3>
            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 20, marginLeft: 6 }}>
              {order.subOrders.some((so) => so.commissionProcessed) && (
                <TimelineEvent
                  text="Commission has been processed for this order."
                  time=""
                />
              )}
              {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
                <TimelineEvent
                  text="Order has been marked as delivered. Return/exchange window started."
                  time={order.subOrders.find((so) => so.deliveredAt)?.deliveredAt ? fmtDate(order.subOrders.find((so) => so.deliveredAt)!.deliveredAt!) : ''}
                />
              )}
              {order.subOrders.some((so) => so.fulfillmentStatus === 'FULFILLED' || so.fulfillmentStatus === 'DELIVERED') && (
                <TimelineEvent text="Order has been fulfilled." time="" />
              )}
              {order.paymentStatus === 'PAID' && (
                <TimelineEvent
                  text={`Payment of ${fmt(Number(order.totalAmount))} was collected on Cash on Delivery (COD).`}
                  time=""
                />
              )}
              <TimelineEvent
                text={`A ${fmt(Number(order.totalAmount))} INR payment is pending on Cash on Delivery (COD).`}
                time={fmtDate(order.createdAt)}
              />
              <TimelineEvent
                text={`${order.customer.firstName} ${order.customer.lastName} placed this order on Online Store.`}
                time={fmtDate(order.createdAt)}
              />
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (sidebar) ── */}
        <div style={{ flex: '0 0 320px', minWidth: 280 }}>
          {/* Notes */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Notes</h3>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No notes from customer</p>
          </div>

          {/* Customer */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Customer</h3>
            <div style={{ fontSize: 14 }}>
              <div style={{ fontWeight: 600, color: '#2563eb', marginBottom: 2 }}>
                {order.customer.firstName} {order.customer.lastName}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>1 order</div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Contact information</h4>
              <div style={{ fontSize: 13 }}>
                <div style={{ color: '#2563eb', marginBottom: 4 }}>{order.customer.email}</div>
                <div style={{ color: '#6b7280' }}>{order.customer.phone || 'No phone number'}</div>
              </div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Shipping address</h4>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                {addr.fullName}<br />
                {addr.addressLine1}<br />
                {addr.addressLine2 && <>{addr.addressLine2}<br /></>}
                {addr.postalCode} {addr.city} {addr.state}<br />
                {addr.country || 'India'}<br />
                {addr.phone}
              </div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Billing address</h4>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Same as shipping address</p>
            </div>
          </div>

          {/* Payment method */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Payment method</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ fontSize: 18 }}>&#128176;</span>
              <div>
                <div style={{ fontWeight: 600 }}>Cash on Delivery</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Customer pays on delivery</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────── delivery info card ────────── */
function DeliveryInfoCard({ subOrder, onRefresh }: { subOrder: SubOrder; onRefresh: () => void }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      // Auto-refresh when return window expires to pick up commission
      if (subOrder.returnWindowEndsAt && !subOrder.commissionProcessed) {
        const ends = new Date(subOrder.returnWindowEndsAt);
        if (new Date() >= ends) onRefresh();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [subOrder.returnWindowEndsAt, subOrder.commissionProcessed, onRefresh]);

  const returnWindowEnds = subOrder.returnWindowEndsAt ? new Date(subOrder.returnWindowEndsAt) : null;
  const returnWindowActive = returnWindowEnds ? now < returnWindowEnds : false;
  const remainingMs = returnWindowEnds ? Math.max(0, returnWindowEnds.getTime() - now.getTime()) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const totalSellerEarning = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.productEarning), 0);
  const totalCommission = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.totalCommission), 0);

  return (
    <div style={{ marginTop: 14, padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#374151' }}>Delivery & Commission Status</div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: '#374151', marginBottom: 10 }}>
        <div>
          <span style={{ color: '#6b7280', fontWeight: 500 }}>Delivered at: </span>
          <span style={{ fontWeight: 600 }}>
            {subOrder.deliveredAt ? fmtDate(subOrder.deliveredAt) : '-'}
          </span>
        </div>
        <div>
          <span style={{ color: '#6b7280', fontWeight: 500 }}>Return window: </span>
          {returnWindowActive ? (
            <span style={{ fontWeight: 600, color: '#f59e0b' }}>
              {remainingSec}s remaining
            </span>
          ) : (
            <span style={{ fontWeight: 600, color: '#16a34a' }}>Expired</span>
          )}
        </div>
      </div>

      {/* Commission status */}
      {subOrder.commissionProcessed && subOrder.commissionRecords?.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>
            Commission Processed
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Product</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Rate</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Commission</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Seller Earning</th>
              </tr>
            </thead>
            <tbody>
              {subOrder.commissionRecords.map((cr) => (
                <tr key={cr.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px', color: '#374151' }}>{cr.productTitle}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{cr.commissionRate}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{fmt(Number(cr.totalCommission))}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmt(Number(cr.productEarning))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                <td style={{ padding: '8px', fontWeight: 700, color: '#111' }} colSpan={2}>Total</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmt(totalCommission)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt(totalSellerEarning)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : returnWindowActive ? (
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>
          Commission will be processed after return window expires ({remainingSec}s)
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
          Processing commission...
        </div>
      )}
    </div>
  );
}

/* ────────── timeline event ────────── */
function TimelineEvent({ text, time }: { text: string; time: string }) {
  return (
    <div style={{ position: 'relative', paddingBottom: 18 }}>
      <div style={{
        position: 'absolute', left: -26, top: 4,
        width: 10, height: 10, borderRadius: '50%',
        background: '#d1d5db', border: '2px solid #fff',
      }} />
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{text}</div>
      {time && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{time}</div>}
    </div>
  );
}

/* ────────── styles ────────── */
const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const sideCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 18,
  marginBottom: 12,
};

const sideTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
  margin: '0 0 10px 0',
};

const sideSubTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  margin: '0 0 6px 0',
};

const sideSection: React.CSSProperties = {
  borderTop: '1px solid #f3f4f6',
  marginTop: 14,
  paddingTop: 14,
};

const payTd: React.CSSProperties = {
  padding: '6px 0',
  color: '#374151',
};

const payTdRight: React.CSSProperties = {
  padding: '6px 0',
  textAlign: 'right',
  color: '#6b7280',
};

const btnDark: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  background: '#111',
  color: '#fff',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: 8,
  cursor: 'pointer',
};
