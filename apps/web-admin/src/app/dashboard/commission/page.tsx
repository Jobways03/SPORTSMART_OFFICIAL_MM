'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  sellerName: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  commissionType: string;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  productEarning: number;
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

function Th({ label }: { label: string }) {
  return <th style={thStyle}>{label}</th>;
}

export default function AdminCommissionPage() {
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [commissionType, setCommissionType] = useState('');

  const fetchData = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (commissionType) params.set('commissionType', commissionType);

    apiClient<CommissionResponse>(`/admin/commission?${params}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, dateFrom, dateTo, commissionType]);

  useEffect(() => { fetchData(page); }, [page, fetchData]);

  const handleApply = () => { setPage(1); fetchData(1); };
  const handleClear = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setCommissionType('');
    setPage(1);
  };

  const fmt = (n: number) =>
    `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Summary totals
  const totalAdminEarning = data?.records.reduce((a, r) => a + Number(r.adminEarning), 0) ?? 0;
  const totalRefunded = data?.records.reduce((a, r) => a + Number(r.refundedAdminEarning), 0) ?? 0;
  const totalCommission = data?.records.reduce((a, r) => a + Number(r.totalCommission), 0) ?? 0;

  const hasFilters = search || dateFrom || dateTo || commissionType;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Commission</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            Track marketplace commissions from all seller orders.
          </p>
        </div>
        <Link
          href="/dashboard/commission/settings"
          style={{
            padding: '10px 22px',
            fontSize: 13,
            fontWeight: 600,
            background: '#2563eb',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Commission Settings
        </Link>
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
            placeholder="Order no, product, seller..."
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
        <div style={{ flex: '0 1 180px' }}>
          <label style={filterLabelStyle}>Commission Type</label>
          <select
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value)}
            style={filterInputStyle}
          >
            <option value="">All Types</option>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED">Fixed</option>
            <option value="PERCENTAGE_PLUS_FIXED">% + Fixed</option>
            <option value="FIXED_PLUS_PERCENTAGE">Fixed + %</option>
          </select>
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
          <SummaryCard label="Total Commission (This Page)" value={fmt(totalCommission)} color="#2563eb" />
          <SummaryCard label="Admin Earning (This Page)" value={fmt(totalAdminEarning)} color="#16a34a" />
          <SummaryCard label="Refunded (This Page)" value={fmt(totalRefunded)} color="#dc2626" />
          <SummaryCard label="Total Records" value={String(data.pagination.total)} color="#7c3aed" />
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
              : 'Commission records will appear here when orders are placed.'}
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
                    <Th label="SELLER NAME" />
                    <Th label="PRODUCT NAME" />
                    <Th label="QTY" />
                    <Th label="PRICE" />
                    <Th label="UNIT PRODUCT COMMISSION" />
                    <Th label="TOTAL PRODUCT COMMISSION" />
                    <Th label="TOTAL ADMIN EARNING" />
                    <Th label="REFUNDED ADMIN EARNING" />
                    <Th label="STORE ORDER ID" />
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
                        <span style={{ fontWeight: 500 }}>{r.sellerName}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: '#2563eb' }} title={r.productTitle}>
                          {r.productTitle.length > 22 ? r.productTitle.slice(0, 22) + '...' : r.productTitle}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.unitPrice))}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.unitCommission))}</td>
                      <td style={{ ...tdNumStyle, fontWeight: 600 }}>{fmt(Number(r.totalCommission))}</td>
                      <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(Number(r.adminEarning))}</td>
                      <td style={{
                        ...tdNumStyle,
                        color: Number(r.refundedAdminEarning) > 0 ? '#dc2626' : '#9ca3af',
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
  ...tdStyle,
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
