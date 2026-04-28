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
  verified: boolean;
  verifiedAt: string | null;
  itemCount: number;
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
  { value: 'PLACED', label: 'Placed (Pending Verification)' },
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'ROUTED_TO_SELLER', label: 'Routed' },
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
    // Return-derived statuses (synthetic on the client — there's no
    // RETURN_* entry on the master order enum yet, but we surface the
    // state here so ops can see it at a glance).
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
    case 'SELLER_ACCEPTED': return 'Seller Accepted';
    case 'DISPATCHED': return 'Dispatched';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    case 'EXCEPTION_QUEUE': return 'Exception Queue';
    case 'RETURN_REQUESTED': return 'Return Requested';
    case 'RETURN_IN_PROGRESS': return 'Return In Progress';
    case 'RETURN_REJECTED': return 'Return Rejected';
    case 'REFUNDED': return 'Refunded';
    default: return status;
  }
};

// Collapse the 13-state return lifecycle into 4 display buckets so the
// Order Status column stays readable. The caller still links to the
// full return detail page for the granular state.
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
    // APPROVED, PICKUP_SCHEDULED, IN_TRANSIT, RECEIVED, QC_APPROVED,
    // PARTIALLY_APPROVED, REFUND_PROCESSING — all "in flight" to the
    // customer perspective.
    default:
      return 'RETURN_IN_PROGRESS';
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

  // Derived metrics for the top summary row. These are lightweight —
  // the existing list payload already includes everything we need.
  const metrics = (() => {
    const orders = data?.orders ?? [];
    const pendingVerify = orders.filter((o) => o.orderStatus === 'PLACED' || o.orderStatus === 'PENDING_VERIFICATION').length;
    const inProgress = orders.filter((o) =>
      ['VERIFIED', 'ROUTED_TO_SELLER', 'SELLER_ACCEPTED', 'DISPATCHED'].includes(o.orderStatus),
    ).length;
    const returns = orders.filter((o) => (o.returns?.length ?? 0) > 0).length;
    const cancelled = orders.filter((o) => o.orderStatus === 'CANCELLED').length;
    return { pendingVerify, inProgress, returns, cancelled };
  })();

  return (
    <div style={{ padding: '24px 28px', background: '#f8fafc', minHeight: 'calc(100vh - 56px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>Orders</h1>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Manage orders, verification, and returns across the marketplace.
          </div>
        </div>
        {data && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            <strong style={{ color: '#111827', fontSize: 14 }}>{data.pagination.total}</strong> orders total
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard
          label="Pending Verification"
          value={metrics.pendingVerify}
          color="#d97706"
          active={statusFilter === 'PLACED'}
          onClick={() => { setStatusFilter(statusFilter === 'PLACED' ? '' : 'PLACED'); setPage(1); }}
        />
        <MetricCard
          label="In Progress"
          value={metrics.inProgress}
          color="#2563eb"
          active={statusFilter === 'ROUTED_TO_SELLER'}
          onClick={() => { setStatusFilter(statusFilter === 'ROUTED_TO_SELLER' ? '' : 'ROUTED_TO_SELLER'); setPage(1); }}
        />
        <MetricCard
          label="With Returns"
          value={metrics.returns}
          color="#7c3aed"
        />
        <MetricCard
          label="Exception Queue"
          value={exceptionCount}
          color="#dc2626"
          active={statusFilter === 'EXCEPTION_QUEUE'}
          onClick={() => { setStatusFilter(statusFilter === 'EXCEPTION_QUEUE' ? '' : 'EXCEPTION_QUEUE'); setPage(1); }}
        />
        <MetricCard
          label="Cancelled"
          value={metrics.cancelled}
          color="#6b7280"
          active={statusFilter === 'CANCELLED'}
          onClick={() => { setStatusFilter(statusFilter === 'CANCELLED' ? '' : 'CANCELLED'); setPage(1); }}
        />
      </div>

      {/* Filter bar (tabs + dropdown inside a single card) */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { value: '', label: 'All Orders' },
            { value: 'PLACED', label: 'Pending Verification' },
            { value: 'ROUTED_TO_SELLER', label: 'Routed' },
            { value: 'DISPATCHED', label: 'Shipped' },
            { value: 'DELIVERED', label: 'Delivered' },
            { value: 'EXCEPTION_QUEUE', label: 'Exception Queue', count: exceptionCount },
            { value: 'CANCELLED', label: 'Cancelled' },
          ].map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                style={{
                  padding: '7px 14px',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  border: 'none',
                  borderRadius: 999,
                  background: active ? '#1e3a8a' : '#f1f5f9',
                  color: active ? '#fff' : '#475569',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.15s',
                }}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '1px 7px',
                    borderRadius: 10,
                    background: active ? 'rgba(255,255,255,0.25)' : '#dc2626',
                    color: '#fff',
                    minWidth: 18,
                    textAlign: 'center',
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Detailed Status:</label>
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
              style={{
                padding: '6px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                background: '#fff',
                fontSize: 12,
                color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div style={{ background: '#fff', borderRadius: 12, textAlign: 'center', padding: 60, color: '#6b7280', border: '1px solid #e5e7eb' }}>
          Loading orders...
        </div>
      ) : !data || data.orders.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, textAlign: 'center', padding: 60, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No orders yet</h3>
          <p style={{ color: '#6b7280' }}>When customers place orders, they will appear here.</p>
        </div>
      ) : (
        <>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thStyle}>Order</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Customer</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                    <th style={thStyle}>Payment</th>
                    <th style={thStyle}>Order Status</th>
                    <th style={thStyle}>Fulfillment</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order, idx) => {
                    const activeSubOrders = order.subOrders.filter(s => s.acceptStatus !== 'REJECTED');
                    const relevantSubOrders = activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
                    const fulfillmentStatuses = [...new Set(relevantSubOrders.map(s => s.fulfillmentStatus))];
                    const latestReturn = (order.returns ?? [])[0];
                    const effectiveStatus = latestReturn
                      ? returnToOrderStatus(latestReturn.status)
                      : (order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED'));
                    const customerInitials =
                      `${order.customer.firstName?.[0] ?? ''}${order.customer.lastName?.[0] ?? ''}`.toUpperCase() ||
                      (order.customer.email?.[0]?.toUpperCase() ?? '?');
                    return (
                      <tr
                        key={order.id}
                        onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          cursor: 'pointer',
                          background: idx % 2 === 0 ? '#fff' : '#fcfdff',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#eef2ff')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fcfdff')}
                      >
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700, color: '#2563eb', fontSize: 13 }}>{order.orderNumber}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{order.paymentMethod ?? '—'}</div>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontSize: 13, color: '#111827' }}>{formatDate(order.createdAt)}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>
                            {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #6366f1, #2563eb)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {customerInitials}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>
                                {order.customer.firstName} {order.customer.lastName}
                              </div>
                              <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                                {order.customer.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontSize: 14, color: '#111827' }}>
                          {formatPrice(Number(order.totalAmount))}
                        </td>
                        <td style={tdStyle}>
                          {badge(order.paymentStatus, order.paymentStatus === 'PAID' ? '#16a34a' : '#d97706')}
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
                              style={{ fontSize: 10, color: '#6b7280', marginTop: 4, cursor: 'pointer', textDecoration: 'underline dotted' }}
                            >
                              {latestReturn.returnNumber}
                              {(order.returns?.length ?? 0) > 1 && ` +${(order.returns!.length - 1)}`}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {fulfillmentStatuses.map((s, i) => {
                              const fLabel = s === 'DELIVERED' ? 'Delivered' : s === 'SHIPPED' ? 'Shipped' : s === 'PACKED' ? 'Packed' : s === 'CANCELLED' ? 'Cancelled' : s === 'FULFILLED' ? 'Fulfilled' : 'Unfulfilled';
                              const fColor = s === 'DELIVERED' ? '#15803d' : s === 'SHIPPED' ? '#2563eb' : s === 'PACKED' ? '#d97706' : s === 'CANCELLED' ? '#dc2626' : s === 'FULFILLED' ? '#16a34a' : '#6366f1';
                              return <span key={i}>{badge(fLabel, fColor)}</span>;
                            })}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: 26,
                              height: 26,
                              padding: '0 8px',
                              borderRadius: 999,
                              background: '#f1f5f9',
                              color: '#334155',
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {order.itemCount}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 16px',
  verticalAlign: 'middle',
};

function MetricCard({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: active ? `2px solid ${color}` : '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '16px 18px',
        boxShadow: active ? `0 4px 12px ${color}20` : '0 1px 2px rgba(0,0,0,0.04)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border 0.15s, box-shadow 0.15s, transform 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 4,
          height: '100%',
          background: color,
          opacity: active ? 1 : 0.4,
        }}
      />
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
