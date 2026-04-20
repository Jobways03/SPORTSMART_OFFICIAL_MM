'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  franchiseOrdersService,
  FranchiseOrder,
} from '@/services/orders.service';
import {
  franchiseReturnsService,
  FranchiseReturn,
} from '@/services/returns.service';
import { ApiError } from '@/lib/api-client';

type Tab = 'orders' | 'returns';

const fmtCurrency = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 4,
        background: `${color}18`,
        color,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function colorForAcceptStatus(s: string) {
  if (s === 'ACCEPTED') return '#2563eb';
  if (s === 'REJECTED' || s === 'CANCELLED') return '#dc2626';
  return '#6b7280'; // OPEN
}

function colorForFulfillment(s: string) {
  if (s === 'DELIVERED' || s === 'FULFILLED') return '#16a34a';
  if (s === 'SHIPPED') return '#d97706';
  if (s === 'PACKED') return '#2563eb';
  if (s === 'CANCELLED') return '#dc2626';
  return '#6b7280'; // UNFULFILLED
}

function colorForReturnStatus(s: string) {
  if (s === 'COMPLETED' || s === 'APPROVED' || s === 'REFUNDED') return '#16a34a';
  if (s === 'REJECTED' || s === 'CANCELLED') return '#dc2626';
  if (s === 'IN_TRANSIT' || s === 'SHIPPED') return '#d97706';
  if (s === 'RECEIVED' || s === 'QC_IN_PROGRESS') return '#2563eb';
  return '#6b7280';
}

const fulfillmentLabel = (s: string) => {
  switch (s) {
    case 'DELIVERED':
      return 'Delivered';
    case 'SHIPPED':
      return 'Shipped';
    case 'PACKED':
      return 'Packed';
    case 'FULFILLED':
      return 'Fulfilled';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return 'Unfulfilled';
  }
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
  minWidth: 160,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px',
  verticalAlign: 'middle',
  fontSize: 13,
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};

