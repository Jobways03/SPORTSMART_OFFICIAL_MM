'use client';

import { useEffect, useState, useCallback } from 'react';
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
  createdAt: string;
}

interface CommissionResponse {
  records: CommissionRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function Th({ label }: { label: string }) {
  return <th style={thStyle}>{label}</th>;
}

export default function StorefrontCommissionPage() {
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    apiClient<CommissionResponse>(`/admin/commission?${params}`)
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

  const totalCommission = data?.records.reduce((a, r) => a + Number(r.totalCommission), 0) ?? 0;
  const totalAdminEarning = data?.records.reduce((a, r) => a + Number(r.adminEarning), 0) ?? 0;
  const totalSellerEarning = data?.records.reduce((a, r) => a + Number(r.productEarning), 0) ?? 0;
  const totalRefunded = data?.records.reduce((a, r) => a + Number(r.refundedAdminEarning), 0) ?? 0;

  const hasFilters = search || dateFrom || dateTo;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Commission</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Track commissions from delivered orders. Commissions are processed after the return/exchange window expires.
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
            placeholder="Order no, product, seller..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            style={filterInputStyle}
          />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={filterLabelStyle}>From Date</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={filterInputStyle} />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={filterLabelStyle}>To Date</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={filterInputStyle} />
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
          <SummaryCard label="Total Commission" value={fmt(totalCommission)} color="#2563eb" />
          <SummaryCard label="Admin Earning" value={fmt(totalAdminEarning)} color="#16a34a" />
          <SummaryCard label="Seller Earning" value={fmt(totalSellerEarning)} color="#7c3aed" />
          <SummaryCard label="Refunded" value={fmt(totalRefunded)} color="#dc2626" />
          <SummaryCard label="Total Records" value={String(data.pagination.total)} color="#374151" />
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading commissions...</div>
      ) : !data || data.records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128176;</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No commission records {hasFilters ? 'match your filters' : 'yet'}</h3>
          <p style={{ color: '#6b7280' }}>
            {hasFilters
              ? 'Try adjusting your filters or clearing them.'
              : 'Commission records appear here after orders are delivered and the return window expires (1 min for testing).'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                    <Th label="ORDER NO" />
                    <Th label="DATE" />
                    <Th label="SELLER" />
                    <Th label="PRODUCT" />
                    <Th label="QTY" />
                    <Th label="UNIT PRICE" />
                    <Th label="TOTAL PRICE" />
                    <Th label="RATE" />
                    <Th label="COMMISSION" />
                    <Th label="ADMIN EARNING" />
                    <Th label="SELLER EARNING" />
                    <Th label="REFUNDED" />
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
                        <strong style={{ color: '#2563eb' }}>{r.orderNumber}</strong>
                      </td>
                      <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                      <td style={tdStyle}><span style={{ fontWeight: 500 }}>{r.sellerName}</span></td>
                      <td style={tdStyle}>
                        <span style={{ color: '#2563eb' }} title={r.productTitle}>
                          {r.productTitle.length > 22 ? r.productTitle.slice(0, 22) + '...' : r.productTitle}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.unitPrice))}</td>
                      <td style={tdNumStyle}>{fmt(Number(r.totalPrice))}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 500 }}>{r.commissionRate}</td>
                      <td style={{ ...tdNumStyle, fontWeight: 600, color: '#dc2626' }}>{fmt(Number(r.totalCommission))}</td>
                      <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(Number(r.adminEarning))}</td>
                      <td style={{ ...tdNumStyle, color: '#7c3aed', fontWeight: 600 }}>{fmt(Number(r.productEarning))}</td>
                      <td style={{
                        ...tdNumStyle,
                        color: Number(r.refundedAdminEarning) > 0 ? '#dc2626' : '#9ca3af',
                        fontWeight: Number(r.refundedAdminEarning) > 0 ? 600 : 400,
                      }}>
                        {fmt(Number(r.refundedAdminEarning))}
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

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const filterLabelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4,
};

const filterInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
  outline: 'none', boxSizing: 'border-box',
};

const filterBtnStyle: React.CSSProperties = {
  padding: '8px 20px', fontSize: 13, fontWeight: 600,
  border: 'none', borderRadius: 6, background: '#2563eb',
  color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 8px', fontWeight: 600,
  fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
  letterSpacing: '0.04em', whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 8px', verticalAlign: 'middle', whiteSpace: 'nowrap',
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle, fontFamily: 'monospace', fontSize: 12, textAlign: 'right',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', fontSize: 13, cursor: 'pointer',
};
