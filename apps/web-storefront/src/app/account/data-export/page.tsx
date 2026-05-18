'use client';

/**
 * Customer data export landing page (DPDP §11 right to portability).
 *
 * Talks the user through what they're about to download, then triggers
 * the download from /customer/data-export. The endpoint returns a JSON
 * file with a `Content-Disposition: attachment` header, so the browser
 * saves it directly rather than rendering it.
 *
 * Throttled server-side to 3 calls per hour. The UI surfaces the rate
 * limit if it kicks in (HTTP 429 from the backend) rather than just
 * showing a generic error.
 */

import { useState } from 'react';
import Link from 'next/link';

export default function CustomerDataExportPage() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    setDone(false);
    try {
      // We don't use the shared apiClient here because that envelopes
      // every response in `{success, data}` and would also try to JSON-
      // parse the body. We want the raw JSON file the server sends.
      const token = sessionStorage.getItem('accessToken');
      if (!token) {
        throw new Error('You need to be logged in to download your data.');
      }
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBase}/api/v1/customer/data-export`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        throw new Error(
          'You\'ve requested an export recently. The system limits this to 3 requests per hour — please try again later.',
        );
      }
      if (!res.ok) {
        throw new Error(
          `Server returned ${res.status}. Please try again or contact support if this keeps happening.`,
        );
      }

      const blob = await res.blob();
      const filename =
        res.headers
          .get('Content-Disposition')
          ?.match(/filename="?([^"]+)"?/)?.[1] ?? 'sportsmart-data-export.json';

      // Trigger save via a hidden anchor — works in every modern
      // browser including mobile Safari.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'Could not download your data.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="dpdp-export">
      <h1>Download all your data</h1>

      <p className="dpdp-export__lede">
        Under the Digital Personal Data Protection Act, you can ask us
        for a copy of everything we hold about you. Click the button
        below to download a single JSON file containing:
      </p>

      <ul className="dpdp-export__list">
        <li>Your profile (name, email, phone, addresses)</li>
        <li>Every order you've placed with us (up to 500 most-recent)</li>
        <li>Returns you've raised</li>
        <li>Wishlist</li>
        <li>Wallet balance and the last 200 transactions</li>
        <li>Tax invoices and credit notes (metadata; PDFs are separate)</li>
        <li>Consent log (every change you've made to your privacy settings)</li>
        <li>Active sessions on your account</li>
      </ul>

      <p className="dpdp-export__note">
        We <strong>do not</strong> include your password hash, internal
        admin notes, or any other customer's data — even if their name
        appears in your orders.
      </p>

      <div className="dpdp-export__actions">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="dpdp-export__btn"
        >
          {downloading ? 'Building your file…' : 'Download my data (.json)'}
        </button>
        <p className="dpdp-export__rate">
          You can do this up to 3 times per hour.
        </p>
      </div>

      {error && (
        <div role="alert" className="dpdp-export__error">
          {error}
        </div>
      )}

      {done && !error && (
        <div role="status" className="dpdp-export__success">
          Your file has been saved. Look in your browser's Downloads folder.
        </div>
      )}

      <hr />

      <section className="dpdp-export__related">
        <h2>Related</h2>
        <ul>
          <li>
            <Link href="/account/privacy">
              Manage your privacy and marketing preferences
            </Link>
          </li>
          <li>
            <Link href="/account/invoices">
              View and download individual tax invoices
            </Link>
          </li>
        </ul>
      </section>

      <section className="dpdp-export__about">
        <h2>What happens if you want your data erased</h2>
        <p>
          You can ask us to erase your data through the support form. We'll
          redact your personal information across our systems, but we are
          required by Section 36 of the Indian GST law to keep your tax
          invoices on file for 8 years from the year they were issued.
          When you receive your erasure-completed email we'll list exactly
          what was redacted and what had to remain on file as statutory
          evidence.
        </p>
      </section>

      <style jsx>{`
        .dpdp-export {
          padding: 32px 16px;
          max-width: 720px;
          margin: 0 auto;
        }
        .dpdp-export h1 {
          margin: 0 0 12px;
          font-size: 24px;
        }
        .dpdp-export__lede {
          color: #555;
          font-size: 15px;
          line-height: 1.6;
          margin: 0 0 12px;
        }
        .dpdp-export__list {
          margin: 0 0 16px;
          padding-left: 20px;
          font-size: 14px;
          color: #333;
          line-height: 1.7;
        }
        .dpdp-export__note {
          background: #fff8e1;
          padding: 10px 14px;
          border-left: 3px solid #f57f17;
          font-size: 13px;
          color: #5d4037;
          margin: 16px 0;
        }
        .dpdp-export__actions {
          margin: 24px 0;
        }
        .dpdp-export__btn {
          padding: 12px 24px;
          background: #1565c0;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }
        .dpdp-export__btn:disabled {
          background: #b0bec5;
          cursor: not-allowed;
        }
        .dpdp-export__rate {
          font-size: 12px;
          color: #666;
          margin: 8px 0 0;
        }
        .dpdp-export__error {
          background: #ffebee;
          color: #c62828;
          padding: 12px 14px;
          border-radius: 6px;
          font-size: 13px;
          margin: 16px 0;
        }
        .dpdp-export__success {
          background: #e8f5e9;
          color: #2e7d32;
          padding: 12px 14px;
          border-radius: 6px;
          font-size: 14px;
          margin: 16px 0;
        }
        hr {
          border: none;
          border-top: 1px solid #eee;
          margin: 32px 0 20px;
        }
        .dpdp-export__related h2,
        .dpdp-export__about h2 {
          font-size: 16px;
          margin: 0 0 10px;
        }
        .dpdp-export__related ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .dpdp-export__related li {
          margin-bottom: 6px;
        }
        .dpdp-export__related :global(a) {
          color: #1565c0;
          text-decoration: underline;
          font-size: 14px;
        }
        .dpdp-export__about p {
          color: #555;
          font-size: 14px;
          line-height: 1.6;
        }
      `}</style>
    </main>
  );
}
