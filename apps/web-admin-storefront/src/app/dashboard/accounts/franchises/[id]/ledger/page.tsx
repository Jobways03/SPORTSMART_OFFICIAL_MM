'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminFranchiseFinanceService as svc,
  paiseToINR,
  LedgerBalance,
  LedgerPage,
} from '@/services/admin-franchise-finance.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';
const SOURCE_TYPES = ['', 'ONLINE_ORDER', 'POS_SALE', 'POS_SALE_REVERSAL', 'PROCUREMENT_FEE', 'PROCUREMENT_COST', 'RETURN_REVERSAL', 'ADJUSTMENT', 'PENALTY'];
const STATUSES = ['', 'PENDING', 'ACCRUED', 'HOLD', 'SETTLED', 'REVERSED'];

/**
 * Phase 181 (Franchise Ledger audit #10) — per-franchise running-balance ledger:
 * balance KPI, filters, debit/credit/balance table, adjustment + penalty modals,
 * CSV export with the running balance column.
 */
export default function FranchiseLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [balance, setBalance] = useState<LedgerBalance | null>(null);
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<LedgerPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<'adjustment' | 'penalty' | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, l] = await Promise.all([
        svc.getBalance(id),
        svc.getLedger(id, { page, limit: 25, sourceType: sourceType || undefined, status: status || undefined }),
      ]);
      if (b.data) setBalance(b.data);
      if (l.data) setData(l.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load ledger');
    }
  }, [id, page, sourceType, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [sourceType, status]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  const csvHref = `${API_BASE}${svc.ledgerCsvUrl(id, { sourceType: sourceType || undefined, status: status || undefined })}`;

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href={`/dashboard/accounts/franchises/${id}/overview`} style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Franchise finances</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Franchise ledger</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModal('adjustment')} style={btn('#15803d')}>+ Adjustment</button>
          <button onClick={() => setModal('penalty')} style={btn('#b91c1c')}>+ Penalty</button>
          <a href={csvHref} download style={{ ...btn('#0F1115'), textDecoration: 'none' }}>⬇ CSV</a>
        </div>
      </div>

      {/* Balance KPI */}
      <div style={{ marginTop: 18, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px', display: 'inline-block', minWidth: 260 }}>
        <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Running balance (owed to franchise)</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: balance && balance.balanceInPaise.startsWith('-') ? '#b91c1c' : '#15803d', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {balance ? paiseToINR(balance.balanceInPaise) : '—'}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', margin: '18px 0' }}>
        <Field label="Source type">
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={inputStyle}>
            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </Field>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#F9FAFB' }}>
            <tr>
              <th style={th}>When</th><th style={th}>Source</th><th style={th}>Description</th><th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Debit</th><th style={{ ...th, textAlign: 'right' }}>Credit</th>
              <th style={{ ...th, textAlign: 'right' }}>Balance</th><th style={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, color: '#7A828F', textAlign: 'center' }}>No ledger entries.</td></tr>
            ) : (data?.entries ?? []).map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={td}>{new Date(e.createdAt).toLocaleDateString('en-IN')}</td>
                <td style={td}>{e.sourceType}</td>
                <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description ?? '—'}</td>
                <td style={td}>{e.status}</td>
                <td style={{ ...td, textAlign: 'right', color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>{e.debitInPaise !== '0' ? paiseToINR(e.debitInPaise) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{e.creditInPaise !== '0' ? paiseToINR(e.creditInPaise) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{paiseToINR(e.balanceAfterInPaise)}</td>
                <td style={td}>{e.createdBySystem ? 'system' : (e.createdByAdminId ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Page {page} of {totalPages} · {data?.total ?? 0} entries</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={pageBtn}>Next →</button>
      </div>

      {modal && <EntryModal kind={modal} franchiseId={id} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />}
    </div>
  );
}

function EntryModal({ kind, franchiseId, onClose, onDone }: { kind: 'adjustment' | 'penalty'; franchiseId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [coApprover, setCoApprover] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isPenalty = kind === 'penalty';
  const amtRe = isPenalty ? /^\d{1,9}(\.\d{1,2})?$/ : /^-?\d{1,9}(\.\d{1,2})?$/;
  const valid = amtRe.test(amount.trim()) && (!isPenalty || Number(amount) > 0) && reason.trim().length >= 5;

  async function submit() {
    if (!valid) { setErr('Enter a valid amount and a reason (≥5 chars).'); return; }
    setBusy(true); setErr(null);
    try {
      const res = isPenalty
        ? await svc.createPenalty(franchiseId, { amount: Number(amount), reason: reason.trim(), coApproverAdminId: coApprover.trim() || undefined })
        : await svc.createAdjustment(franchiseId, { amount: Number(amount), reason: reason.trim() });
      if (res.success) onDone();
      else setErr(res.message || 'Failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#0F1115' }}>{isPenalty ? 'Record penalty' : 'Record adjustment'}</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#7A828F' }}>{isPenalty ? 'Positive amount, debited from the franchise. High-value penalties need a co-approver.' : 'Signed amount — positive credits the franchise, negative debits.'}</p>
        <label style={lbl}>Amount (₹)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={isPenalty ? '500.00' : '-150.00'} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
        <label style={{ ...lbl, marginTop: 10 }}>Reason</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
        {isPenalty && (
          <>
            <label style={{ ...lbl, marginTop: 10 }}>Co-approver admin id (high-value only)</label>
            <input value={coApprover} onChange={(e) => setCoApprover(e.target.value)} placeholder="another admin's id" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
          </>
        )}
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={modalCancelBtn}>Cancel</button>
          <button disabled={busy || !valid} onClick={submit} style={{ ...modalConfirmBtn, opacity: busy || !valid ? 0.5 : 1 }}>{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={lbl}>{label}</label>{children}</div>;
}

const btn = (color: string): React.CSSProperties => ({ background: '#fff', color, border: `1px solid ${color}55`, borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#111827' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#111827' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, width: 'min(460px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const modalCancelBtn: React.CSSProperties = { background: '#fff', color: '#525A65', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
const modalConfirmBtn: React.CSSProperties = { background: '#0F1115', color: '#fff', border: '1px solid #0F1115', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
