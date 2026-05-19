'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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

// ── Page ──────────────────────────────────────────────────────────

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
      .catch((err) => console.warn(err))
      .finally(() => setLoading(false));
  }, [search, dateFrom, dateTo]);

  useEffect(() => { fetchData(page); }, [page, fetchData]);

  const handleApply = () => { setPage(1); fetchData(1); };
  const handleClear = () => {
    setSearch(''); setDateFrom(''); setDateTo(''); setPage(1);
  };

  const hasFilters = Boolean(search || dateFrom || dateTo);

  const totals = useMemo(() => {
    const records = data?.records ?? [];
    return {
      totalCommission: records.reduce((a, r) => a + Number(r.totalCommission), 0),
      totalSellerEarning: records.reduce((a, r) => a + Number(r.productEarning), 0),
      totalRefunded: records.reduce((a, r) => a + Number(r.refundedAdminEarning), 0),
    };
  }, [data]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Commission
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 720, lineHeight: 1.5 }}>
          Commissions earned from delivered orders. Records are processed after the
          return/exchange window expires.
        </p>
      </div>

      <KpiStrip
        loading={loading && !data}
        totalRecords={data?.pagination.total ?? 0}
        page={totals}
      />

      {/* Filter bar */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
        padding: 16, marginBottom: 16,
        display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <Field label="Search" style={{ flex: '1 1 240px' }}>
          <input
            type="text"
            placeholder="Order #, product, seller…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            style={input}
          />
        </Field>
        <Field label="From" style={{ flex: '0 1 160px' }}>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={input} />
        </Field>
        <Field label="To" style={{ flex: '0 1 160px' }}>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={input} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleApply} style={btnPrimary}>Apply</button>
          {hasFilters && (
            <button onClick={handleClear} style={btnGhost}>Clear</button>
          )}
        </div>
      </div>

      {/* Table / states */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && !data ? (
          <Skeleton />
        ) : !data || data.records.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onClear={handleClear} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={th}>Order #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Seller</th>
                  <th style={th}>Product</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Unit price</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total price</th>
                  <th style={{ ...th, textAlign: 'right' }}>Commission</th>
                  <th style={{ ...th, textAlign: 'right' }}>Seller earning</th>
                  <th style={{ ...th, textAlign: 'right' }}>Refunded</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => <Row key={r.id} record={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, padding: '0 4px', flexWrap: 'wrap', gap: 12,
        }}>
          <span style={{ fontSize: 12, color: '#525A65' }}>
            Page <strong style={{ color: '#0F1115' }}>{page}</strong> of{' '}
            <strong style={{ color: '#0F1115' }}>{data.pagination.totalPages}</strong>
            {' · '}<strong style={{ color: '#0F1115' }}>{data.pagination.total.toLocaleString('en-IN')}</strong> total
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              style={page <= 1 ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
            >Previous</button>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
              style={page >= data.pagination.totalPages ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  loading, totalRecords, page,
}: {
  loading: boolean;
  totalRecords: number;
  page: { totalCommission: number; totalSellerEarning: number; totalRefunded: number };
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total records"
        value={totalRecords.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Across all loaded pages." />
      <Kpi label="Commission (this page)"
        value={inr(page.totalCommission)}
        tone="success" loading={loading}
        hint="Platform earnings on visible rows." />
      <Kpi label="Seller earning (this page)"
        value={inr(page.totalSellerEarning)}
        tone="neutral" loading={loading}
        hint="Net to sellers on visible rows." />
      <Kpi label="Refunded (this page)"
        value={inr(page.totalRefunded)}
        tone={page.totalRefunded > 0 ? 'danger' : 'muted'} loading={loading}
        hint="Admin earning clawed back on returns." />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: KPI_TONE[tone],
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function Row({ record: r }: { record: CommissionRecord }) {
  const refunded = Number(r.refundedAdminEarning);
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {r.orderNumber}
        </span>
      </td>
      <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
        {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      <td style={td}>
        <span style={{ fontWeight: 500, color: '#0F1115' }}>{r.sellerName}</span>
      </td>
      <td style={td}>
        <span style={{ color: '#0F1115' }} title={r.productTitle}>
          {r.productTitle.length > 28 ? r.productTitle.slice(0, 28) + '…' : r.productTitle}
        </span>
      </td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {r.quantity}
      </td>
      <td style={tdNum}>{inr(Number(r.unitPrice))}</td>
      <td style={tdNum}>{inr(Number(r.totalPrice))}</td>
      <td style={{ ...tdNum, fontWeight: 700, color: '#0F1115' }}>{inr(Number(r.totalCommission))}</td>
      <td style={{ ...tdNum, color: '#525A65' }}>{inr(Number(r.productEarning))}</td>
      <td style={{
        ...tdNum,
        color: refunded > 0 ? '#b91c1c' : '#7A828F',
        fontWeight: refunded > 0 ? 700 : 400,
      }}>
        {inr(refunded)}
      </td>
    </tr>
  );
}

// ── Empty / skeleton ──────────────────────────────────────────────

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <PercentIcon />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>
        No commission records {hasFilters ? 'match your filters' : 'yet'}
      </div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 460, margin: '4px auto 0' }}>
        {hasFilters
          ? 'Try adjusting your filters or clearing them.'
          : 'Records appear after orders are delivered and the return window expires.'}
      </div>
      {hasFilters && (
        <button onClick={onClear} style={{ ...btnGhost, marginTop: 16 }}>Clear filters</button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function Field({
  label, children, style,
}: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <span style={kpiLabel}>{label}</span>
      {children}
    </label>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function PercentIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M19 5 5 19" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Shared styles ─────────────────────────────────────────────────

const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 18px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'middle',
};
const tdNum: React.CSSProperties = {
  ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12,
  textAlign: 'right', whiteSpace: 'nowrap',
};
const pageBtn: React.CSSProperties = {
  height: 32, padding: '0 14px',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  background: '#fff', cursor: 'pointer',
  fontSize: 12, fontWeight: 600, color: '#0F1115',
};
const pageBtnDisabled: React.CSSProperties = {
  color: '#CBD5E1', cursor: 'not-allowed', background: '#FAFAFA',
};
