'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, formatINR } from '../../../lib/api';

interface TopEarner {
  rank: number;
  affiliateId: string;
  totalEarned: string;
  commissionCount: number;
  affiliate: { id: string; firstName: string; lastName: string; email: string; status: string } | null;
}

interface Totals {
  PENDING: { sum: string; count: number };
  HOLD: { sum: string; count: number };
  CONFIRMED: { sum: string; count: number };
  PAID: { sum: string; count: number };
  CANCELLED: { sum: string; count: number };
  REVERSED: { sum: string; count: number };
}

export default function ReportsPage() {
  const [top, setTop] = useState<TopEarner[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ rows: TopEarner[] }>('/admin/affiliates/reports/top-earners?limit=20'),
      apiFetch<Totals>('/admin/affiliates/commissions/totals'),
    ])
      .then(([t, totalsRes]) => {
        setTop(t.rows ?? []);
        setTotals(totalsRes);
      })
      .catch((e) => setError(e?.message ?? 'Could not load reports.'))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;

  const totalPaid = totals ? Number(totals.PAID.sum) : 0;
  const totalConfirmed = totals ? Number(totals.CONFIRMED.sum) : 0;
  const totalReversed = totals ? Number(totals.REVERSED.sum) : 0;
  const reversalRate = totalPaid > 0 ? (totalReversed / (totalPaid + totalReversed)) * 100 : 0;

  return (
    <div style={{ maxWidth: 1200 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Reports
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Performance signals across the affiliate program. Use these to spot strong partners
          and worrying churn early.
        </p>
      </header>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
            <Metric label="Total paid out" value={formatINR(totalPaid)} sub={`${totals?.PAID.count ?? 0} commissions settled`} tone="success" />
            <Metric label="Available for payout" value={formatINR(totalConfirmed)} sub={`${totals?.CONFIRMED.count ?? 0} confirmed`} tone="info" />
            <Metric label="Pending pipeline" value={formatINR(totals?.PENDING.sum ?? 0)} sub={`${totals?.PENDING.count ?? 0} in return window`} tone="warning" />
            <Metric label="Reversal rate" value={`${reversalRate.toFixed(1)}%`} sub={`${formatINR(totalReversed)} reversed`} tone={reversalRate > 5 ? 'danger' : 'muted'} />
          </section>

          <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Top earners (lifetime)</h3>
              <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
                Sum of CONFIRMED + PAID commissions. Tap an affiliate to manage their config.
              </p>
            </div>
            {top.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                No earnings yet — first sales will surface here.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {top.map((t, i) => {
                  const max = Number(top[0]?.totalEarned ?? 0) || 1;
                  const pct = (Number(t.totalEarned) / max) * 100;
                  return (
                    <li
                      key={t.affiliateId}
                      style={{
                        padding: '14px 18px',
                        borderBottom: i === top.length - 1 ? 'none' : '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                        <div
                          style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: t.rank === 1 ? '#fef3c7' : t.rank === 2 ? '#e0e7ff' : t.rank === 3 ? '#fce7f3' : '#f1f5f9',
                            color: t.rank === 1 ? '#92400e' : t.rank === 2 ? '#3730a3' : t.rank === 3 ? '#9d174d' : '#475569',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 12, flexShrink: 0,
                          }}
                        >
                          #{t.rank}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>
                            {t.affiliate ? `${t.affiliate.firstName} ${t.affiliate.lastName}` : 'Unknown'}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {t.affiliate?.email ?? ''}
                            {' · '}
                            {t.commissionCount} commission{t.commissionCount === 1 ? '' : 's'}
                            {t.affiliate?.status && t.affiliate.status !== 'ACTIVE' && (
                              <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, borderRadius: 4, background: '#fef2f2', color: '#b91c1c' }}>
                                {t.affiliate.status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums', minWidth: 110, textAlign: 'right' }}>
                          {formatINR(t.totalEarned)}
                        </div>
                      </div>
                      {/* Visualisation bar */}
                      <div style={{ marginLeft: 40, height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #4ade80, #16a34a)',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p style={{ marginTop: 24, fontSize: 12, color: '#94a3b8' }}>
            Need deeper analytics?{' '}
            <Link href="/dashboard/commissions" style={{ color: '#1d4ed8', fontWeight: 600 }}>
              Drill into the commission ledger
            </Link>{' '}
            for per-row filtering.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'success' | 'warning' | 'info' | 'danger' | 'muted' }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'info' ? '#1d4ed8' :
    tone === 'danger' ? '#b91c1c' :
    '#64748b';
  return (
    <div style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: 3, background: fg, opacity: 0.6 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
