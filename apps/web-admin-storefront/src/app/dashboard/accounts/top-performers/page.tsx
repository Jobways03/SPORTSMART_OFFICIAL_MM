'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  formatINR,
  TopPerformers,
  RankMetric,
  RankNodeType,
} from '@/services/admin-accounts.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

/**
 * Phase 179 (Top Performers Report audit) — the dedicated leaderboard the audit
 * found missing (#2). Adds the ranking-metric selector (#1), node-type scope
 * (#14), drill-down links to the per-node dashboards (#9), and CSV export (#10).
 * Money arrives as exact rupee strings — formatted, never parsed to math.
 */
export default function TopPerformersPage() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [metric, setMetric] = useState<RankMetric>('REVENUE');
  const [nodeType, setNodeType] = useState<RankNodeType>('ALL');
  const [limit] = useState(20);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<TopPerformers | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccountsService.getTopPerformers({
        limit, page, metric, nodeType,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (res.data) setData(res.data);
      else setErr(res.message || 'Failed to load top performers');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load top performers');
    } finally {
      setLoading(false);
    }
  }, [limit, page, metric, nodeType, fromDate, toDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [metric, nodeType, fromDate, toDate]);

  const csvHref = `${API_BASE}${adminAccountsService.topPerformersCsvUrl({ limit: 100, metric, nodeType, fromDate: fromDate || undefined, toDate: toDate || undefined })}`;
  const showSellers = nodeType === 'ALL' || nodeType === 'SELLER';
  const showFranchises = nodeType === 'ALL' || nodeType === 'FRANCHISE';

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Top performers</h1>
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 14, color: '#525A65' }}>
            Ranked leaderboard. Sellers and franchises are ranked separately on different revenue bases — see the methodology below.
          </p>
        </div>
        <a href={csvHref} download style={downloadBtn}>⬇ Export CSV</a>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 20 }}>
        <Field label="From"><input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Rank by">
          <Segmented<RankMetric> value={metric} onChange={setMetric} options={[['REVENUE', 'Revenue'], ['MARGIN', 'Margin']]} />
        </Field>
        <Field label="Show">
          <Segmented<RankNodeType> value={nodeType} onChange={setNodeType} options={[['ALL', 'Both'], ['SELLER', 'Sellers'], ['FRANCHISE', 'Franchises']]} />
        </Field>
      </div>

      {err && <div style={{ marginTop: 16, color: '#dc2626', fontSize: 13 }}>{err}</div>}

      {loading && !data ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : data ? (
        <>
          {showSellers && (
            <Section title="Top sellers" basis={data.revenueBasis?.sellers}>
              <table style={tableStyle}>
                <thead style={{ background: '#F9FAFB' }}>
                  <tr>
                    <th style={th}>#</th><th style={th}>Seller</th>
                    <th style={{ ...th, textAlign: 'right' }}>Orders</th>
                    <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...th, textAlign: 'right' }}>Margin</th>
                    <th style={{ ...th, textAlign: 'right' }}>Margin %</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {data.topSellers.length === 0 ? (
                    <tr><td colSpan={7} style={emptyTd}>No sellers for this period.</td></tr>
                  ) : data.topSellers.map((s) => (
                    <tr key={s.sellerId} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={{ ...td, fontWeight: 700 }}>{s.rank}</td>
                      <td style={td}>{s.sellerName}</td>
                      <td style={numTd}>{s.totalOrders}</td>
                      <td style={numTd}>{formatINR(s.totalRevenue)}</td>
                      <td style={numTd}>{formatINR(s.platformMargin)}</td>
                      <td style={numTd}>{s.marginPercentage}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Link href={`/dashboard/accounts/sellers/${s.sellerId}`} style={linkBtn}>View →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {showFranchises && (
            <Section title="Top franchises" basis={data.revenueBasis?.franchises}>
              <table style={tableStyle}>
                <thead style={{ background: '#F9FAFB' }}>
                  <tr>
                    <th style={th}>#</th><th style={th}>Franchise</th>
                    <th style={{ ...th, textAlign: 'right' }}>Online</th>
                    <th style={{ ...th, textAlign: 'right' }}>Procurements</th>
                    <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...th, textAlign: 'right' }}>Platform earning</th>
                    <th style={{ ...th, textAlign: 'right' }}>Margin %</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {data.topFranchises.length === 0 ? (
                    <tr><td colSpan={8} style={emptyTd}>No franchises for this period.</td></tr>
                  ) : data.topFranchises.map((f) => (
                    <tr key={f.franchiseId} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={{ ...td, fontWeight: 700 }}>{f.rank}</td>
                      <td style={td}>{f.franchiseName}</td>
                      <td style={numTd}>{f.totalOnlineOrders}</td>
                      <td style={numTd}>{f.totalProcurements}</td>
                      <td style={numTd}>{formatINR(f.totalRevenue)}</td>
                      <td style={numTd}>{formatINR(f.platformEarning)}</td>
                      <td style={numTd}>{f.marginPercentage}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Link href={`/dashboard/accounts/franchises/${f.franchiseId}`} style={linkBtn}>View →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Page {page}</span>
            <button onClick={() => setPage(page + 1)} style={pageBtn}>Next →</button>
          </div>

          {data.methodology && (
            <p style={{ marginTop: 18, fontSize: 11, color: '#9CA3AF', maxWidth: 900, lineHeight: 1.5 }}>
              <strong>Methodology:</strong> {data.methodology}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function Section({ title, basis, children }: { title: string; basis?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F1115', margin: '0 0 2px' }}>{title}</h2>
      {basis && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>Revenue basis: {basis}</div>}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #D2D6DC', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            background: value === v ? '#0F1115' : '#fff',
            color: value === v ? '#fff' : '#525A65',
            border: 'none', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#111827' };
const numTd: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const emptyTd: React.CSSProperties = { padding: 24, color: '#7A828F', textAlign: 'center' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#111827' };
const linkBtn: React.CSSProperties = { fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600 };
const downloadBtn: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 14px', textDecoration: 'none', background: '#fff' };
