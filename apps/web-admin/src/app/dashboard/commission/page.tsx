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

function Th({
  label,
  align = 'left',
}: {
  label: string;
  align?: 'left' | 'right' | 'center';
}) {
  return <th style={{ ...thStyle, textAlign: align }}>{label}</th>;
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
    const tones: Record<string, { bg: string; color: string; border: string; dot: string }> = {
      PENDING: { bg: 'rgba(245, 158, 11, 0.1)', color: '#b45309', border: 'rgba(245, 158, 11, 0.25)', dot: '#f59e0b' },
      SETTLED: { bg: 'rgba(22, 163, 74, 0.08)', color: '#15803d', border: 'rgba(22, 163, 74, 0.2)', dot: '#16a34a' },
      PAID: { bg: 'rgba(22, 163, 74, 0.08)', color: '#15803d', border: 'rgba(22, 163, 74, 0.2)', dot: '#16a34a' },
      APPROVED: { bg: 'rgba(14, 116, 144, 0.08)', color: '#0e7490', border: 'rgba(14, 116, 144, 0.2)', dot: '#0891b2' },
      DRAFT: { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0', dot: '#94a3b8' },
      PREVIEWED: { bg: 'rgba(14, 116, 144, 0.08)', color: '#0e7490', border: 'rgba(14, 116, 144, 0.2)', dot: '#0891b2' },
      REFUNDED: { bg: 'rgba(220, 38, 38, 0.08)', color: '#b91c1c', border: 'rgba(220, 38, 38, 0.2)', dot: '#dc2626' },
    };
    const t = tones[s] || { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0', dot: '#94a3b8' };
    const label = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
        {label}
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
    <div style={{ color: '#0f172a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: '#0f172a' }}>
            Commission &amp; Settlements
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
            Platform margin tracking, settlement cycles, and reconciliation.
          </p>
        </div>
        <Link
          href="/dashboard/commission/settings"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 38,
            padding: '0 16px',
            fontSize: 13,
            fontWeight: 600,
            background: '#0f172a',
            color: '#ffffff',
            border: '1px solid #0f172a',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Commission settings
        </Link>
      </div>

      {/* Summary cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        <SummaryCard label="Total platform revenue" value={fmt(marginSummary?.totalPlatformRevenue ?? 0)} />
        <SummaryCard label="Total seller payouts" value={fmt(marginSummary?.totalSellerPayouts ?? 0)} />
        <SummaryCard label="Total platform margin" value={fmt(marginSummary?.totalPlatformMargin ?? 0)} valueColor="#15803d" />
        <SummaryCard label="Pending settlement" value={fmt(marginSummary?.pendingSettlementAmount ?? 0)} valueColor="#b45309" />
      </div>

      {/* Tab bar — segmented pill style */}
      <div
        role="tablist"
        aria-label="Commission tabs"
        style={{
          display: 'inline-flex',
          gap: 4,
          padding: 4,
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {(['records', 'sellers', 'cycles', 'reconciliation'] as TabType[]).map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 30,
                padding: '0 14px',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                border: 'none',
                borderRadius: 7,
                background: active ? '#ffffff' : 'transparent',
                color: active ? '#0f172a' : '#475569',
                cursor: 'pointer',
                boxShadow: active ? '0 1px 2px rgba(15, 23, 42, 0.06)' : 'none',
                fontFamily: 'inherit',
                transition: 'background-color 0.12s, color 0.12s',
              }}
            >
              {tab === 'records' ? 'Records' : tab === 'sellers' ? 'Seller breakdown' : tab === 'cycles' ? 'Settlement cycles' : 'Reconciliation'}
            </button>
          );
        })}
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
                        <Th label="QTY" align="center" />
                        <Th label="PLATFORM PRICE" align="right" />
                        <Th label="SETTLEMENT PRICE" align="right" />
                        <Th label="PLATFORM MARGIN" align="right" />
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
                        <Th label="RECORDS" align="right" />
                        <Th label="PLATFORM AMOUNT" align="right" />
                        <Th label="SETTLEMENT AMOUNT" align="right" />
                        <Th label="PLATFORM MARGIN" align="right" />
                        <Th label="MARGIN %" align="right" />
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
                      <Th label="ORDERS" align="center" />
                      <Th label="ITEMS" align="center" />
                      <Th label="PLATFORM AMT" align="right" />
                      <Th label="SETTLEMENT AMT" align="right" />
                      <Th label="MARGIN" align="right" />
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

function SummaryCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  color?: string;
  valueColor?: string;
}) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: '16px 18px',
    }}>
      <div style={{
        fontSize: 11,
        color: '#64748b',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: valueColor ?? '#0f172a',
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function ReconcileCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/* ── Styles ── */

const filterLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
};

const filterInputStyle: React.CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  fontSize: 13,
  color: '#0f172a',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const filterBtnStyle: React.CSSProperties = {
  height: 38,
  padding: '0 18px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #0f172a',
  borderRadius: 8,
  background: '#0f172a',
  color: '#ffffff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 12px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontSize: 13,
  color: '#0f172a',
  borderBottom: '1px solid #f1f5f9',
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  fontWeight: 500,
};

const pageBtnStyle: React.CSSProperties = {
  minWidth: 32,
  height: 32,
  padding: '0 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  color: '#334155',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
