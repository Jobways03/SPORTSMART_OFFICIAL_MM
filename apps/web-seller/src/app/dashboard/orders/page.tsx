'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  items: { productTitle: string; quantity: number; totalPrice: number }[];
  masterOrder: {
    orderNumber: string;
    paymentMethod: string;
    createdAt: string;
    customer: { firstName: string; lastName: string };
  };
}

interface OrdersResponse {
  subOrders: SubOrder[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function SellerOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = (p: number) => {
    setLoading(true);
    const token = sessionStorage.getItem('accessToken');
    fetch(`${API_BASE}/api/v1/seller/orders?page=${p}&limit=20`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
      .then((r) => r.json())
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(page); }, [page]);

  const handleAction = async (e: React.MouseEvent, subOrderId: string, action: 'accept' | 'reject') => {
    e.stopPropagation();
    setActionLoading(subOrderId);
    const token = sessionStorage.getItem('accessToken');
    try {
      await fetch(`${API_BASE}/api/v1/seller/orders/${subOrderId}/${action}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      fetchOrders(page);
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Orders</h1>
        {data && <span style={{ fontSize: 13, color: '#6b7280' }}>{data.pagination.total} total</span>}
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading orders...</div>
      ) : !data || data.subOrders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No orders yet</h3>
          <p style={{ color: '#6b7280' }}>When customers order your products, orders will appear here.</p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={thStyle}>ORDER ID</th>
                  <th style={thStyle}>STORE ORDER ID</th>
                  <th style={thStyle}>DATE</th>
                  <th style={thStyle}>PAYMENT MODE</th>
                  <th style={thStyle}>PAYMENT STATUS</th>
                  <th style={thStyle}>FULFILLMENT</th>
                  <th style={thStyle}>ORDER ACCEPT</th>
                  <th style={thStyle}>ORDER AMOUNT</th>
                  <th style={thStyle}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {data.subOrders.map((so) => (
                  <tr
                    key={so.id}
                    onClick={() => router.push(`/dashboard/orders/${so.id}`)}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{so.id.slice(0, 8)}...</span></td>
                    <td style={tdStyle}><strong style={{ color: '#2563eb' }}>{so.masterOrder.orderNumber}</strong></td>
                    <td style={tdStyle}>{formatDate(so.masterOrder.createdAt)}</td>
                    <td style={tdStyle}>{so.masterOrder.paymentMethod}</td>
                    <td style={tdStyle}>
                      {badge(so.paymentStatus, so.paymentStatus === 'PAID' ? '#16a34a' : '#d97706')}
                    </td>
                    <td style={tdStyle}>
                      {badge(so.fulfillmentStatus, so.fulfillmentStatus === 'DELIVERED' ? '#7c3aed' : so.fulfillmentStatus === 'FULFILLED' ? '#16a34a' : '#6366f1')}
                    </td>
                    <td style={tdStyle}>
                      {badge(so.acceptStatus, so.acceptStatus === 'ACCEPTED' ? '#16a34a' : so.acceptStatus === 'REJECTED' ? '#dc2626' : '#6b7280')}
                    </td>
                    <td style={tdStyle}>{formatPrice(Number(so.subTotal))}</td>
                    <td style={tdStyle}>
                      {so.acceptStatus === 'OPEN' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={(e) => handleAction(e, so.id, 'accept')}
                            disabled={actionLoading === so.id}
                            style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                          >
                            Accept
                          </button>
                          <button
                            onClick={(e) => handleAction(e, so.id, 'reject')}
                            disabled={actionLoading === so.id}
                            style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, border: 'none', background: '#dc2626', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
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
