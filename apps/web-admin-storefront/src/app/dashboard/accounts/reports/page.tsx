'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  formatINR,
  RevenueRow,
  MarginReport,
  PayoutReport,
  ReconciliationReport,
  MarginDateBasis,
  PayoutNodeType,
} from '@/services/admin-accounts.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';
type Tab = 'revenue' | 'margins' | 'payouts' | 'reconciliation';

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Phase 180 (Revenue/Margin/Payouts audit #7) — the admin reports console the
 * 5 backend endpoints lacked a UI for. Money arrives as exact rupee strings.
 */
export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [dateBasis, setDateBasis] = useState<MarginDateBasis>('created');
  const [payoutNode, setPayoutNode] = useState<PayoutNodeType>('ALL');

  const [revenue, setRevenue] = useState<RevenueRow[] | null>(null);
  const [margins, setMargins] = useState<MarginReport | null>(null);
  const [payouts, setPayouts] = useState<PayoutReport | null>(null);
  const [recon, setRecon] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      if (tab === 'revenue') {
        const r = await adminAccountsService.getRevenueReport({ fromDate, toDate, groupBy });
        if (r.data) setRevenue(r.data); else setErr(r.message || 'Failed');
      } else if (tab === 'margins') {
        const r = await adminAccountsService.getMarginReport({ fromDate, toDate, dateBasis });
        if (r.data) setMargins(r.data); else setErr(r.message || 'Failed');
      } else if (tab === 'payouts') {
        const r = await adminAccountsService.getPayoutReport({ fromDate, toDate, nodeType: payoutNode });
        if (r.data) setPayouts(r.data); else setErr(r.message || 'Failed');
      } else {
        const r = await adminAccountsService.getReconciliationReport({ fromDate, toDate });
        if (r.data) setRecon(r.data); else setErr(r.message || 'Failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [tab, fromDate, toDate, groupBy, dateBasis, payoutNode]);

  useEffect(() => { void load(); }, [load]);

  const csv = (type: 'revenue' | 'margins' | 'payouts', extra: Record<string, string | undefined>) =>
    `${API_BASE}${adminAccountsService.reportCsvUrl(type, { fromDate, toDate, ...extra })}`;

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '12px 0 0', color: '#0F1115' }}>Finance reports</h1>
      <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>Revenue, margins, payouts and reconciliation. Payout amounts are NET of statutory deductions.</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', margin: '18px 0 16px' }}>
        {(['revenue', 'margins', 'payouts', 'reconciliation'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
        {tab === 'revenue' && (
          <Field label="Group by"><Segmented<'day' | 'week' | 'month'> value={groupBy} onChange={setGroupBy} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} /></Field>
        )}
        {tab === 'margins' && (
          <Field label="Date basis"><Segmented<MarginDateBasis> value={dateBasis} onChange={setDateBasis} options={[['created', 'Recognised'], ['settled', 'Settled']]} /></Field>
        )}
        {tab === 'payouts' && (
          <Field label="Partner"><Segmented<PayoutNodeType> value={payoutNode} onChange={setPayoutNode} options={[['ALL', 'All'], ['SELLER', 'Sellers'], ['FRANCHISE', 'Franchises'], ['AFFILIATE', 'Affiliates']]} /></Field>
        )}
        {tab === 'revenue' && <a href={csv('revenue', { groupBy })} download style={dl}>⬇ CSV</a>}
        {tab === 'margins' && <a href={csv('margins', { dateBasis })} download style={dl}>⬇ CSV</a>}
        {tab === 'payouts' && <a href={csv('payouts', { nodeType: payoutNode })} download style={dl}>⬇ CSV</a>}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {loading && <div style={{ color: '#7A828F', fontSize: 13, marginBottom: 12 }}>Loading…</div>}

      {tab === 'revenue' && revenue && (
        <Table
          headers={['Period', 'Total revenue', 'Refunds', 'Net revenue', 'Seller', 'Franchise', 'Commission margin']}
          rightFrom={1}
          rows={revenue.map((r) => [new Date(r.period).toLocaleDateString('en-IN'), formatINR(r.totalRevenue), formatINR(r.refunds), formatINR(r.netRevenue), formatINR(r.sellerFulfilledAmount), formatINR(r.franchiseFulfilledAmount), formatINR(r.platformCommissionMargin)])}
        />
      )}

      {tab === 'margins' && margins && (
        <>
          <Kpis items={[['Platform margin', margins.summary.totalPlatformMargin], ['Seller margin', margins.summary.totalSellerMargin], ['Franchise margin', margins.summary.totalFranchiseMargin]]} />
          <Table
            headers={['Type', 'Node', 'Records', 'Revenue', 'Payable', 'Platform margin', 'Margin %']}
            rightFrom={2}
            rows={[...margins.sellers, ...margins.franchises].map((m) => [m.nodeType, m.nodeName, String(m.totalRecords), formatINR(m.totalRevenue), formatINR(m.totalPayable), formatINR(m.platformMargin), `${m.marginPercentage}%`])}
          />
          <Note>{margins.methodology}</Note>
        </>
      )}

      {tab === 'payouts' && payouts && (
        <>
          <Kpis items={[['Net paid out', payouts.summary.totalNetPaidOut], ['Sellers', payouts.summary.totalSellerPayouts], ['Franchises', payouts.summary.totalFranchisePayouts], ['Affiliates', payouts.summary.totalAffiliatePayouts]]} />
          <Table
            headers={['Type', 'Partner', 'Status', 'Gross', 'TCS', 'TDS', 'Comm. GST', 'Net paid', 'Reference']}
            rightFrom={3}
            rows={[...payouts.sellerPayouts, ...payouts.franchisePayouts, ...payouts.affiliatePayouts].map((p) => [p.nodeType, p.nodeName, p.status, formatINR(p.grossAmount), formatINR(p.tcsDeducted), formatINR(p.tdsDeducted), formatINR(p.commissionGst), formatINR(p.netAmountPaid), p.paymentReference ?? '—'])}
          />
          <Note>{payouts.note}</Note>
        </>
      )}

      {tab === 'reconciliation' && recon && (
        <>
          <div style={{ display: 'inline-block', padding: '6px 14px', borderRadius: 8, marginBottom: 14, fontWeight: 700, fontSize: 13, background: recon.isReconciled ? '#dcfce7' : '#fee2e2', color: recon.isReconciled ? '#15803d' : '#b91c1c' }}>
            {recon.isReconciled ? '✓ Reconciled' : `✗ ${recon.mismatches.length} mismatch(es)`}
          </div>
          <Kpis items={[['Platform earnings', recon.combined.totalPlatformEarnings], ['Outstanding payable', recon.combined.totalPayableOutstanding], ['Total paid', recon.combined.totalPaid]]} />
          {recon.mismatches.length > 0 && (
            <ul style={{ marginTop: 12, fontSize: 13, color: '#b91c1c' }}>
              {recon.mismatches.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <div style={{ marginTop: 14, fontSize: 12, color: '#525A65' }}>
            Integrity: settled-commission margin {formatINR(recon.integrityChecks.settledCommissionMargin)} vs paid-settlement margin {formatINR(recon.integrityChecks.paidSettlementMargin)}; orphaned settled commissions: <strong>{recon.integrityChecks.orphanedSettledCommissions}</strong>
          </div>
        </>
      )}
    </div>
  );
}

function Table({ headers, rows, rightFrom }: { headers: string[]; rows: string[][]; rightFrom: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: '#F9FAFB' }}>
          <tr>{headers.map((h, i) => <th key={h} style={{ ...th, textAlign: i >= rightFrom ? 'right' : 'left' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} style={{ padding: 24, color: '#7A828F', textAlign: 'center' }}>No data for this period.</td></tr>
          ) : rows.map((r, ri) => (
            <tr key={ri} style={{ borderTop: '1px solid #F3F4F6' }}>
              {r.map((c, ci) => <td key={ci} style={{ ...td, textAlign: ci >= rightFrom ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpis({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 12, marginBottom: 6 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0F1115', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{formatINR(value)}</div>
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 14, fontSize: 11, color: '#9CA3AF', maxWidth: 900, lineHeight: 1.5 }}>{children}</p>;
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #D2D6DC', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{ background: value === v ? '#0F1115' : '#fff', color: value === v ? '#fff' : '#525A65', border: 'none', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>{label}</button>
      ))}
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

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#111827' };
const dl: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 14px', textDecoration: 'none', background: '#fff', alignSelf: 'flex-end' };
const tabBtn = (active: boolean): React.CSSProperties => ({ background: 'transparent', color: active ? '#111827' : '#6b7280', border: 'none', borderBottom: active ? '2px solid #111827' : '2px solid transparent', padding: '8px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600, marginBottom: -2 });
