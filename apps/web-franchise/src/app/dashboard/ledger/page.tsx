'use client';

import { useEffect, useState, useCallback } from 'react';
import { ledgerService, paiseToINR, LedgerBalance, LedgerPage } from '@/services/ledger.service';

const SOURCE_TYPES = ['', 'ONLINE_ORDER', 'POS_SALE', 'POS_SALE_REVERSAL', 'PROCUREMENT_FEE', 'PROCUREMENT_COST', 'RETURN_REVERSAL', 'ADJUSTMENT', 'PENALTY'];

/**
 * Phase 181 (#9) — the franchise's own running-balance ledger. Read-only; scoped
 * server-side to the authenticated franchise. No adjustment/penalty actions here.
 */
export default function MyLedgerPage() {
  const [balance, setBalance] = useState<LedgerBalance | null>(null);
  const [data, setData] = useState<LedgerPage | null>(null);
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [b, l] = await Promise.all([
        ledgerService.getBalance(),
        ledgerService.getLedger({ page, limit: 25, sourceType: sourceType || undefined }),
      ]);
      if (b.data) setBalance(b.data);
      if (l.data) setData(l.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your ledger');
    } finally { setLoading(false); }
  }, [page, sourceType]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [sourceType]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  const negative = balance?.balanceInPaise.startsWith('-');

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My ledger</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>Every commission credit, fee, penalty and reversal — with a running balance.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', display: 'inline-block', minWidth: 260, marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Current balance</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: negative ? '#b45309' : '#15803d', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {balance ? paiseToINR(balance.balanceInPaise) : '—'}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{negative ? 'you owe the platform' : 'owed to you'}</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 }}>Type</label>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
          {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
        </select>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading…</div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={th}>When</th><th style={th}>Type</th><th style={th}>Description</th><th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Debit</th><th style={{ ...th, textAlign: 'right' }}>Credit</th><th style={{ ...th, textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>No entries.</td></tr>
                ) : (data?.entries ?? []).map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={td}>{new Date(e.createdAt).toLocaleDateString('en-IN')}</td>
                    <td style={td}>{e.sourceType}</td>
                    <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description ?? '—'}</td>
                    <td style={td}>{e.status}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#b45309', fontVariantNumeric: 'tabular-nums' }}>{e.debitInPaise !== '0' ? paiseToINR(e.debitInPaise) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{e.creditInPaise !== '0' ? paiseToINR(e.creditInPaise) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{paiseToINR(e.balanceAfterInPaise)}</td>
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
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#111827' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#111827' };
