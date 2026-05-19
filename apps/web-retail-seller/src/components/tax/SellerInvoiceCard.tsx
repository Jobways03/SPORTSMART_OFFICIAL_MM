'use client';

// Phase 25 — Seller invoice card. Drops onto seller order-detail
// pages. Self-contained.

import { useEffect, useState, useCallback } from 'react';
import {
  sellerTaxService,
  SellerTaxDocument,
} from '@/services/tax.service';

export function SellerInvoiceCard({ orderId, subOrderId }: { orderId?: string; subOrderId?: string }) {
  const [docs, setDocs] = useState<SellerTaxDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sellerTaxService.list({ orderId, subOrderId, limit: 20 });
      setDocs(res.data?.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [orderId, subOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (doc: SellerTaxDocument) => {
    setDownloadingId(doc.id);
    try {
      const res = await sellerTaxService.getDownloadUrl(doc.id);
      const url = res.data?.url;
      if (!url) {
        setError('Server did not return a download URL');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err?.message ?? 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <div style={card}><span style={muted}>Loading invoices…</span></div>;
  if (error) {
    return (
      <div style={card}>
        <span style={errStyle}>{error}</span>
        <button onClick={load} style={btnSecondary}>Retry</button>
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Tax Invoices</div>
        <div style={muted}>No invoices generated yet for this order.</div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>Tax Invoices</span>
        <button onClick={load} style={btnLink}>Refresh</button>
      </div>
      <table style={tbl}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>Number</th>
            <th style={th}>Type</th>
            <th style={th}>Buyer</th>
            <th style={{ ...th, textAlign: 'right' }}>Total</th>
            <th style={th}>IRN</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const ready = d.status === 'PDF_GENERATED';
            return (
              <tr key={d.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{d.documentNumber}</td>
                <td style={td}>{labelForDocType(d.documentType)}</td>
                <td style={td}>
                  <div>{d.buyerLegalName ?? '—'}</div>
                  {d.buyerGstin && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666' }}>{d.buyerGstin}</div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                  ₹{paiseToRupees(d.documentTotalInPaise)}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                  {d.irn ? `${d.irn.slice(0, 8)}…${d.irn.slice(-4)}` : '—'}
                </td>
                <td style={td}>
                  <button
                    onClick={() => download(d)}
                    disabled={!ready || downloadingId === d.id}
                    style={ready ? btnPrimary : btnDisabled}
                  >
                    {downloadingId === d.id ? 'Opening…' : ready ? 'Download' : 'Pending'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function labelForDocType(t: string): string {
  switch (t) {
    case 'TAX_INVOICE': return 'Tax Invoice';
    case 'BILL_OF_SUPPLY': return 'Bill of Supply';
    case 'INVOICE_CUM_BILL_OF_SUPPLY': return 'Inv-cum-BoS';
    case 'CREDIT_NOTE': return 'Credit Note';
    case 'DEBIT_NOTE': return 'Debit Note';
    case 'LEGACY_RECEIPT': return 'Legacy Receipt';
    default: return t;
  }
}

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const n = BigInt(p);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return (neg ? '-' : '') + whole.toString() + '.' + cents.toString().padStart(2, '0');
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#374151' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 13 };
const errStyle: React.CSSProperties = { color: '#dc2626', fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginLeft: 8 };
const btnDisabled: React.CSSProperties = { background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', padding: '5px 10px', borderRadius: 4, cursor: 'not-allowed', fontSize: 12 };
const btnLink: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' };
