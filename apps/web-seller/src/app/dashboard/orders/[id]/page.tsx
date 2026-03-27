'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/* -- types -- */
interface OrderItem {
  id: string;
  productId: string;
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
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productEarning: number;
  totalCommission: number;
  unitCommission: number;
  adminEarning: number;
  commissionRate: string;
  refundedAdminEarning: number;
  createdAt: string;
}

interface SubOrderDetail {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  acceptDeadlineAt: string | null;
  expectedDispatchDate: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  commissionProcessed: boolean;
  items: OrderItem[];
  commissionRecords: CommissionRecord[];
  masterOrder: {
    orderNumber: string;
    paymentMethod: string;
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
    customer: { firstName: string; lastName: string; email: string };
  };
}

/* -- helpers -- */
function getToken() {
  try {
    return sessionStorage.getItem('accessToken');
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDateTime = (d: string) => {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 4,
        background: color,
        color: '#fff',
        textTransform: 'capitalize',
      }}
    >
      {text}
    </span>
  );
}

function badgeColor(s: string) {
  if (s === 'PAID' || s === 'FULFILLED' || s === 'ACCEPTED') return '#22c55e';
  if (s === 'REJECTED' || s === 'CANCELLED' || s === 'VOIDED') return '#ef4444';
  return '#f59e0b';
}

const fulfillmentLabel = (status: string) => {
  switch (status) {
    case 'DELIVERED': return 'Delivered';
    case 'SHIPPED': return 'Shipped';
    case 'PACKED': return 'Packed';
    case 'FULFILLED': return 'Fulfilled';
    case 'CANCELLED': return 'Cancelled';
    default: return 'Packing';
  }
};

const fulfillmentColor = (status: string) => {
  switch (status) {
    case 'DELIVERED': return '#7c3aed';
    case 'FULFILLED': return '#22c55e';
    case 'SHIPPED': return '#2563eb';
    case 'PACKED': return '#d97706';
    case 'CANCELLED': return '#ef4444';
    default: return '#f59e0b';
  }
};

const rejectionReasonLabel = (reason: string) => {
  switch (reason) {
    case 'OUT_OF_STOCK': return 'Out of Stock';
    case 'CANNOT_SHIP': return 'Cannot Ship to Location';
    case 'LOCATION_ISSUE': return 'Location Issue';
    case 'OTHER': return 'Other';
    default: return reason;
  }
};

