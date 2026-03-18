'use client';

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  productEarning: number;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  refundedAdminEarning: number;
  vatOnCommission: number;
  taxCommission: number;
  shippingCommission: number;
  createdAt: string;
}

interface CommissionResponse {
  records: CommissionRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function getToken() {
  try { return sessionStorage.getItem('accessToken'); } catch { return null; }
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function Th({ label }: { label: string }) {
  return <th style={thStyle}>{label}</th>;
}

export default function SellerCommissionPage() {
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    fetch(`${API_BASE}/api/v1/seller/commission?${params}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    })
      .then((r) => r.json())
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, dateFrom, dateTo]);

  useEffect(() => { fetchData(page); }, [page, fetchData]);

  const handleApply = () => { setPage(1); fetchData(1); };
  const handleClear = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const fmt = (n: number) =>
    `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Summary totals
  const totalEarning = data?.records.reduce((a, r) => a + Number(r.productEarning), 0) ?? 0;
  const totalDeducted = data?.records.reduce((a, r) => a + Number(r.totalCommission), 0) ?? 0;
  const totalRefunded = data?.records.reduce((a, r) => a + Number(r.refundedAdminEarning), 0) ?? 0;

  const hasFilters = search || dateFrom || dateTo;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Commission</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Track commissions deducted from your orders by the marketplace.
        </p>
      </div>

      {/* Filters */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={filterLabelStyle}>Search</label>
          <input
            type="text"
            placeholder="Order no, product name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            style={filterInputStyle}
          />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={filterLabelStyle}>From Date</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={filterInputStyle}
          />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={filterLabelStyle}>To Date</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={filterInputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 1 }}>
          <button onClick={handleApply} style={filterBtnStyle}>Apply</button>
          {hasFilters && (
            <button onClick={handleClear} style={{ ...filterBtnStyle, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && data.records.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <SummaryCard label="Your Earning (This Page)" value={fmt(totalEarning)} color="#16a34a" />
          <SummaryCard label="Commission Deducted (This Page)" value={fmt(totalDeducted)} color="#dc2626" />
          <SummaryCard label="Refunded Back (This Page)" value={fmt(totalRefunded)} color="#7c3aed" />
          <SummaryCard label="Total Records" value={String(data.pagination.total)} color="#2563eb" />
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading commissions...</div>
      ) : !data || data.records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No commission records {hasFilters ? 'match your filters' : 'yet'}</h3>
          <p style={{ color: '#6b7280' }}>
            {hasFilters
              ? 'Try adjusting your filters or clearing them.'
              : 'Commission records will appear here when your orders are placed.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                    <Th label="ORDER ID" />
                    <Th label="DATE" />
                    <Th label="PRODUCT NAME" />
                    <Th label="QTY" />
                    <Th label="PRODUCT PRICE" />
                    <Th label="PRODUCT EARNING" />
                    <Th label="COMMISSION RATE" />
                    <Th label="UNIT PRODUCT COMMISSION" />
                    <Th label="TOTAL PRODUCT COMMISSION" />
                    <Th label="TOTAL ADMIN EARNING" />
                    <Th label="REFUNDED ADMIN EARNING" />
                    <Th label="STORE ORDER NO" />
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r, i) => (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        background: i % 2 === 0 ? '#fff' : '#fafbfc',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f4ff')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc')}
                    >
                      <td style={tdStyle}>
                        <span style={{ color: '#2563eb', fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                          {r.orderItemId.slice(0, 8)}
                        </span>
                      </td>
                      <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                      <td style={tdStyle}>
                        <span style={{ color: '#2563eb' }} title={r.productTitle}>
                          {r.productTitle.length > 25 ? r.productTitle.slice(0, 25) + '...' : r.productTitle}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.unitPrice))}</td>
                      <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(Number(r.productEarning))}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 500 }}>{r.commissionRate}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.unitCommission))}</td>
                      <td style={{ ...tdNumStyle, fontWeight: 600, color: '#dc2626' }}>{fmt(Number(r.totalCommission))}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.adminEarning))}</td>
                      <td style={{
                        ...tdNumStyle,
                        color: Number(r.refundedAdminEarning) > 0 ? '#16a34a' : '#9ca3af',
                        fontWeight: Number(r.refundedAdminEarning) > 0 ? 600 : 400,
                      }}>
                        {fmt(Number(r.refundedAdminEarning))}
                      </td>
                      <td style={tdStyle}>
                        <strong style={{ color: '#374151' }}>{r.orderNumber}</strong>
                      </td>
                    </tr>
                  ))}
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

/* ── Summary Card ── */
function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const filterLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: 4,
};

const filterInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const filterBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  fontWeight: 600,
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

const tdNumStyle: React.CSSProperties = {
  padding: '12px 10px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontFamily: 'monospace',
  fontSize: 12,
  textAlign: 'right',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
