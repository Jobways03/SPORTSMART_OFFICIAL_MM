'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatINR } from '../../../lib/api';

interface TdsRecord {
  id: string;
  affiliateId: string;
  financialYear: string;
  cumulativeGross: string;
  cumulativeTds: string;
  cumulativeNet: string;
  thresholdCrossedAt: string | null;
  updatedAt: string;
  createdAt: string;
  affiliate: { id: string; firstName: string; lastName: string; email: string };
}

interface PageData {
  records: TdsRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function TdsRecordsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fyFilter, setFyFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (fyFilter !== 'ALL') params.set('financialYear', fyFilter);
      const d = await apiFetch<PageData>(`/admin/affiliates/reports/tds?${params}`);
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load TDS records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyFilter, page]);

  // Distinct FY list (computed from current page only — fine for filter UX)
  const fyOptions = Array.from(
    new Set(['ALL', ...(data?.records.map((r) => r.financialYear) ?? [])]),
  );

  // Page-level totals
  const sums = (data?.records ?? []).reduce(
    (acc, r) => ({
      gross: acc.gross + Number(r.cumulativeGross),
      tds: acc.tds + Number(r.cumulativeTds),
      net: acc.net + Number(r.cumulativeNet),
    }),
    { gross: 0, tds: 0, net: 0 },
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          TDS records
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Per-affiliate, per-FY tax aggregations under §194H. Updated automatically each time
          a payout is marked paid.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Tile label="Records on page" value={String(data?.records.length ?? 0)} />
        <Tile label="Cumulative gross" value={formatINR(sums.gross)} tone="info" />
        <Tile label="Cumulative TDS" value={formatINR(sums.tds)} tone="danger" />
        <Tile label="Cumulative net" value={formatINR(sums.net)} tone="success" />
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Financial year</label>
        <select
          value={fyFilter}
          onChange={(e) => {
            setFyFilter(e.target.value);
            setPage(1);
          }}
          style={selectStyle}
        >
          {fyOptions.map((fy) => (
            <option key={fy} value={fy}>{fy === 'ALL' ? 'All years' : `FY ${fy}`}</option>
          ))}
        </select>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : !data || data.records.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📑</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>No TDS records yet</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Records appear here after the first payout is marked paid.
          </div>
        </div>
      ) : (
        <div style={{ overflow: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <Th>Affiliate</Th>
                <Th>FY</Th>
                <Th align="right">Cumulative gross</Th>
                <Th align="right">TDS deducted</Th>
                <Th align="right">Net paid</Th>
                <Th>Threshold crossed</Th>
                <Th>Last updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => {
                const above = Number(r.cumulativeGross) > 15000;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {r.affiliate.firstName} {r.affiliate.lastName}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{r.affiliate.email}</div>
                    </Td>
                    <Td>
                      <span style={{ padding: '2px 7px', fontSize: 11, fontWeight: 700, borderRadius: 4, background: '#f1f5f9', color: '#475569' }}>
                        FY {r.financialYear}
                      </span>
                    </Td>
                    <Td align="right" strong>{formatINR(r.cumulativeGross)}</Td>
                    <Td align="right" tone={Number(r.cumulativeTds) > 0 ? 'danger' : 'muted'}>
                      {Number(r.cumulativeTds) > 0 ? `−${formatINR(r.cumulativeTds)}` : '—'}
                    </Td>
                    <Td align="right" strong tone="success">{formatINR(r.cumulativeNet)}</Td>
                    <Td>
                      {r.thresholdCrossedAt ? (
                        <span style={{ color: '#15803d' }}>{formatDate(r.thresholdCrossedAt)}</span>
                      ) : above ? (
                        <span style={{ color: '#92400e' }}>Above ₹15k (TDS active)</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Below ₹15k threshold</span>
                      )}
                    </Td>
                    <Td>{formatDate(r.updatedAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#64748b' }}>
            Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} records
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1 }}>
              ‹ Previous
            </button>
            <button disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} style={{ ...btnGhost, opacity: page >= data.pagination.totalPages ? 0.4 : 1 }}>
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'info' | 'success' | 'danger' }) {
  const fg = tone === 'success' ? '#16a34a' : tone === 'danger' ? '#b91c1c' : tone === 'info' ? '#1d4ed8' : '#0f172a';
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
        {value}
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: align ?? 'left' }}>
      {children}
    </th>
  );
}

function Td({ children, align, strong, tone }: { children: React.ReactNode; align?: 'left' | 'right'; strong?: boolean; tone?: 'success' | 'danger' | 'muted' }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        verticalAlign: 'top',
        textAlign: align ?? 'left',
        fontWeight: strong ? 600 : 400,
        color:
          tone === 'success' ? '#15803d' :
          tone === 'danger' ? '#b91c1c' :
          tone === 'muted' ? '#94a3b8' :
          '#0f172a',
        fontVariantNumeric: align === 'right' ? 'tabular-nums' : 'normal',
      }}
    >
      {children}
    </td>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: '60px 20px',
  textAlign: 'center',
  background: '#fff',
  border: '1px dashed #cbd5e1',
  borderRadius: 14,
};

const errBox: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 12,
  color: '#991b1b',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 28px 7px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  fontWeight: 600,
  color: '#475569',
  background: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>\") no-repeat right 10px center #fff",
  appearance: 'none',
  cursor: 'pointer',
  outline: 'none',
};

const btnGhost: React.CSSProperties = {
  padding: '7px 14px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
