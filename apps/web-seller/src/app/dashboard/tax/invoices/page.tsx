'use client';

/**
 * Seller-facing tax-document list + download.
 *
 * Backend already provides:
 *   GET  /seller/tax-documents                — paginated list
 *   GET  /seller/tax-documents/:id/download   — signed download URL
 *
 * Filters supported: document type (TAX_INVOICE / CREDIT_NOTE / etc.),
 * financial year, sub-order id. The page bundles all four into a
 * simple toolbar.
 *
 * Plain-English helper notes are surfaced for each document type so the
 * seller (and their internal accountant) understands what they're looking
 * at without needing the CA doc open in another tab.
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
  documentTotalInPaise: string; // BigInt serialised
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

export default function SellerTaxInvoicesPage() {
  const [items, setItems] = useState<TaxDocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Filters
  const [docTypeFilter, setDocTypeFilter] = useState<'' | DocumentType>('');
  const [fyFilter, setFyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
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
      const res = await apiClient<ListResponse>(`/seller/tax-documents?${query}`);
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

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async (doc: TaxDocItem) => {
    setDownloadingId(doc.id);
    try {
      const res = await apiClient<{ url: string }>(
        `/seller/tax-documents/${doc.id}/download`,
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
    <main className="tax-invoices">
      <header className="tax-invoices__header">
        <h1>Tax invoices</h1>
        <p>
          Every tax document issued under your GSTIN. Download the PDF for
          your records or to share with your CA.
        </p>
      </header>

      <div className="tax-invoices__filters">
        <div>
          <label htmlFor="docType">Document type</label>
          <select
            id="docType"
            value={docTypeFilter}
            onChange={(e) => {
              setDocTypeFilter(e.target.value as '' | DocumentType);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((dt) => (
              <option key={dt} value={dt}>
                {DOC_TYPE_LABELS[dt]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fy">Financial year</label>
          <input
            id="fy"
            placeholder="e.g. 2025-26"
            value={fyFilter}
            onChange={(e) => {
              setFyFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="tax-invoices__btn"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="tax-invoices__error">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="tax-invoices__hint">
          No documents match the current filters. Try widening the financial
          year or clearing the type filter.
        </p>
      )}

      {items.length > 0 && (
        <div className="tax-invoices__table-wrap">
          <table className="tax-invoices__table">
            <thead>
              <tr>
                <th>Document #</th>
                <th>Type</th>
                <th>FY</th>
                <th>Generated</th>
                <th>Buyer</th>
                <th>IRN</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <code>{doc.documentNumber}</code>
                  </td>
                  <td>
                    <span title={DOC_TYPE_HINTS[doc.documentType]}>
                      {DOC_TYPE_LABELS[doc.documentType]}
                    </span>
                  </td>
                  <td>{doc.financialYear}</td>
                  <td>{fmtDate(doc.generatedAt)}</td>
                  <td>
                    {doc.buyerLegalName ?? doc.buyerGstin ?? (
                      <span style={{ color: '#888' }}>—</span>
                    )}
                  </td>
                  <td>
                    {doc.irn ? (
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                        {doc.irn.slice(0, 12)}…
                      </code>
                    ) : (
                      <span style={{ color: '#888' }}>N/A</span>
                    )}
                  </td>
                  <td className="text-right">
                    {fmtRupees(doc.documentTotalInPaise)}
                  </td>
                  <td>
                    <span
                      className={`tax-invoices__status tax-invoices__status--${doc.status.toLowerCase().replace(/_/g, '-')}`}
                    >
                      {doc.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={
                        downloadingId === doc.id || doc.status !== 'PDF_GENERATED'
                      }
                      className="tax-invoices__download"
                      title={
                        doc.status !== 'PDF_GENERATED'
                          ? 'PDF still being generated — try again in a minute'
                          : 'Download PDF'
                      }
                    >
                      {downloadingId === doc.id ? '…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tax-invoices__pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} total)
            </span>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .tax-invoices {
          padding: 24px;
          max-width: 1100px;
          margin: 0 auto;
        }
        .tax-invoices__header h1 {
          margin: 0 0 4px;
          font-size: 22px;
        }
        .tax-invoices__header p {
          margin: 0 0 20px;
          color: #555;
          font-size: 14px;
        }
        .tax-invoices__filters {
          display: flex;
          gap: 14px;
          align-items: flex-end;
          background: #fff;
          padding: 14px 16px;
          border-radius: 8px;
          border: 1px solid #d0d7de;
          margin-bottom: 16px;
        }
        .tax-invoices__filters label {
          display: block;
          font-size: 12px;
          color: #666;
          margin-bottom: 4px;
        }
        .tax-invoices__filters select,
        .tax-invoices__filters input {
          padding: 6px 10px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          font-size: 13px;
          font-family: inherit;
        }
        .tax-invoices__btn {
          padding: 8px 16px;
          background: #1565c0;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .tax-invoices__btn:disabled {
          opacity: 0.6;
        }
        .tax-invoices__error {
          background: #ffebee;
          color: #c62828;
          padding: 10px 14px;
          border-radius: 6px;
          margin-bottom: 14px;
          font-size: 13px;
        }
        .tax-invoices__hint {
          color: #555;
          font-size: 14px;
          padding: 16px;
        }
        .tax-invoices__table-wrap {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          overflow: hidden;
        }
        .tax-invoices__table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .tax-invoices__table th,
        .tax-invoices__table td {
          padding: 10px 12px;
          border-bottom: 1px solid #eee;
          text-align: left;
          vertical-align: middle;
        }
        .tax-invoices__table th {
          background: #fafbfc;
          color: #555;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }
        :global(.text-right) {
          text-align: right;
        }
        .tax-invoices__status {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          background: #f3f4f6;
          color: #555;
        }
        .tax-invoices__status--pdf-generated {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .tax-invoices__status--pdf-pending,
        .tax-invoices__status--draft {
          background: #fff8e1;
          color: #ef6c00;
        }
        .tax-invoices__status--pdf-failed {
          background: #ffebee;
          color: #c62828;
        }
        .tax-invoices__status--partially-reversed,
        .tax-invoices__status--fully-reversed,
        .tax-invoices__status--superseded {
          background: #ede7f6;
          color: #5e35b1;
        }
        .tax-invoices__download {
          padding: 6px 12px;
          background: #1565c0;
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .tax-invoices__download:disabled {
          background: #b0bec5;
          cursor: not-allowed;
        }
        .tax-invoices__pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-top: 1px solid #eee;
          background: #fafbfc;
          font-size: 13px;
        }
        .tax-invoices__pagination button {
          padding: 6px 12px;
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          cursor: pointer;
        }
        .tax-invoices__pagination button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
