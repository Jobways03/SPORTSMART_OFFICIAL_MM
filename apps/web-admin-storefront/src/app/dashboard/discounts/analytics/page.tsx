// Phase F (P2.2) — Discount Analytics Dashboard.
//
// Read-only dashboard summarizing discount campaign performance over
// a configurable date range. Sources:
//   - order_discounts (spend roll-up)
//   - discount_liability_ledger (funding split)
//   - return_tax_reversal_lines (refund impact)
//   - discount_redemptions (lifecycle counts)
//
// Stubs (rendered as "Coming soon" / "0"):
//   - Abuse attempts → ships with P1.4 fraud controls (coupon_attempts).
//   - Remaining budget per campaign → ships with P2.1 budget enforcement.

'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface AnalyticsSummary {
  range: { fromDate: string; toDate: string };
  redemptions: {
    redeemed: number;
    released: number;
    inFlight: number;
  };
  spend: {
    totalDiscountInPaise: string;
    byFundingType: Array<{
      fundingType: string;
      amountInPaise: string;
      count: number;
    }>;
  };
  liability: {
    byParty: Array<{
      liabilityParty: string;
      amountInPaise: string;
      entryCount: number;
    }>;
  };
  refundImpact: {
    discountReversedInPaise: string;
    totalCreditNoteInPaise: string;
    reversalCount: number;
  };
  topCoupons: {
    byRevenue: Array<{
      discountId: string;
      discountCode: string | null;
      redemptionCount: number;
      totalDiscountInPaise: string;
    }>;
    byLoss: Array<{
      discountId: string;
      discountCode: string | null;
      reversalCount: number;
      totalReversalInPaise: string;
    }>;
  };
  abuse: { attemptCount: number; blockedCount: number };
}

