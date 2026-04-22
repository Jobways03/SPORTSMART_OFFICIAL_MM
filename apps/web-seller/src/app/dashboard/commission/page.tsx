'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface EarningsSummary {
  totalEarned: number;
  pendingSettlement: number;
  lastPayout: { amount: number; paidAt: string; utrReference: string | null } | null;
}

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  productTitle: string;
  variantTitle: string | null;
  platformPrice: number;
  settlementPrice: number;
  quantity: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  platformMargin: number;
  status: string;
  // Legacy fields
  unitPrice: number;
  totalPrice: number;
  productEarning: number;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  refundedAdminEarning: number;
  createdAt: string;
}

interface CommissionResponse {
  records: CommissionRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface SettlementRecord {
  id: string;
  cycleId: string;
  sellerName: string;
  totalOrders: number;
  totalItems: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  totalPlatformMargin: number;
  status: string;
  paidAt: string | null;
  utrReference: string | null;
  createdAt: string;
  cycle: { periodStart: string; periodEnd: string; status: string };
}

interface SettlementResponse {
  settlements: SettlementRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function Th({ label }: { label: string }) {
  return <th style={thStyle}>{label}</th>;
}

type TabType = 'records' | 'settlements';

export default function SellerCommissionPage() {
  const [activeTab, setActiveTab] = useState<TabType>('records');
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [currentSeller, setCurrentSeller] = useState<{ sellerName: string; sellerShopName: string } | null>(null);

  // Pull the active seller identity from sessionStorage so the header
  // always shows whose data this page is rendering — catches the case
  // where a stale login in another tab/window causes confusion.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('seller');
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.sellerShopName) {
          setCurrentSeller({ sellerName: s.sellerName, sellerShopName: s.sellerShopName });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Commission records state
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Settlement history state
  const [settlements, setSettlements] = useState<SettlementResponse | null>(null);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementLoading, setSettlementLoading] = useState(false);

  // Fetch earnings summary
  useEffect(() => {
    apiClient<EarningsSummary>('/seller/earnings/summary')
      .then((res) => { if (res.data) setSummary(res.data); })
      .catch(() => {});
  }, []);

