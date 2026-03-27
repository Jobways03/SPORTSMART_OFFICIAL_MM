'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ── Types ── */

interface MarginSummary {
  totalPlatformRevenue: number;
  totalSellerPayouts: number;
  totalPlatformMargin: number;
  pendingSettlementAmount: number;
  totalSettlementsDue: number;
}

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  sellerName: string;
  productTitle: string;
  variantTitle: string | null;
  platformPrice: number;
  settlementPrice: number;
  quantity: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  platformMargin: number;
  status: string;
  unitPrice: number;
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

interface SellerBreakdown {
  sellerId: string;
  sellerName: string;
  totalRecords: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  totalPlatformMargin: number;
}

interface SellerBreakdownResponse {
  sellers: SellerBreakdown[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface SettlementCycle {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  totalMargin: number;
  createdAt: string;
  _count: { sellerSettlements: number };
}

interface CycleListResponse {
  cycles: SettlementCycle[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface SellerSettlement {
  id: string;
  sellerId: string;
  sellerName: string;
  totalOrders: number;
  totalItems: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  totalPlatformMargin: number;
  status: string;
  paidAt: string | null;
  utrReference: string | null;
  _count: { commissionRecords: number };
}

interface CycleDetail {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  totalMargin: number;
  sellerSettlements: SellerSettlement[];
}

interface Reconciliation {
  totalPlatformRevenue: number;
  totalSellerSettlements: number;
  totalPlatformMargin: number;
  pendingSettlements: { count: number; amount: number; platformAmount: number };
  settledPayments: { count: number; amount: number };
  totalDeliveredItems: number;
  totalCommissionRecords: number;
  isReconciled: boolean;
  mismatches: string[];
}

function Th({ label }: { label: string }) {
  return <th style={thStyle}>{label}</th>;
}

type TabType = 'records' | 'sellers' | 'cycles' | 'reconciliation';

export default function AdminCommissionPage() {
  const [activeTab, setActiveTab] = useState<TabType>('records');
  const [marginSummary, setMarginSummary] = useState<MarginSummary | null>(null);

  // Commission records
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Seller breakdown
  const [sellerData, setSellerData] = useState<SellerBreakdownResponse | null>(null);
  const [sellerPage, setSellerPage] = useState(1);

  // Settlement cycles
  const [cycles, setCycles] = useState<CycleListResponse | null>(null);
  const [cyclePage, setCyclePage] = useState(1);
  const [cycleDetail, setCycleDetail] = useState<CycleDetail | null>(null);

  // Reconciliation
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);

  // Create cycle form
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');
  const [creating, setCreating] = useState(false);

  // Mark paid form
  const [payingId, setPayingId] = useState<string | null>(null);
  const [utrInput, setUtrInput] = useState('');

  // Fetch margin summary
  useEffect(() => {
    apiClient<MarginSummary>('/admin/settlements/margin-summary')
      .then((res) => { if (res.data) setMarginSummary(res.data); })
      .catch(() => {});
  }, []);

  // Fetch commission records
  const fetchData = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (statusFilter) params.set('status', statusFilter);

    apiClient<CommissionResponse>(`/admin/commission?${params}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, dateFrom, dateTo, statusFilter]);

  // Fetch seller breakdown
  const fetchSellers = useCallback((p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    apiClient<SellerBreakdownResponse>(`/admin/settlements/seller-breakdown?${params}`)
      .then((res) => { if (res.data) setSellerData(res.data); })
      .catch(() => {});
  }, []);

  // Fetch settlement cycles
  const fetchCycles = useCallback((p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    apiClient<CycleListResponse>(`/admin/settlements/cycles?${params}`)
      .then((res) => { if (res.data) setCycles(res.data); })
      .catch(() => {});
  }, []);

  // Fetch reconciliation
  const fetchReconciliation = useCallback(() => {
    apiClient<Reconciliation>('/admin/settlements/reconciliation')
      .then((res) => { if (res.data) setReconciliation(res.data); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchData(page); }, [page, fetchData]);
  useEffect(() => {
    if (activeTab === 'sellers') fetchSellers(sellerPage);
  }, [activeTab, sellerPage, fetchSellers]);
  useEffect(() => {
    if (activeTab === 'cycles') { fetchCycles(cyclePage); setCycleDetail(null); }
  }, [activeTab, cyclePage, fetchCycles]);
  useEffect(() => {
    if (activeTab === 'reconciliation') fetchReconciliation();
  }, [activeTab, fetchReconciliation]);

  const handleApply = () => { setPage(1); fetchData(1); };
  const handleClear = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setPage(1);
  };

  const fmt = (n: number) =>
    `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const hasFilters = search || dateFrom || dateTo || statusFilter;

  const statusBadge = (s: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      PENDING: { bg: '#fef3c7', color: '#92400e' },
      SETTLED: { bg: '#d1fae5', color: '#065f46' },
      PAID: { bg: '#d1fae5', color: '#065f46' },
      APPROVED: { bg: '#dbeafe', color: '#1e40af' },
      DRAFT: { bg: '#f3f4f6', color: '#374151' },
      PREVIEWED: { bg: '#e0e7ff', color: '#3730a3' },
      REFUNDED: { bg: '#fee2e2', color: '#991b1b' },
    };
    const c = colors[s] || { bg: '#f3f4f6', color: '#374151' };
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}>
        {s}
      </span>
    );
  };

  /* ── Create cycle handler ── */
  const handleCreateCycle = async () => {
    if (!createStart || !createEnd) return;
    setCreating(true);
    try {
      await apiClient('/admin/settlements/create-cycle', {
        method: 'POST',
        body: JSON.stringify({ periodStart: createStart, periodEnd: createEnd }),
      });
      setCreateStart('');
      setCreateEnd('');
      fetchCycles(1);
      // Refresh summary
      apiClient<MarginSummary>('/admin/settlements/margin-summary')
        .then((res) => { if (res.data) setMarginSummary(res.data); })
        .catch(() => {});
    } catch {
      // error handled by apiClient
    } finally {
      setCreating(false);
    }
  };

  /* ── Approve cycle handler ── */
  const handleApproveCycle = async (cycleId: string) => {
    try {
      await apiClient(`/admin/settlements/cycles/${cycleId}/approve`, { method: 'PATCH' });
      fetchCycles(cyclePage);
      if (cycleDetail?.id === cycleId) {
        viewCycleDetail(cycleId);
      }
    } catch {
      // error handled
    }
  };

  /* ── Mark paid handler ── */
  const handleMarkPaid = async (settlementId: string) => {
    if (!utrInput.trim()) return;
    try {
      await apiClient(`/admin/settlements/${settlementId}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({ utrReference: utrInput.trim() }),
      });
      setPayingId(null);
      setUtrInput('');
      if (cycleDetail) {
        viewCycleDetail(cycleDetail.id);
      }
      fetchCycles(cyclePage);
    } catch {
      // error handled
    }
  };

  /* ── View cycle detail ── */
  const viewCycleDetail = async (cycleId: string) => {
    try {
      const res = await apiClient<CycleDetail>(`/admin/settlements/cycles/${cycleId}`);
      if (res.data) setCycleDetail(res.data);
    } catch {
      // error handled
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Commission & Settlements</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            Platform margin tracking, settlement cycles, and reconciliation.
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

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Platform Revenue" value={fmt(marginSummary?.totalPlatformRevenue ?? 0)} color="#2563eb" />
        <SummaryCard label="Total Seller Payouts" value={fmt(marginSummary?.totalSellerPayouts ?? 0)} color="#dc2626" />
        <SummaryCard label="Total Platform Margin" value={fmt(marginSummary?.totalPlatformMargin ?? 0)} color="#16a34a" />
        <SummaryCard label="Pending Settlement" value={fmt(marginSummary?.pendingSettlementAmount ?? 0)} color="#d97706" />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        {(['records', 'sellers', 'cycles', 'reconciliation'] as TabType[]).map((tab) => (
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
            {tab === 'records' ? 'Records' : tab === 'sellers' ? 'Seller Breakdown' : tab === 'cycles' ? 'Settlement Cycles' : 'Reconciliation'}
          </button>
        ))}
      </div>

      {/* ── Tab: Commission Records ── */}
      {activeTab === 'records' && (
        <>
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
            <div style={{ flex: '0 1 140px' }}>
              <label style={filterLabelStyle}>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterInputStyle}>
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="SETTLED">Settled</option>
                <option value="REFUNDED">Refunded</option>
              </select>
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
                <button onClick={handleClear} style={{ ...filterBtnStyle, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>Clear</button>
              )}
            </div>
          </div>

          {loading && !data ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading commissions...</div>
          ) : !data || data.records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No commission records {hasFilters ? 'match your filters' : 'yet'}</h3>
              <p style={{ color: '#6b7280' }}>{hasFilters ? 'Try adjusting your filters.' : 'Records appear when orders are delivered.'}</p>
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
                        <Th label="SELLER" />
                        <Th label="PRODUCT" />
                        <Th label="QTY" />
                        <Th label="PLATFORM PRICE" />
                        <Th label="SETTLEMENT PRICE" />
                        <Th label="PLATFORM MARGIN" />
                        <Th label="STATUS" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.records.map((r, i) => (
                        <tr
                          key={r.id}
                          style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f4ff')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc')}
                        >
                          <td style={tdStyle}><strong style={{ color: '#374151' }}>{r.orderNumber}</strong></td>
                          <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                          <td style={tdStyle}><span style={{ fontWeight: 500 }}>{r.sellerName}</span></td>
                          <td style={tdStyle}>
                            <span style={{ color: '#2563eb' }} title={r.productTitle}>
                              {r.productTitle.length > 22 ? r.productTitle.slice(0, 22) + '...' : r.productTitle}
                            </span>
                            {r.variantTitle && <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.variantTitle}</div>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                          <td style={tdNumStyle}>{fmt(Number(r.platformPrice))}</td>
                          <td style={tdNumStyle}>{fmt(Number(r.settlementPrice))}</td>
                          <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(Number(r.platformMargin))}</td>
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

      {/* ── Tab: Seller Breakdown ── */}
      {activeTab === 'sellers' && (
        <>
          {!sellerData || sellerData.sellers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No seller data yet</h3>
              <p style={{ color: '#6b7280' }}>Per-seller breakdowns appear after commissions are processed.</p>
            </div>
          ) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                        <Th label="SELLER" />
                        <Th label="RECORDS" />
                        <Th label="PLATFORM AMOUNT" />
                        <Th label="SETTLEMENT AMOUNT" />
                        <Th label="PLATFORM MARGIN" />
                        <Th label="MARGIN %" />
                      </tr>
                    </thead>
                    <tbody>
                      {sellerData.sellers.map((s, i) => {
                        const marginPct = s.totalPlatformAmount > 0
                          ? ((s.totalPlatformMargin / s.totalPlatformAmount) * 100).toFixed(1)
                          : '0.0';
                        return (
                          <tr
                            key={s.sellerId}
                            style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}
                          >
                            <td style={tdStyle}><span style={{ fontWeight: 600 }}>{s.sellerName}</span></td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{s.totalRecords}</td>
                            <td style={tdNumStyle}>{fmt(s.totalPlatformAmount)}</td>
                            <td style={tdNumStyle}>{fmt(s.totalSettlementAmount)}</td>
                            <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(s.totalPlatformMargin)}</td>
                            <td style={{ ...tdNumStyle, fontWeight: 600 }}>{marginPct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {sellerData.pagination.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
                  <button disabled={sellerPage <= 1} onClick={() => setSellerPage(sellerPage - 1)} style={pageBtnStyle}>Previous</button>
                  <span style={{ padding: '8px 12px', fontSize: 14 }}>Page {sellerPage} of {sellerData.pagination.totalPages}</span>
                  <button disabled={sellerPage >= sellerData.pagination.totalPages} onClick={() => setSellerPage(sellerPage + 1)} style={pageBtnStyle}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tab: Settlement Cycles ── */}
      {activeTab === 'cycles' && (
        <>
          {/* Create cycle form */}
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
            <div style={{ flex: '0 1 180px' }}>
              <label style={filterLabelStyle}>Period Start</label>
              <input type="date" value={createStart} onChange={(e) => setCreateStart(e.target.value)} style={filterInputStyle} />
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <label style={filterLabelStyle}>Period End</label>
              <input type="date" value={createEnd} onChange={(e) => setCreateEnd(e.target.value)} style={filterInputStyle} />
            </div>
            <button
              onClick={handleCreateCycle}
              disabled={creating || !createStart || !createEnd}
              style={{
                ...filterBtnStyle,
                background: creating ? '#9ca3af' : '#16a34a',
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Creating...' : 'Create Settlement Cycle'}
            </button>
          </div>

          {/* Cycle detail view */}
          {cycleDetail && (
            <div style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 20,
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
                    Cycle: {fmtDate(cycleDetail.periodStart)} - {fmtDate(cycleDetail.periodEnd)}
                  </h3>
                  <div style={{ marginTop: 4 }}>{statusBadge(cycleDetail.status)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(cycleDetail.status === 'DRAFT' || cycleDetail.status === 'PREVIEWED') && (
                    <button onClick={() => handleApproveCycle(cycleDetail.id)} style={{ ...filterBtnStyle, background: '#16a34a' }}>
                      Approve Cycle
                    </button>
                  )}
                  <button onClick={() => setCycleDetail(null)} style={{ ...filterBtnStyle, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>
                    Close
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <MiniCard label="Total Settlement" value={fmt(Number(cycleDetail.totalAmount))} />
                <MiniCard label="Total Margin" value={fmt(Number(cycleDetail.totalMargin))} />
                <MiniCard label="Sellers" value={String(cycleDetail.sellerSettlements.length)} />
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                      <Th label="SELLER" />
                      <Th label="ORDERS" />
                      <Th label="ITEMS" />
                      <Th label="PLATFORM AMT" />
                      <Th label="SETTLEMENT AMT" />
                      <Th label="MARGIN" />
                      <Th label="STATUS" />
                      <Th label="UTR" />
                      <Th label="ACTIONS" />
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.sellerSettlements.map((ss, i) => (
                      <tr key={ss.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600 }}>{ss.sellerName}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{ss.totalOrders}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{ss.totalItems}</td>
                        <td style={tdNumStyle}>{fmt(Number(ss.totalPlatformAmount))}</td>
                        <td style={{ ...tdNumStyle, fontWeight: 600 }}>{fmt(Number(ss.totalSettlementAmount))}</td>
                        <td style={{ ...tdNumStyle, color: '#16a34a' }}>{fmt(Number(ss.totalPlatformMargin))}</td>
                        <td style={tdStyle}>{statusBadge(ss.status)}</td>
                        <td style={tdStyle}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{ss.utrReference || '--'}</span>
                        </td>
                        <td style={tdStyle}>
                          {ss.status !== 'PAID' && cycleDetail.status === 'APPROVED' && (
                            <>
                              {payingId === ss.id ? (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <input
                                    type="text"
                                    placeholder="UTR ref..."
                                    value={utrInput}
                                    onChange={(e) => setUtrInput(e.target.value)}
                                    style={{ ...filterInputStyle, width: 120, padding: '4px 6px', fontSize: 12 }}
                                  />
                                  <button
                                    onClick={() => handleMarkPaid(ss.id)}
                                    style={{ fontSize: 11, padding: '4px 8px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    Pay
                                  </button>
                                  <button
                                    onClick={() => { setPayingId(null); setUtrInput(''); }}
                                    style={{ fontSize: 11, padding: '4px 8px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    X
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setPayingId(ss.id)}
                                  style={{ fontSize: 11, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                >
                                  Mark Paid
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cycles list */}
          {!cycles || cycles.cycles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No settlement cycles yet</h3>
              <p style={{ color: '#6b7280' }}>Create a settlement cycle using the form above.</p>
            </div>
          ) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                        <Th label="PERIOD" />
                        <Th label="SELLERS" />
                        <Th label="TOTAL SETTLEMENT" />
                        <Th label="TOTAL MARGIN" />
                        <Th label="STATUS" />
                        <Th label="CREATED" />
                        <Th label="ACTIONS" />
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.cycles.map((c, i) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                          <td style={tdStyle}>{fmtDate(c.periodStart)} - {fmtDate(c.periodEnd)}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{c._count.sellerSettlements}</td>
                          <td style={tdNumStyle}>{fmt(Number(c.totalAmount))}</td>
                          <td style={{ ...tdNumStyle, color: '#16a34a', fontWeight: 600 }}>{fmt(Number(c.totalMargin))}</td>
                          <td style={tdStyle}>{statusBadge(c.status)}</td>
                          <td style={tdStyle}>{fmtDate(c.createdAt)}</td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => viewCycleDetail(c.id)}
                                style={{ fontSize: 11, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                              >
                                View
                              </button>
                              {(c.status === 'DRAFT' || c.status === 'PREVIEWED') && (
                                <button
                                  onClick={() => handleApproveCycle(c.id)}
                                  style={{ fontSize: 11, padding: '4px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                >
                                  Approve
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {cycles.pagination.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
                  <button disabled={cyclePage <= 1} onClick={() => setCyclePage(cyclePage - 1)} style={pageBtnStyle}>Previous</button>
                  <span style={{ padding: '8px 12px', fontSize: 14 }}>Page {cyclePage} of {cycles.pagination.totalPages}</span>
                  <button disabled={cyclePage >= cycles.pagination.totalPages} onClick={() => setCyclePage(cyclePage + 1)} style={pageBtnStyle}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tab: Reconciliation ── */}
      {activeTab === 'reconciliation' && (
        <>
          {!reconciliation ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading reconciliation data...</div>
          ) : (
            <div style={{ maxWidth: 800 }}>
              {/* Status banner */}
              <div style={{
                padding: '16px 20px',
                borderRadius: 10,
                marginBottom: 24,
                background: reconciliation.isReconciled ? '#d1fae5' : '#fee2e2',
                border: `1px solid ${reconciliation.isReconciled ? '#6ee7b7' : '#fca5a5'}`,
              }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: reconciliation.isReconciled ? '#065f46' : '#991b1b' }}>
                  {reconciliation.isReconciled ? 'All Reconciled' : 'Mismatches Detected'}
                </div>
                {reconciliation.mismatches.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, color: '#991b1b' }}>
                    {reconciliation.mismatches.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                )}
              </div>

              {/* Reconciliation grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <ReconcileCard label="Total Platform Revenue" value={fmt(reconciliation.totalPlatformRevenue)} />
                <ReconcileCard label="Total Seller Settlements Due" value={fmt(reconciliation.totalSellerSettlements)} />
                <ReconcileCard label="Total Platform Margin" value={fmt(reconciliation.totalPlatformMargin)} />
                <ReconcileCard label="Pending Settlements" value={`${reconciliation.pendingSettlements.count} records | ${fmt(reconciliation.pendingSettlements.amount)}`} />
                <ReconcileCard label="Settled Payments" value={`${reconciliation.settledPayments.count} records | ${fmt(reconciliation.settledPayments.amount)}`} />
                <ReconcileCard label="Items Delivered vs Commission Records" value={`${reconciliation.totalDeliveredItems} / ${reconciliation.totalCommissionRecords}`} />
              </div>

              <button onClick={fetchReconciliation} style={filterBtnStyle}>Refresh</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Components ── */

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: '1 1 200px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 16px' }}>
      <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}

function ReconcileCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}

/* ── Styles ── */

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
