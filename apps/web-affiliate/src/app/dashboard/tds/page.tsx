'use client';

/**
 * Affiliate-facing TDS records. Section 194H of the Income Tax Act
 * requires SportSmart to deduct 5% TDS on commission payments to
 * affiliates once cumulative payouts for the financial year cross the
 * per-FY threshold (currently ₹15,000). One row per FY.
 *
 * Backend: GET /affiliate/me/tds → scoped to the requester's affiliateId.
 *
 * No Form 16A download yet — the admin emits those quarterly once
 * Form 26Q is filed with the IT department. We surface a hint instead
 * of pretending the link is there.
 */

import { useEffect, useState } from 'react';
import { apiFetch, formatINR, formatDate, ApiError } from '../../../lib/api';

interface TdsRecord {
  id: string;
  affiliateId: string;
  financialYear: string;
  cumulativeGross: string;
  cumulativeTds: string;
  cumulativeNet: string;
  thresholdCrossedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TdsResponse {
  records: TdsRecord[];
}

export default function AffiliateTdsPage() {
  const [records, setRecords] = useState<TdsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<TdsResponse>('/affiliate/me/tds');
        setRecords(data.records ?? []);
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else setError('Could not load TDS records.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>TDS Statement</h1>
        <p style={{ color: '#64748b', margin: '6px 0 0', fontSize: 13 }}>
          5% TDS is deducted under Section 194H once your commission for the
          financial year crosses the threshold (currently ₹15,000). This page
          shows the cumulative gross commission, TDS deducted, and net paid
          per FY. Share these figures with your CA at filing time.
        </p>
      </header>

      {error && (
        <div role="alert" style={{ marginBottom: 12, padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b', padding: 32, textAlign: 'center' }}>Loading…</p>
      ) : records.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>No TDS yet</p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 0' }}>
            TDS records appear after the first commission payout that crosses
            the per-FY threshold. Until then, every paise of your commission is
            paid out gross.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={th}>Financial Year</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cumulative Gross</th>
                  <th style={{ ...th, textAlign: 'right' }}>TDS Deducted</th>
                  <th style={{ ...th, textAlign: 'right' }}>Net Paid</th>
                  <th style={th}>Threshold Crossed</th>
                  <th style={th}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const crossed = Boolean(r.thresholdCrossedAt);
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.financialYear}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{formatINR(r.cumulativeGross)}</td>
                      <td style={{ ...td, textAlign: 'right', color: crossed ? '#b91c1c' : '#64748b', fontWeight: crossed ? 600 : 400 }}>
                        {formatINR(r.cumulativeTds)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{formatINR(r.cumulativeNet)}</td>
                      <td style={td}>
                        {crossed ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                            {formatDate(r.thresholdCrossedAt!)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>Not yet</span>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{formatDate(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, padding: 14, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, color: '#1e3a8a' }}>
        <strong>Form 16A:</strong> SportSmart files Form 26Q with the Income
        Tax Department each quarter. Form 16A (your TDS certificate) is issued
        within 15 days of the quarterly filing. We&apos;ll email it to your
        registered address — there&apos;s no download here yet.
      </div>
    </main>
  );
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};
