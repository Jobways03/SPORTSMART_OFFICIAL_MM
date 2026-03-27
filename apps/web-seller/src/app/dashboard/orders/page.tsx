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
  acceptDeadlineAt: string | null;
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

function DeadlineCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000); // update every 30s
    return () => clearInterval(timer);
  }, []);

  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>
        EXPIRED — auto-rejecting
      </span>
    );
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const isUrgent = diffMs < 2 * 60 * 60 * 1000; // within 2 hours
  const color = isUrgent ? '#dc2626' : '#d97706';

  let label: string;
  if (hours >= 1) {
    label = `Accept within ${hours}h ${minutes}m`;
  } else {
    label = `Accept within ${minutes}m`;
  }

  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, display: 'block', marginTop: 2 }}>
      {label}
    </span>
  );
}

export default function SellerOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [acceptFilter, setAcceptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Reject modal state
  const [rejectModal, setRejectModal] = useState<{ subOrderId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const fetchOrders = (p: number) => {
    setLoading(true);
    const token = sessionStorage.getItem('accessToken');
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (fulfillmentFilter) params.append('fulfillmentStatus', fulfillmentFilter);
    if (acceptFilter) params.append('acceptStatus', acceptFilter);
    if (searchQuery) params.append('search', searchQuery);

    fetch(`${API_BASE}/api/v1/seller/orders?${params.toString()}`, {
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

  useEffect(() => { fetchOrders(page); }, [page, fulfillmentFilter, acceptFilter]);

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const handleAction = async (e: React.MouseEvent, subOrderId: string, action: string, body?: object) => {
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
        body: body ? JSON.stringify(body) : undefined,
      });
      fetchOrders(page);
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async (e: React.MouseEvent) => {
    if (!rejectModal) return;
    e.stopPropagation();
    setActionLoading(rejectModal.subOrderId);
    const token = sessionStorage.getItem('accessToken');
    try {
      await fetch(`${API_BASE}/api/v1/seller/orders/${rejectModal.subOrderId}/reject`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reason: rejectReason || undefined,
          note: rejectNote || undefined,
        }),
      });
      fetchOrders(page);
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
      setRejectModal(null);
      setRejectReason('');
      setRejectNote('');
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

  const nextFulfillmentAction = (so: SubOrder): { label: string; status: string } | null => {
    if (so.acceptStatus !== 'ACCEPTED') return null;
    switch (so.fulfillmentStatus) {
      case 'UNFULFILLED': return { label: 'Mark Packed', status: 'PACKED' };
      case 'PACKED': return { label: 'Mark Shipped', status: 'SHIPPED' };
      default: return null; // After SHIPPED, seller is done - delivery confirmed by admin
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Orders</h1>
        {data && <span style={{ fontSize: 13, color: '#6b7280' }}>{data.pagination.total} total</span>}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={fulfillmentFilter}
          onChange={(e) => { setFulfillmentFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="">All Fulfillment</option>
          <option value="UNFULFILLED">Packing</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          value={acceptFilter}
          onChange={(e) => { setAcceptFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="">All Accept Status</option>
          <option value="OPEN">Open</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search order number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 180 }}
          />
          <button onClick={handleSearch} style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', fontSize: 13, cursor: 'pointer' }}>
            Search
          </button>
        </div>
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
                      {badge(
                        fulfillmentLabel(so.fulfillmentStatus),
                        so.fulfillmentStatus === 'DELIVERED' ? '#7c3aed'
                        : so.fulfillmentStatus === 'FULFILLED' ? '#16a34a'
                        : so.fulfillmentStatus === 'SHIPPED' ? '#2563eb'
                        : so.fulfillmentStatus === 'PACKED' ? '#d97706'
                        : so.fulfillmentStatus === 'CANCELLED' ? '#dc2626'
                        : '#6366f1'
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div>
                        {badge(so.acceptStatus, so.acceptStatus === 'ACCEPTED' ? '#16a34a' : so.acceptStatus === 'REJECTED' ? '#dc2626' : '#6b7280')}
                        {so.acceptStatus === 'OPEN' && so.acceptDeadlineAt && (
                          <DeadlineCountdown deadline={so.acceptDeadlineAt} />
                        )}
                      </div>
                    </td>
                    <td style={tdStyle}>{formatPrice(Number(so.subTotal))}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {so.acceptStatus === 'OPEN' && (
                          <>
                            <button
                              onClick={(e) => handleAction(e, so.id, 'accept')}
                              disabled={actionLoading === so.id}
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                            >
                              Accept
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setRejectModal({ subOrderId: so.id }); }}
                              disabled={actionLoading === so.id}
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: '#dc2626', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {(() => {
                          const next = nextFulfillmentAction(so);
                          if (!next) return null;
                          return (
                            <button
                              onClick={(e) => handleAction(e, so.id, 'status', { status: next.status })}
                              disabled={actionLoading === so.id}
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: '#2563eb', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                            >
                              {next.label}
                            </button>
                          );
                        })()}
                        {so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'SHIPPED' && (
                          <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 500 }}>Awaiting delivery confirmation</span>
                        )}
                        {so.acceptStatus === 'ACCEPTED' && so.fulfillmentStatus === 'DELIVERED' && (
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Delivered</span>
                        )}
                        {so.acceptStatus !== 'OPEN' && !nextFulfillmentAction(so) && so.fulfillmentStatus !== 'SHIPPED' && so.fulfillmentStatus !== 'DELIVERED' && (
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>-</span>
                        )}
                      </div>
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

      {/* Reject Modal */}
      {rejectModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => { setRejectModal(null); setRejectReason(''); setRejectNote(''); }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 12, padding: 28, width: 420,
              maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700 }}>Reject Order</h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
              Please provide a reason for rejecting this order.
            </p>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Reason
            </label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 16, background: '#fff' }}
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
              placeholder="Additional details..."
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 20, resize: 'vertical', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); setRejectNote(''); }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!!actionLoading}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, border: 'none', background: '#dc2626', color: '#fff', borderRadius: 6, cursor: 'pointer' }}
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
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
