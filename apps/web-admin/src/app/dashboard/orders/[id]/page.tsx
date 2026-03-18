'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ── types ── */
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
  seller: { id: string; sellerName: string; sellerShopName: string; email: string } | null;
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

/* ── helpers ── */
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

function badgeColor(status: string) {
  if (status === 'PAID' || status === 'FULFILLED' || status === 'ACCEPTED') return '#22c55e';
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'VOIDED') return '#ef4444';
  return '#f59e0b';
}

/* ── page ── */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrder = useCallback(() => {
    apiClient<OrderDetail>(`/admin/orders/${id}`)
      .then((res) => {
        if (res.data) setOrder(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const handleAction = async (endpoint: string, key: string) => {
    setActionLoading(key);
    try {
      await apiClient(endpoint, { method: 'PATCH' });
      fetchOrder();
    } catch {
      //
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
        <Link href="/dashboard/orders" style={{ color: '#2563eb' }}>
          Back to Orders
        </Link>
      </div>
    );
  }

  const addr = order.shippingAddressSnapshot;
  const totalItems = order.subOrders.reduce((s, so) => s + so.items.reduce((a, i) => a + i.quantity, 0), 0);

  return (
    <div>
      {/* ── breadcrumb ── */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        <Link href="/dashboard/orders" style={{ color: '#6b7280', textDecoration: 'none' }}>
          ORDERS
        </Link>{' '}
        &rsaquo; ORDER DETAILS
      </div>

      {/* ── header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Order {order.orderNumber}</h1>
            {order.paymentStatus !== 'CANCELLED' && (
              <Badge
                text={order.verified ? 'VERIFIED' : 'UNVERIFIED'}
                color={order.verified ? '#16a34a' : '#f59e0b'}
              />
            )}
            {order.paymentStatus === 'CANCELLED' && (
              <Badge text="CANCELLED" color="#dc2626" />
            )}
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Here are details about order.</p>
        </div>
      </div>

      {/* ── two-column layout ── */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          {/* ── Unfulfilled / Pending Products (one per sub-order) ── */}
          {order.subOrders.map((so) => (
            <div key={so.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {so.fulfillmentStatus === 'DELIVERED' ? 'Delivered' : so.fulfillmentStatus === 'FULFILLED' ? 'Fulfilled' : 'Unfulfilled/Pending'} Products
                  </span>
                  <Badge text={so.acceptStatus} color={badgeColor(so.acceptStatus)} />
                  {so.fulfillmentStatus === 'DELIVERED' && (
                    <Badge text="DELIVERED" color="#7c3aed" />
                  )}
                </div>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  Total No. of Products Ordered - {so.items.reduce((a, i) => a + i.quantity, 0)}
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
                      <th style={thStyle}>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {so.items.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={tdStyle}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280' }}>
                            #{item.productId.slice(0, 8)}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <div
                            style={{
                              width: 44,
                              height: 44,
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
                              <img
                                src={item.imageUrl}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
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
                        <td style={tdStyle}>{item.quantity}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(Number(item.totalPrice))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* ── BILLING & SHIPPING DETAILS ── */}
          <div style={cardStyle}>
            <h2 style={sectionTitle}>BILLING & SHIPPING DETAILS</h2>
            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              {/* Billing */}
              <div style={{ flex: '1 1 280px' }}>
                <h3 style={colTitle}>BILLING DETAILS</h3>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                  <tbody>
                    <DetailRow label="Payment Mode" value="Cash On Delivery (COD)" />
                    <DetailRow label="Name" value={addr.fullName} />
                    <DetailRow label="Address" value={addr.addressLine1 + (addr.addressLine2 ? `, ${addr.addressLine2}` : '')} />
                    <DetailRow label="Postal Code" value={addr.postalCode} />
                    <DetailRow label="Company" value="N/A" />
                    <DetailRow label="City" value={addr.city} />
                    <DetailRow label="State" value={addr.state} />
                    <DetailRow label="Country" value={addr.country || 'India'} />
                    <DetailRow label="Contact" value={addr.phone} />
                  </tbody>
                </table>
              </div>
              {/* Shipping */}
              <div style={{ flex: '1 1 280px' }}>
                <h3 style={colTitle}>SHIPPING DETAILS</h3>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                  <tbody>
                    <DetailRow
                      label="Order Status"
                      value={<Badge text={order.paymentStatus} color={badgeColor(order.paymentStatus)} />}
                    />
                    <DetailRow label="Name" value={addr.fullName} />
                    <DetailRow label="Shipping Address" value={addr.addressLine1 + (addr.addressLine2 ? `, ${addr.addressLine2}` : '')} />
                    <DetailRow label="Postal Code" value={addr.postalCode} />
                    <DetailRow label="Company" value="N/A" />
                    <DetailRow label="City" value={addr.city} />
                    <DetailRow label="State" value={addr.state} />
                    <DetailRow label="Country" value={addr.country || 'India'} />
                    <DetailRow label="Contact" value={addr.phone} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── SELLER DETAILS (one per sub-order) ── */}
          {order.subOrders.map(
            (so) =>
              so.seller && (
                <div key={`seller-${so.id}`} style={cardStyle}>
                  <h2 style={sectionTitle}>SELLER DETAILS</h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px 0' }}>
                    Here are seller details.
                  </p>
                  <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      <DetailRow
                        label="Seller Name"
                        value={
                          <span style={{ color: '#2563eb', fontWeight: 500 }}>{so.seller.sellerName}</span>
                        }
                      />
                      <DetailRow label="Seller Shop Name" value={so.seller.sellerShopName} />
                      <DetailRow label="Seller Email" value={so.seller.email} />
                      <DetailRow label="Invoice Number" value="-" />
                    </tbody>
                  </table>
                </div>
              ),
          )}

          {/* ── CUSTOMER DETAILS ── */}
          <div style={cardStyle}>
            <h2 style={sectionTitle}>CUSTOMER DETAILS</h2>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px 0' }}>
              Here are customer details.
            </p>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <DetailRow label="Name" value={`${order.customer.firstName} ${order.customer.lastName}`} />
                <DetailRow label="Email" value={order.customer.email} />
                <DetailRow label="Phone" value={order.customer.phone || 'N/A'} />
                <DetailRow label="Company" value="N/A" />
              </tbody>
            </table>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div style={{ flex: '0 0 340px', minWidth: 300 }}>
          {/* ── CURRENT ORDER STATUS ── */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>CURRENT ORDER STATUS</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
              Here is current status of order.
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <SideRow label="ORDERED ON" value={fmtDateTime(order.createdAt)} />
                <SideRow label="DELIVERY METHOD" value="Free Shipping" />
                <SideRow label="SHIPPING APPLIED BY" value="Merchant Shipping" />
                <SideRow
                  label="ORDER STATUS"
                  value={
                    <Badge
                      text={
                        order.subOrders.every((s) => s.fulfillmentStatus === 'DELIVERED')
                          ? 'Delivered'
                          : order.subOrders.every((s) => s.fulfillmentStatus === 'FULFILLED' || s.fulfillmentStatus === 'DELIVERED')
                            ? 'Fulfilled'
                            : 'Pending'
                      }
                      color={
                        order.subOrders.every((s) => s.fulfillmentStatus === 'DELIVERED')
                          ? '#7c3aed'
                          : order.subOrders.every((s) => s.fulfillmentStatus === 'FULFILLED' || s.fulfillmentStatus === 'DELIVERED')
                            ? '#22c55e'
                            : '#f59e0b'
                      }
                    />
                  }
                />
                <SideRow
                  label="PAYMENT STATUS"
                  value={<Badge text={order.paymentStatus} color={badgeColor(order.paymentStatus)} />}
                />
                <SideRow label="SUB TOTAL" value={fmt(Number(order.totalAmount))} />
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
              <span>{fmt(Number(order.totalAmount))}</span>
            </div>

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Verification actions */}
              {!order.verified && order.paymentStatus !== 'CANCELLED' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAction(`/admin/orders/${order.id}/verify`, 'verify')}
                    disabled={!!actionLoading}
                    style={btnSuccess}
                  >
                    {actionLoading === 'verify' ? 'Verifying...' : 'VERIFY ORDER'}
                  </button>
                  <button
                    onClick={() => handleAction(`/admin/orders/${order.id}/reject-order`, 'reject-order')}
                    disabled={!!actionLoading}
                    style={btnDanger}
                  >
                    {actionLoading === 'reject-order' ? 'Rejecting...' : 'REJECT ORDER'}
                  </button>
                </div>
              )}

              {/* Order actions (only after verification) */}
              {order.verified && (
                <>
                  {order.subOrders.some((so) => so.acceptStatus === 'OPEN') && (
                    <>
                      {order.subOrders
                        .filter((so) => so.acceptStatus === 'OPEN')
                        .map((so) => (
                          <div key={so.id} style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/accept`, `accept-${so.id}`)}
                              disabled={!!actionLoading}
                              style={btnSuccess}
                            >
                              {actionLoading === `accept-${so.id}` ? 'Accepting...' : 'ACCEPT ORDER'}
                            </button>
                            <button
                              onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/reject`, `reject-${so.id}`)}
                              disabled={!!actionLoading}
                              style={btnDanger}
                            >
                              REJECT
                            </button>
                          </div>
                        ))}
                    </>
                  )}

                  {order.subOrders.some(
                    (so) => so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'UNFULFILLED',
                  ) && (
                    <>
                      {order.subOrders
                        .filter((so) => so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'UNFULFILLED')
                        .map((so) => (
                          <button
                            key={so.id}
                            onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/fulfill`, `fulfill-${so.id}`)}
                            disabled={!!actionLoading}
                            style={btnOrange}
                          >
                            {actionLoading === `fulfill-${so.id}` ? 'Fulfilling...' : 'MARK AS FULFILLED'}
                          </button>
                        ))}
                    </>
                  )}

                  {order.subOrders.some(
                    (so) => so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'FULFILLED',
                  ) && (
                    <>
                      {order.subOrders
                        .filter((so) => so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'FULFILLED')
                        .map((so) => (
                          <button
                            key={so.id}
                            onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/deliver`, `deliver-${so.id}`)}
                            disabled={!!actionLoading}
                            style={btnPurple}
                          >
                            {actionLoading === `deliver-${so.id}` ? 'Updating...' : 'MARK AS DELIVERED'}
                          </button>
                        ))}
                    </>
                  )}

                  {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
                    <div style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>&#10003; Delivered</div>
                  )}

                  {order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CANCELLED' && (
                    <button
                      onClick={() => handleAction(`/admin/orders/${order.id}/mark-paid`, 'mark-paid')}
                      disabled={!!actionLoading}
                      style={btnDark}
                    >
                      {actionLoading === 'mark-paid' ? 'Processing...' : 'CAPTURE PAYMENT'}
                    </button>
                  )}
                </>
              )}

              {order.paymentStatus === 'CANCELLED' && (
                <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Order Cancelled</div>
              )}
            </div>
          </div>

          {/* ── SELLER EARNING ── */}
          {order.subOrders.map((so) => {
            const sellerEarning = so.commissionRecords?.length > 0
              ? so.commissionRecords.reduce((a, c) => a + Number(c.productEarning), 0)
              : Number(so.subTotal);
            return (
              <div key={`earn-${so.id}`} style={sideCard}>
                <h3 style={sideCardTitle}>SELLER EARNING</h3>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
                  Here is earning of seller.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    <SideRow label="PRODUCT EARNING" value={fmt(sellerEarning)} />
                    <SideRow label="SHIPPING CHARGE EARNING" value={fmt(0)} />
                    <SideRow label="TAX CHARGE EARNING" value={fmt(0)} />
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
                  <span>TOTAL ORDER EARNING</span>
                  <span>{fmt(sellerEarning)}</span>
                </div>
              </div>
            );
          })}

          {/* ── DELIVERY & COMMISSION STATUS ── */}
          {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
            <div style={sideCard}>
              <h3 style={sideCardTitle}>DELIVERY & COMMISSION</h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
                Delivery and commission processing status.
              </p>
              {order.subOrders
                .filter((so) => so.fulfillmentStatus === 'DELIVERED')
                .map((so) => (
                  <DeliveryStatusBlock key={`del-${so.id}`} subOrder={so} onRefresh={fetchOrder} />
                ))}
            </div>
          )}

          {/* ── ADDITIONAL ORDER DETAILS ── */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>ADDITIONAL ORDER DETAILS</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
              Here is additional details of order.
            </p>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              <div>Order ID: <span style={{ fontFamily: 'monospace' }}>{order.id}</span></div>
              <div style={{ marginTop: 6 }}>Payment Method: {order.paymentMethod}</div>
              <div style={{ marginTop: 6 }}>Items Ordered: {totalItems}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── delivery status block ── */
function DeliveryStatusBlock({ subOrder, onRefresh }: { subOrder: SubOrder; onRefresh: () => void }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      if (subOrder.returnWindowEndsAt && !subOrder.commissionProcessed) {
        if (new Date() >= new Date(subOrder.returnWindowEndsAt)) onRefresh();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [subOrder.returnWindowEndsAt, subOrder.commissionProcessed, onRefresh]);

  const returnWindowEnds = subOrder.returnWindowEndsAt ? new Date(subOrder.returnWindowEndsAt) : null;
  const returnWindowActive = returnWindowEnds ? now < returnWindowEnds : false;
  const remainingSec = returnWindowEnds ? Math.max(0, Math.ceil((returnWindowEnds.getTime() - now.getTime()) / 1000)) : 0;

  const totalCommission = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.totalCommission), 0);
  const totalSellerEarning = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.productEarning), 0);

  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      {subOrder.seller && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          Seller: {subOrder.seller.sellerShopName}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          <tr>
            <td style={{ padding: '4px 0', color: '#6b7280' }}>Delivered at</td>
            <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>
              {subOrder.deliveredAt ? fmtDateTime(subOrder.deliveredAt) : '-'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 0', color: '#6b7280' }}>Return Window</td>
            <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, color: returnWindowActive ? '#f59e0b' : '#16a34a' }}>
              {returnWindowActive ? `${remainingSec}s remaining` : 'Expired'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 0', color: '#6b7280' }}>Commission</td>
            <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, color: subOrder.commissionProcessed ? '#16a34a' : '#f59e0b' }}>
              {subOrder.commissionProcessed ? 'Processed' : returnWindowActive ? `Pending (${remainingSec}s)` : 'Processing...'}
            </td>
          </tr>
        </tbody>
      </table>

      {subOrder.commissionProcessed && subOrder.commissionRecords?.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Commission Breakdown:</div>
          {subOrder.commissionRecords.map((cr) => (
            <div key={cr.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
              <span style={{ color: '#6b7280' }}>{cr.productTitle} ({cr.commissionRate})</span>
              <span style={{ color: '#dc2626', fontWeight: 600 }}>{`\u20B9${Number(cr.totalCommission).toFixed(2)}`}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginTop: 4, borderTop: '1px solid #e5e7eb', paddingTop: 4 }}>
            <span>Total Commission</span>
            <span style={{ color: '#dc2626' }}>{`\u20B9${totalCommission.toFixed(2)}`}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginTop: 2 }}>
            <span>Seller Earning</span>
            <span style={{ color: '#16a34a' }}>{`\u20B9${totalSellerEarning.toFixed(2)}`}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── sub-components ── */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '6px 0', color: '#374151', fontWeight: 500, whiteSpace: 'nowrap', width: 140 }}>
        {label}
      </td>
      <td style={{ padding: '6px 8px', color: '#9ca3af' }}>-</td>
      <td style={{ padding: '6px 0', color: '#111' }}>{value}</td>
    </tr>
  );
}

function SideRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '5px 0', color: '#374151', fontSize: 12, fontWeight: 500 }}>{label} -</td>
      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, fontSize: 13 }}>{value}</td>
    </tr>
  );
}

/* ── styles ── */
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

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: '0 0 4px 0',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

const colTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
  textTransform: 'uppercase',
  margin: '0 0 10px 0',
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

const btnSuccess: React.CSSProperties = {
  flex: 1,
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  background: '#22c55e',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};

const btnDanger: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  background: '#ef4444',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};

const btnOrange: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  background: '#f59e0b',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};

const btnPurple: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  background: '#7c3aed',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};

const btnDark: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  background: '#374151',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  letterSpacing: '0.03em',
};
