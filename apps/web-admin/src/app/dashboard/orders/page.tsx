'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  seller: { id: string; sellerName: string; sellerShopName: string; email: string } | null;
  items: { productTitle: string; quantity: number }[];
}

interface ReturnLite {
  id: string;
  returnNumber: string;
  status: string;
  createdAt: string;
}

interface Order {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  verified: boolean;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string };
  subOrders: SubOrder[];
  returns?: ReturnLite[];
}

interface OrdersResponse {
  orders: Order[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'ROUTED_TO_SELLER', label: 'Routed to Seller' },
  { value: 'SELLER_ACCEPTED', label: 'Seller Accepted' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXCEPTION_QUEUE', label: 'Exception Queue' },
];

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
    // Return-derived statuses (client-side only — no master-order enum
    // for them yet, but we reflect the return lifecycle here so ops can
    // see at a glance that a delivered order is now in a return flow).
    case 'RETURN_REQUESTED': return '#d97706';
    case 'RETURN_IN_PROGRESS': return '#7c3aed';
    case 'RETURN_REJECTED': return '#dc2626';
    case 'REFUNDED': return '#059669';
    default: return '#6b7280';
  }
};

const orderStatusLabel = (status: string): string => {
  switch (status) {
    case 'PLACED': return 'Placed';
    case 'PENDING_VERIFICATION': return 'Pending Verification';
    case 'VERIFIED': return 'Verified';
    case 'ROUTED_TO_SELLER': return 'Routed';
    case 'SELLER_ACCEPTED': return 'Accepted';
    case 'DISPATCHED': return 'Dispatched';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    case 'EXCEPTION_QUEUE': return 'Exception';
    case 'RETURN_REQUESTED': return 'Return Requested';
    case 'RETURN_IN_PROGRESS': return 'Return In Progress';
    case 'RETURN_REJECTED': return 'Return Rejected';
    case 'REFUNDED': return 'Refunded';
    default: return status;
  }
};

// Collapse the 13-state return lifecycle into 4 display buckets so the
// Order Status column stays readable while still flipping away from
// "Delivered" the moment a return is opened.
const returnToOrderStatus = (returnStatus: string): string => {
  switch (returnStatus) {
    case 'REQUESTED':
      return 'RETURN_REQUESTED';
    case 'REJECTED':
    case 'QC_REJECTED':
      return 'RETURN_REJECTED';
    case 'REFUNDED':
    case 'COMPLETED':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'RETURN_IN_PROGRESS';
  }
};

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

