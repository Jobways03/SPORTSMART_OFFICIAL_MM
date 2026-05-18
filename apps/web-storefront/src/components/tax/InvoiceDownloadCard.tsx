'use client';

// Phase 25 — Customer invoice download card.
//
// Drops onto any order-detail page. Self-contained: fetches the
// authenticated customer's tax documents for the given orderId on
// mount, renders one row per document with a "Download" button.

import { useEffect, useState, useCallback } from 'react';
import {
  customerTaxService,
  CustomerTaxDocument,
} from '@/services/customer-tax.service';

export function InvoiceDownloadCard({ orderId }: { orderId: string }) {
  const [docs, setDocs] = useState<CustomerTaxDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await customerTaxService.list({ orderId, limit: 20 });
      setDocs(res.data?.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (doc: CustomerTaxDocument) => {
    setDownloadingId(doc.id);
    try {
      const res = await customerTaxService.getDownloadUrl(doc.id);
      const url = res.data?.url;
      if (!url) {
        setError('Server did not return a download URL');
        return;
      }
      // Stub provider returns file:// URL — opens in a new tab. Real
      // S3 URL works the same way.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err?.message ?? 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div style={card}>
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading invoices…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={card}>
        <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>
        <button onClick={load} style={btnSecondary}>Retry</button>
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Tax Invoice</div>
        <div style={{ color: '#6b7280', fontSize: 13 }}>
          Your tax invoice will appear here once it's generated.
          {' '}
          <button onClick={load} style={{ ...btnLink, marginLeft: 4 }}>Check again</button>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Tax Documents</div>
      {docs.map((d) => {
        const ready = d.status === 'PDF_GENERATED';
        return (
          <div
            key={d.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderTop: '1px solid #f3f4f6',
            }}
          >
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
                {d.documentNumber}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {labelForDocType(d.documentType)} · ₹{paiseToRupees(d.documentTotalInPaise)}
                {' · '}
                {d.generatedAt ? new Date(d.generatedAt).toLocaleDateString('en-IN') : '—'}
              </div>
            </div>
            <button
              onClick={() => download(d)}
              disabled={!ready || downloadingId === d.id}
              style={ready ? btnPrimary : btnDisabled}
              title={
                ready
                  ? 'Download invoice'
                  : 'Invoice PDF is still being generated — try again in a moment.'
              }
            >
              {downloadingId === d.id
                ? 'Opening…'
                : ready
                ? 'Download'
                : 'Pending'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function labelForDocType(t: string): string {
  switch (t) {
    case 'TAX_INVOICE':
      return 'Tax Invoice';
    case 'BILL_OF_SUPPLY':
      return 'Bill of Supply';
    case 'INVOICE_CUM_BILL_OF_SUPPLY':
      return 'Invoice-cum-Bill of Supply';
    case 'CREDIT_NOTE':
      return 'Credit Note';
    case 'DEBIT_NOTE':
      return 'Debit Note';
    case 'LEGACY_RECEIPT':
      return 'Order Receipt';
    default:
      return t;
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

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};
const btnSecondary: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111',
  border: '1px solid #d1d5db',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
  marginTop: 8,
};
const btnDisabled: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#9ca3af',
  border: '1px solid #e5e7eb',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'not-allowed',
  fontSize: 13,
};
const btnLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#2563eb',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
  textDecoration: 'underline',
};
