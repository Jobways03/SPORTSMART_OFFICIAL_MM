'use client';

/**
 * Customer-facing invoice list + download.
 *
 * Lives at /account/invoices in the storefront. Backend already provides:
 *   GET  /customer/tax-documents                — paginated list
 *   GET  /customer/tax-documents/:id/download   — signed download URL
 *
 * Simpler than the seller variant because customers don't filter by
 * financial year as often — we list everything most-recent-first and
 * paginate. Tax document type is labelled in plain English (no
 * "INVOICE_CUM_BILL_OF_SUPPLY" jargon for end-users).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface InvoiceItem {
  id: string;
  documentNumber: string;
  documentType: string;
  financialYear: string;
  generatedAt: string;
  status: string;
  downloadable?: boolean;
  einvoiceStatus: string;
  documentTotalInPaise: string;
}

interface ListResponse {
  items: InvoiceItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const TYPE_LABEL: Record<string, string> = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  INVOICE_CUM_BILL_OF_SUPPLY: 'Tax invoice',
  CREDIT_NOTE: 'Credit note',
  DEBIT_NOTE: 'Debit note',
  LEGACY_RECEIPT: 'Receipt',
};

const fmtRupees = (paise: string) => {
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

export default function CustomerInvoicesPage() {
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ListResponse>(
        `/customer/tax-documents?page=${p}&limit=20`,
      );
      const data = (res?.data as ListResponse) ?? (res as unknown as ListResponse);
      setItems(data.items ?? []);
      setPagination(data.pagination ?? pagination);
    } catch (err) {
      setError((err as Error).message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const handleDownload = async (doc: InvoiceItem) => {
    setDownloadingId(doc.id);
    try {
      const res = await apiClient<{ url: string }>(
        `/customer/tax-documents/${doc.id}/download`,
      );
      const url = (res?.data as { url?: string })?.url;
      if (!url) throw new Error('Download URL not returned');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError((err as Error).message || 'Could not fetch download URL');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <main className="invoices">
      <header className="invoices__header">
        <h1>Your invoices</h1>
        <p>
          Tax invoices and credit notes for every order you've placed.
          Download for your records or share with your tax advisor.
        </p>
        <p className="invoices__data-export">
          Need everything we have on file? You can also{' '}
          <Link href="/account/data-export">download your full data export</Link>.
        </p>
      </header>

      {error && (
        <div role="alert" className="invoices__error">
          {error}
        </div>
      )}

      {loading && <p className="invoices__hint">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="invoices__hint">
          You don't have any invoices yet. Once you place an order and it's
          accepted by the seller, your tax invoice will appear here.
        </p>
      )}

      {items.length > 0 && (
        <div className="invoices__list">
          {items.map((doc) => (
            <article key={doc.id} className="invoices__row">
              <div className="invoices__row-main">
                <div className="invoices__row-num">
                  <code>{doc.documentNumber}</code>
                  <span className="invoices__row-type">
                    {TYPE_LABEL[doc.documentType] ?? doc.documentType}
                  </span>
                </div>
                <div className="invoices__row-meta">
                  {fmtDate(doc.generatedAt)} · FY {doc.financialYear}
                  {doc.einvoiceStatus === 'GENERATED' && (
                    <span className="invoices__row-irn"> · IRP-signed</span>
                  )}
                </div>
              </div>
              <div className="invoices__row-amount">
                {fmtRupees(doc.documentTotalInPaise)}
              </div>
              <div className="invoices__row-action">
                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  disabled={
                    downloadingId === doc.id || !(doc.downloadable ?? doc.status === 'PDF_GENERATED')
                  }
                  className="invoices__download"
                  title={
                    !(doc.downloadable ?? doc.status === 'PDF_GENERATED')
                      ? 'PDF is still being generated — check back shortly'
                      : 'Download invoice'
                  }
                >
                  {downloadingId === doc.id
                    ? '…'
                    : !(doc.downloadable ?? doc.status === 'PDF_GENERATED')
                      ? 'Preparing'
                      : 'Download invoice'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="invoices__pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Newer
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Older →
          </button>
        </div>
      )}

      <style jsx>{`
        .invoices {
          padding: 24px 16px;
          max-width: 900px;
          margin: 0 auto;
        }
        .invoices__header h1 {
          margin: 0 0 6px;
          font-size: 22px;
        }
        .invoices__header p {
          margin: 0 0 6px;
          color: #555;
          font-size: 14px;
        }
        .invoices__data-export {
          font-size: 13px;
          color: #1565c0;
        }
        .invoices__data-export :global(a) {
          color: #1565c0;
          text-decoration: underline;
        }
        .invoices__error {
          background: #ffebee;
          color: #c62828;
          padding: 10px 14px;
          border-radius: 6px;
          margin: 12px 0;
          font-size: 13px;
        }
        .invoices__hint {
          color: #555;
          padding: 24px 0;
          text-align: center;
        }
        .invoices__list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 16px;
        }
        .invoices__row {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 14px 18px;
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 12px;
          align-items: center;
        }
        @media (max-width: 600px) {
          .invoices__row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .invoices__row-amount {
            text-align: left !important;
          }
        }
        .invoices__row-num {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 4px;
        }
        .invoices__row-num code {
          font-weight: 600;
          font-size: 14px;
        }
        .invoices__row-type {
          display: inline-block;
          padding: 1px 8px;
          background: #f3f4f6;
          color: #555;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .invoices__row-meta {
          color: #666;
          font-size: 12px;
        }
        .invoices__row-irn {
          color: #2e7d32;
          font-weight: 600;
        }
        .invoices__row-amount {
          font-weight: 700;
          font-size: 15px;
          text-align: right;
        }
        .invoices__download {
          padding: 8px 16px;
          background: #1565c0;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .invoices__download:disabled {
          background: #b0bec5;
          cursor: not-allowed;
        }
        .invoices__pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          font-size: 13px;
          color: #666;
        }
        .invoices__pagination button {
          padding: 6px 12px;
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .invoices__pagination button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
