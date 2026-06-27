'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  accountsService,
  formatINR,
  SellerAccountsOverview,
  SellerCommissionRecords,
  SellerSettlementsList,
} from '@/services/accounts.service';

type Tab = 'commission' | 'settlements';

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SellerAccountsPage() {
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
      const res = await accountsService.getOverview(fromDate, toDate);
      if (res.data) setO(res.data);
      else setErr(res.message || 'Could not load your finances');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your finances');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const loadDrill = useCallback(async () => {
    if (tab === 'commission') {
      const res = await accountsService.getCommissionRecords({ page, fromDate, toDate });
      if (res.data) setCommission(res.data);
    } else {
      const res = await accountsService.getSettlements({ page, fromDate, toDate });
      if (res.data) setSettlements(res.data);
    }
  }, [tab, page, fromDate, toDate]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadDrill(); }, [loadDrill]);
  useEffect(() => { setPage(1); }, [tab, fromDate, toDate]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My finances</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
          Your revenue, what we owe you, statutory deductions, and settlement history.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
        {o && <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>GSTIN: <code>{o.seller.gstin ?? '—'}</code> · status {o.seller.status}</span>}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {loading && !o ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading your finances…</div>
      ) : o ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            <Kpi label="Net revenue" value={formatINR(o.revenue.net)} tone="good" sub={`gross ${formatINR(o.revenue.gross)} − refunds ${formatINR(o.revenue.refundsDeducted)}`} />
            <Kpi label="Platform margin" value={formatINR(o.margin.platformMargin)} sub={`${o.margin.marginPercentage}% of revenue`} />
            <Kpi label="Pending payable" value={formatINR(o.payable.pendingAmount)} tone="warn" sub={`net · gross ${formatINR(o.payable.pendingGrossAmount)} · ${o.payable.pendingCount} settlement(s)`} />
            <Kpi label="Overdue payout" value={formatINR(o.overdue.amount)} tone={o.overdue.count > 0 ? 'warn' : 'good'} sub={o.overdue.count > 0 ? `${o.overdue.count} past due — being processed` : 'nothing past due'} />
            <Kpi label="Paid to you (period)" value={formatINR(o.payable.paidAmount)} sub={o.payable.lastSettledOn ? `last ${new Date(o.payable.lastSettledOn).toLocaleDateString('en-IN')}` : 'none yet'} />
            <Kpi label="TDS deducted (§194-O)" value={formatINR(o.taxDeductions.tdsDeducted)} sub={`${o.taxDeductions.tdsDepositedCount}/${o.taxDeductions.tdsRowCount} deposited`} />
            <Kpi label="TCS collected (§52)" value={formatINR(o.taxDeductions.tcsCollected)} sub={`${o.taxDeductions.tcsRowCount} period(s)`} />
            <Kpi label="Refunds / reversals" value={formatINR(o.reversals.refundedAdminEarning)} sub={`${o.reversals.count} record(s)`} />
            <Kpi label="Adjustments" value={formatINR(o.adjustments.totalAmount)} sub={`${o.adjustments.count} active`} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Commission ({o.commission.recordCount}):</span>
            {Object.entries(o.commission.statusBreakdown).map(([k, v]) => (
              <span key={k} style={{ fontSize: 12, color: '#111827', background: '#f3f4f6', padding: '2px 10px', borderRadius: 10 }}>{k}: <strong>{v}</strong></span>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>{o.taxDeductions.note}</div>

          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', margin: '24px 0 16px' }}>
            {(['commission', 'settlements'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t === 'commission' ? 'Commission records' : 'Settlements'}</button>
            ))}
          </div>

          {tab === 'commission' ? (
            <DrillTable
              headers={['Order', 'Product', 'Status', 'Amount', 'Margin', 'Net payable', 'When']}
              rightFrom={3}
              rows={(commission?.records ?? []).map((r) => ({ id: r.id, cells: [r.orderNumber, r.productTitle, r.status, formatINR(r.totalPlatformAmount), formatINR(r.platformMargin), formatINR(Number((r as any).netPayableInPaise ?? 0) / 100), new Date(r.createdAt).toLocaleDateString('en-IN')] }))}
              page={page} total={commission?.total ?? 0} limit={commission?.limit ?? 20} onPage={setPage}
            />
          ) : (
            <DrillTable
              headers={['Cycle', 'Status', 'Amount', 'Margin', 'UTR', 'Due', 'Issue', 'Paid', 'When']}
              rightFrom={2}
              rows={(settlements?.settlements ?? []).map((s) => ({ id: s.id, cells: [s.cycleId.slice(0, 8), s.status, formatINR(s.totalSettlementAmount), formatINR(s.totalPlatformMargin), s.utrReference ?? '—', s.payoutDueBy ? new Date(s.payoutDueBy).toLocaleDateString('en-IN') : '—', s.paymentFailureReason ?? '—', s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-IN') : '—', new Date(s.createdAt).toLocaleDateString('en-IN')] }))}
              page={page} total={settlements?.total ?? 0} limit={settlements?.limit ?? 20} onPage={setPage}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function DrillTable({
  headers, rows, page, total, limit, onPage, rightFrom,
}: {
  headers: string[];
  rows: Array<{ id: string; cells: string[] }>;
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
  rightFrom: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>No rows for this period.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>{headers.map((h, i) => <th key={h} style={{ ...th, textAlign: i >= rightFrom ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  {r.cells.map((c, i) => <td key={i} style={{ ...td, textAlign: i >= rightFrom ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Page {page} of {totalPages} · {total} total</span>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={pageBtn}>Next →</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'warn' ? '#b45309' : '#111827';
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#111827' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#111827' };
const tabBtn = (active: boolean): React.CSSProperties => ({ background: 'transparent', color: active ? '#111827' : '#6b7280', border: 'none', borderBottom: active ? '2px solid #111827' : '2px solid transparent', padding: '8px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600, marginBottom: -2 });
