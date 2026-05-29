'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminQueuesService,
  QueueItem,
  QueueResource,
  QueueSummary,
  RiskTier,
  SlaState,
} from '@/services/admin-queues.service';
import { ApiError } from '@/lib/api-client';

const RESOURCES: QueueResource[] = ['dispute', 'return', 'ticket'];

const RESOURCE_LABEL: Record<QueueResource, string> = {
  dispute: 'Disputes',
  return: 'Returns',
  ticket: 'Tickets',
};

const RESOURCE_HREF: Record<QueueResource, (id: string) => string> = {
  dispute: (id) => `/dashboard/disputes/${id}`,
  return: (id) => `/dashboard/returns/${id}`,
  ticket: (id) => `/dashboard/support/${id}`,
};

const SLA_COLOR: Record<SlaState, { bg: string; fg: string; label: string }> = {
  OK: { bg: '#dcfce7', fg: '#166534', label: 'OK' },
  WARNING: { bg: '#fef3c7', fg: '#92400e', label: 'Warning' },
  BREACHED: { bg: '#fee2e2', fg: '#991b1b', label: 'Breached' },
  BREACHED_ESCALATE: { bg: '#fecaca', fg: '#7f1d1d', label: 'Escalate' },
  NO_POLICY: { bg: '#e5e7eb', fg: '#475569', label: 'No SLA' },
};

const TIER_COLOR: Record<RiskTier, { bg: string; fg: string }> = {
  LOW: { bg: '#e5e7eb', fg: '#475569' },
  MEDIUM: { bg: '#fef3c7', fg: '#92400e' },
  HIGH: { bg: '#fee2e2', fg: '#991b1b' },
};

function formatRemaining(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes <= 0) {
    const overdue = -minutes;
    if (overdue < 60) return `−${overdue}m`;
    if (overdue < 1440) return `−${(overdue / 60).toFixed(1)}h`;
    return `−${(overdue / 1440).toFixed(1)}d`;
  }
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export default function QueuesConsolePage() {
  const [summaries, setSummaries] = useState<QueueSummary[]>([]);
  const [active, setActive] = useState<QueueResource>('return');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [onlyBreaching, setOnlyBreaching] = useState(false);
  const [minTier, setMinTier] = useState<RiskTier | ''>('');
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await adminQueuesService.summary();
      setSummaries(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load summary');
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await adminQueuesService.list(active, {
        page,
        limit,
        onlyBreaching,
        minTier: minTier || undefined,
      });
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load queue');
      setItems([]);
      setTotal(0);
    } finally {
      setLoadingList(false);
    }
  }, [active, page, limit, onlyBreaching, minTier]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    // Resetting filters/tab should reset to page 1.
    setPage(1);
  }, [active, onlyBreaching, minTier]);

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1320, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Queues
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
          Live SLA + risk view across disputes, returns, and tickets.
          Click any row to jump to its detail page.
        </p>
      </header>

      {/* Summary tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {RESOURCES.map((r) => {
          const s = summaries.find((x) => x.resource === r);
          const isActive = r === active;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setActive(r)}
              style={{
                textAlign: 'left',
                background: isActive ? '#0F1115' : '#fff',
                color: isActive ? '#fff' : '#0f172a',
                border: `1px solid ${isActive ? '#0F1115' : '#e2e8f0'}`,
                borderRadius: 12,
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  opacity: 0.7,
                }}
              >
                {RESOURCE_LABEL[r]}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>
                  {loadingSummary ? '…' : s?.total ?? 0}
                </span>
                {s && (
                  <span style={{ fontSize: 11, opacity: 0.75 }}>
                    {s.breaching} breaching · {s.warning} warning · {s.highRisk} high-risk
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 14,
          padding: 12,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
        }}
      >
        <label style={{ fontSize: 13, color: '#475569', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={onlyBreaching}
            onChange={(e) => setOnlyBreaching(e.target.checked)}
          />
          Only breaching
        </label>
        <label style={{ fontSize: 13, color: '#475569', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Min risk tier
          <select
            value={minTier}
            onChange={(e) => setMinTier(e.target.value as RiskTier | '')}
            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">Any</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          {loadingList ? 'Loading…' : `${total} item${total === 1 ? '' : 's'}`}
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <section
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', textAlign: 'left' }}>
              <th style={th}>Number</th>
              <th style={th}>Status</th>
              <th style={th}>SLA</th>
              <th style={{ ...th, textAlign: 'right' }}>Remaining</th>
              <th style={th}>Risk</th>
              <th style={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loadingList && (
              <tr>
                <td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                  No items match these filters.
                </td>
              </tr>
            )}
            {items.map((it) => {
              const sla = SLA_COLOR[it.slaState];
              const tier = TIER_COLOR[it.riskTier];
              return (
                <tr key={it.resourceId} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>
                    <Link
                      href={RESOURCE_HREF[active](it.resourceId)}
                      style={{
                        color: '#1d4ed8',
                        textDecoration: 'none',
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      {it.number || it.resourceId.slice(0, 8)}
                    </Link>
                  </td>
                  <td style={{ ...td, color: '#475569' }}>{it.status}</td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: sla.bg,
                        color: sla.fg,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {sla.label}
                    </span>
                    {it.slaPolicyName && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>
                        {it.slaPolicyName}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: it.slaRemainingMinutes !== null && it.slaRemainingMinutes < 0 ? '#dc2626' : '#0f172a' }}>
                    {formatRemaining(it.slaRemainingMinutes)}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: tier.bg,
                        color: tier.fg,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {it.riskTier}
                    </span>
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>
                      score {it.riskScore}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#64748b' }}>
                    {new Date(it.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pageCount > 1 && (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderTop: '1px solid #f1f5f9',
              background: '#fafafa',
            }}
          >
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loadingList}
              style={pagerBtn}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loadingList}
              style={pagerBtn}
            >
              Next →
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const td: React.CSSProperties = {
  padding: '10px 14px',
};

const pagerBtn: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  background: '#fff',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};
