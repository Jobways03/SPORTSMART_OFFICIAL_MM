'use client';

// Phase 22 GST — E-invoice / IRN admin panel.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  EInvoiceItem,
} from '@/services/admin-tax.service';

type Status = 'ALL' | 'NOT_APPLICABLE' | 'PENDING' | 'GENERATED' | 'FAILED';

const CBIC_CANCEL_CODES = [
  { value: 1, label: '1 — Duplicate' },
  { value: 2, label: '2 — Data entry mistake' },
  { value: 3, label: '3 — Order cancelled' },
  { value: 4, label: '4 — Other' },
];

export default function EinvoicesPage() {
  const [filter, setFilter] = useState<Status>('ALL');
  const [items, setItems] = useState<EInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<EInvoiceItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listEinvoices(filter === 'ALL' ? undefined : filter);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const generate = async (documentId: string) => {
    setBusy(documentId);
    try {
      const res = await adminTaxService.generateEinvoice(documentId);
      setMsg({ kind: 'ok', text: `IRN minted: ${res.data?.irn?.slice(0, 12)}… (ack: ${res.data?.ackNo})` });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Generate failed' });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>&larr; Tax / GST</Link>
      <h1>E-invoices (CBIC Rule 48(4))</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        IRN management. Currently using the <strong>stub</strong> provider — deterministic
        64-char hex IRN per (supplier, document, date). Real NIC IRP integration is
        gated by <code>EINVOICE_PROVIDER=nic</code> + adapter implementation.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['ALL', 'PENDING', 'GENERATED', 'FAILED', 'NOT_APPLICABLE'] as Status[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)} style={filter === s ? btnFilterActive : btnFilter}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
        <button onClick={load} style={btnSecondary}>Refresh</button>
      </div>

      {msg && (
        <div style={{ ...note, background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.kind === 'ok' ? '#166534' : '#991b1b' }}>
          {msg.text}
        </div>
      )}

      {loading ? <p>Loading…</p> : items.length === 0 ? (
        <p style={{ color: '#666' }}>No documents match the filter.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Document</th>
              <th style={th}>Status</th>
              <th style={th}>IRN</th>
              <th style={th}>Buyer GSTIN</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                  {d.documentNumber}
                  <div style={{ fontSize: 10, color: '#666' }}>{d.documentType}</div>
                </td>
                <td style={td}>
                  <span style={statusBadge(d.einvoiceStatus)}>{d.einvoiceStatus}</span>
                  {d.einvoiceRetryCount > 0 && (
                    <div style={{ fontSize: 10, color: '#666' }}>retries: {d.einvoiceRetryCount}</div>
                  )}
                  {d.einvoiceFailureReason && (
                    <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{d.einvoiceFailureReason}</div>
                  )}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                  {d.irn ? (
                    <>
                      <div>{d.irn.slice(0, 12)}…{d.irn.slice(-4)}</div>
                      {d.ackNo && <div style={{ color: '#666' }}>ack: {d.ackNo}</div>}
                      {d.ackDate && <div style={{ color: '#666' }}>{new Date(d.ackDate).toLocaleDateString('en-IN')}</div>}
                    </>
                  ) : '—'}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.buyerGstin ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>₹{paiseToRupees(d.documentTotalInPaise)}</td>
                <td style={td}>
                  {(d.einvoiceStatus === 'PENDING' || d.einvoiceStatus === 'FAILED') && (
                    <button
                      onClick={() => generate(d.id)}
                      disabled={busy === d.id}
                      style={busy === d.id ? { ...btnPrimary, ...busyStyle } : btnPrimary}
                    >
                      {busy === d.id ? 'Generating…' : 'Generate IRN'}
                    </button>
                  )}
                  {d.einvoiceStatus === 'GENERATED' && (
                    <button onClick={() => setCancelFor(d)} style={btnDanger}>Cancel (24h)</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {cancelFor && (
        <CancelModal
          row={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={async () => { setCancelFor(null); await load(); }}
        />
      )}
    </div>
  );
}

function CancelModal({ row, onClose, onDone }: { row: EInvoiceItem; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(4);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) { setErr('Reason required'); return; }
    setSubmitting(true);
    try {
      await adminTaxService.cancelEinvoice(row.id, code, reason);
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Cancel failed');
    } finally { setSubmitting(false); }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3>Cancel IRN within 24h</h3>
        <p style={{ fontSize: 12, color: '#666' }}>Document: <code>{row.documentNumber}</code></p>
        <p style={{ fontSize: 11, color: '#d97706' }}>
          ⚠ CBIC permits IRN cancellation within 24h of ackDate. Past that → issue a Credit Note instead.
        </p>
        <label>Cancellation code
          <select value={code} onChange={(e) => setCode(parseInt(e.target.value))} style={input}>
            {CBIC_CANCEL_CODES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={input} />
        </label>
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={btnSecondary}>Close</button>
          <button onClick={submit} disabled={submitting} style={btnDanger}>
            {submitting ? 'Cancelling…' : 'Cancel IRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusBadge(s: string): React.CSSProperties {
  const color =
    s === 'GENERATED' ? '#16a34a' :
    s === 'FAILED' ? '#dc2626' :
    s === 'PENDING' ? '#d97706' :
    '#6b7280';
  return { background: color, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
}
function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const n = BigInt(p);
  const whole = n / 100n;
  const cents = n % 100n;
  return whole.toString() + '.' + cents.toString().padStart(2, '0');
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnDanger: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const input: React.CSSProperties = { display: 'block', width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, marginTop: 4, marginBottom: 8 };
const modalBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: React.CSSProperties = { background: '#fff', padding: 24, borderRadius: 8, minWidth: 450 };