export default function FranchiseOrdersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('orders');

  // ---------------- Orders state ----------------
  const [ordersData, setOrdersData] = useState<{
    subOrders: FranchiseOrder[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  } | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersPage, setOrdersPage] = useState(1);
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [acceptFilter, setAcceptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // KPI counts
  const [kpis, setKpis] = useState({
    pendingAcceptance: 0,
    inProgress: 0,
    delivered: 0,
    returnsToProcess: 0,
  });

  // ---------------- Returns state ----------------
  const [returnsData, setReturnsData] = useState<{
    returns: FranchiseReturn[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  } | null>(null);
  const [returnsLoading, setReturnsLoading] = useState(true);
  const [returnsPage, setReturnsPage] = useState(1);
  const [returnsStatusFilter, setReturnsStatusFilter] = useState('');

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await franchiseOrdersService.list({
        page: ordersPage,
        limit: 20,
        fulfillmentStatus: fulfillmentFilter || undefined,
        acceptStatus: acceptFilter || undefined,
        search: searchQuery || undefined,
      });
      if (res.data) setOrdersData(res.data);
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to load orders');
      else alert('Failed to load orders');
    } finally {
      setOrdersLoading(false);
    }
  }, [ordersPage, fulfillmentFilter, acceptFilter, searchQuery]);

  const fetchReturns = useCallback(async () => {
    setReturnsLoading(true);
    try {
      const res = await franchiseReturnsService.list({
        page: returnsPage,
        limit: 20,
        status: returnsStatusFilter || undefined,
      });
      if (res.data) setReturnsData(res.data);
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to load returns');
      else alert('Failed to load returns');
    } finally {
      setReturnsLoading(false);
    }
  }, [returnsPage, returnsStatusFilter]);

  const fetchKpis = useCallback(async () => {
    try {
      const [openRes, packedRes, shippedRes, unfulfilledRes, deliveredRes, returnsRes] =
        await Promise.all([
          franchiseOrdersService.list({ page: 1, limit: 1, acceptStatus: 'OPEN' }),
          franchiseOrdersService.list({ page: 1, limit: 1, fulfillmentStatus: 'PACKED' }),
          franchiseOrdersService.list({ page: 1, limit: 1, fulfillmentStatus: 'SHIPPED' }),
          franchiseOrdersService.list({
            page: 1,
            limit: 1,
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'ACCEPTED',
          }),
          franchiseOrdersService.list({ page: 1, limit: 1, fulfillmentStatus: 'DELIVERED' }),
          franchiseReturnsService.list({ page: 1, limit: 1 }),
        ]);
      setKpis({
        pendingAcceptance: openRes.data?.pagination.total || 0,
        inProgress:
          (packedRes.data?.pagination.total || 0) +
          (shippedRes.data?.pagination.total || 0) +
          (unfulfilledRes.data?.pagination.total || 0),
        delivered: deliveredRes.data?.pagination.total || 0,
        returnsToProcess: returnsRes.data?.pagination.total || 0,
      });
    } catch {
      // ignore KPI errors
    }
  }, []);

  useEffect(() => {
    if (tab === 'orders') fetchOrders();
  }, [tab, fetchOrders]);

  useEffect(() => {
    if (tab === 'returns') fetchReturns();
  }, [tab, fetchReturns]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setOrdersPage(1);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p>Manage customer orders and returns assigned to your franchise</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-icon amber">&#128276;</div>
          <div className="stat-content">
            <h3>Pending Acceptance</h3>
            <div className="stat-value">{kpis.pendingAcceptance}</div>
            <div className="stat-sub">Orders awaiting response</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">&#128230;</div>
          <div className="stat-content">
            <h3>In Progress</h3>
            <div className="stat-value">{kpis.inProgress}</div>
            <div className="stat-sub">Being packed or shipped</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">&#10004;</div>
          <div className="stat-content">
            <h3>Delivered</h3>
            <div className="stat-value">{kpis.delivered}</div>
            <div className="stat-sub">Successfully fulfilled</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">&#8634;</div>
          <div className="stat-content">
            <h3>Returns to Process</h3>
            <div className="stat-value">{kpis.returnsToProcess}</div>
            <div className="stat-sub">Awaiting warehouse action</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '2px solid #e5e7eb',
          marginBottom: 20,
        }}
      >
        <button
          onClick={() => setTab('orders')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            color: tab === 'orders' ? '#2563eb' : '#6b7280',
            borderBottom:
              tab === 'orders' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          Orders
        </button>
        <button
          onClick={() => setTab('returns')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            color: tab === 'returns' ? '#2563eb' : '#6b7280',
            borderBottom:
              tab === 'returns' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          Returns
        </button>
      </div>

      {tab === 'orders' ? (
        <>
          {/* Orders Filters */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 16,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              value={fulfillmentFilter}
              onChange={(e) => {
                setFulfillmentFilter(e.target.value);
                setOrdersPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Fulfillment</option>
              <option value="UNFULFILLED">Unfulfilled</option>
              <option value="PACKED">Packed</option>
              <option value="SHIPPED">Shipped</option>
              <option value="DELIVERED">Delivered</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              value={acceptFilter}
              onChange={(e) => {
                setAcceptFilter(e.target.value);
                setOrdersPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Accept Status</option>
              <option value="OPEN">Open</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                placeholder="Search order number..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 13,
                  width: 200,
                }}
              />
              <button
                onClick={handleSearch}
                style={{
                  padding: '8px 14px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#f9fafb',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Search
              </button>
            </div>
          </div>

          {ordersLoading && !ordersData ? (
            <div className="card">Loading...</div>
          ) : !ordersData || ordersData.subOrders.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No orders found</h3>
              <p style={{ color: '#6b7280' }}>
                Orders assigned to your franchise will appear here.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f9fafb',
                        borderBottom: '2px solid #e5e7eb',
                      }}
                    >
                      <th style={thStyle}>Order Number</th>
                      <th style={thStyle}>Items</th>
                      <th style={thStyle}>Sub Total</th>
                      <th style={thStyle}>Accept Status</th>
                      <th style={thStyle}>Fulfillment</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordersData.subOrders.map((so) => (
                      <tr
                        key={so.id}
                        onClick={() => router.push(`/dashboard/orders/${so.id}`)}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = '#f9fafb')
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                      >
                        <td style={tdStyle}>
                          <strong style={{ color: '#2563eb' }}>
                            {so.masterOrder?.orderNumber || so.id.slice(0, 8)}
                          </strong>
                        </td>
                        <td style={tdStyle}>
                          {so.items?.reduce((a, i) => a + i.quantity, 0) || 0}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {fmtCurrency(Number(so.subTotal))}
                        </td>
                        <td style={tdStyle}>
                          <Badge
                            text={so.acceptStatus}
                            color={colorForAcceptStatus(so.acceptStatus)}
                          />
                        </td>
                        <td style={tdStyle}>
                          <Badge
                            text={fulfillmentLabel(so.fulfillmentStatus)}
                            color={colorForFulfillment(so.fulfillmentStatus)}
                          />
                        </td>
                        <td style={tdStyle}>{fmtDate(so.createdAt)}</td>
                        <td style={tdStyle}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/orders/${so.id}`);
                            }}
                            style={{
                              padding: '6px 14px',
                              fontSize: 12,
                              fontWeight: 600,
                              border: '1px solid #2563eb',
                              background: '#fff',
                              color: '#2563eb',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {ordersData.pagination.totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    padding: 20,
                    borderTop: '1px solid #f3f4f6',
                  }}
                >
                  <button
                    disabled={ordersPage <= 1}
                    onClick={() => setOrdersPage(ordersPage - 1)}
                    style={pageBtnStyle}
                  >
                    Previous
                  </button>
                  <span style={{ padding: '8px 12px', fontSize: 14 }}>
                    Page {ordersPage} of {ordersData.pagination.totalPages}
                  </span>
                  <button
                    disabled={ordersPage >= ordersData.pagination.totalPages}
                    onClick={() => setOrdersPage(ordersPage + 1)}
                    style={pageBtnStyle}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Returns Filters */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 16,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              value={returnsStatusFilter}
              onChange={(e) => {
                setReturnsStatusFilter(e.target.value);
                setReturnsPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Status</option>
              <option value="REQUESTED">Requested</option>
              <option value="APPROVED">Approved</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="RECEIVED">Received</option>
              <option value="QC_IN_PROGRESS">QC In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="REFUNDED">Refunded</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {returnsLoading && !returnsData ? (
            <div className="card">Loading...</div>
          ) : !returnsData || returnsData.returns.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>&#8634;</div>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No returns found</h3>
              <p style={{ color: '#6b7280' }}>
                Returns assigned to your franchise warehouse will appear here.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f9fafb',
                        borderBottom: '2px solid #e5e7eb',
                      }}
                    >
                      <th style={thStyle}>Return Number</th>
                      <th style={thStyle}>Order Number</th>
                      <th style={thStyle}>Items</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Refund Amount</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnsData.returns.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() =>
                          router.push(`/dashboard/orders/returns/${r.id}`)
                        }
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = '#f9fafb')
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                      >
                        <td style={tdStyle}>
                          <strong style={{ color: '#2563eb' }}>
                            {r.returnNumber}
                          </strong>
                        </td>
                        <td style={tdStyle}>
                          {r.masterOrder?.orderNumber || '-'}
                        </td>
                        <td style={tdStyle}>
                          {r.items?.reduce((a, i) => a + i.quantity, 0) || 0}
                        </td>
                        <td style={tdStyle}>
                          <Badge
                            text={r.status}
                            color={colorForReturnStatus(r.status)}
                          />
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {r.refundAmount != null
                            ? fmtCurrency(Number(r.refundAmount))
                            : '-'}
                        </td>
                        <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                        <td style={tdStyle}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/orders/returns/${r.id}`);
                            }}
                            style={{
                              padding: '6px 14px',
                              fontSize: 12,
                              fontWeight: 600,
                              border: '1px solid #2563eb',
                              background: '#fff',
                              color: '#2563eb',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {returnsData.pagination.totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    padding: 20,
                    borderTop: '1px solid #f3f4f6',
                  }}
                >
                  <button
                    disabled={returnsPage <= 1}
                    onClick={() => setReturnsPage(returnsPage - 1)}
                    style={pageBtnStyle}
                  >
                    Previous
                  </button>
                  <span style={{ padding: '8px 12px', fontSize: 14 }}>
                    Page {returnsPage} of {returnsData.pagination.totalPages}
                  </span>
                  <button
                    disabled={returnsPage >= returnsData.pagination.totalPages}
                    onClick={() => setReturnsPage(returnsPage + 1)}
                    style={pageBtnStyle}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
