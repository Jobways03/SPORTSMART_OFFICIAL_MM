'use client';

// Phase 13 (P1.14) — admin queue for replacement / exchange orders.
//
// Returns whose customerRemedy is REPLACEMENT or EXCHANGE land
// here. Tabs filter by replacementStatus so ops can:
//   - Pending stock check  → returns sitting on a stock-availability decision
//   - Awaiting payment      → exchange-with-pay-up; customer hasn't paid yet
//   - Awaiting fulfilment   → replacement order created, courier hand-off pending
//   - Fulfilled             → shipped + delivered
//   - Fallback to refund    → out of stock; admin needs to switch to refund
//
// Filtering happens client-side because the existing
// /admin/returns endpoint only filters on ReturnStatus, not on
// replacementStatus. That's fine for the volumes we expect; a
// proper server-side filter is a small follow-up if the queue
// gets long.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminReturnsService,
  ReturnListItem,
} from '@/services/admin-returns.service';

const TABS = [
  { key: 'PENDING_STOCK_CHECK', label: 'Pending stock check' },
  { key: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
  { key: 'AWAITING_FULFILMENT', label: 'Awaiting fulfilment' },
  { key: 'FULFILLED', label: 'Fulfilled' },
  { key: 'FALLBACK_TO_REFUND', label: 'Fallback to refund' },
  { key: 'ALL', label: 'All replacements' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const STATUS_COLOR: Record<string, string> = {
  PENDING_STOCK_CHECK: '#d97706',
  AWAITING_PAYMENT: '#9a3412',
  AWAITING_FULFILMENT: '#2A8595',
  FULFILLED: '#15803d',
  FALLBACK_TO_REFUND: '#b91c1c',
  CANCELLED: '#7A828F',
};

export default function ReplacementsPage() {
  const [tab, setTab] = useState<Tab>('PENDING_STOCK_CHECK');
  const [rows, setRows] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    // Pull a wide window of returns; client-side filter on
    // replacementStatus + customerRemedy below.
    adminReturnsService
      .listReturns({ page: 1, limit: 200 })
      .then((res) => {
        if (res.data) setRows(res.data.returns);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const onlyReplacements = rows.filter(
      (r) =>
        r.customerRemedy === 'REPLACEMENT' || r.customerRemedy === 'EXCHANGE',
    );
    if (tab === 'ALL') return onlyReplacements;
    return onlyReplacements.filter((r) => r.replacementStatus === tab);
  }, [rows, tab]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
        Replacements & exchanges
      </h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
        Returns whose admin picked REPLACEMENT or EXCHANGE at QC time.
        Filter by lifecycle status to see what action each one is
        waiting on.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '20px 0 12px' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 9999,
              border: tab === t.key ? '1px solid #0F1115' : '1px solid #D2D6DC',
              background: tab === t.key ? '#0F1115' : '#fff',
              color: tab === t.key ? '#fff' : '#0F1115',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        {loading && filtered.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
            Nothing in this tab.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
                <Th>Return</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Diff</Th>
                <Th>Replacement order</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const diffPaise = r.exchangePriceDiffPaise
                  ? Number(r.exchangePriceDiffPaise)
                  : 0;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <Td>
                      <Link
                        href={`/dashboard/returns/${r.id}`}
                        style={{ color: '#2A8595', fontWeight: 600 }}
                      >
                        {r.returnNumber}
                      </Link>
                    </Td>
                    <Td>{r.customerRemedy}</Td>
                    <Td>
                      <span style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 9999,
                        background: (STATUS_COLOR[r.replacementStatus ?? ''] ?? '#7A828F') + '22',
                        color: STATUS_COLOR[r.replacementStatus ?? ''] ?? '#7A828F',
                        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {r.replacementStatus?.replace(/_/g, ' ').toLowerCase() ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {diffPaise > 0
                        ? `₹${(diffPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </Td>
                    <Td style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {r.replacementOrderId ? r.replacementOrderId.slice(0, 8) + '…' : '—'}
                    </Td>
                    <Td style={{ color: '#525A65' }}>
                      {new Date(r.createdAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} matches · client-side filtered from the most recent 200 returns
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '12px 14px', verticalAlign: 'top', ...style }}>{children}</td>;
}
