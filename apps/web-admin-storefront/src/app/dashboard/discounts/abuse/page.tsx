// Phase E (P1.4) — Admin Coupon Abuse Panel.
//
// Shows top-attempted invalid codes + recent attempts feed. Sources:
//   - GET /admin/discounts/analytics/abuse/top-codes (top abused)
//   - GET /admin/discounts/analytics/abuse/attempts  (paginated feed)
//
// Filterable by result (INVALID / BLOCKED / EXPIRED / NOT_ELIGIBLE
// / VALID) and date range. Same date-range presets as the analytics
// dashboard so the two read consistently.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface TopAbusedCode {
  codeAttempted: string;
  invalidCount: number;
  distinctCustomers: number;
  distinctIps: number;
}

interface AttemptRow {
  id: string;
  customerId: string | null;
  ipAddress: string | null;
  deviceId: string | null;
  codeAttempted: string;
  result: 'VALID' | 'INVALID' | 'EXPIRED' | 'NOT_ELIGIBLE' | 'BLOCKED';
  reason: string | null;
  createdAt: string;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '24 hours', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

const RESULT_FILTERS: Array<{
  label: string;
  value: '' | AttemptRow['result'];
}> = [
  { label: 'All', value: '' },
  { label: 'Invalid', value: 'INVALID' },
  { label: 'Blocked', value: 'BLOCKED' },
  { label: 'Expired', value: 'EXPIRED' },
  { label: 'Not eligible', value: 'NOT_ELIGIBLE' },
  { label: 'Valid', value: 'VALID' },
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

const resultPillStyle = (
  result: AttemptRow['result'],
): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string }> = {
    VALID: { bg: '#ecfdf5', fg: '#065f46' },
    INVALID: { bg: '#fef3c7', fg: '#92400e' },
    EXPIRED: { bg: '#f3f4f6', fg: '#374151' },
    NOT_ELIGIBLE: { bg: '#fef3c7', fg: '#92400e' },
    BLOCKED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const c = colors[result];
  return {
    display: 'inline-block',
    padding: '2px 8px',
    background: c.bg,
    color: c.fg,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
  };
};

export default function CouponAbusePage() {
  const [presetDays, setPresetDays] = useState<number>(7);
  const [resultFilter, setResultFilter] = useState<'' | AttemptRow['result']>(
    '',
  );
  const [topCodes, setTopCodes] = useState<TopAbusedCode[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date(
      toDate.getTime() - presetDays * 24 * 60 * 60 * 1000,
    );
    return { fromDate, toDate };
  }, [presetDays]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const baseQs = new URLSearchParams({
          fromDate: range.fromDate.toISOString(),
          toDate: range.toDate.toISOString(),
        });
        const attemptQs = new URLSearchParams(baseQs);
        if (resultFilter) attemptQs.set('result', resultFilter);
        attemptQs.set('page', String(page));
        attemptQs.set('limit', '50');

        const [topRes, attemptsRes] = await Promise.all([
          apiClient<TopAbusedCode[]>(
            `/admin/discounts/analytics/abuse/top-codes?${baseQs.toString()}&limit=25`,
          ),
          apiClient<{
            items: AttemptRow[];
            total: number;
            page: number;
            limit: number;
          }>(`/admin/discounts/analytics/abuse/attempts?${attemptQs.toString()}`),
        ]);
        if (cancelled) return;
        setTopCodes(topRes.data ?? []);
        setAttempts(attemptsRes.data?.items ?? []);
        setTotal(attemptsRes.data?.total ?? 0);
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
  }, [presetDays, resultFilter, page, range]);

  const fmtDateTime = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncate = (v: string | null, n = 12): string => {
    if (!v) return '—';
    return v.length > n ? `${v.slice(0, n)}…` : v;
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
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
            Coupon abuse
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Tracking + rate-limiting on POST /customer/coupons/validate.
            High-volume invalid attempts from one source usually indicate
            either a leaked code or a guessing attack.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => {
                setPresetDays(p.days);
                setPage(1);
              }}
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

      {/* Top abused codes */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={cardTitle}>Top attempted codes</h3>
        <p style={cardSubtitle}>
          Highest-volume invalid (or blocked) attempts in the window. If the
          same code shows up across many distinct IPs / customers, treat as a
          probable leak.
        </p>
        {!topCodes || topCodes.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            No invalid attempts in this window.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Code</th>
                <th style={thRight}>Attempts</th>
                <th style={thRight}>Distinct customers</th>
                <th style={thRight}>Distinct IPs</th>
              </tr>
            </thead>
            <tbody>
              {topCodes.map((row) => (
                <tr key={row.codeAttempted} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{row.codeAttempted}</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>
                    {row.invalidCount.toLocaleString('en-IN')}
                  </td>
                  <td style={tdRight}>
                    {row.distinctCustomers.toLocaleString('en-IN')}
                  </td>
                  <td style={tdRight}>
                    {row.distinctIps.toLocaleString('en-IN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Attempts feed */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div>
            <h3 style={cardTitle}>Recent attempts</h3>
            <p style={cardSubtitle}>
              Every call to the validate endpoint is logged. Use the filter
              to focus on rejected attempts.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {RESULT_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  setResultFilter(f.value);
                  setPage(1);
                }}
                style={{
                  padding: '4px 10px',
                  border: resultFilter === f.value ? '1px solid #0F1115' : '1px solid #d1d5db',
                  background: resultFilter === f.value ? '#0F1115' : '#fff',
                  color: resultFilter === f.value ? '#fff' : '#374151',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading && !attempts && (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: 16 }}>Loading…</div>
        )}
        {attempts && attempts.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: 16 }}>
            No attempts in this window.
          </div>
        )}
        {attempts && attempts.length > 0 && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th}>When</th>
                  <th style={th}>Code</th>
                  <th style={th}>Result</th>
                  <th style={th}>Customer</th>
                  <th style={th}>IP</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>{fmtDateTime(row.createdAt)}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>
                      {row.codeAttempted}
                    </td>
                    <td style={td}>
                      <span style={resultPillStyle(row.result)}>
                        {row.result.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', color: '#6b7280' }}>
                      {truncate(row.customerId, 8)}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', color: '#6b7280' }}>
                      {truncate(row.ipAddress, 18)}
                    </td>
                    <td style={{ ...td, color: '#6b7280' }}>
                      {row.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 12,
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              <div>
                Page {page} of {Math.max(1, Math.ceil(total / 50))} · {total.toLocaleString('en-IN')} attempts total
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={pgBtn(page === 1)}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * 50 >= total}
                  style={pgBtn(page * 50 >= total)}
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
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
  fontSize: 12,
  color: '#374151',
  textAlign: 'left',
  verticalAlign: 'top',
};

const tdRight: React.CSSProperties = {
  ...td,
  textAlign: 'right',
};

const pgBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  border: '1px solid #d1d5db',
  background: disabled ? '#f3f4f6' : '#fff',
  color: disabled ? '#9ca3af' : '#374151',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
