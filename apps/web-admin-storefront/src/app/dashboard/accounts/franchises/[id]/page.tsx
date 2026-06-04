'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminAccountsService,
  formatINR,
  FranchiseAccountsOverview,
  FranchiseLedgerEntries,
  FranchisePosSales,
  FranchiseSettlementsList,
  FranchiseReconDiscrepancies,
} from '@/services/admin-accounts.service';

type Tab = 'ledger' | 'pos' | 'settlements' | 'discrepancies';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';
const ADJ_TYPES = ['MANUAL_CORRECTION', 'COURIER_PENALTY', 'SLA_FINE', 'GOODWILL'];

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FranchiseAccountsPage() {
  const { id } = useParams<{ id: string }>();
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
  const [recon, setRecon] = useState<FranchiseReconDiscrepancies | null>(null);

  // Adjustment modal (#4 write).
  const [adjFor, setAdjFor] = useState<string | null>(null);
  // Phase 178 — partial-pay (#12) modal + hold/release (#4/#11) quick action.
  const [payFor, setPayFor] = useState<string | null>(null);
  const [holdBusy, setHoldBusy] = useState<string | null>(null);

  async function doHold(settlementId: string, hold: boolean) {
    const reason = hold ? window.prompt('Hold reason (optional):') ?? undefined : undefined;
    setHoldBusy(settlementId);
    setErr(null);
    try {
      const res = await adminAccountsService.setSettlementHold('FRANCHISE', settlementId, hold, reason || undefined);
      if (res.success) await reloadAll();
      else setErr(res.message || 'Failed to update hold');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update hold');
    } finally {
      setHoldBusy(null);
    }
  }

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccountsService.getFranchiseAccounts(id, fromDate, toDate);
      if (res.success && res.data) setO(res.data);
      else setErr(res.message || 'Franchise not found');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load franchise finances');
    } finally {
      setLoading(false);
    }
  }, [id, fromDate, toDate]);

  const loadDrill = useCallback(async () => {
    if (tab === 'ledger') {
      const res = await adminAccountsService.getFranchiseLedger(id, { page, fromDate, toDate });
      if (res.data) setLedger(res.data);
    } else if (tab === 'pos') {
      const res = await adminAccountsService.getFranchisePosSales(id, { page, fromDate, toDate });
      if (res.data) setPos(res.data);
    } else if (tab === 'settlements') {
      const res = await adminAccountsService.getFranchiseSettlements(id, { page, fromDate, toDate });
      if (res.data) setSettlements(res.data);
    } else {
      const res = await adminAccountsService.getFranchiseRecon(id, { page });
      if (res.data) setRecon(res.data);
    }
  }, [id, tab, page, fromDate, toDate]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadDrill(); }, [loadDrill]);
  useEffect(() => { setPage(1); }, [tab, fromDate, toDate]);

  async function reloadAll() {
    await Promise.all([loadOverview(), loadDrill()]);
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts/franchises" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← All franchises</Link>
      {err && <div style={{ marginTop: 16, color: '#dc2626', fontSize: 13 }}>{err}</div>}
      {loading && !o ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : o ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0F1115' }}>{o.franchise.name} <span style={{ fontSize: 14, color: '#7A828F', fontWeight: 500 }}>· {o.franchise.code}</span></h1>
              <div style={{ marginTop: 6, fontSize: 13, color: '#525A65', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>GSTIN: <code>{o.franchise.gstin ?? '—'}</code></span>
                <span>PAN: <code>{o.franchise.pan ?? '—'}</code></span>
                {o.franchise.warehousePincode && <span>PIN {o.franchise.warehousePincode}</span>}
                <span style={{ background: '#EEF2FF', color: '#3730A3', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{o.franchise.status}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
              <Field label="To"><input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
              <a href={`${API_BASE}${adminAccountsService.franchiseCsvUrl(id, fromDate, toDate)}`} download style={downloadBtn}>⬇ CSV</a>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
            <Kpi label="Total revenue" value={formatINR(o.revenue.totalRevenue)} tone="good" sub="online + POS (net)" />
            <Kpi label="Online revenue" value={formatINR(o.revenue.onlineRevenue)} />
            <Kpi label="POS revenue (net)" value={formatINR(o.revenue.posNet)} sub={`gross ${formatINR(o.revenue.posGross)} − returns ${formatINR(o.revenue.posReturns)}`} />
            <Kpi label="Platform margin" value={formatINR(o.platformMargin.total)} sub={`online ${formatINR(o.platformMargin.online)} + procurement ${formatINR(o.platformMargin.procurement)}`} />
            <Kpi label="Procurement value" value={formatINR(o.procurement.totalProcuredValue)} sub={`${o.procurement.procurementCount} · fees ${formatINR(o.procurement.procurementFees)}`} />
            <Kpi label="Payable pending" value={formatINR(o.payable.pendingAmount)} tone="bad" sub={`${o.payable.pendingCount} settlement(s)`} />
            <Kpi label="Overdue (past SLA)" value={formatINR(o.overdue.amount)} tone={o.overdue.count > 0 ? 'bad' : 'good'} sub={`${o.overdue.count} settlement(s)`} />
            <Kpi label="Paid (period)" value={formatINR(o.payable.paidAmount)} sub={o.payable.lastSettledOn ? `last ${new Date(o.payable.lastSettledOn).toLocaleDateString('en-IN')}` : 'none yet'} />
            <Kpi label="Reversals" value={formatINR(o.reversals.platformEarning)} sub={`${o.reversals.count} reversed`} />
            <Kpi label="Adjustments" value={formatINR(o.adjustments.totalAmount)} sub={`${o.adjustments.count} active`} />
            <Kpi label="POS sales / voids / returns" value={`${o.pos.saleCount} / ${o.pos.voidedCount} / ${o.pos.returnCount}`} />
            <Kpi label="Open discrepancies" value={String(o.reconciliation.openDiscrepancies)} tone={o.reconciliation.openDiscrepancies > 0 ? 'bad' : 'good'} sub={`${o.reconciliation.resolvedDiscrepancies} resolved`} />
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: '#9CA3AF' }}>{o.procurement.note}</div>

          <div style={{ display: 'flex', gap: 6, margin: '24px 0 12px', alignItems: 'center' }}>
            {(['ledger', 'pos', 'settlements', 'discrepancies'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
                {t === 'ledger' ? 'Finance ledger' : t === 'pos' ? 'POS sales' : t === 'settlements' ? 'Settlements' : 'Discrepancies'}
              </button>
            ))}
            {/* Phase 181 — running-balance ledger (debit/credit + adjustments/penalties). */}
            <Link href={`/dashboard/accounts/franchises/${id}/ledger`} style={{ marginLeft: 'auto', fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Running-balance ledger →</Link>
          </div>

          {tab === 'ledger' && (
            <DrillTable
              headers={['Source', 'Ref', 'Status', 'Base', 'Platform', 'Franchise', 'When']} rightFrom={3}
              rows={(ledger?.entries ?? []).map((e) => ({ id: e.id, cells: [e.sourceType, e.sourceId.slice(0, 10), e.status, formatINR(e.baseAmount), formatINR(e.platformEarning), formatINR(e.franchiseEarning), new Date(e.createdAt).toLocaleDateString('en-IN')] }))}
              page={page} total={ledger?.total ?? 0} limit={ledger?.limit ?? 50} onPage={setPage}
            />
          )}
          {tab === 'pos' && (
            <DrillTable
              headers={['Type', 'Status', 'Gross', 'Net', 'Voided', 'When']} rightFrom={2}
              rows={(pos?.sales ?? []).map((s) => ({ id: s.id, cells: [s.saleType, s.status, formatINR(s.grossAmount), formatINR(s.netAmount), s.voided ? 'yes' : '—', new Date(s.soldAt).toLocaleDateString('en-IN')] }))}
              page={page} total={pos?.total ?? 0} limit={pos?.limit ?? 50} onPage={setPage}
            />
          )}
          {tab === 'discrepancies' && (
            <DrillTable
              headers={['Sev', 'Kind', 'Order/Ref', 'Difference', 'Status', 'When']} rightFrom={3}
              rows={(recon?.discrepancies ?? []).map((d) => ({ id: d.id, cells: [String(d.severity), d.kind, d.orderNumber ?? d.externalRef ?? '—', formatINR(d.difference), d.status, new Date(d.createdAt).toLocaleDateString('en-IN')] }))}
              page={page} total={recon?.total ?? 0} limit={recon?.limit ?? 50} onPage={setPage}
            />
          )}
          {tab === 'settlements' && (
            <div>
              {(settlements?.settlements ?? []).length === 0 ? (
                <div style={{ padding: 24, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>No settlements for this period.</div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead style={{ background: '#F9FAFB' }}>
                      <tr>
                        <th style={th}>Cycle</th><th style={th}>Status</th>
                        <th style={{ ...th, textAlign: 'right' }}>Net payable</th>
                        <th style={{ ...th, textAlign: 'right' }}>Platform</th>
                        <th style={th}>Ref</th><th style={th}>Due</th>
                        <th style={th}>Paid</th><th style={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(settlements?.settlements ?? []).map((s) => (
                        <tr key={s.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                          <td style={td}>{s.cycleId.slice(0, 8)}</td>
                          <td style={td}>{s.status}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatINR(s.netPayableToFranchise)}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatINR(s.totalPlatformEarning)}</td>
                          <td style={td}>{s.paymentReference ?? '—'}</td>
                          <td style={td}>{s.payoutDueBy ? new Date(s.payoutDueBy).toLocaleDateString('en-IN') : '—'}</td>
                          <td style={td}>{s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-IN') : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {s.status === 'PENDING' && <button onClick={() => setAdjFor(s.id)} style={smallBtn('#b45309')}>+ Adj</button>}
                            {s.status !== 'PAID' && s.status !== 'ON_HOLD' && <button onClick={() => setPayFor(s.id)} style={{ ...smallBtn('#15803d'), marginLeft: 6 }}>Pay</button>}
                            {s.status !== 'PAID' && (
                              <button disabled={holdBusy === s.id} onClick={() => doHold(s.id, s.status !== 'ON_HOLD')} style={{ ...smallBtn(s.status === 'ON_HOLD' ? '#2563eb' : '#b91c1c'), marginLeft: 6, opacity: holdBusy === s.id ? 0.5 : 1 }}>{s.status === 'ON_HOLD' ? 'Release' : 'Hold'}</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager page={page} total={settlements?.total ?? 0} limit={settlements?.limit ?? 50} onPage={setPage} />
            </div>
          )}
        </>
      ) : null}

      {adjFor && (
        <AdjustModal
          franchiseId={id}
          settlementId={adjFor}
          onClose={() => setAdjFor(null)}
          onDone={async () => { setAdjFor(null); await reloadAll(); }}
        />
      )}

      {payFor && (
        <PayModal
          settlementId={payFor}
          onClose={() => setPayFor(null)}
          onDone={async () => { setPayFor(null); await reloadAll(); }}
        />
      )}
    </div>
  );
}

// Phase 178 (#12) — record a partial / full disbursement against a franchise
// settlement. Positive rupee amount; the server flips to PARTIALLY_PAID / PAID
// and rejects over-payment.
function PayModal({ settlementId, onClose, onDone }: { settlementId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  async function submit() {
    if (!valid) { setErr('Enter a positive rupee amount (e.g. 5000.00).'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await adminAccountsService.recordSettlementPayment('FRANCHISE', settlementId, amount.trim());
      if (res.success) onDone();
      else setErr(res.message || 'Failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record payment');
    } finally { setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#0F1115' }}>Record settlement payment</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#7A828F' }}>Positive rupee amount disbursed to the franchise. A part payment marks the settlement PARTIALLY_PAID; reaching the net payable marks it PAID. Over-payment is rejected.</p>
        <label style={lbl}>Amount (₹)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000.00" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={modalCancelBtn}>Cancel</button>
          <button disabled={busy || !valid} onClick={submit} style={{ ...modalConfirmBtn, opacity: busy || !valid ? 0.5 : 1 }}>{busy ? 'Recording…' : 'Record payment'}</button>
        </div>
      </div>
    </div>
  );
}

function AdjustModal({ franchiseId, settlementId, onClose, onDone }: { franchiseId: string; settlementId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [type, setType] = useState(ADJ_TYPES[0]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^-?\d{1,9}(\.\d{1,2})?$/.test(amount.trim());

  async function submit() {
    if (!valid) { setErr('Enter a signed rupee amount (e.g. -150.00 to deduct).'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await adminAccountsService.createFranchiseAdjustment(franchiseId, settlementId, { amount: amount.trim(), adjustmentType: type, notes: notes.trim() || undefined });
      if (res.success) onDone();
      else setErr(res.message || 'Failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record adjustment');
    } finally { setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#0F1115' }}>Record settlement adjustment</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#7A828F' }}>Signed rupee amount — negative deducts from the payout, positive credits. Only PENDING settlements can be adjusted.</p>
        <label style={lbl}>Amount (₹)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-150.00" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
        <label style={{ ...lbl, marginTop: 10 }}>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}>
          {ADJ_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label style={{ ...lbl, marginTop: 10 }}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={500} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={modalCancelBtn}>Cancel</button>
          <button disabled={busy || !valid} onClick={submit} style={{ ...modalConfirmBtn, opacity: busy || !valid ? 0.5 : 1 }}>{busy ? 'Recording…' : 'Record'}</button>
        </div>
      </div>
    </div>
  );
}

function DrillTable({ headers, rows, page, total, limit, onPage, rightFrom }: { headers: string[]; rows: Array<{ id: string; cells: string[] }>; page: number; total: number; limit: number; onPage: (p: number) => void; rightFrom: number }) {
  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>No rows for this period.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>{headers.map((h, i) => <th key={h} style={{ ...th, textAlign: i >= rightFrom ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  {r.cells.map((c, i) => <td key={i} style={{ ...td, textAlign: i >= rightFrom ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} limit={limit} onPage={onPage} />
    </div>
  );
}

function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
      <span style={{ fontSize: 13, color: '#525A65' }}>Page {page} of {totalPages} · {total} total</span>
      <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={pageBtn}>Next →</button>
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const downloadBtn: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 14px', textDecoration: 'none', background: '#fff', alignSelf: 'flex-end' };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#0F1115' };
const smallBtn = (color: string): React.CSSProperties => ({ background: '#fff', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 });
const tabBtn = (active: boolean): React.CSSProperties => ({ background: active ? '#0F1115' : '#fff', color: active ? '#fff' : '#525A65', border: '1px solid #D2D6DC', borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 });
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, width: 'min(460px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const modalCancelBtn: React.CSSProperties = { background: '#fff', color: '#525A65', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
const modalConfirmBtn: React.CSSProperties = { background: '#0F1115', color: '#fff', border: '1px solid #0F1115', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