/* -- Deadline countdown component -- */
function AcceptDeadlineCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return (
      <div style={{
        background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
        padding: '12px 16px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>
          DEADLINE EXPIRED — Auto-rejecting
        </div>
        <div style={{ fontSize: 12, color: '#991b1b', marginTop: 4 }}>
          The acceptance deadline has passed. This order will be auto-rejected and reassigned.
        </div>
      </div>
    );
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const isUrgent = diffMs < 2 * 60 * 60 * 1000;
  const bgColor = isUrgent ? '#fef2f2' : '#fffbeb';
  const borderColor = isUrgent ? '#fecaca' : '#fde68a';
  const textColor = isUrgent ? '#dc2626' : '#d97706';

  return (
    <div style={{
      background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 8,
      padding: '12px 16px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
        ACCEPTANCE DEADLINE
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
        Deadline: {fmtDateTime(deadline)}
      </div>
    </div>
  );
}

/* -- page -- */
export default function SellerOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<SubOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Reject modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  // Accept modal state
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [expectedDispatchDate, setExpectedDispatchDate] = useState('');

  const fetchOrder = useCallback(() => {
    fetch(`${API_BASE}/api/v1/seller/orders/${id}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setOrder(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const handleAction = async (action: string, key: string, body?: object) => {
    setActionLoading(key);
    try {
      await fetch(`${API_BASE}/api/v1/seller/orders/${id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      fetchOrder();
    } catch {
      //
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    setActionLoading('reject');
    try {
      await fetch(`${API_BASE}/api/v1/seller/orders/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          reason: rejectReason || undefined,
          note: rejectNote || undefined,
        }),
      });
      fetchOrder();
    } catch {
      //
    } finally {
      setActionLoading(null);
      setShowRejectModal(false);
      setRejectReason('');
      setRejectNote('');
    }
  };

  const handleAcceptConfirm = async () => {
    setActionLoading('accept');
    try {
      await fetch(`${API_BASE}/api/v1/seller/orders/${id}/accept`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          expectedDispatchDate: expectedDispatchDate || undefined,
        }),
      });
      fetchOrder();
    } catch {
      //
    } finally {
      setActionLoading(null);
      setShowAcceptModal(false);
      setExpectedDispatchDate('');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading order...</div>;
  }

  if (!order) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Order not found</h3>
        <Link href="/dashboard/orders" style={{ color: '#2563eb' }}>
          Back to Orders
        </Link>
      </div>
    );
  }

  const mo = order.masterOrder;
  const totalQty = order.items.reduce((a, i) => a + i.quantity, 0);

  // Calculate earnings from commission records
  const totalProductEarning = (order.commissionRecords || []).reduce(
    (a, c) => a + Number(c.productEarning), 0
  );
  const sellerEarning = order.commissionRecords?.length > 0
    ? totalProductEarning
    : Number(order.subTotal) * 0.8;

  // Determine next fulfillment action — seller can only do UNFULFILLED → PACKED → SHIPPED
  const getNextFulfillmentAction = (): { label: string; status: string; color: string } | null => {
    if (order.acceptStatus !== 'ACCEPTED') return null;
    switch (order.fulfillmentStatus) {
      case 'UNFULFILLED': return { label: 'MARK AS PACKED', status: 'PACKED', color: '#d97706' };
      case 'PACKED': return { label: 'MARK AS SHIPPED', status: 'SHIPPED', color: '#2563eb' };
      default: return null; // After SHIPPED, delivery confirmed by admin
    }
  };

  const nextAction = getNextFulfillmentAction();

  return (
    <div>
      {/* -- header -- */}
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/dashboard/orders"
          style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}
        >
          &#8592; Back to Orders
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px 0' }}>Order {mo.orderNumber}</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Here are details about order.</p>
      </div>

      {/* Acceptance deadline countdown - shown prominently for OPEN orders */}
      {order.acceptStatus === 'OPEN' && order.acceptDeadlineAt && (
        <AcceptDeadlineCountdown deadline={order.acceptDeadlineAt} />
      )}

      {/* -- two-column layout -- */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* -- LEFT COLUMN -- */}
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>
          {/* -- Products card -- */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {fulfillmentLabel(order.fulfillmentStatus)} Products
                </span>
                <Badge text={order.acceptStatus} color={badgeColor(order.acceptStatus)} />
                <Badge text={fulfillmentLabel(order.fulfillmentStatus)} color={fulfillmentColor(order.fulfillmentStatus)} />
              </div>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                Total No. of Products Ordered - {totalQty}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                    <th style={thStyle}>PRODUCT ID</th>
                    <th style={thStyle}>IMAGE</th>
                    <th style={thStyle}>PRODUCT NAME</th>
                    <th style={thStyle}>PRICE PER UNIT</th>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>QTY</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Avl. QTY<br />For Fulfill</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>QTY<br />Fulfilled</th>
                    <th style={thStyle}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280' }}>
                          #{item.productId.slice(0, 8)}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 6,
                            background: '#f3f4f6',
                            border: '1px solid #e5e7eb',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: 18, color: '#d1d5db' }}>&#128722;</span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: '#2563eb' }}>{item.productTitle}</div>
                        {item.variantTitle && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{item.variantTitle}</div>
                        )}
                      </td>
                      <td style={tdStyle}>{fmt(Number(item.unitPrice))}</td>
                      <td style={tdStyle}>{item.sku || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {['SHIPPED', 'FULFILLED', 'DELIVERED'].includes(order.fulfillmentStatus) ? item.quantity : 0}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(Number(item.totalPrice))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* -- Action buttons -- */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
              {order.acceptStatus === 'OPEN' && (
                <>
                  <button
                    onClick={() => setShowAcceptModal(true)}
                    disabled={!!actionLoading}
                    style={btnBlue}
                  >
                    {actionLoading === 'accept' ? 'Processing...' : 'ACCEPT ORDER'}
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={!!actionLoading}
                    style={btnRed}
                  >
                    {actionLoading === 'reject' ? 'Processing...' : 'REJECT ORDER'}
                  </button>
                </>
              )}

              {/* Fulfillment status progression */}
              {nextAction && (
                <button
                  onClick={() => handleAction('status', 'status', { status: nextAction.status })}
                  disabled={!!actionLoading}
                  style={{ ...btnBlue, background: nextAction.color }}
                >
                  {actionLoading === 'status' ? 'Updating...' : nextAction.label}
                </button>
              )}

              {order.acceptStatus === 'ACCEPTED' && order.fulfillmentStatus === 'SHIPPED' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', fontSize: 12, fontWeight: 700,
                    padding: '4px 12px', borderRadius: 6,
                    background: '#dcfce7', color: '#166534',
                  }}>Shipped</span>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>Delivery will be confirmed by admin</span>
                </div>
              )}
              {order.acceptStatus === 'ACCEPTED' && order.fulfillmentStatus === 'FULFILLED' && (
                <span style={{ fontSize: 14, color: '#16a34a', fontWeight: 600 }}>&#10003; Order Fulfilled</span>
              )}
              {order.acceptStatus === 'ACCEPTED' && order.fulfillmentStatus === 'DELIVERED' && (
                <span style={{ fontSize: 14, color: '#16a34a', fontWeight: 600 }}>&#10003; Order Delivered</span>
              )}
              {order.acceptStatus === 'REJECTED' && (
                <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 600 }}>Order Rejected</span>
              )}
              {order.acceptStatus === 'CANCELLED' && (
                <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 600 }}>Order Cancelled</span>
              )}
            </div>
          </div>
        </div>

        {/* -- RIGHT SIDEBAR -- */}
        <div style={{ flex: '0 0 340px', minWidth: 300 }}>
          {/* -- CURRENT ORDER STATUS -- */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>CURRENT ORDER STATUS</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
              Here is current status of order.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <SideRow label="ORDERED ON" value={fmtDateTime(mo.createdAt)} />
                <SideRow label="DELIVERY METHOD" value="Free Shipping" />
                <SideRow label="SHIPPING APPLIED BY" value="Merchant Shipping" />
                <SideRow
                  label="ORDER STATUS"
                  value={
                    <Badge text={fulfillmentLabel(order.fulfillmentStatus)} color={fulfillmentColor(order.fulfillmentStatus)} />
                  }
                />
                <SideRow
                  label="PAYMENT STATUS"
                  value={<Badge text={order.paymentStatus} color={badgeColor(order.paymentStatus)} />}
                />
                {order.expectedDispatchDate && (
                  <SideRow
                    label="EXPECTED DISPATCH"
                    value={
                      <span style={{ color: '#2563eb', fontWeight: 700 }}>
                        {new Date(order.expectedDispatchDate).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </span>
                    }
                  />
                )}
                <SideRow label="SUB TOTAL" value={fmt(Number(order.subTotal))} />
                <SideRow label="SHIPPING" value={fmt(0)} />
                <SideRow label="TOTAL TAX (Inclusive)" value={fmt(0)} />
              </tbody>
            </table>
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                marginTop: 14,
                paddingTop: 14,
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <span>NET PAYMENT -</span>
              <span>{fmt(Number(order.subTotal))}</span>
            </div>
          </div>

          {/* -- REJECTION DETAILS (if rejected) -- */}
          {order.acceptStatus === 'REJECTED' && (order.rejectionReason || order.rejectionNote) && (
            <div style={{ ...sideCard, borderColor: '#fecaca', background: '#fef2f2' }}>
              <h3 style={{ ...sideCardTitle, color: '#dc2626' }}>REJECTION DETAILS</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {order.rejectionReason && (
                    <SideRow label="REASON" value={rejectionReasonLabel(order.rejectionReason)} />
                  )}
                  {order.rejectionNote && (
                    <SideRow label="NOTE" value={order.rejectionNote} />
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* -- SELLER EARNING -- */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>SELLER EARNING</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
              Here is earning of seller.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <SideRow label="PRODUCT EARNING" value={fmt(sellerEarning)} />
                <SideRow label="SHIPPING CHARGE EARNING" value={fmt(0)} />
                <SideRow label="TAX CHARGE EARNING (INCLUDED)" value={fmt(0)} />
                <SideRow label="TIP EARNING" value={fmt(0)} />
              </tbody>
            </table>
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                marginTop: 10,
                paddingTop: 10,
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <span>TOTAL ORDER EARNING -</span>
              <span>{fmt(sellerEarning)}</span>
            </div>
          </div>

          {/* -- DELIVERY & COMMISSION STATUS -- */}
          {order.fulfillmentStatus === 'DELIVERED' && (
            <SellerDeliveryCard order={order} onRefresh={fetchOrder} />
          )}

          {/* -- ADDITIONAL ORDER DETAILS -- */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>ADDITIONAL ORDER DETAILS</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
              Here are the additional details of the order.
            </p>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              <div>Order Number: <strong>{mo.orderNumber}</strong></div>
              <div>Payment Method: {mo.paymentMethod}</div>
              <div>Customer: {mo.customer.firstName} {mo.customer.lastName}</div>
              <div>Email: {mo.customer.email}</div>
            </div>
          </div>

          {/* -- SHIPPING ADDRESS -- */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>SHIPPING ADDRESS</h3>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              <div><strong>{mo.shippingAddressSnapshot.fullName}</strong></div>
              <div>{mo.shippingAddressSnapshot.phone}</div>
              <div>{mo.shippingAddressSnapshot.addressLine1}</div>
              {mo.shippingAddressSnapshot.addressLine2 && <div>{mo.shippingAddressSnapshot.addressLine2}</div>}
              <div>{mo.shippingAddressSnapshot.city}, {mo.shippingAddressSnapshot.state} - {mo.shippingAddressSnapshot.postalCode}</div>
            </div>
          </div>
        </div>
      </div>

      {/* -- REJECT MODAL -- */}
      {showRejectModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => { setShowRejectModal(false); setRejectReason(''); setRejectNote(''); }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 12, padding: 28, width: 440,
              maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#dc2626' }}>
              Reject Order
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
              Please provide a reason for rejecting this order. The order will be reassigned to another seller if available.
            </p>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Reason *
            </label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 13, marginBottom: 16, background: '#fff',
              }}
            >
              <option value="">Select a reason...</option>
              <option value="OUT_OF_STOCK">Out of Stock</option>
              <option value="CANNOT_SHIP">Cannot Ship to Location</option>
              <option value="LOCATION_ISSUE">Location Issue</option>
              <option value="OTHER">Other</option>
            </select>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Note (optional)
            </label>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Additional details about the rejection..."
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 13, marginBottom: 24, resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { setShowRejectModal(false); setRejectReason(''); setRejectNote(''); }}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: 600,
                  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!!actionLoading}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: 700, border: 'none',
                  background: '#dc2626', color: '#fff', borderRadius: 6, cursor: 'pointer',
                }}
              >
                {actionLoading === 'reject' ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- ACCEPT MODAL -- */}
      {showAcceptModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => { setShowAcceptModal(false); setExpectedDispatchDate(''); }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 12, padding: 28, width: 440,
              maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#16a34a' }}>
              Accept Order
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
              You can optionally set an expected dispatch date for this order.
            </p>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Expected Dispatch Date (optional)
            </label>
            <input
              type="date"
              value={expectedDispatchDate}
              onChange={(e) => setExpectedDispatchDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 13, marginBottom: 24, background: '#fff',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { setShowAcceptModal(false); setExpectedDispatchDate(''); }}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: 600,
                  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptConfirm}
                disabled={!!actionLoading}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: 700, border: 'none',
                  background: '#16a34a', color: '#fff', borderRadius: 6, cursor: 'pointer',
                }}
              >
                {actionLoading === 'accept' ? 'Accepting...' : 'Accept Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -- delivery & commission card for seller -- */
function SellerDeliveryCard({ order, onRefresh }: { order: SubOrderDetail; onRefresh: () => void }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      if (order.returnWindowEndsAt && !order.commissionProcessed) {
        if (new Date() >= new Date(order.returnWindowEndsAt)) onRefresh();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [order.returnWindowEndsAt, order.commissionProcessed, onRefresh]);

  const returnWindowEnds = order.returnWindowEndsAt ? new Date(order.returnWindowEndsAt) : null;
  const returnWindowActive = returnWindowEnds ? now < returnWindowEnds : false;
  const remainingSec = returnWindowEnds ? Math.max(0, Math.ceil((returnWindowEnds.getTime() - now.getTime()) / 1000)) : 0;

  const totalCommission = (order.commissionRecords || []).reduce((a, c) => a + Number(c.totalCommission), 0);
  const totalSellerEarning = (order.commissionRecords || []).reduce((a, c) => a + Number(c.productEarning), 0);

  return (
    <div style={sideCard}>
      <h3 style={sideCardTitle}>DELIVERY & COMMISSION</h3>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
        Delivery tracking and commission details.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          <SideRow label="DELIVERED AT" value={order.deliveredAt ? fmtDateTime(order.deliveredAt) : '-'} />
          <SideRow
            label="RETURN WINDOW"
            value={
              <span style={{ color: returnWindowActive ? '#f59e0b' : '#16a34a', fontWeight: 700 }}>
                {returnWindowActive ? `${remainingSec}s left` : 'Expired'}
              </span>
            }
          />
          <SideRow
            label="COMMISSION"
            value={
              <Badge
                text={order.commissionProcessed ? 'Processed' : returnWindowActive ? 'Pending' : 'Processing...'}
                color={order.commissionProcessed ? '#16a34a' : '#f59e0b'}
              />
            }
          />
        </tbody>
      </table>

      {order.commissionProcessed && order.commissionRecords?.length > 0 && (
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Commission Breakdown</div>
          {order.commissionRecords.map((cr) => (
            <div key={cr.id} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', marginBottom: 2 }}>{cr.productTitle}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                <span>Rate: {cr.commissionRate}</span>
                <span>Qty: {cr.quantity}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>Commission: {fmt(Number(cr.totalCommission))}</span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>Your Earning: {fmt(Number(cr.productEarning))}</span>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: '2px solid #e5e7eb' }}>
            <span>Total Commission</span>
            <span style={{ color: '#dc2626' }}>{fmt(totalCommission)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, marginTop: 4 }}>
            <span>Your Net Earning</span>
            <span style={{ color: '#16a34a' }}>{fmt(totalSellerEarning)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* -- sub-components -- */
function SideRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '5px 0', color: '#374151', fontSize: 12, fontWeight: 500 }}>{label} -</td>
      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, fontSize: 13 }}>{value}</td>
    </tr>
  );
}

/* -- styles -- */
const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
};

const sideCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 18,
  marginBottom: 14,
};

const sideCardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: '0 0 4px 0',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px',
  verticalAlign: 'middle',
};

const btnBlue: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: 700,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};

const btnRed: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: 700,
  border: 'none',
  background: '#ef4444',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};
