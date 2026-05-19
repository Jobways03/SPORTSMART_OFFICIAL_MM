'use client';

/**
 * Franchise-facing tax-document list + download.
 *
 * Backend:
 *   GET  /franchise/tax-documents                — paginated list
 *   GET  /franchise/tax-documents/:id/download   — signed download URL
 *
 * Mirrors the seller invoices page (filters by document type + FY,
 * one-click download). Franchise tax documents are filtered server-side
 * via the sub-order franchiseId — the page only sees its own.
 *
 * Plain-English document-type hints are inline so the franchise (and
 * their internal accountant) understands what they're looking at without
 * needing the CGST handbook open in another tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type DocumentType =
  | 'TAX_INVOICE'
  | 'BILL_OF_SUPPLY'
  | 'INVOICE_CUM_BILL_OF_SUPPLY'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'LEGACY_RECEIPT';

interface TaxDocItem {
  id: string;
  documentNumber: string;
  documentType: DocumentType;
  financialYear: string;
  generatedAt: string;
  status: string;
  einvoiceStatus: string;
  irn: string | null;
  documentTotalInPaise: string;
  taxableAmountInPaise?: string;
  totalTaxAmountInPaise?: string;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
}

interface ListResponse {
  items: TaxDocItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  INVOICE_CUM_BILL_OF_SUPPLY: 'Invoice-cum-Bill of Supply',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
  LEGACY_RECEIPT: 'Legacy Receipt',
};

const DOC_TYPE_HINTS: Record<DocumentType, string> = {
  TAX_INVOICE:
    'A regular tax invoice. CGST/SGST/IGST are charged on top of the taxable value.',
  BILL_OF_SUPPLY:
    'Issued by a composition or exempt supplier. No GST is charged or claimable.',
  INVOICE_CUM_BILL_OF_SUPPLY:
    'A mixed document for orders that contain both taxable and exempt items.',
  CREDIT_NOTE:
    "Reduces a previously-issued invoice's value (e.g. after a return). The original GST liability is reduced by this amount.",
  DEBIT_NOTE:
    'Increases a previously-issued invoice (e.g. correction upward). Rarely used in marketplace returns.',
  LEGACY_RECEIPT:
    'Pre-GST historical document. No tax breakdown — kept for record-keeping only.',
};

const fmtRupees = (paise: string | undefined) => {
  if (!paise) return '—';
  try {
    const n = BigInt(paise);
    const rupees = Number(n) / 100;
    return `₹${rupees.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } catch {
    return `₹${paise}`;
  }
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export default function FranchiseTaxInvoicesPage() {
  const [items, setItems] = useState<TaxDocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [docTypeFilter, setDocTypeFilter] = useState<'' | DocumentType>('');
  const [fyFilter, setFyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1, limit: 20, total: 0, totalPages: 1,
  });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', '20');
    if (docTypeFilter) p.set('documentType', docTypeFilter);
    if (fyFilter) p.set('financialYear', fyFilter);
    return p.toString();
  }, [page, docTypeFilter, fyFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ListResponse>(`/franchise/tax-documents?${query}`);
      const data = (res?.data as ListResponse) ?? (res as unknown as ListResponse);
      setItems(data.items ?? []);
      setPagination(data.pagination ?? pagination);
    } catch (err) {
      setError((err as Error).message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const handleDownload = async (doc: TaxDocItem) => {
    setDownloadingId(doc.id);
    try {
      const res = await apiClient<{ url: string }>(
        `/franchise/tax-documents/${doc.id}/download`,
      );
      const url = (res?.data as { url?: string })?.url;
      if (!url) throw new Error('Download URL not returned by server');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch download URL');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 1200 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Tax invoices</h1>
        <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 13 }}>
          Every GSTIN-issued tax document for sales served from your franchise.
          Download the PDF for your records or share with your CA.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <div>
          <label htmlFor="docType" style={lbl}>Document type</label>
          <select
            id="docType"
            value={docTypeFilter}
            onChange={(e) => { setDocTypeFilter(e.target.value as '' | DocumentType); setPage(1); }}
            style={input}
          >
            <option value="">All types</option>
            {(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((dt) => (
              <option key={dt} value={dt}>{DOC_TYPE_LABELS[dt]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fy" style={lbl}>Financial year</label>
          <input
            id="fy"
            placeholder="e.g. 2025-26"
            value={fyFilter}
            onChange={(e) => { setFyFilter(e.target.value); setPage(1); }}
            style={input}
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: loading ? 'wait' : 'pointer', fontSize: 13 }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 12, padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p style={{ color: '#6b7280', padding: 32, textAlign: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          No documents match the current filters. Try widening the financial year
          or clearing the type filter. (If your franchise hasn't fulfilled any
          online orders yet, no marketplace invoices exist — only POS receipts.)
        </p>
      )}

      {items.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th}>Document #</th>
                  <th style={th}>Type</th>
                  <th style={th}>FY</th>
                  <th style={th}>Generated</th>
                  <th style={th}>Buyer</th>
                  <th style={th}>IRN</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}><code>{doc.documentNumber}</code></td>
                    <td style={td}>
                      <span title={DOC_TYPE_HINTS[doc.documentType]}>
                        {DOC_TYPE_LABELS[doc.documentType]}
                      </span>
                    </td>
                    <td style={td}>{doc.financialYear}</td>
                    <td style={td}>{fmtDate(doc.generatedAt)}</td>
                    <td style={td}>
                      {doc.buyerLegalName ?? doc.buyerGstin ?? (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      {doc.irn ? (
                        <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {doc.irn.slice(0, 12)}…
                        </code>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>N/A</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                      {fmtRupees(doc.documentTotalInPaise)}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#374151' }}>
                        {doc.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingId === doc.id || doc.status !== 'PDF_GENERATED'}
                        title={doc.status !== 'PDF_GENERATED'
                          ? 'PDF still being generated — try again in a minute'
                          : 'Download invoice'}
                        style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #2563eb', background: doc.status === 'PDF_GENERATED' ? '#2563eb' : '#9ca3af', color: '#fff', borderRadius: 4, cursor: doc.status === 'PDF_GENERATED' && downloadingId !== doc.id ? 'pointer' : 'not-allowed' }}
                      >
                        {downloadingId === doc.id ? '…' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fafbfc' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} document{pagination.total === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  style={pageBtn}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= pagination.totalPages || loading}
                  style={pageBtn}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const input: React.CSSProperties = { padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', minWidth: 180 };
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const pageBtn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, cursor: 'pointer' };