  // Fetch commission records
  const fetchRecords = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    apiClient<any>(`/seller/earnings/records?${params}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, statusFilter, dateFrom, dateTo]);

  // Fetch settlement history
  const fetchSettlements = useCallback((p: number) => {
    setSettlementLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    apiClient<SettlementResponse>(`/seller/earnings/settlements?${params}`)
      .then((res) => { if (res.data) setSettlements(res.data); })
      .catch(() => {})
      .finally(() => setSettlementLoading(false));
  }, []);

  useEffect(() => { fetchRecords(page); }, [page, fetchRecords]);
  useEffect(() => {
    if (activeTab === 'settlements') fetchSettlements(settlementPage);
  }, [activeTab, settlementPage, fetchSettlements]);

  const handleApply = () => { setPage(1); fetchRecords(1); };
  const handleClear = () => {
    setSearch('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const fmt = (n: number) =>
    `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const hasFilters = search || statusFilter || dateFrom || dateTo;

  const statusBadge = (s: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      PENDING: { bg: '#fef3c7', color: '#92400e' },
      SETTLED: { bg: '#d1fae5', color: '#065f46' },
      PAID: { bg: '#d1fae5', color: '#065f46' },
      APPROVED: { bg: '#dbeafe', color: '#1e40af' },
      REFUNDED: { bg: '#fee2e2', color: '#991b1b' },
    };
    // Human labels so the UI doesn't render raw enum values. Unknown
    // statuses fall back to title-case (e.g. FUTURE_STATE → "Future
    // state") instead of the screaming-snake original.
    const labels: Record<string, string> = {
      PENDING: 'Pending',
      SETTLED: 'Settled',
      PAID: 'Paid',
      APPROVED: 'Approved',
      REFUNDED: 'Refunded',
    };
    const c = colors[s] || { bg: '#f3f4f6', color: '#374151' };
    const label =
      labels[s] ??
      s
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/, (ch) => ch.toUpperCase());
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}>
        {label}
      </span>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Earnings & Settlements</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Track your earnings, settlement prices, and payout history.
        </p>
        {currentSeller && (
          <div style={{
            marginTop: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            borderRadius: 999,
            fontSize: 12,
            color: '#3730a3',
            fontWeight: 600,
          }}>
            Viewing as: {currentSeller.sellerShopName}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryCard
          label="Total Earned"
          value={fmt(summary?.totalEarned ?? 0)}
          color="#16a34a"
        />
        <SummaryCard
          label="Pending Settlement"
          value={fmt(summary?.pendingSettlement ?? 0)}
          color="#d97706"
        />
        <SummaryCard
          label="Last Payout"
          value={summary?.lastPayout ? fmt(summary.lastPayout.amount) : '--'}
          subtitle={summary?.lastPayout?.paidAt ? fmtDate(summary.lastPayout.paidAt) : undefined}
          color="#2563eb"
        />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        {(['records', 'settlements'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 24px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {tab === 'records' ? 'Commission Records' : 'Settlement History'}
          </button>
        ))}
      </div>

      {activeTab === 'records' && (
        <>
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
            <div style={{ flex: '0 1 140px' }}>
              <label style={filterLabelStyle}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={filterInputStyle}
              >
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="SETTLED">Settled</option>
                <option value="REFUNDED">Refunded</option>
              </select>
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

          {loading && !data ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading records...</div>
          ) : !data || data.records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No commission records {hasFilters ? 'match your filters' : 'yet'}</h3>
              <p style={{ color: '#6b7280' }}>
                {hasFilters
                  ? 'Try adjusting your filters or clearing them.'
                  : 'Commission records will appear here when your orders are delivered.'}
              </p>
            </div>
          ) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                        <Th label="ORDER #" />
                        <Th label="DATE" />
                        <Th label="PRODUCT" />
                        <Th label="QTY" />
                        <Th label="PLATFORM PRICE" />
                        <Th label="SETTLEMENT PRICE" />
                        <Th label="TOTAL EARNED" />
                        <Th label="MARGIN" />
                        <Th label="STATUS" />
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
                            <strong style={{ color: '#374151' }}>{r.orderNumber}</strong>
                          </td>
                          <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                          <td style={tdStyle}>
                            <span style={{ color: '#2563eb' }} title={r.productTitle}>
                              {r.productTitle.length > 25 ? r.productTitle.slice(0, 25) + '...' : r.productTitle}
                            </span>
                            {r.variantTitle && (
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.variantTitle}</div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                          <td style={tdNumStyle}>{fmt(Number(r.platformPrice))}</td>
                          <td style={tdNumStyle}>{fmt(Number(r.settlementPrice))}</td>
                          <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>
                            {fmt(Number(r.totalSettlementAmount))}
                          </td>
                          <td style={{ ...tdNumStyle, color: '#dc2626' }}>
                            {fmt(Number(r.platformMargin))}
                          </td>
                          <td style={tdStyle}>{statusBadge(r.status)}</td>
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
        </>
      )}

      {activeTab === 'settlements' && (
        <>
          {settlementLoading && !settlements ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading settlement history...</div>
          ) : !settlements || settlements.settlements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No settlements yet</h3>
              <p style={{ color: '#6b7280' }}>Settlement records will appear here once payouts are processed.</p>
            </div>
          ) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                        <Th label="PERIOD" />
                        <Th label="ORDERS" />
                        <Th label="ITEMS" />
                        <Th label="PLATFORM AMOUNT" />
                        <Th label="SETTLEMENT AMOUNT" />
                        <Th label="STATUS" />
                        <Th label="PAID DATE" />
                        <Th label="UTR" />
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.settlements.map((s, i) => (
                        <tr
                          key={s.id}
                          style={{
                            borderBottom: '1px solid #f3f4f6',
                            background: i % 2 === 0 ? '#fff' : '#fafbfc',
                          }}
                        >
                          <td style={tdStyle}>
                            {fmtDate(s.cycle.periodStart)} - {fmtDate(s.cycle.periodEnd)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{s.totalOrders}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{s.totalItems}</td>
                          <td style={tdNumStyle}>{fmt(Number(s.totalPlatformAmount))}</td>
                          <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>
                            {fmt(Number(s.totalSettlementAmount))}
                          </td>
                          <td style={tdStyle}>{statusBadge(s.status)}</td>
                          <td style={tdStyle}>{s.paidAt ? fmtDate(s.paidAt) : '--'}</td>
                          <td style={tdStyle}>
                            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {s.utrReference || '--'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {settlements.pagination.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
                  <button disabled={settlementPage <= 1} onClick={() => setSettlementPage(settlementPage - 1)} style={pageBtnStyle}>Previous</button>
                  <span style={{ padding: '8px 12px', fontSize: 14 }}>
                    Page {settlementPage} of {settlements.pagination.totalPages}
                  </span>
                  <button disabled={settlementPage >= settlements.pagination.totalPages} onClick={() => setSettlementPage(settlementPage + 1)} style={pageBtnStyle}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Summary Card ── */
function SummaryCard({ label, value, color, subtitle }: { label: string; value: string; color: string; subtitle?: string }) {
  return (
    <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{subtitle}</div>}
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
