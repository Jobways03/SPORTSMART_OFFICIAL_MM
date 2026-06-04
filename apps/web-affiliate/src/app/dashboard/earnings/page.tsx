'use client';

import { useEffect, useState } from 'react';
import { useSseStream } from '@sportsmart/ui';
import { apiFetch, formatDate, formatINR } from '../../../lib/api';

interface Commission {
  id: string;
  orderId: string;
  source: 'LINK' | 'COUPON';
  code?: string | null;
  orderSubtotal: string;
  commissionPercentage: string;
  commissionAmount: string;
  adjustedAmount: string;
  status: 'PENDING' | 'HOLD' | 'CONFIRMED' | 'PAID' | 'CANCELLED' | 'REVERSED';
  returnWindowEndsAt?: string | null;
  confirmedAt?: string | null;
  paidAt?: string | null;
  cancelledAt?: string | null;
  reversedAt?: string | null;
  holdReason?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Page {
  commissions: Commission[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Balances {
  pending: string;
  confirmed: string;
  paid: string;
  hold: string;
  counts: { pending: number; confirmed: number; paid: number; hold: number };
}

const STATUSES = ['ALL', 'PENDING', 'HOLD', 'CONFIRMED', 'PAID', 'CANCELLED', 'REVERSED'] as const;
type Filter = (typeof STATUSES)[number];

export default function EarningsPage() {
  const [data, setData] = useState<Page | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  // Bumped by the affiliate SSE stream to refetch balances + commissions
  // live when a commission is confirmed/reversed or a payout changes.
  const [refreshTick, setRefreshTick] = useState(0);

  useSseStream('/portal/streams/affiliate-earnings', {
    onMessage: () => setRefreshTick((t) => t + 1),
  });

  // Balances are independent of filter/page so fetch once (+ on live update).
  useEffect(() => {
    apiFetch<Balances>('/affiliate/me/balances')
      .then(setBalances)
      .catch(() => {
        // Hero shows '—' if balances fail; non-fatal.
      });
  }, [refreshTick]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (filter !== 'ALL') params.set('status', filter);
    if (search.trim()) params.set('search', search.trim());
    apiFetch<Page>(`/affiliate/me/commissions?${params}`)
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Could not load commissions.'))
      .finally(() => setLoading(false));
  }, [filter, page, search, refreshTick]);

  const total = data?.pagination.total ?? 0;
  const totalEarned =
    Number(balances?.pending ?? 0) +
    Number(balances?.confirmed ?? 0) +
    Number(balances?.paid ?? 0);

  return (
    <div style={{ maxWidth: 1100, marginInline: 'auto' }}>
      {/* ── Hero with balance KPIs ─────────────────────── */}
      <header
        style={{
          position: 'relative',
          padding: '26px 28px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #312e81 100%)',
          color: '#fff',
          borderRadius: 16,
          marginBottom: 18,
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: -50,
            top: -50,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6 }}>
            Affiliate · Earnings
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Your earnings
          </h1>
          <p style={{ fontSize: 13, color: '#cbd5e1', margin: '8px 0 16px', maxWidth: 560, lineHeight: 1.55 }}>
            Every commission earned, with its lifecycle status.{' '}
            <strong style={{ color: '#fff' }}>CONFIRMED</strong> commissions are eligible for payout.{' '}
            <button
              onClick={() => setLegendOpen((v) => !v)}
              style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, textDecoration: 'underline' }}
            >
              {legendOpen ? 'Hide lifecycle' : 'How does the lifecycle work?'}
            </button>
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <BalanceTile
              label="Pending"
              value={balances ? formatINR(balances.pending) : '—'}
              count={balances?.counts.pending ?? 0}
              tone="warning"
              hint="Awaiting return-window close"
            />
            <BalanceTile
              label="Confirmed"
              value={balances ? formatINR(balances.confirmed) : '—'}
              count={balances?.counts.confirmed ?? 0}
              tone="info"
              hint="Ready for payout"
            />
            <BalanceTile
              label="Paid"
              value={balances ? formatINR(balances.paid) : '—'}
              count={balances?.counts.paid ?? 0}
              tone="success"
              hint="Already settled"
            />
            <BalanceTile
              label="On hold"
              value={balances ? formatINR(balances.hold) : '—'}
              count={balances?.counts.hold ?? 0}
              tone="neutral"
              hint="Exchange in progress"
            />
          </div>

          {balances && totalEarned > 0 && (
            <div style={{ marginTop: 14, fontSize: 12, color: '#cbd5e1' }}>
              Lifetime earnings:{' '}
              <strong style={{ color: '#fff' }}>{formatINR(totalEarned)}</strong>
              {total > 0 && <> across {total} commission{total === 1 ? '' : 's'}</>}
            </div>
          )}
        </div>
      </header>

      {legendOpen && <LifecycleLegend />}

      {/* ── Toolbar: filter pills + search ──────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          marginBottom: 14,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setFilter(s);
                setPage(1);
              }}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                border: '1px solid ' + (filter === s ? '#2563eb' : '#e2e8f0'),
                background: filter === s ? '#2563eb' : '#f8fafc',
                color: filter === s ? '#fff' : '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {s === 'ALL' ? 'All' : s}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', position: 'relative', display: 'flex' }}>
          <span aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13, pointerEvents: 'none' }}>
            🔍
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Order or coupon code"
            style={{
              padding: '7px 12px 7px 32px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              minWidth: 220,
            }}
          />
        </div>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <ListSkeleton />
      ) : !data || data.commissions.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <Th />
                  <Th>Date</Th>
                  <Th>Order</Th>
                  <Th>Source</Th>
                  <Th align="right">Subtotal</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Commission</Th>
                  <Th>Status</Th>
                  <Th>Next step</Th>
                </tr>
              </thead>
              <tbody>
                {data.commissions.map((c) => {
                  const isOpen = expandedId === c.id;
                  return (
                    <Row
                      key={c.id}
                      commission={c}
                      isOpen={isOpen}
                      onToggle={() => setExpandedId(isOpen ? null : c.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.pagination.totalPages > 1 && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#64748b' }}>
                Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} total
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1 }}
                >
                  ‹ Previous
                </button>
                <button
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  style={{ ...btnGhost, opacity: page >= data.pagination.totalPages ? 0.4 : 1 }}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Hero balance tile ─────────────────────────────────── */

function BalanceTile({
  label,
  value,
  count,
  tone,
  hint,
}: {
  label: string;
  value: string;
  count: number;
  tone: 'success' | 'warning' | 'info' | 'neutral';
  hint?: string;
}) {
  const palette = {
    success: { fg: '#86efac', bg: 'rgba(34, 197, 94, 0.12)' },
    warning: { fg: '#fde68a', bg: 'rgba(245, 158, 11, 0.12)' },
    info: { fg: '#bfdbfe', bg: 'rgba(59, 130, 246, 0.12)' },
    neutral: { fg: '#cbd5e1', bg: 'rgba(148, 163, 184, 0.12)' },
  }[tone];
  return (
    <div
      title={hint}
      style={{
        padding: 12,
        background: palette.bg,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: palette.fg, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
        {count} {count === 1 ? 'commission' : 'commissions'}
      </div>
    </div>
  );
}

/* ── Table row + expanded timeline ─────────────────────── */

function Row({
  commission: c,
  isOpen,
  onToggle,
}: {
  commission: Commission;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: isOpen ? 'none' : '1px solid #f1f5f9',
          cursor: 'pointer',
          background: isOpen ? '#f8fafc' : '#fff',
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.background = '#f8fafc';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.background = '#fff';
        }}
      >
        <Td>
          <span style={{ display: 'inline-block', width: 14, color: '#94a3b8', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ›
          </span>
        </Td>
        <Td>{formatDate(c.createdAt)}</Td>
        <Td>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
            {c.orderId.slice(0, 8)}…
          </span>
        </Td>
        <Td>
          <span style={sourcePill(c.source)}>{c.source}</span>
          {c.code && (
            <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>{c.code}</span>
          )}
        </Td>
        <Td align="right">{formatINR(c.orderSubtotal)}</Td>
        <Td align="right">{Number(c.commissionPercentage).toFixed(2)}%</Td>
        <Td align="right" strong>
          {formatINR(c.adjustedAmount)}
          {c.adjustedAmount !== c.commissionAmount && (
            <div style={{ fontSize: 10, color: '#94a3b8', textDecoration: 'line-through', fontWeight: 400 }}>
              {formatINR(c.commissionAmount)}
            </div>
          )}
        </Td>
        <Td><CommissionStatusPill status={c.status} hold={c.holdReason} /></Td>
        <Td>
          <NextStep commission={c} />
        </Td>
      </tr>
      {isOpen && (
        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
          <td colSpan={9} style={{ padding: '16px 22px 24px', background: '#f8fafc' }}>
            <Timeline commission={c} />
          </td>
        </tr>
      )}
    </>
  );
}

function NextStep({ commission: c }: { commission: Commission }) {
  switch (c.status) {
    case 'PENDING': {
      if (!c.returnWindowEndsAt) {
        return <Subtle>Awaiting delivery confirmation</Subtle>;
      }
      const ends = new Date(c.returnWindowEndsAt);
      const now = new Date();
      if (ends > now) {
        return (
          <span style={{ color: '#475569' }}>
            Auto-confirms in {countdown(ends, now)}
          </span>
        );
      }
      return <Subtle>Confirming on next sweep…</Subtle>;
    }
    case 'HOLD':
      return (
        <span style={{ color: '#b91c1c' }} title={c.holdReason ?? undefined}>
          On hold{c.holdReason ? ` — ${c.holdReason.slice(0, 32)}${c.holdReason.length > 32 ? '…' : ''}` : ''}
        </span>
      );
    case 'CONFIRMED':
      return (
        <span style={{ color: '#15803d' }}>
          Ready for payout
          {c.confirmedAt && <Subtle> · {formatDate(c.confirmedAt)}</Subtle>}
        </span>
      );
    case 'PAID':
      return (
        <span style={{ color: '#15803d' }}>
          Paid {c.paidAt ? formatDate(c.paidAt) : ''}
        </span>
      );
    case 'CANCELLED':
      return (
        <Subtle>Cancelled {c.cancelledAt ? formatDate(c.cancelledAt) : ''}</Subtle>
      );
    case 'REVERSED':
      return (
        <span style={{ color: '#b91c1c' }}>
          Reversed {c.reversedAt ? formatDate(c.reversedAt) : ''}
        </span>
      );
    default:
      return <Subtle>—</Subtle>;
  }
}

function Timeline({ commission: c }: { commission: Commission }) {
  type Event = { label: string; at?: string | null; tone: 'done' | 'pending' | 'fail'; sub?: string };
  const isCancelled = c.status === 'CANCELLED';
  const isReversed = c.status === 'REVERSED';
  const reachedConfirmed = ['CONFIRMED', 'PAID', 'REVERSED'].includes(c.status);
  const reachedPaid = ['PAID', 'REVERSED'].includes(c.status);

  const events: Event[] = [
    { label: 'Order placed', at: c.createdAt, tone: 'done' },
    {
      label: 'Return window closes',
      at: c.returnWindowEndsAt ?? null,
      tone: c.returnWindowEndsAt && new Date(c.returnWindowEndsAt) < new Date() ? 'done' : 'pending',
      sub: c.returnWindowEndsAt
        ? new Date(c.returnWindowEndsAt) < new Date()
          ? 'Window closed — eligible for confirmation.'
          : 'Until then the commission stays PENDING (refund kills it).'
        : 'Set when the order is delivered.',
    },
    {
      label: 'Auto-confirmed',
      at: c.confirmedAt,
      tone: reachedConfirmed ? 'done' : 'pending',
      sub: 'Confirmed by the platform cron once the return window closes without a refund.',
    },
    {
      label: 'Paid out',
      at: c.paidAt,
      tone: reachedPaid ? 'done' : 'pending',
      sub: 'Bundled into a payout request you submit, transferred after admin approval.',
    },
  ];
  if (c.status === 'HOLD') {
    events.splice(1, 0, {
      label: 'Hold applied',
      at: c.createdAt,
      tone: 'fail',
      sub: c.holdReason ?? 'Exchange/manual review in progress.',
    });
  }
  if (isCancelled) {
    events.push({
      label: 'Cancelled',
      at: c.cancelledAt ?? null,
      tone: 'fail',
      sub: 'Refund/cancellation killed this commission before payout.',
    });
  }
  if (isReversed) {
    events.push({
      label: 'Reversed',
      at: c.reversedAt ?? null,
      tone: 'fail',
      sub: 'Refund happened after payout — clawback netted from your next payout.',
    });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 24 }}>
      <div>
        <h4 style={sectionLabel}>Detail</h4>
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <Detail label="Full order ID" value={c.orderId} mono />
          <Detail label="Source" value={`${c.source}${c.code ? ` · ${c.code}` : ''}`} />
          <Detail label="Order subtotal (post-discount)" value={formatINR(c.orderSubtotal)} />
          <Detail label="Commission rate" value={`${Number(c.commissionPercentage).toFixed(2)}%`} />
          {c.adjustedAmount !== c.commissionAmount && (
            <>
              <Detail label="Original commission" value={formatINR(c.commissionAmount)} />
              <Detail label="Adjusted commission" value={formatINR(c.adjustedAmount)} />
            </>
          )}
        </div>
      </div>

      <div>
        <h4 style={sectionLabel}>Lifecycle</h4>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {events.map((e, i) => (
            <li
              key={i}
              style={{ display: 'flex', gap: 12, marginBottom: i === events.length - 1 ? 0 : 14, position: 'relative' }}
            >
              <div style={{ flexShrink: 0, position: 'relative' }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background:
                      e.tone === 'done' ? '#16a34a' :
                      e.tone === 'fail' ? '#dc2626' :
                      '#cbd5e1',
                    border:
                      '2px solid ' +
                      (e.tone === 'done' ? '#16a34a' :
                       e.tone === 'fail' ? '#dc2626' :
                       '#cbd5e1'),
                    marginTop: 2,
                  }}
                />
                {i !== events.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 6,
                      top: 18,
                      bottom: -14,
                      width: 2,
                      background: e.tone === 'done' ? '#86efac' : '#e2e8f0',
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: e.tone === 'fail' ? '#b91c1c' : '#0f172a',
                  }}
                >
                  {e.label}
                  {e.at && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                      {formatDateTime(e.at)}
                    </span>
                  )}
                  {!e.at && e.tone === 'pending' && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                      not yet
                    </span>
                  )}
                </div>
                {e.sub && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>
                    {e.sub}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ── Lifecycle legend ──────────────────────────────────── */

function LifecycleLegend() {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 18,
        marginBottom: 14,
        fontSize: 12,
        color: '#475569',
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stage tone="warning">PENDING</Stage>
        <Arrow />
        <Stage tone="info">CONFIRMED</Stage>
        <Arrow />
        <Stage tone="success">PAID</Stage>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div>
          <strong style={{ color: '#0f172a' }}>PENDING → CONFIRMED:</strong>{' '}
          once the order&rsquo;s return window closes without a refund, an automated job promotes
          the commission. Usually 7 days after delivery.
        </div>
        <div>
          <strong style={{ color: '#0f172a' }}>CONFIRMED → PAID:</strong>{' '}
          only happens when you submit a payout request and admin marks the bank transfer complete.
        </div>
        <div>
          <strong style={{ color: '#0f172a' }}>Side branches:</strong>{' '}
          <Stage tone="neutral" small>HOLD</Stage> while an exchange is in progress;{' '}
          <Stage tone="neutral" small>CANCELLED</Stage> if a refund kills the order before payout;{' '}
          <Stage tone="danger" small>REVERSED</Stage> if a refund happens after payout (clawback nets against your next request).
        </div>
      </div>
    </div>
  );
}

function Stage({ children, tone, small }: { children: React.ReactNode; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger'; small?: boolean }) {
  const palette = {
    warning: { bg: '#fef3c7', fg: '#92400e' },
    info: { bg: '#dbeafe', fg: '#1e40af' },
    success: { bg: '#dcfce7', fg: '#15803d' },
    neutral: { bg: '#f1f5f9', fg: '#475569' },
    danger: { bg: '#fee2e2', fg: '#991b1b' },
  }[tone];
  return (
    <span
      style={{
        padding: small ? '2px 7px' : '4px 10px',
        fontSize: small ? 10 : 11,
        fontWeight: 700,
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        letterSpacing: '0.5px',
      }}
    >
      {children}
    </span>
  );
}

function Arrow() {
  return <span style={{ color: '#94a3b8', fontSize: 14 }}>→</span>;
}

/* ── Empty state + skeleton ────────────────────────────── */

function EmptyState({ filter }: { filter: Filter }) {
  const messages: Record<Filter, { emoji: string; title: string; sub: string }> = {
    ALL: { emoji: '🎯', title: 'No commissions yet', sub: 'The first sale through your code will land here.' },
    PENDING: { emoji: '⏳', title: 'No pending commissions', sub: 'Pending commissions appear here while their return window is open.' },
    HOLD: { emoji: '⏸️', title: 'No commissions on hold', sub: 'Commissions paused for exchanges or manual review will appear here.' },
    CONFIRMED: { emoji: '✅', title: 'No confirmed commissions', sub: 'Once a return window closes without a refund, the commission lands here.' },
    PAID: { emoji: '💰', title: 'No paid commissions', sub: 'Paid commissions show up here for record-keeping.' },
    CANCELLED: { emoji: '🚫', title: 'No cancelled commissions', sub: 'Pre-payout refunds park their cancelled commissions here.' },
    REVERSED: { emoji: '↩️', title: 'No reversed commissions', sub: 'Post-payout refunds park their reversed commissions here.' },
  };
  const m = messages[filter];
  return (
    <div
      style={{
        padding: '60px 24px',
        textAlign: 'center',
        background: '#fff',
        border: '1px dashed #cbd5e1',
        borderRadius: 14,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          margin: '0 auto 14px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
        }}
      >
        {m.emoji}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{m.title}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
        {m.sub}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 44,
            background: 'linear-gradient(90deg, #f8fafc, #f1f5f9, #f8fafc)',
            backgroundSize: '200% 100%',
            borderRadius: 8,
            marginBottom: i === 3 ? 0 : 8,
          }}
        />
      ))}
    </div>
  );
}

