'use client';

/**
 * Settlement cycles index — list + create new cycle.
 *
 * Backend endpoints:
 *   GET  /admin/settlements/cycles           — paginated list
 *   POST /admin/settlements/create-cycle     — kick off new cycle for period
 *
 * Each row deep-links to /finance/settlements/[id] for the full
 * cycle detail (per-seller margin breakdown, opening/closing balance,
 * Tally CSV export).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { paiseToRupeesString } from '@sportsmart/shared-utils';

interface SettlementCycle {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: string | number;
  totalAmountInPaise: string | number;
  totalMargin: string | number;
  totalMarginInPaise: string | number;
  sellerCount: number;
  createdAt: string;
}

interface CyclesResponse {
  items: SettlementCycle[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type Status = 'DRAFT' | 'PREVIEWED' | 'APPROVED' | 'PAID' | string;

const STATUS_TONE: Record<string, { color: string; chip: string }> = {
  DRAFT:     { color: '#525A65', chip: '#F3F4F6' },
  PREVIEWED: { color: '#1d4ed8', chip: '#dbeafe' },
  APPROVED: { color: '#15803d', chip: '#dcfce7' },
  PAID:     { color: '#7c3aed', chip: '#ede9fe' },
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

// ── Page ──────────────────────────────────────────────────────────

export default function SettlementCyclesPage() {
  const [items, setItems] = useState<SettlementCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<CyclesResponse>('/admin/settlements/cycles');
      const data = (res?.data as CyclesResponse) ?? (res as unknown as CyclesResponse);
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message || 'Failed to load settlement cycles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const cy of items) byStatus[cy.status] = (byStatus[cy.status] ?? 0) + 1;
    const totalSettled = items.reduce(
      (acc, cy) => acc + (typeof cy.totalAmountInPaise === 'string'
        ? BigInt(cy.totalAmountInPaise || '0')
        : BigInt(cy.totalAmountInPaise || 0)),
      BigInt(0),
    );
    const totalMargin = items.reduce(
      (acc, cy) => acc + (typeof cy.totalMarginInPaise === 'string'
        ? BigInt(cy.totalMarginInPaise || '0')
        : BigInt(cy.totalMarginInPaise || 0)),
      BigInt(0),
    );
    return {
      total: items.length,
      pending: (byStatus['DRAFT'] ?? 0) + (byStatus['PREVIEWED'] ?? 0),
      approved: byStatus['APPROVED'] ?? 0,
      paid: byStatus['PAID'] ?? 0,
      totalSettled: totalSettled.toString(),
      totalMargin: totalMargin.toString(),
    };
  }, [items]);

  return (
    <main style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Settlement cycles
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 720, lineHeight: 1.5 }}>
          Weekly aggregation of seller commissions into payable settlements. Click a row to see the
          per-seller margin breakdown, opening / closing balance, and Tally CSV export.
        </p>
      </div>

      <KpiStrip counts={counts} loading={loading && items.length === 0} />

      {error && (
        <div role="alert" style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 12, fontSize: 13,
          border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" style={{
            padding: 4, border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'inherit', opacity: 0.6, lineHeight: 1, fontSize: 16,
          }}>×</button>
        </div>
      )}

      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && items.length === 0 ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>Period</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Sellers</th>
                <th style={{ ...th, textAlign: 'right' }}>Settlement total</th>
                <th style={{ ...th, textAlign: 'right' }}>Platform margin</th>
                <th style={th}>Created</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((cy) => (
                <Row key={cy.id} cycle={cy} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: {
    total: number; pending: number; approved: number; paid: number;
    totalSettled: string; totalMargin: string;
  };
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total cycles"
        value={counts.total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Across all loaded weeks." />
      <Kpi label="Pending action"
        value={counts.pending.toLocaleString('en-IN')}
        tone={counts.pending > 0 ? 'warning' : 'muted'} loading={loading}
        hint="Draft + Previewed — awaiting approval." />
      <Kpi label="Approved (not paid)"
        value={counts.approved.toLocaleString('en-IN')}
        tone={counts.approved > 0 ? 'warning' : 'muted'} loading={loading}
        hint="Approved and ready for payout." />
      <Kpi label="Total settled"
        value={`₹${paiseToRupeesString(counts.totalSettled)}`}
        tone="neutral" loading={loading}
        hint="Sum across loaded cycles." />
      <Kpi label="Platform margin"
        value={`₹${paiseToRupeesString(counts.totalMargin)}`}
        tone="success" loading={loading}
        hint="Sum of commission earnings." />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: KPI_TONE[tone],
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function Row({ cycle: cy }: { cycle: SettlementCycle }) {
  const tone = STATUS_TONE[cy.status] ?? { color: '#525A65', chip: '#F3F4F6' };
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {fmtDate(cy.periodStart)} <span style={{ color: '#7A828F', fontWeight: 400 }}>→</span> {fmtDate(cy.periodEnd)}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {cy.id.slice(0, 8)}…
        </div>
      </td>
      <td style={td}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 22, padding: '0 10px', borderRadius: 9999,
          background: tone.chip, color: tone.color,
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone.color }} />
          {cy.status}
        </span>
      </td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {cy.sellerCount ?? '—'}
      </td>
      <td style={{
        ...td, textAlign: 'right', fontWeight: 700, color: '#0F1115',
        fontVariantNumeric: 'tabular-nums',
      }}>
        ₹{paiseToRupeesString(cy.totalAmountInPaise)}
      </td>
      <td style={{
        ...td, textAlign: 'right', color: '#15803d', fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}>
        ₹{paiseToRupeesString(cy.totalMarginInPaise)}
      </td>
      <td style={{ ...td, color: '#525A65' }}
          title={new Date(cy.createdAt).toLocaleString('en-IN')}>
        {relTime(new Date(cy.createdAt))}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Link href={`/dashboard/finance/settlements/${cy.id}`} style={btnPrimary}>
          View detail <ArrowRight />
        </Link>
      </td>
    </tr>
  );
}

// ── Empty / skeleton ──────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <BanknoteIcon />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>No settlement cycles yet</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>
        Cycles are created weekly by the settlements cron.
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 180, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 60, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1 }} />
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 110, height: 32, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function ArrowRight({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function BanknoteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// ── Shared styles ─────────────────────────────────────────────────

const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 32, padding: '0 14px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, textDecoration: 'none',
  whiteSpace: 'nowrap',
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'middle',
};
