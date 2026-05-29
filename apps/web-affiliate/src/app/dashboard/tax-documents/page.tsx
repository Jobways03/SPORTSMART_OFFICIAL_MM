'use client';

// Phase 159f — affiliate tax documents: per-quarter §194-O TDS summary +
// Form 16A download (enabled once the marketplace has issued the certificate).

import { useEffect, useState } from 'react';
import { apiFetch, API_BASE, getToken, formatINR } from '../../../lib/api';

interface TaxQuarter {
  filingPeriod: string;
  grossInPaise: string;
  tdsInPaise: string;
  payoutCount: number;
  status: string;
  canDownloadForm16A: boolean;
}

const rupees = (paise: string) => formatINR(Number(paise) / 100);

export default function TaxDocumentsPage() {
  const [quarters, setQuarters] = useState<TaxQuarter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ quarters: TaxQuarter[] }>('/affiliate/me/tax/summary');
        setQuarters(data?.quarters ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load tax documents');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Form 16A is raw HTML behind AffiliateAuthGuard, so fetch with the bearer
  // token and open the result (a plain <a> can't send the header).
  const download = async (q: string) => {
    setDownloading(q);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/affiliate/me/tax/${encodeURIComponent(q)}/form-16a`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('Form 16A is not available yet for this quarter.');
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setError(e?.message ?? 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tax documents</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
        TDS deducted on your payouts under Section 194-O, by filing quarter. Download your Form 16A
        once the marketplace has issued it.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, margin: '12px 0' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : quarters.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>No TDS deducted yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
              <th style={th}>Quarter</th>
              <th style={{ ...th, textAlign: 'right' }}>Gross</th>
              <th style={{ ...th, textAlign: 'right' }}>TDS</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Form 16A</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={q.filingPeriod} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}>
                  <strong>{q.filingPeriod}</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{q.payoutCount} payout(s)</div>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{rupees(q.grossInPaise)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{rupees(q.tdsInPaise)}</td>
                <td style={td}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: q.canDownloadForm16A ? '#dcfce7' : '#fef3c7',
                      color: q.canDownloadForm16A ? '#166534' : '#92400e',
                    }}
                  >
                    {q.status}
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {q.canDownloadForm16A ? (
                    <button onClick={() => download(q.filingPeriod)} disabled={downloading === q.filingPeriod} style={btn}>
                      {downloading === q.filingPeriod ? 'Opening…' : 'Download'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Not issued</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #0F1115',
  background: '#0F1115',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