const fmtPaise = (v: string | number): string => {
  const n = Number(v);
  return `₹${(n / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtCount = (n: number): string => n.toLocaleString('en-IN');

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#374151',
  margin: '0 0 4px',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const cardSubtitle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  margin: '0 0 12px',
};

const fundingPillStyle = (fundingType: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    PLATFORM: { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
    SELLER: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
    BRAND: { bg: '#fae8ff', fg: '#86198f', border: '#f5d0fe' },
    SHARED: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
    NONE: { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
  };
  const c = colors[fundingType] ?? colors.NONE;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
  };
};

export default function DiscountAnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetDays, setPresetDays] = useState<number>(30);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const toDate = new Date();
        const fromDate = new Date(
          toDate.getTime() - presetDays * 24 * 60 * 60 * 1000,
        );
        const qs = new URLSearchParams({
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
        });
        const res = await apiClient<AnalyticsSummary>(
          `/admin/discounts/analytics/summary?${qs.toString()}`,
        );
        if (!cancelled) setSummary(res.data ?? null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [presetDays]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header + range picker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Discount analytics
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Spend, liability, redemption, and refund impact over the selected
            window. Reads from the discount allocation ledger — survives
            discount edits / deletes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPresetDays(p.days)}
              style={{
                padding: '6px 14px',
                border: presetDays === p.days ? '1px solid #0F1115' : '1px solid #d1d5db',
                background: presetDays === p.days ? '#0F1115' : '#fff',
                color: presetDays === p.days ? '#fff' : '#374151',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#991b1b',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading && !summary && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Loading…
        </div>
      )}

      {summary && (
        <>
          {/* ── KPI summary cards ──────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <KpiCard
              title="Total discount spend"
              value={fmtPaise(summary.spend.totalDiscountInPaise)}
              subtitle={`${fmtCount(
                summary.spend.byFundingType.reduce((a, r) => a + r.count, 0),
              )} discount applications`}
            />
            <KpiCard
              title="Redemptions"
              value={fmtCount(summary.redemptions.redeemed)}
              subtitle={`${fmtCount(summary.redemptions.released)} released · ${fmtCount(summary.redemptions.inFlight)} in flight`}
            />
            <KpiCard
              title="Refund impact"
              value={fmtPaise(summary.refundImpact.totalCreditNoteInPaise)}
              subtitle={`${fmtCount(summary.refundImpact.reversalCount)} credit-note lines`}
              tone={Number(summary.refundImpact.totalCreditNoteInPaise) > 0 ? 'danger' : 'neutral'}
            />
            <KpiCard
              title="Abuse attempts"
              value={fmtCount(summary.abuse.attemptCount)}
              subtitle="P1.4 — fraud tracking ships next"
              tone="muted"
            />
          </div>

          {/* ── Funding split + Liability breakdown ─────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div style={cardStyle}>
              <h3 style={cardTitle}>Spend by funding type</h3>
              <p style={cardSubtitle}>
                Who absorbed the discount cost across all redemptions in the
                window. Platform-funded is marketing expense; seller-funded
                reduces seller payout.
              </p>
              {summary.spend.byFundingType.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>No data in this range.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th}>Funding type</th>
                      <th style={thRight}>Discounts</th>
                      <th style={thRight}>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.spend.byFundingType.map((row) => (
                      <tr key={row.fundingType} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td}>
                          <span style={fundingPillStyle(row.fundingType)}>
                            {row.fundingType}
                          </span>
                        </td>
                        <td style={tdRight}>{fmtCount(row.count)}</td>
                        <td style={{ ...tdRight, fontWeight: 600 }}>
                          {fmtPaise(row.amountInPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={cardStyle}>
              <h3 style={cardTitle}>Liability ledger</h3>
              <p style={cardSubtitle}>
                Authoritative source: discount_liability_ledger.
                SHARED-funded discounts produce one row per party (PLATFORM
                + SELLER + BRAND).
              </p>
              {summary.liability.byParty.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>No ledger entries.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th}>Liability party</th>
                      <th style={thRight}>Entries</th>
                      <th style={thRight}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.liability.byParty.map((row) => (
                      <tr key={row.liabilityParty} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td}>
                          <span style={fundingPillStyle(row.liabilityParty)}>
                            {row.liabilityParty}
                          </span>
                        </td>
                        <td style={tdRight}>{fmtCount(row.entryCount)}</td>
                        <td style={{ ...tdRight, fontWeight: 600 }}>
                          {fmtPaise(row.amountInPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Top coupons (revenue + loss) ─────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div style={cardStyle}>
              <h3 style={cardTitle}>Top by spend</h3>
              <p style={cardSubtitle}>
                Highest-spend campaigns in the window. Top 10.
              </p>
              {summary.topCoupons.byRevenue.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>No discounts redeemed.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th}>Code</th>
                      <th style={thRight}>Redemptions</th>
                      <th style={thRight}>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topCoupons.byRevenue.map((row) => (
                      <tr key={row.discountId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                          {row.discountCode ?? '—'}
                        </td>
                        <td style={tdRight}>{fmtCount(row.redemptionCount)}</td>
                        <td style={{ ...tdRight, fontWeight: 600 }}>
                          {fmtPaise(row.totalDiscountInPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={cardStyle}>
              <h3 style={cardTitle}>Top by refund loss</h3>
              <p style={cardSubtitle}>
                Highest credit-note reversals (returns of discounted items).
                Top 10. High loss = customers returning post-discount.
              </p>
              {summary.topCoupons.byLoss.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>No refund reversals.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={th}>Code</th>
                      <th style={thRight}>Reversals</th>
                      <th style={thRight}>Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topCoupons.byLoss.map((row) => (
                      <tr key={row.discountId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                          {row.discountCode ?? '—'}
                        </td>
                        <td style={tdRight}>{fmtCount(row.reversalCount)}</td>
                        <td style={{ ...tdRight, fontWeight: 600, color: '#dc2626' }}>
                          {fmtPaise(row.totalReversalInPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
            Range: {new Date(summary.range.fromDate).toLocaleDateString('en-IN')} →{' '}
            {new Date(summary.range.toDate).toLocaleDateString('en-IN')}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone?: 'neutral' | 'danger' | 'muted';
}) {
  const valueColor =
    tone === 'danger' ? '#dc2626' : tone === 'muted' ? '#9ca3af' : '#111827';
  return (
    <div style={cardStyle}>
      <div style={cardTitle}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor, margin: '4px 0' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{subtitle}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'left',
};

const thRight: React.CSSProperties = {
  ...th,
  textAlign: 'right',
};

const td: React.CSSProperties = {
  padding: '10px',
  fontSize: 13,
  color: '#374151',
  textAlign: 'left',
  verticalAlign: 'top',
};

const tdRight: React.CSSProperties = {
  ...td,
  textAlign: 'right',
};
