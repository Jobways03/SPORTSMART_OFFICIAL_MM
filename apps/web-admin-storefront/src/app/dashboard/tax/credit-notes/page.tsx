'use client';

// Phase 164 (Credit Note Generation audit #11) — admin credit-note register.
//
// Previously the only CN touch-point in the admin app was the override
// buried inside the timebar-review page; there was no "show me all credit
// notes" surface. This page lists issued credit notes with filing-period /
// status / seller / return filters, flags partial-coverage CNs, and shows
// whether the customer was notified. Gated server-side on tax.creditNote.read.

import { useCallback, useEffect, useState } from 'react';
import { adminTaxService, CreditNoteRow } from '@/services/admin-tax.service';

const STATUSES = [
  '',
  'PDF_PENDING',
  'PDF_GENERATED',
  'PDF_FAILED',
  'PARTIALLY_REVERSED',
  'FULLY_REVERSED',
];

// Pure string math (the admin app targets < ES2020, so no BigInt literals).
function rupees(paise: string): string {
  const neg = paise.trim().startsWith('-');
  const digits = (neg ? paise.trim().slice(1) : paise.trim()).replace(/\D/g, '') || '0';
  const padded = digits.padStart(3, '0');
  const rupeePart = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const paisePart = padded.slice(-2);
  return `${neg ? '-' : ''}₹${rupeePart}.${paisePart}`;
}

function defaultPeriod(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function AdminCreditNotesPage() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [status, setStatus] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [rows, setRows] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminTaxService.listCreditNotes({
        filingPeriod: period || undefined,
        status: status || undefined,
        sellerId: sellerId || undefined,
        limit: 200,
      });
      setRows(res.data?.items ?? []);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? 'Failed to load credit notes');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [period, status, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>Credit notes</h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760 }}>
        Section 34 credit notes issued against tax invoices on QC-approved returns. Filter by filing
        period / status / seller. A “Partial” badge flags credit notes that covered only some
        approved lines (a missing snapshot on a legacy order).
      </p>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>
          Period{' '}
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
            style={{ height: 34, padding: '0 8px', borderRadius: 8, border: '1px solid #D2D6DC' }} />
        </label>
        <label style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            style={{ height: 34, padding: '0 8px', borderRadius: 8, border: '1px solid #D2D6DC' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </label>
        <input value={sellerId} onChange={(e) => setSellerId(e.target.value)} placeholder="Seller ID (optional)"
          style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid #D2D6DC', width: 220 }} />
        <button onClick={() => void load()} disabled={loading}
          style={{ height: 34, padding: '0 16px', borderRadius: 8, border: '1px solid #0F1115', background: '#0F1115', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ marginTop: 16, overflow: 'auto', border: '1px solid #E5E7EB', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
              <th style={th}>CN Number</th>
              <th style={th}>Date</th>
              <th style={th}>Original Invoice</th>
              <th style={th}>Buyer GSTIN</th>
              <th style={{ ...th, textAlign: 'right' }}>Taxable</th>
              <th style={{ ...th, textAlign: 'right' }}>Tax</th>
              <th style={{ ...th, textAlign: 'right' }}>Cess</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>Status</th>
              <th style={th}>Customer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                  {r.documentNumber}
                  {r.partialCoverageLineCount > 0 && (
                    <span title={`${r.partialCoverageLineCount} approved line(s) had no snapshot`}
                      style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', borderRadius: 9999, padding: '1px 7px' }}>
                      PARTIAL
                    </span>
                  )}
                </td>
                <td style={td}>{r.generatedAt ? new Date(r.generatedAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.originalDocumentNumber ?? '—'}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.buyerGstin ?? <span style={{ color: '#7A828F' }}>B2C</span>}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees(r.taxableAmountInPaise)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees(r.totalTaxAmountInPaise)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees(r.cessAmountInPaise)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{rupees(r.documentTotalInPaise)}</td>
                <td style={td}>{r.status}</td>
                <td style={td}>
                  {r.customerNotifiedAt ? (
                    <span title={new Date(r.customerNotifiedAt).toLocaleString('en-IN')} style={{ color: '#15803d', fontWeight: 600 }}>Notified</span>
                  ) : (
                    <span style={{ color: '#7A828F' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 24 }}>
                No credit notes for the selected filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '10px 12px', color: '#0F1115' };
