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

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchOrders = (p: number) => {
    setLoading(true);
    apiClient<OrdersResponse>(`/admin/orders?page=${p}&limit=20`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(page); }, [page]);

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Orders</h1>
        {data && <span style={{ fontSize: 13, color: '#6b7280' }}>{data.pagination.total} total</span>}
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
                  <th style={thStyle}>Fulfillment</th>
                  <th style={thStyle}>Items</th>
                  <th style={thStyle}>Verification</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => {
                  const fulfillmentStatuses = [...new Set(order.subOrders.map(s => s.fulfillmentStatus))];
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
                        {fulfillmentStatuses.map((s, i) => (
                          <span key={i}>{badge(s, s === 'DELIVERED' ? '#7c3aed' : s === 'FULFILLED' ? '#16a34a' : '#6366f1')}{' '}</span>
                        ))}
                      </td>
                      <td style={tdStyle}>{order.itemCount}</td>
                      <td style={tdStyle}>
                        {order.paymentStatus === 'CANCELLED'
                          ? badge('CANCELLED', '#dc2626')
                          : order.verified
                            ? badge('VERIFIED', '#16a34a')
                            : badge('UNVERIFIED', '#f59e0b')
                        }
                      </td>
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