export default function AdminOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [acceptFilter, setAcceptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOrders = (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (orderStatusFilter) params.append('orderStatus', orderStatusFilter);
    if (paymentFilter) params.append('paymentStatus', paymentFilter);
    if (fulfillmentFilter) params.append('fulfillmentStatus', fulfillmentFilter);
    if (acceptFilter) params.append('acceptStatus', acceptFilter);
    if (searchQuery) params.append('search', searchQuery);

    apiClient<OrdersResponse>(`/admin/orders?${params.toString()}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(page); }, [page, orderStatusFilter, paymentFilter, fulfillmentFilter, acceptFilter]);

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const badge = (text: string, color: string) => (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 4,
      background: color + '18',
      color,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );

  const orderStatusBadge = (status: string) => {
    const color = orderStatusColor(status);
    const label = orderStatusLabel(status);
    const isWarning = status === 'PLACED' || status === 'EXCEPTION_QUEUE';
    return (
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 4,
        background: color + '18',
        color,
        whiteSpace: 'nowrap',
        border: isWarning ? `1px solid ${color}40` : 'none',
      }}>{label}</span>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Orders</h1>
        {data && <span style={{ fontSize: 13, color: '#6b7280' }}>{data.pagination.total} total</span>}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={orderStatusFilter} onChange={(e) => { setOrderStatusFilter(e.target.value); setPage(1); }} style={selectStyle}>
          {ORDER_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Payment</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={fulfillmentFilter} onChange={(e) => { setFulfillmentFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Fulfillment</option>
          <option value="UNFULFILLED">Unfulfilled</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
          <option value="FULFILLED">Out for Delivery</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={acceptFilter} onChange={(e) => { setAcceptFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Accept</option>
          <option value="OPEN">Open</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search order / customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 200 }}
          />
          <button onClick={handleSearch} style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', fontSize: 13, cursor: 'pointer' }}>
            Search
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading orders...</div>
      ) : !data || data.orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No orders yet</h3>
          <p style={{ color: '#6b7280' }}>When customers place orders, they will appear here.</p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={thStyle}>ORDER #</th>
                  <th style={thStyle}>CUSTOMER</th>
                  <th style={thStyle}>SELLER(S)</th>
                  <th style={thStyle}>ORDER STATUS</th>
                  <th style={thStyle}>PAYMENT</th>
                  <th style={thStyle}>FULFILLMENT</th>
                  <th style={thStyle}>ACCEPT</th>
                  <th style={thStyle}>DATE</th>
                  <th style={thStyle}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => {
                  // When the first seller rejects, the router spawns a fresh
                  // sub-order on a different seller. The rejected row stays
                  // in the DB (acceptStatus=REJECTED, fulfillmentStatus=
                  // CANCELLED), but showing it alongside the successful
                  // re-route reads as "Delivered + Cancelled" which confuses
                  // everyone. Hide rejected sub-orders unless *all* were
                  // rejected (i.e. the whole order really failed).
                  const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
                  const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;
                  const wasRerouted = activeSubs.length > 0 && activeSubs.length < order.subOrders.length;

                  const sellers = relevantSubs
                    .map((so) => so.seller?.sellerShopName || '-')
                    .filter((v, i, a) => a.indexOf(v) === i);
                  const fulfillmentStatuses = [...new Set(relevantSubs.map((so) => so.fulfillmentStatus))];
                  const acceptStatuses = [...new Set(relevantSubs.map((so) => so.acceptStatus))];

                  // When a return exists, its lifecycle supersedes the
                  // master-order status — a delivered order that's now
                  // being refunded shouldn't keep reading "Delivered".
                  const latestReturn = (order.returns ?? [])[0];
                  const effectiveStatus = latestReturn
                    ? returnToOrderStatus(latestReturn.status)
                    : (order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED'));

                  return (
                    <tr
                      key={order.id}
                      onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                      style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={tdStyle}>
                        <strong style={{ color: '#2563eb' }}>{order.orderNumber}</strong>
                        {wasRerouted && (
                          <div
                            title="This order was rejected by one seller and re-routed to another. Click to see the full history."
                            style={{
                              display: 'inline-block',
                              marginLeft: 6,
                              padding: '1px 6px',
                              background: '#fef3c7',
                              color: '#92400e',
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                              verticalAlign: 'middle',
                            }}
                          >
                            Re-routed
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500 }}>{order.customer.firstName} {order.customer.lastName}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{order.customer.email}</div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {sellers.map((s, idx) => (
                            <span key={idx} style={{ fontSize: 12, color: '#374151' }}>{s}</span>
                          ))}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {orderStatusBadge(effectiveStatus)}
                        {latestReturn && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/returns/${latestReturn.id}`);
                            }}
                            title={`View ${latestReturn.returnNumber}`}
                            style={{ fontSize: 10, color: '#6b7280', marginTop: 3, cursor: 'pointer', textDecoration: 'underline dotted' }}
                          >
                            {latestReturn.returnNumber}
                            {(order.returns?.length ?? 0) > 1 && ` +${(order.returns!.length - 1)}`}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {badge(order.paymentStatus, order.paymentStatus === 'PAID' ? '#16a34a' : order.paymentStatus === 'CANCELLED' ? '#dc2626' : '#d97706')}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {fulfillmentStatuses.map((fs, idx) => (
                            <span key={idx}>
                              {badge(
                                fulfillmentLabel(fs),
                                fs === 'DELIVERED' ? '#7c3aed'
                                : fs === 'FULFILLED' ? '#16a34a'
                                : fs === 'SHIPPED' ? '#2563eb'
                                : fs === 'PACKED' ? '#d97706'
                                : fs === 'CANCELLED' ? '#dc2626'
                                : '#6366f1'
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {acceptStatuses.map((as2, idx) => (
                            <span key={idx}>
                              {badge(as2, as2 === 'ACCEPTED' ? '#16a34a' : as2 === 'REJECTED' ? '#dc2626' : '#6b7280')}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={tdStyle}>{formatDate(order.createdAt)}</td>
                      <td style={tdStyle}><strong>{formatPrice(Number(order.totalAmount))}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pageBtnStyle}>Previous</button>
              <span style={{ padding: '8px 12px', fontSize: 14 }}>Page {page} of {data.pagination.totalPages}</span>
              <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)} style={pageBtnStyle}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 8px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'middle',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