/* ── small helpers ─────────────────────────────────────── */

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          marginTop: 2,
          wordBreak: mono ? 'break-all' : 'normal',
          fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
          color: '#0f172a',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Subtle({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#94a3b8' }}>{children}</span>;
}

function CommissionStatusPill({ status, hold }: { status: Commission['status']; hold?: string | null }) {
  const palette: Record<Commission['status'], { bg: string; fg: string }> = {
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    HOLD: { bg: '#fef2f2', fg: '#b91c1c' },
    CONFIRMED: { bg: '#dbeafe', fg: '#1e40af' },
    PAID: { bg: '#dcfce7', fg: '#15803d' },
    CANCELLED: { bg: '#f1f5f9', fg: '#475569' },
    REVERSED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const p = palette[status];
  return (
    <span
      style={{
        padding: '3px 9px',
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        letterSpacing: '0.3px',
      }}
      title={hold ?? undefined}
    >
      {status}
    </span>
  );
}

function sourcePill(source: 'LINK' | 'COUPON'): React.CSSProperties {
  return {
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    background: source === 'LINK' ? '#dbeafe' : '#fce7f3',
    color: source === 'LINK' ? '#1e40af' : '#be185d',
    letterSpacing: '0.3px',
  };
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        padding: '12px 14px',
        fontSize: 11,
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        textAlign: align ?? 'left',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  strong,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  strong?: boolean;
}) {
  return (
    <td
      style={{
        padding: '12px 14px',
        verticalAlign: 'top',
        textAlign: align ?? 'left',
        fontWeight: strong ? 600 : 400,
        fontVariantNumeric: align === 'right' ? 'tabular-nums' : 'normal',
      }}
    >
      {children}
    </td>
  );
}

/**
 * Pick the most natural unit for a future deadline. Avoids the
 * round-up bug where 120s windows showed as "1 day".
 */
function countdown(ends: Date, now: Date): string {
  const ms = ends.getTime() - now.getTime();
  if (ms <= 0) return 'a moment';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 30) return 'a few seconds';
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  margin: '0 0 12px',
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

const btnGhost: React.CSSProperties = {
  padding: '7px 14px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
