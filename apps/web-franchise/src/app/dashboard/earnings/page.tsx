'use client';

import { useEffect, useState } from 'react';
import {
  franchiseEarningsService,
  EarningsSummary,
  FranchiseSettlement,
  LedgerEntry,
} from '@/services/earnings.service';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';

type TabKey = 'overview' | 'history' | 'settlements';

const SOURCE_TYPES = [
  'ONLINE_ORDER',
  'PROCUREMENT_FEE',
  'RETURN_REVERSAL',
  'ADJUSTMENT',
  'PENALTY',
];

const LEDGER_STATUSES = ['PENDING', 'APPROVED', 'SETTLED', 'REVERSED'];

const SETTLEMENT_STATUSES = ['PENDING', 'APPROVED', 'PAID', 'FAILED'];

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function formatInr(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Keep the server-side enum values lowercase-friendly for the UI.
// FranchiseSettlementStatus in _base.prisma is PENDING | APPROVED | PAID | FAILED.
const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  FAILED: 'Failed',
};
function formatSettlementStatus(status: string): string {
  return SETTLEMENT_STATUS_LABELS[status] ?? status;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
  switch (status) {
    case 'PAID':
    case 'APPROVED':
    case 'SETTLED':
      return { ...base, background: '#d1fae5', color: '#065f46' };
    case 'PENDING':
      return { ...base, background: '#fef3c7', color: '#92400e' };
    case 'FAILED':
    case 'REVERSED':
      return { ...base, background: '#fee2e2', color: '#991b1b' };
    default:
      return { ...base, background: '#e5e7eb', color: '#374151' };
  }
}

