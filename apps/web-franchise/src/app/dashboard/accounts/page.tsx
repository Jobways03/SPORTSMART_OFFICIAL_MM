'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  franchiseAccountsService,
  formatINR,
  FranchiseAccountsOverview,
  FranchiseLedgerEntries,
  FranchisePosSales,
  FranchiseSettlementsList,
} from '@/services/accounts.service';

type Tab = 'ledger' | 'pos' | 'settlements';

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FranchiseAccountsPage() {
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [o, setO] = useState<FranchiseAccountsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('ledger');
  const [page, setPage] = useState(1);
  const [ledger, setLedger] = useState<FranchiseLedgerEntries | null>(null);
  const [pos, setPos] = useState<FranchisePosSales | null>(null);
  const [settlements, setSettlements] = useState<FranchiseSettlementsList | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await franchiseAccountsService.getOverview(fromDate, toDate);
      if (res.data) setO(res.data);
      else setErr(res.message || 'Could not load your finances');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your finances');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const loadDrill = useCallback(async () => {
    if (tab === 'ledger') {
      const res = await franchiseAccountsService.getLedger({ page, fromDate, toDate });
      if (res.data) setLedger(res.data);
    } else if (tab === 'pos') {
      const res = await franchiseAccountsService.getPosSales({ page, fromDate, toDate });
      if (res.data) setPos(res.data);
    } else {
      const res = await franchiseAccountsService.getSettlements({ page, fromDate, toDate });
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
          Online + POS revenue, what we owe you, procurement, and settlement history.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
        {o && <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>{o.franchise.code} · GSTIN {o.franchise.gstin ?? '—'} · {o.franchise.status}</span>}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {loading && !o ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading your finances…</div>
      ) : o ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            <Kpi label="Total revenue" value={formatINR(o.revenue.totalRevenue)} tone="good" sub="online + POS (net)" />
            <Kpi label="Online revenue" value={formatINR(o.revenue.onlineRevenue)} />
            <Kpi label="POS revenue (net)" value={formatINR(o.revenue.posNet)} sub={`gross ${formatINR(o.revenue.posGross)} − returns ${formatINR(o.revenue.posReturns)}`} />
            <Kpi label="Pending payable" value={formatINR(o.payable.pendingAmount)} tone="warn" sub={`${o.payable.pendingCount} settlement(s)`} />
            <Kpi label="Overdue payout" value={formatINR(o.overdue.amount)} tone={o.overdue.count > 0 ? 'warn' : 'good'} sub={o.overdue.count > 0 ? `${o.overdue.count} past due — being processed` : 'nothing past due'} />
            <Kpi label="Paid to you (period)" value={formatINR(o.payable.paidAmount)} sub={o.payable.lastSettledOn ? `last ${new Date(o.payable.lastSettledOn).toLocaleDateString('en-IN')}` : 'none yet'} />
            <Kpi label="Procurement value" value={formatINR(o.procurement.totalProcuredValue)} sub={`${o.procurement.procurementCount} · fees ${formatINR(o.procurement.procurementFees)}`} />
            <Kpi label="Reversals" value={formatINR(o.reversals.platformEarning)} sub={`${o.reversals.count} reversed`} />
            <Kpi label="Adjustments" value={formatINR(o.adjustments.totalAmount)} sub={`${o.adjustments.count} active`} />
            <Kpi label="POS sales / voids / returns" value={`${o.pos.saleCount} / ${o.pos.voidedCount} / ${o.pos.returnCount}`} />
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>{o.procurement.note}</div>

          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', margin: '24px 0 16px' }}>
            {(['ledger', 'pos', 'settlements'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t === 'ledger' ? 'Earnings ledger' : t === 'pos' ? 'POS sales' : 'Settlements'}</button>
            ))}
          </div>

          {tab === 'ledger' && (
            <DrillTable
              headers={['Source', 'Ref', 'Status', 'Base', 'Your earning', 'When']} rightFrom={3}
              rows={(ledger?.entries ?? []).map((e) => ({ id: e.id, cells: [e.sourceType, e.sourceId.slice(0, 10), e.status, formatINR(e.baseAmount), formatINR(e.franchiseEarning), new Date(e.createdAt).toLocaleDateString('en-IN')] }))}
              page={page} total={ledger?.total ?? 0} limit={ledger?.limit ?? 20} onPage={setPage}
            />
          )}
          {tab === 'pos' && (
            <DrillTable
              headers={['Type', 'Status', 'Gross', 'Net', 'Voided', 'When']} rightFrom={2}
              rows={(pos?.sales ?? []).map((s) => ({ id: s.id, cells: [s.saleType, s.status, formatINR(s.grossAmount), formatINR(s.netAmount), s.voided ? 'yes' : '—', new Date(s.soldAt).toLocaleDateString('en-IN')] }))}
              page={page} total={pos?.total ?? 0} limit={pos?.limit ?? 20} onPage={setPage}
            />
          )}
          {tab === 'settlements' && (
            <DrillTable
              headers={['Cycle', 'Status', 'Net payable', 'Ref', 'Due', 'Paid', 'When']} rightFrom={2}
              rows={(settlements?.settlements ?? []).map((s) => ({ id: s.id, cells: [s.cycleId.slice(0, 8), s.status, formatINR(s.netPayableToFranchise), s.paymentReference ?? '—', s.payoutDueBy ? new Date(s.payoutDueBy).toLocaleDateString('en-IN') : '—', s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-IN') : '—', new Date(s.createdAt).toLocaleDateString('en-IN')] }))}
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
  page: number; total: number; limit: number; onPage: (p: number) => void; rightFrom: number;
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
