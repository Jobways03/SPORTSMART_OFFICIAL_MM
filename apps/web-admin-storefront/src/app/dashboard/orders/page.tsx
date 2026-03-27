'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface SubOrder {
  id: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  items: { productTitle: string; quantity: number }[];
  seller: { sellerShopName: string } | null;
}

interface Order {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  verified: boolean;
  verifiedAt: string | null;
  itemCount: number;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string };
  subOrders: SubOrder[];
}

interface OrdersResponse {
  orders: Order[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PLACED', label: 'Placed (Pending Verification)' },
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

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [exceptionCount, setExceptionCount] = useState(0);

  const fetchOrders = (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (statusFilter) params.append('orderStatus', statusFilter);
    apiClient<OrdersResponse>(`/admin/orders?${params.toString()}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Fetch exception queue count
  const fetchExceptionCount = () => {
    apiClient<OrdersResponse>('/admin/orders?orderStatus=EXCEPTION_QUEUE&limit=1')
      .then((res) => { if (res.data) setExceptionCount(res.data.pagination.total); })
      .catch(() => {});
  };

  useEffect(() => { fetchExceptionCount(); }, []);
  useEffect(() => { fetchOrders(page); }, [page, statusFilter]);

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

      {/* Quick Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { value: '', label: 'All Orders' },
          { value: 'PLACED', label: 'Pending Verification' },
          { value: 'ROUTED_TO_SELLER', label: 'Routed to Seller' },
          { value: 'SHIPPED', label: 'Shipped', filterType: 'fulfillment' },
          { value: 'DELIVERED', label: 'Delivered (Awaiting Payment)' },
          { value: 'PAID', label: 'Completed', filterType: 'payment' },
          { value: 'EXCEPTION_QUEUE', label: 'Exception Queue', count: exceptionCount },
          { value: 'CANCELLED', label: 'Cancelled' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: statusFilter === tab.value ? 700 : 500,
              border: statusFilter === tab.value ? '1px solid #7c3aed' : '1px solid #d1d5db',
              borderRadius: 8,
              background: statusFilter === tab.value ? '#f5f3ff' : '#fff',
              color: statusFilter === tab.value ? '#7c3aed' : '#374151',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: 10,
                background: tab.value === 'EXCEPTION_QUEUE' ? '#dc2626' : '#6b7280',
                color: '#fff',
                minWidth: 18,
                textAlign: 'center',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Status Filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          {ORDER_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {statusFilter && (
          <button
            onClick={() => { setStatusFilter(''); setPage(1); }}
            style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', fontSize: 13, cursor: 'pointer' }}
          >
            Clear Filter
          </button>
        )}
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={thStyle}>Order #</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Payment</th>
                  <th style={thStyle}>Order Status</th>
                  <th style={thStyle}>Fulfillment</th>
                  <th style={thStyle}>Items</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => {
                  // Show only active sub-orders' fulfillment (exclude rejected/cancelled ones unless ALL are cancelled)
                  const activeSubOrders = order.subOrders.filter(s => s.acceptStatus !== 'REJECTED');
                  const relevantSubOrders = activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
                  const fulfillmentStatuses = [...new Set(relevantSubOrders.map(s => s.fulfillmentStatus))];
                  return (
                    <tr
                      key={order.id}
                      onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                      style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={tdStyle}><strong style={{ color: '#2563eb' }}>{order.orderNumber}</strong></td>
                      <td style={tdStyle}>{formatDate(order.createdAt)}</td>
                      <td style={tdStyle}>
                        {order.customer.firstName} {order.customer.lastName}
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{order.customer.email}</div>
                      </td>
                      <td style={tdStyle}>{formatPrice(Number(order.totalAmount))}</td>
                      <td style={tdStyle}>
                        {badge(order.paymentStatus, order.paymentStatus === 'PAID' ? '#16a34a' : '#d97706')}
                      </td>
                      <td style={tdStyle}>
                        {orderStatusBadge(order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED'))}
                      </td>
                      <td style={tdStyle}>
                        {fulfillmentStatuses.map((s, i) => {
                          const fLabel = s === 'DELIVERED' ? 'Delivered' : s === 'SHIPPED' ? 'Shipped' : s === 'PACKED' ? 'Packed' : s === 'CANCELLED' ? 'Cancelled' : s === 'FULFILLED' ? 'Fulfilled' : 'Unfulfilled';
                          const fColor = s === 'DELIVERED' ? '#15803d' : s === 'SHIPPED' ? '#2563eb' : s === 'PACKED' ? '#d97706' : s === 'CANCELLED' ? '#dc2626' : s === 'FULFILLED' ? '#16a34a' : '#6366f1';
                          return <span key={i}>{badge(fLabel, fColor)}{' '}</span>;
                        })}
                      </td>
                      <td style={tdStyle}>{order.itemCount}</td>
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
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 12,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px',
  verticalAlign: 'top',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
