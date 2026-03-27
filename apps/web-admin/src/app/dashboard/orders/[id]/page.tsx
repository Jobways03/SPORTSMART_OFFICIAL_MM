'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* -- types -- */
interface OrderItem {
  id: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  masterSku: string | null;
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
  acceptDeadline: string | null;
  items: OrderItem[];
  commissionRecords: CommissionRecord[];
  seller: { id: string; sellerName: string; sellerShopName: string; email: string } | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationRemarks: string | null;
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

/* -- helpers -- */
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

/* -- order status helpers -- */
const orderStatusColor = (status: string): string => {
  switch (status) {
    case 'PLACED': return '#d97706';
    case 'PENDING_VERIFICATION': return '#d97706';
    case 'VERIFIED': return '#2563eb';
    case 'ROUTED_TO_SELLER': return '#7c3aed';
    case 'SELLER_ACCEPTED': return '#16a34a';
    case 'DISPATCHED': return '#0d9488';
    case 'DELIVERED': return '#15803d';
    case 'CANCELLED': return '#dc2626';
    case 'EXCEPTION_QUEUE': return '#dc2626';
    default: return '#6b7280';
  }
};

const orderStatusLabel = (status: string): string => {
  switch (status) {
    case 'PLACED': return 'Placed';
    case 'PENDING_VERIFICATION': return 'Pending Verification';
    case 'VERIFIED': return 'Verified';
    case 'ROUTED_TO_SELLER': return 'Routed to Seller';
    case 'SELLER_ACCEPTED': return 'Seller Accepted';
    case 'DISPATCHED': return 'Dispatched';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    case 'EXCEPTION_QUEUE': return 'Exception Queue';
    default: return status;
  }
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

function OrderStatusBadge({ status }: { status: string }) {
  const color = orderStatusColor(status);
  const label = orderStatusLabel(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        padding: '4px 12px',
        borderRadius: 6,
        background: color + '15',
        color,
        border: `1px solid ${color}30`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

function badgeColor(status: string) {
  if (status === 'PAID' || status === 'FULFILLED' || status === 'ACCEPTED') return '#22c55e';
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'VOIDED') return '#ef4444';
  return '#f59e0b';
}

const fulfillmentLabel = (status: string) => {
  switch (status) {
    case 'DELIVERED': return 'Delivered';
    case 'FULFILLED': return 'Out for Delivery';
    case 'SHIPPED': return 'Shipped';
    case 'PACKED': return 'Packed';
    case 'CANCELLED': return 'Cancelled';
    default: return 'Unfulfilled';
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

/* -- page -- */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);

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

  const handleVerifyOrder = async () => {
    setActionLoading('verify');
    setVerifySuccess(false);
    try {
      await apiClient(`/admin/orders/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ remarks: verifyRemarks || undefined }),
      });
      setVerifySuccess(true);
      setVerifyRemarks('');
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
  const currentStatus = order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED');
  const isPlaced = currentStatus === 'PLACED' || currentStatus === 'PENDING_VERIFICATION';
  const isExceptionQueue = currentStatus === 'EXCEPTION_QUEUE';

  return (
    <div>
      {/* -- breadcrumb -- */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        <Link href="/dashboard/orders" style={{ color: '#6b7280', textDecoration: 'none' }}>
          ORDERS
        </Link>{' '}
        &rsaquo; ORDER DETAILS
      </div>

      {/* -- header -- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Order {order.orderNumber}</h1>
            <OrderStatusBadge status={currentStatus} />
            {order.paymentStatus === 'CANCELLED' && (
              <Badge text="CANCELLED" color="#dc2626" />
            )}
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            {order.subOrders.length} sub-order{order.subOrders.length !== 1 ? 's' : ''} | {totalItems} item{totalItems !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* -- Exception Queue Banner -- */}
      {isExceptionQueue && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '16px 20px', marginBottom: 20, display: 'flex',
          alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>&#9888;</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#991b1b', marginBottom: 4 }}>
              No Eligible Seller Found
            </div>
            <div style={{ fontSize: 13, color: '#7f1d1d' }}>
              This order has been placed in the exception queue. Manual reassignment is required to proceed.
            </div>
          </div>
        </div>
      )}

      {/* -- Verification Info Banner -- */}
      {order.verified && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
          padding: '12px 20px', marginBottom: 20, fontSize: 13,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
            <div>
              <span style={{ color: '#166534', fontWeight: 700 }}>Verified</span>
              {order.verifiedAt && (
                <span style={{ color: '#15803d', marginLeft: 8 }}>on {fmtDateTime(order.verifiedAt)}</span>
              )}
            </div>
            {order.verifiedBy && (
              <div style={{ color: '#15803d' }}>
                <span style={{ fontWeight: 600 }}>By:</span> {order.verifiedBy}
              </div>
            )}
            {order.verificationRemarks && (
              <div style={{ color: '#15803d' }}>
                <span style={{ fontWeight: 600 }}>Remarks:</span> {order.verificationRemarks}
              </div>
            )}
          </div>
        </div>
      )}

      {/* -- two-column layout -- */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* -- LEFT COLUMN -- */}
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          {/* -- Sub-orders (one card per seller allocation) -- */}
          {order.subOrders.map((so) => (
            <div key={so.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {fulfillmentLabel(so.fulfillmentStatus)} Products
                  </span>
                  <Badge text={so.acceptStatus} color={badgeColor(so.acceptStatus)} />
                  <Badge text={fulfillmentLabel(so.fulfillmentStatus)} color={fulfillmentColor(so.fulfillmentStatus)} />
                </div>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  {so.items.reduce((a, i) => a + i.quantity, 0)} items
                </span>
              </div>

              {/* Allocated seller info */}
              {so.seller && (
                <div style={{ background: '#f0f9ff', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span><strong>Allocated Seller:</strong> {so.seller.sellerShopName}</span>
                  <span style={{ color: '#6b7280' }}>{so.seller.sellerName}</span>
                  <span style={{ color: '#6b7280' }}>{so.seller.email}</span>
                  <span style={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: 11 }}>ID: {so.seller.id.slice(0, 8)}</span>
                </div>
              )}

              {/* Accept deadline info */}
              {so.acceptDeadline && so.acceptStatus === 'OPEN' && (
                <div style={{ fontSize: 12, color: '#d97706', fontWeight: 500, marginBottom: 10, padding: '6px 12px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a' }}>
                  Accept deadline: {fmtDateTime(so.acceptDeadline)}
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                      <th style={thStyle}>PRODUCT ID</th>
                      <th style={thStyle}>IMAGE</th>
                      <th style={thStyle}>PRODUCT NAME</th>
                      <th style={thStyle}>PRICE</th>
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
                        <td style={tdStyle}>{item.sku || item.masterSku || '-'}</td>
                        <td style={tdStyle}>{item.quantity}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(Number(item.totalPrice))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* -- BILLING & SHIPPING DETAILS -- */}
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
                      value={<OrderStatusBadge status={currentStatus} />}
                    />
                    <DetailRow label="Name" value={addr.fullName} />
                    <DetailRow label="Address" value={addr.addressLine1 + (addr.addressLine2 ? `, ${addr.addressLine2}` : '')} />
                    <DetailRow label="Postal Code" value={addr.postalCode} />
                    <DetailRow label="City" value={addr.city} />
                    <DetailRow label="State" value={addr.state} />
                    <DetailRow label="Country" value={addr.country || 'India'} />
                    <DetailRow label="Contact" value={addr.phone} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* -- SELLER DETAILS (one per sub-order) -- */}
          {order.subOrders.map(
            (so) =>
              so.seller && (
                <div key={`seller-${so.id}`} style={cardStyle}>
                  <h2 style={sectionTitle}>SELLER ALLOCATION DETAILS</h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px 0' }}>
                    Seller allocated for sub-order {so.id.slice(0, 8)}
                  </p>
                  <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      <DetailRow
                        label="Seller Name"
                        value={
                          <span style={{ color: '#2563eb', fontWeight: 500 }}>{so.seller.sellerName}</span>
                        }
                      />
                      <DetailRow label="Shop Name" value={so.seller.sellerShopName} />
                      <DetailRow label="Email" value={so.seller.email} />
                      <DetailRow label="Seller ID" value={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{so.seller.id}</span>} />
                      <DetailRow label="Accept Status" value={<Badge text={so.acceptStatus} color={badgeColor(so.acceptStatus)} />} />
                      <DetailRow label="Fulfillment" value={<Badge text={fulfillmentLabel(so.fulfillmentStatus)} color={fulfillmentColor(so.fulfillmentStatus)} />} />
                      <DetailRow label="Sub-Total" value={fmt(Number(so.subTotal))} />
                      {so.acceptDeadline && so.acceptStatus === 'OPEN' && (
                        <DetailRow label="Accept Deadline" value={<span style={{ color: '#d97706', fontWeight: 600 }}>{fmtDateTime(so.acceptDeadline)}</span>} />
                      )}
                    </tbody>
                  </table>
                </div>
              ),
          )}

          {/* -- CUSTOMER DETAILS -- */}
          <div style={cardStyle}>
            <h2 style={sectionTitle}>CUSTOMER DETAILS</h2>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <DetailRow label="Name" value={`${order.customer.firstName} ${order.customer.lastName}`} />
                <DetailRow label="Email" value={order.customer.email} />
                <DetailRow label="Phone" value={order.customer.phone || 'N/A'} />
              </tbody>
            </table>
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
                <SideRow label="ORDERED ON" value={fmtDateTime(order.createdAt)} />
                <SideRow label="DELIVERY METHOD" value="Free Shipping" />
                <SideRow
                  label="ORDER STATUS"
                  value={<OrderStatusBadge status={currentStatus} />}
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
              {/* Verify Order Card */}
              {isPlaced && order.paymentStatus !== 'CANCELLED' && (
                <div style={{
                  background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8,
                  padding: 14, marginBottom: 4,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
                    Verify Order
                  </div>
                  <textarea
                    value={verifyRemarks}
                    onChange={(e) => setVerifyRemarks(e.target.value)}
                    placeholder="Remarks (optional)..."
                    style={{
                      width: '100%', padding: '8px 10px', border: '1px solid #fbbf24',
                      borderRadius: 6, fontSize: 12, resize: 'vertical', minHeight: 50,
                      background: '#fff', boxSizing: 'border-box', marginBottom: 8,
                    }}
                  />
                  {verifySuccess && (
                    <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, marginBottom: 6 }}>
                      Order verified and routed!
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleVerifyOrder}
                      disabled={!!actionLoading}
                      style={btnSuccess}
                    >
                      {actionLoading === 'verify' ? 'Verifying...' : 'VERIFY & ROUTE'}
                    </button>
                    <button
                      onClick={() => handleAction(`/admin/orders/${order.id}/reject-order`, 'reject-order')}
                      disabled={!!actionLoading}
                      style={btnDanger}
                    >
                      {actionLoading === 'reject-order' ? 'Rejecting...' : 'REJECT'}
                    </button>
                  </div>
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
                              {actionLoading === `accept-${so.id}` ? 'Accepting...' : `ACCEPT${so.seller ? ` (${so.seller.sellerShopName})` : ''}`}
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
                            {actionLoading === `fulfill-${so.id}` ? 'Fulfilling...' : `MARK AS FULFILLED${so.seller ? ` (${so.seller.sellerShopName})` : ''}`}
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
                            {actionLoading === `deliver-${so.id}` ? 'Updating...' : `MARK AS DELIVERED${so.seller ? ` (${so.seller.sellerShopName})` : ''}`}
                          </button>
                        ))}
                    </>
                  )}

                  {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
                    <div style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>&#10003; Delivered</div>
                  )}

                  {/* Payment capture is handled by Storefront Admin only */}
                </>
              )}

              {order.paymentStatus === 'CANCELLED' && (
                <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Order Cancelled</div>
              )}
            </div>
          </div>

          {/* -- SELLER EARNING per sub-order -- */}
          {order.subOrders.map((so) => {
            const sellerEarning = so.commissionRecords?.length > 0
              ? so.commissionRecords.reduce((a, c) => a + Number(c.productEarning), 0)
              : Number(so.subTotal);
            return (
              <div key={`earn-${so.id}`} style={sideCard}>
                <h3 style={sideCardTitle}>
                  SELLER EARNING {so.seller ? `- ${so.seller.sellerShopName}` : ''}
                </h3>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 14px 0' }}>
                  Earnings for this allocation.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    <SideRow label="PRODUCT EARNING" value={fmt(sellerEarning)} />
                    <SideRow label="SHIPPING" value={fmt(0)} />
                    <SideRow label="TAX" value={fmt(0)} />
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
                  <span>TOTAL EARNING</span>
                  <span>{fmt(sellerEarning)}</span>
                </div>
              </div>
            );
          })}

          {/* -- DELIVERY & COMMISSION STATUS -- */}
          {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
            <div style={sideCard}>
              <h3 style={sideCardTitle}>DELIVERY & COMMISSION</h3>
              {order.subOrders
                .filter((so) => so.fulfillmentStatus === 'DELIVERED')
                .map((so) => (
                  <DeliveryStatusBlock key={`del-${so.id}`} subOrder={so} onRefresh={fetchOrder} />
                ))}
            </div>
          )}

          {/* -- ADDITIONAL ORDER DETAILS -- */}
          <div style={sideCard}>
            <h3 style={sideCardTitle}>ADDITIONAL ORDER DETAILS</h3>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              <div>Order ID: <span style={{ fontFamily: 'monospace' }}>{order.id}</span></div>
              <div style={{ marginTop: 6 }}>Payment Method: {order.paymentMethod}</div>
              <div style={{ marginTop: 6 }}>Items Ordered: {totalItems}</div>
              <div style={{ marginTop: 6 }}>Sub-Orders: {order.subOrders.length}</div>
              {order.verifiedAt && (
                <div style={{ marginTop: 6 }}>Verified At: {fmtDateTime(order.verifiedAt)}</div>
              )}
              {order.verifiedBy && (
                <div style={{ marginTop: 6 }}>Verified By: {order.verifiedBy}</div>
              )}
              {order.verificationRemarks && (
                <div style={{ marginTop: 6 }}>Verification Remarks: {order.verificationRemarks}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -- delivery status block -- */
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

/* -- sub-components -- */
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
