'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminAccountsService,
  formatINR,
  SellerAccountsOverview,
  SellerCommissionRecords,
  SellerSettlementsList,
} from '@/services/admin-accounts.service';

type Tab = 'commission' | 'settlements';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SellerAccountsPage() {
  const { id } = useParams<{ id: string }>();
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [o, setO] = useState<SellerAccountsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('commission');
  const [page, setPage] = useState(1);
  const [commission, setCommission] = useState<SellerCommissionRecords | null>(null);
  const [settlements, setSettlements] = useState<SellerSettlementsList | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccountsService.getSellerAccounts(id, fromDate, toDate);
      if (res.success && res.data) setO(res.data);
      else setErr(res.message || 'Seller not found');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load seller finances');
    } finally {
      setLoading(false);
    }
  }, [id, fromDate, toDate]);

  const loadDrill = useCallback(async () => {
    if (tab === 'commission') {
      const res = await adminAccountsService.getSellerCommissionRecords(id, { page, fromDate, toDate });
      if (res.data) setCommission(res.data);
    } else {
      const res = await adminAccountsService.getSellerSettlements(id, { page, fromDate, toDate });
      if (res.data) setSettlements(res.data);
    }
  }, [id, tab, page, fromDate, toDate]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadDrill(); }, [loadDrill]);
  useEffect(() => { setPage(1); }, [tab, fromDate, toDate]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>

      {err && <div style={{ marginTop: 16, color: '#dc2626', fontSize: 13 }}>{err}</div>}
      {loading && !o ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : o ? (
        <>
          {/* Seller header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0F1115' }}>{o.seller.name}</h1>
              <div style={{ marginTop: 6, fontSize: 13, color: '#525A65', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>GSTIN: <code>{o.seller.gstin ?? '—'}</code></span>
                <span>PAN: <code>{o.seller.pan ?? '—'}</code></span>
                <span style={{ background: '#EEF2FF', color: '#3730A3', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{o.seller.status}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
              <Field label="To"><input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
              <a href={`${API_BASE}${adminAccountsService.sellerCsvUrl(id, fromDate, toDate)}`} download style={downloadBtn}>⬇ CSV</a>
            </div>
          </div>

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
            <Kpi label="Net revenue" value={formatINR(o.revenue.net)} tone="good" sub={`gross ${formatINR(o.revenue.gross)} − refunds ${formatINR(o.revenue.refundsDeducted)}`} />
            <Kpi label="Platform margin" value={formatINR(o.margin.platformMargin)} sub={`${o.margin.marginPercentage}%`} />
            <Kpi label="Payable pending" value={formatINR(o.payable.pendingAmount)} tone="bad" sub={`${o.payable.pendingCount} settlements`} />
            <Kpi label="Overdue (past SLA)" value={formatINR(o.overdue.amount)} tone={o.overdue.count > 0 ? 'bad' : 'good'} sub={`${o.overdue.count} settlement(s)`} />
            <Kpi label="Paid (period)" value={formatINR(o.payable.paidAmount)} sub={o.payable.lastSettledOn ? `last ${new Date(o.payable.lastSettledOn).toLocaleDateString('en-IN')}` : 'none yet'} />
            <Kpi label="TDS deducted (§194-O)" value={formatINR(o.taxDeductions.tdsDeducted)} sub={`${o.taxDeductions.tdsDepositedCount}/${o.taxDeductions.tdsRowCount} deposited`} />
            <Kpi label="TCS collected (§52)" value={formatINR(o.taxDeductions.tcsCollected)} sub={`${o.taxDeductions.tcsRowCount} rows`} />
            <Kpi label="Adjustments" value={formatINR(o.adjustments.totalAmount)} sub={`${o.adjustments.count}`} />
            <Kpi label="Reversals (refunds)" value={formatINR(o.reversals.refundedAdminEarning)} sub={`${o.reversals.count} refunded`} />
            <Kpi label="Open discrepancies" value={String(o.reconciliation.openDiscrepancies)} tone={o.reconciliation.openDiscrepancies > 0 ? 'bad' : 'good'} sub={`${o.reconciliation.resolvedDiscrepancies} resolved`} />
            <Kpi label="Tax on commission" value={formatINR(o.revenue.taxExcluded)} sub="excluded from revenue" />
          </div>

          {/* Commission status breakdown */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#7A828F', fontWeight: 600 }}>Commission ({o.commission.recordCount}):</span>
            {Object.entries(o.commission.statusBreakdown).map(([k, v]) => (
              <span key={k} style={{ fontSize: 12, color: '#0F1115', background: '#F3F4F6', padding: '2px 10px', borderRadius: 10 }}>{k}: <strong>{v}</strong></span>
            ))}
          </div>

          {/* Tax note */}
          <div style={{ marginTop: 8, fontSize: 11, color: '#9CA3AF' }}>{o.taxDeductions.note}</div>

          {/* Drill-down links */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <DrillLink href={o.linkSources.settlementsUrl}>Settlements →</DrillLink>
            <DrillLink href={o.linkSources.commissionUrl}>Commission records →</DrillLink>
            <DrillLink href={o.linkSources.tdsUrl}>TDS ledger →</DrillLink>
            <DrillLink href={o.linkSources.tcsUrl}>TCS ledger →</DrillLink>
          </div>

          {/* Drill-down tabs */}
          <div style={{ display: 'flex', gap: 6, margin: '24px 0 12px' }}>
            {(['commission', 'settlements'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t === 'commission' ? 'Commission records' : 'Settlements'}</button>
            ))}
          </div>

          {tab === 'commission' ? (
            <DrillTable
              headers={['Order', 'Product', 'Status', 'Platform amt', 'Margin', 'When']}
              rows={(commission?.records ?? []).map((r) => ({
                id: r.id,
                cells: [r.orderNumber, r.productTitle, r.status, formatINR(r.totalPlatformAmount), formatINR(r.platformMargin), new Date(r.createdAt).toLocaleDateString('en-IN')],
              }))}
              page={page}
              total={commission?.total ?? 0}
              limit={commission?.limit ?? 50}
              onPage={setPage}
            />
          ) : (
            <DrillTable
              headers={['Cycle', 'Status', 'Amount', 'Margin', 'UTR', 'Due', 'Failure', 'Paid', 'When']}
              rows={(settlements?.settlements ?? []).map((s) => ({
                id: s.id,
                cells: [s.cycleId.slice(0, 8), s.status, formatINR(s.totalSettlementAmount), formatINR(s.totalPlatformMargin), s.utrReference ?? '—', s.payoutDueBy ? new Date(s.payoutDueBy).toLocaleDateString('en-IN') : '—', s.paymentFailureReason ?? '—', s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-IN') : '—', new Date(s.createdAt).toLocaleDateString('en-IN')],
              }))}
              page={page}
              total={settlements?.total ?? 0}
              limit={settlements?.limit ?? 50}
              onPage={setPage}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function DrillTable({
  headers, rows, page, total, limit, onPage,
}: {
  headers: string[];
  rows: Array<{ id: string; cells: string[] }>;
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>No rows for this period.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>{headers.map((h, i) => <th key={h} style={{ ...th, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  {r.cells.map((c, i) => <td key={i} style={{ ...td, textAlign: i >= 3 ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
        <span style={{ fontSize: 13, color: '#525A65' }}>Page {page} of {totalPages} · {total} total</span>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={pageBtn}>Next →</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function DrillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 14px', textDecoration: 'none', background: '#fff' }}>{children}</Link>
  );
}

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const downloadBtn: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 14px', textDecoration: 'none', background: '#fff', alignSelf: 'flex-end' };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#0F1115' };
const tabBtn = (active: boolean): React.CSSProperties => ({ background: active ? '#0F1115' : '#fff', color: active ? '#fff' : '#525A65', border: '1px solid #D2D6DC', borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 });