export default function EarningsPage() {
const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Earnings</h1>
          <p>Track your commissions, ledger entries, and settlements</p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 24,
        }}
      >
        {(
          [
            { key: 'overview', label: 'Overview' },
            { key: 'history', label: 'Ledger History' },
            { key: 'settlements', label: 'Settlements' },
          ] as Array<{ key: TabKey; label: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: 'transparent',
              fontSize: 14,
              fontWeight: 600,
              color:
                activeTab === tab.key ? 'var(--color-primary)' : '#6b7280',
              borderBottom:
                activeTab === tab.key
                  ? '2px solid var(--color-primary)'
                  : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'history' && <LedgerHistoryTab />}
      {activeTab === 'settlements' && <SettlementsTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 1: OVERVIEW
// ══════════════════════════════════════════════════════════════

function OverviewTab() {
  const { notify, confirmDialog } = useModal();
const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [recent, setRecent] = useState<FranchiseSettlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {setIsLoading(true);
    try {
      const [summaryRes, settlementsRes] = await Promise.all([
        franchiseEarningsService.getSummary(),
        franchiseEarningsService.listSettlements({ page: 1, limit: 5 }),
      ]);
      if (summaryRes.data) setSummary(summaryRes.data);
      if (settlementsRes.data) setRecent(settlementsRes.data.settlements);
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load earnings summary');
      } else {
        void notify('Failed to load earnings summary');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (isLoading && !summary) {
    return <div className="card">Loading...</div>;
  }

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <KpiCard
          label="Total Earnings"
          value={formatInr(summary?.totalEarnings)}
          color="#059669"
        />
        <KpiCard
          label="Pending Settlement"
          value={formatInr(summary?.pendingSettlement)}
          color="#d97706"
        />
        <KpiCard
          label="Online Commission"
          value={formatInr(summary?.totalOnlineCommission)}
          color="#2563eb"
        />
      </div>

      <div className="card">
        <h2>Earnings Trend</h2>
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: '#9ca3af',
            background: '#f9fafb',
            borderRadius: 8,
            border: '1px dashed #e5e7eb',
          }}
        >
          Chart coming soon
        </div>
      </div>

      <div className="card">
        <h2>Recent Settlements</h2>
        {recent.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            No settlements yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Period</th>
                  <th style={thStyle}>Net Payable</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Paid At</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr
                    key={s.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>
                      {s.cycle
                        ? `${formatDate(s.cycle.periodStart)} — ${formatDate(s.cycle.periodEnd)}`
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      <strong>{formatInr(s.netPayableToFranchise)}</strong>
                    </td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(s.status as string)}>
                        {formatSettlementStatus(s.status as string)}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDate(s.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 2: LEDGER HISTORY
// ══════════════════════════════════════════════════════════════

function LedgerHistoryTab() {
  const { notify, confirmDialog } = useModal();
const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState({
    sourceType: '',
    status: '',
    fromDate: '',
    toDate: '',
  });

  const load = async () => {setIsLoading(true);
    try {
      const res = await franchiseEarningsService.getLedgerHistory({
        page,
        limit,
        sourceType: filters.sourceType || undefined,
        status: filters.status || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
      });
      if (res.data) {
        setEntries(res.data.entries);
        setTotal(res.data.total);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load ledger');
      } else {
        void notify('Failed to load ledger');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleSearch = () => {
    setPage(1);
    load();
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="card">
        <h2>Filters</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <select
            value={filters.sourceType}
            onChange={(e) =>
              setFilters({ ...filters, sourceType: e.target.value })
            }
            style={selectStyle}
          >
            <option value="">All Source Types</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value })
            }
            style={selectStyle}
          >
            <option value="">All Statuses</option>
            {LEDGER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.fromDate}
            max={filters.toDate || undefined}
            onChange={(e) =>
              setFilters({ ...filters, fromDate: e.target.value })
            }
            style={selectStyle}
          />
          <input
            type="date"
            value={filters.toDate}
            min={filters.fromDate || undefined}
            onChange={(e) =>
              setFilters({ ...filters, toDate: e.target.value })
            }
            style={selectStyle}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSearch}
        >
          Apply Filters
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div
            style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}
          >
            No ledger entries found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Base</th>
                  <th style={thStyle}>Rate</th>
                  <th style={thStyle}>Computed</th>
                  <th style={thStyle}>Your Earning</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>{formatDate(e.createdAt)}</td>
                    <td style={tdStyle}>
                      {(e.sourceType as string).replace('_', ' ')}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 12,
                          color: '#6b7280',
                        }}
                      >
                        {e.description || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatInr(e.baseAmount)}</td>
                    <td style={tdStyle}>{toNumber(e.rate)}%</td>
                    <td style={tdStyle}>{formatInr(e.computedAmount)}</td>
                    <td style={tdStyle}>
                      <strong style={{ color: '#059669' }}>
                        {formatInr(e.franchiseEarning)}
                      </strong>
                    </td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(e.status as string)}>
                        {e.status as string}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
        }}
      >
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Page {page} of {totalPages} · {total} total
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 3: SETTLEMENTS
// ══════════════════════════════════════════════════════════════

function SettlementsTab() {
  const { notify, confirmDialog } = useModal();
const [settlements, setSettlements] = useState<FranchiseSettlement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<FranchiseSettlement | null>(null);

  const load = async () => {setIsLoading(true);
    try {
      const res = await franchiseEarningsService.listSettlements({
        page,
        limit,
        status: statusFilter || undefined,
      });
      if (res.data) {
        setSettlements(res.data.settlements);
        setTotal(res.data.total);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load settlements');
      } else {
        void notify('Failed to load settlements');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const openDetail = async (id: string) => {try {
      const res = await franchiseEarningsService.getSettlement(id);
      if (res.data) setDetail(res.data);
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to load settlement');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="card">
        <h2>Filters</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ ...selectStyle, flex: 1, maxWidth: 240 }}
          >
            <option value="">All Statuses</option>
            {SETTLEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
        ) : settlements.length === 0 ? (
          <div
            style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}
          >
            No settlements found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Settlement ID</th>
                  <th style={thStyle}>Period</th>
                  <th style={thStyle}>Online Earning</th>
                  <th style={thStyle}>Net Payable</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Paid At</th>
                  <th style={thStyle}>Payment Ref</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr
                    key={s.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>
                      <span
                        style={{
                          color: 'var(--color-primary)',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          fontSize: 12,
                        }}
                        onClick={() => openDetail(s.id)}
                      >
                        {s.id.slice(0, 8)}…
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {s.cycle
                        ? `${formatDate(s.cycle.periodStart)} — ${formatDate(s.cycle.periodEnd)}`
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {formatInr(s.totalOnlineCommission)}
                    </td>
                    <td style={tdStyle}>
                      <strong>{formatInr(s.netPayableToFranchise)}</strong>
                    </td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(s.status as string)}>
                        {formatSettlementStatus(s.status as string)}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDate(s.paidAt)}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          fontFamily: 'monospace',
                        }}
                      >
                        {s.paymentReference || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => openDetail(s.id)}
                        style={actionBtnStyle}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
        }}
      >
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Page {page} of {totalPages} · {total} total
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {detail && (
        <SettlementDetailModal
          settlement={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════════

function SettlementDetailModal({
  settlement,
  onClose,
}: {
  settlement: FranchiseSettlement;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 820,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Settlement Detail</h2>
            <div
              style={{
                fontSize: 12,
                color: '#6b7280',
                marginTop: 4,
                fontFamily: 'monospace',
              }}
            >
              {settlement.id}
            </div>
          </div>
          <span style={statusBadgeStyle(settlement.status as string)}>
            {settlement.status as string}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 16,
            padding: 12,
            background: '#f9fafb',
            borderRadius: 8,
          }}
        >
          <div>
            <div style={labelStyle}>Period Start</div>
            <div style={valueStyle}>
              {formatDate(settlement.cycle?.periodStart)}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Period End</div>
            <div style={valueStyle}>
              {formatDate(settlement.cycle?.periodEnd)}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Paid At</div>
            <div style={valueStyle}>{formatDateTime(settlement.paidAt)}</div>
          </div>
          <div>
            <div style={labelStyle}>Payment Reference</div>
            <div style={valueStyle}>
              {settlement.paymentReference || '—'}
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Totals Breakdown</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <BreakdownRow
            label="Online Orders"
            primary={formatInr(settlement.totalOnlineCommission)}
            secondary={`${settlement.totalOnlineOrders} orders · ${formatInr(settlement.totalOnlineAmount)} gross`}
          />
          <BreakdownRow
            label="Procurement Fees"
            primary={formatInr(settlement.totalProcurementFees)}
            secondary={`${settlement.totalProcurements} requests · ${formatInr(settlement.totalProcurementAmount)} gross`}
          />
          <BreakdownRow
            label="POS Fees"
            primary={formatInr(settlement.totalPosFees)}
            secondary={`${settlement.totalPosSales} sales · ${formatInr(settlement.totalPosAmount)} gross`}
          />
          <BreakdownRow
            label="Reversals"
            primary={formatInr(settlement.reversalAmount)}
          />
          <BreakdownRow
            label="Adjustments"
            primary={formatInr(settlement.adjustmentAmount)}
          />
          <BreakdownRow
            label="Gross Earning"
            primary={formatInr(settlement.grossFranchiseEarning)}
          />
          <BreakdownRow
            label="Net Payable to You"
            primary={formatInr(settlement.netPayableToFranchise)}
            highlight
          />
        </div>

        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Linked Ledger Entries</h3>
        {settlement.ledgerEntries && settlement.ledgerEntries.length > 0 ? (
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Base</th>
                  <th style={thStyle}>Rate</th>
                  <th style={thStyle}>Computed</th>
                  <th style={thStyle}>Your Earning</th>
                </tr>
              </thead>
              <tbody>
                {settlement.ledgerEntries.map((e) => (
                  <tr
                    key={e.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>{formatDate(e.createdAt)}</td>
                    <td style={tdStyle}>
                      {(e.sourceType as string).replace('_', ' ')}
                    </td>
                    <td style={tdStyle}>{formatInr(e.baseAmount)}</td>
                    <td style={tdStyle}>{toNumber(e.rate)}%</td>
                    <td style={tdStyle}>{formatInr(e.computedAmount)}</td>
                    <td style={tdStyle}>
                      {formatInr(e.franchiseEarning)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              color: '#9ca3af',
              fontSize: 13,
              padding: 12,
              background: '#f9fafb',
              borderRadius: 6,
              marginBottom: 16,
            }}
          >
            No ledger entries linked.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  primary,
  secondary,
  highlight,
}: {
  label: string;
  primary: string;
  secondary?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: highlight ? '#ecfdf5' : '#fff',
        border: `1px solid ${highlight ? '#a7f3d0' : '#e5e7eb'}`,
        borderRadius: 8,
      }}
    >
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontSize: highlight ? 18 : 16,
          fontWeight: 700,
          color: highlight ? '#065f46' : '#111827',
          marginTop: 4,
        }}
      >
        {primary}
      </div>
      {secondary && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SHARED STYLES & HELPERS
// ══════════════════════════════════════════════════════════════

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: '#f9fafb',
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#374151',
  verticalAlign: 'middle',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#111827',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  color: '#374151',
};

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color,
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}
