'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  MarginReportResponse,
  PayoutsReportResponse,
} from '@/services/admin-accounts.service';
import { validateDateRange } from '@/lib/validators';

const money = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function FranchiseReportsPage() {
  const today = isoDay(new Date());
  const monthAgo = isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);
  const [margins, setMargins] = useState<MarginReportResponse | null>(null);
  const [payouts, setPayouts] = useState<PayoutsReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    const rangeError = validateDateRange(fromDate, toDate);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        adminAccountsService.getMarginsReport(fromDate, toDate).catch(() => null),
        adminAccountsService.getPayoutsReport(fromDate, toDate).catch(() => null),
      ]);
      setMargins(m?.data ?? null);
      setPayouts(p?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Franchise-only payouts (the endpoint returns both node types).
  const franchisePayouts = (payouts?.payouts ?? []).filter(
    (p) => p.nodeType === 'FRANCHISE',
  );
  const franchisePaidTotal = franchisePayouts.reduce((a, p) => a + (p.amount || 0), 0);

  return (
    <div>
      <Link
        href="/dashboard/accounts"
        style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
      >
        &larr; Back to Accounts
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 4px' }}>
        Finance Reports
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
        Margins and franchise payouts for a date range.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          />
        </div>
        <button
          onClick={() => void run()}
          disabled={loading}
          style={{
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            background: loading ? '#9ca3af' : '#2563eb',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Loading...' : 'Run'}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Margins</h2>
          {!margins ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No data</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Revenue</div>
                  <div style={{ fontWeight: 700 }}>{money(margins.overall.totalRevenue)}</div>
                </div>
                <div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Platform earning</div>
                  <div style={{ fontWeight: 700 }}>{money(margins.overall.platformEarning)}</div>
                </div>
                <div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Margin</div>
                  <div style={{ fontWeight: 700 }}>{margins.overall.marginPercentage?.toFixed(1)}%</div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {['Category', 'Revenue', 'Earning', 'Margin %'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(margins.breakdown ?? []).map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 8px' }}>{b.category}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{money(b.totalRevenue)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{money(b.platformEarning)}</td>
                      <td style={{ padding: '6px 8px' }}>{b.marginPercentage?.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            Franchise payouts
          </h2>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <span style={{ color: '#6b7280', fontSize: 12 }}>Total paid to franchises: </span>
            <strong>{money(franchisePaidTotal)}</strong>{' '}
            <span style={{ color: '#9ca3af' }}>({franchisePayouts.length} payouts)</span>
          </div>
          {franchisePayouts.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No franchise payouts in range</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  {['Franchise', 'Amount', 'Paid', 'Status'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {franchisePayouts.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px' }}>{p.nodeName}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{money(p.amount)}</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280' }}>{new Date(p.paidAt).toLocaleDateString()}</td>
                    <td style={{ padding: '6px 8px' }}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
