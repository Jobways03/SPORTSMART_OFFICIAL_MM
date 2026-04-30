'use client';

import { useEffect, useState } from 'react';
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
  affiliate?: { id: string; firstName: string; lastName: string; email: string };
}

interface PageData {
  commissions: Commission[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Totals {
  PENDING: { sum: string; count: number };
  HOLD: { sum: string; count: number };
  CONFIRMED: { sum: string; count: number };
  PAID: { sum: string; count: number };
  CANCELLED: { sum: string; count: number };
  REVERSED: { sum: string; count: number };
}

const FILTERS = ['ALL', 'PENDING', 'HOLD', 'CONFIRMED', 'PAID', 'CANCELLED', 'REVERSED'] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminCommissionsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (filter !== 'ALL') params.set('status', filter);
      if (search.trim()) params.set('search', search.trim());
      const [list, t] = await Promise.all([
        apiFetch<PageData>(`/admin/affiliates/commissions?${params}`),
        apiFetch<Totals>('/admin/affiliates/commissions/totals'),
      ]);
      setData(list);
      setTotals(t);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  return (
    <div style={{ maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Commissions</h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        Every affiliate commission across the platform.{' '}
        <button
          onClick={() => setLegendOpen((v) => !v)}
          style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}
        >
          {legendOpen ? 'Hide lifecycle' : 'How does the lifecycle work?'}
        </button>
      </p>

      {legendOpen && <LifecycleLegend />}

      {totals && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
          <Stat label="Pending" total={totals.PENDING} tone="warning" />
          <Stat label="Confirmed" total={totals.CONFIRMED} tone="info" />
          <Stat label="Paid" total={totals.PAID} tone="success" />
          <Stat label="On hold" total={totals.HOLD} tone="neutral" />
          <Stat label="Reversed" total={totals.REVERSED} tone="danger" />
          <Stat label="Cancelled" total={totals.CANCELLED} tone="neutral" />
        </section>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((s) => (
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
                border: '1px solid ' + (filter === s ? '#2563eb' : '#cbd5e1'),
                background: filter === s ? '#2563eb' : '#fff',
                color: filter === s ? '#fff' : '#475569',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={onSearchSubmit} style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, order, or affiliate"
            style={{ padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 260 }}
          />
          <button type="submit" style={btnPrimary}>Search</button>
        </form>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : !data || data.commissions.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
          No commissions match this filter yet.
        </div>
      ) : (
        <>
          <div style={{ overflow: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <Th />
                  <Th>Date</Th>
                  <Th>Affiliate</Th>
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
                      onActionDone={load}
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
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1 }}>
                  ‹ Previous
                </button>
                <button disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} style={{ ...btnGhost, opacity: page >= data.pagination.totalPages ? 0.4 : 1 }}>
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

function Row({
  commission: c,
  isOpen,
  onToggle,
  onActionDone,
}: {
  commission: Commission;
  isOpen: boolean;
  onToggle: () => void;
  onActionDone: () => void | Promise<void>;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ borderBottom: isOpen ? 'none' : '1px solid #f1f5f9', cursor: 'pointer' }}>
        <Td>
          <span style={{ display: 'inline-block', width: 14, color: '#94a3b8', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ›
          </span>
        </Td>
        <Td>{formatDate(c.createdAt)}</Td>
        <Td>
          <div style={{ fontWeight: 600 }}>
            {c.affiliate?.firstName} {c.affiliate?.lastName}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{c.affiliate?.email}</div>
        </Td>
        <Td>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{c.orderId.slice(0, 8)}…</span>
        </Td>
        <Td>
          <span style={sourcePill(c.source)}>{c.source}</span>
          {c.code && <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>{c.code}</span>}
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
        <Td><NextStep commission={c} /></Td>
      </tr>
      {isOpen && (
        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
          <td colSpan={10} style={{ padding: '14px 18px 22px', background: '#f8fafc' }}>
            <CommissionActions commission={c} onActionDone={onActionDone} />
            <Timeline commission={c} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Hold / Resume controls. Shown in the expanded row only when the
 * action is allowed for the current state:
 *   - "Place on hold"  visible from PENDING / CONFIRMED
 *   - "Resume from hold" visible from HOLD
 * Other states (PAID, CANCELLED, REVERSED) get nothing — those are
 * driven by the order/refund event handlers, not manual admin action.
 */
function CommissionActions({
  commission: c,
  onActionDone,
}: {
  commission: Commission;
  onActionDone: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'hold-input'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canHold = c.status === 'PENDING' || c.status === 'CONFIRMED';
  const canResume = c.status === 'HOLD';
  if (!canHold && !canResume) return null;

  const submitHold = async () => {
    setErr('');
    setBusy(true);
    try {
      await apiFetch(`/admin/affiliates/commissions/${c.id}/hold`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      setMode('idle');
      setReason('');
      await onActionDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not place on hold.');
    } finally {
      setBusy(false);
    }
  };

  const submitResume = async () => {
    setErr('');
    setBusy(true);
    try {
      await apiFetch(`/admin/affiliates/commissions/${c.id}/resume`, {
        method: 'PATCH',
      });
      await onActionDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not resume from hold.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 14,
        padding: '10px 12px',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Admin actions
        </span>
        {canHold && mode === 'idle' && (
          <button
            type="button"
            onClick={() => setMode('hold-input')}
            disabled={busy}
            style={btnGhostSmall}
          >
            Place on hold…
          </button>
        )}
        {canResume && (
          <button
            type="button"
            onClick={submitResume}
            disabled={busy}
            style={btnPrimarySmall}
          >
            {busy ? 'Resuming…' : 'Resume from hold'}
          </button>
        )}
      </div>

      {canHold && mode === 'hold-input' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Optional: why is this on hold? (visible to the affiliate)"
            disabled={busy}
            autoFocus
            style={{
              padding: '8px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              width: '100%',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={submitHold}
              disabled={busy}
              style={btnPrimarySmall}
            >
              {busy ? 'Holding…' : 'Confirm hold'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('idle');
                setReason('');
                setErr('');
              }}
              disabled={busy}
              style={btnGhostSmall}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {err && (
        <div role="alert" style={{ padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>
          {err}
        </div>
      )}
    </div>
  );
}

const btnPrimarySmall: React.CSSProperties = {
  padding: '6px 12px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhostSmall: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  color: '#475569',
  cursor: 'pointer',
};

function NextStep({ commission: c }: { commission: Commission }) {
  switch (c.status) {
    case 'PENDING': {
      if (!c.returnWindowEndsAt) return <Subtle>Awaiting delivery</Subtle>;
      const ends = new Date(c.returnWindowEndsAt);
      const now = new Date();
      if (ends > now) {
        return <span style={{ color: '#475569' }}>Auto-confirms in {countdown(ends, now)}</span>;
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
          Ready for payout{c.confirmedAt && <Subtle> · {formatDate(c.confirmedAt)}</Subtle>}
        </span>
      );
    case 'PAID':
      return <span style={{ color: '#15803d' }}>Paid {c.paidAt ? formatDate(c.paidAt) : ''}</span>;
    case 'CANCELLED':
      return <Subtle>Cancelled {c.cancelledAt ? formatDate(c.cancelledAt) : ''}</Subtle>;
    case 'REVERSED':
      return <span style={{ color: '#b91c1c' }}>Reversed {c.reversedAt ? formatDate(c.reversedAt) : ''}</span>;
    default:
      return <Subtle>—</Subtle>;
  }
}

function Timeline({ commission: c }: { commission: Commission }) {
  type Event = { label: string; at?: string | null; tone: 'done' | 'pending' | 'fail'; sub?: string };
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
      label: 'Auto-confirmed by cron',
      at: c.confirmedAt,
      tone: reachedConfirmed ? 'done' : 'pending',
      sub: 'AffiliateReturnWindowService sweeps every 60s. Once returnWindowEndsAt < now and the commission is still PENDING, it flips to CONFIRMED.',
    },
    {
      label: 'Paid out',
      at: c.paidAt,
      tone: reachedPaid ? 'done' : 'pending',
      sub: 'Bundled into a payout request the affiliate submits, transferred after admin marks paid.',
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
  if (c.status === 'CANCELLED') {
    events.push({
      label: 'Cancelled',
      at: c.cancelledAt ?? null,
      tone: 'fail',
      sub: 'Refund/cancellation killed this commission before payout.',
    });
  }
  if (c.status === 'REVERSED') {
    events.push({
      label: 'Reversed',
      at: c.reversedAt ?? null,
      tone: 'fail',
      sub: 'Refund happened after payout — clawback netted against the affiliate&rsquo;s next payout.',
    });
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, fontSize: 12, marginBottom: 14 }}>
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

      <h4 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>
        Lifecycle
      </h4>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {events.map((e, i) => (
          <li key={i} style={{ display: 'flex', gap: 12, marginBottom: i === events.length - 1 ? 0 : 14, position: 'relative' }}>
            <div style={{ flexShrink: 0, position: 'relative' }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                background: e.tone === 'done' ? '#16a34a' : e.tone === 'fail' ? '#dc2626' : '#cbd5e1',
                marginTop: 2,
              }} />
              {i !== events.length - 1 && (
                <div style={{
                  position: 'absolute',
                  left: 6,
                  top: 18,
                  bottom: -14,
                  width: 2,
                  background: e.tone === 'done' ? '#86efac' : '#e2e8f0',
                }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: e.tone === 'fail' ? '#b91c1c' : '#0f172a' }}>
                {e.label}
                {e.at && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                    {formatDateTime(e.at)}
                  </span>
                )}
                {!e.at && e.tone === 'pending' && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>not yet</span>
                )}
              </div>
              {e.sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{e.sub}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LifecycleLegend() {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Stage tone="warning">PENDING</Stage>
        <Arrow />
        <Stage tone="info">CONFIRMED</Stage>
        <Arrow />
        <Stage tone="success">PAID</Stage>
      </div>
      <div style={{ marginBottom: 4 }}>
        <strong style={{ color: '#0f172a' }}>PENDING → CONFIRMED:</strong>{' '}
        Driven by <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>AffiliateReturnWindowService</code> — runs every 60s,
        flips PENDING commissions to CONFIRMED once the order&rsquo;s return window closes without a refund.
      </div>
      <div style={{ marginBottom: 4 }}>
        <strong style={{ color: '#0f172a' }}>CONFIRMED → PAID:</strong>{' '}
        Affiliate submits a payout request (Payouts page); admin approves + marks paid → bundled commissions flip to PAID.
      </div>
      <div>
        <strong style={{ color: '#0f172a' }}>Side branches:</strong>{' '}
        <Stage tone="neutral" small>HOLD</Stage> on exchange-in-progress;{' '}
        <Stage tone="neutral" small>CANCELLED</Stage> on pre-payout refund;{' '}
        <Stage tone="danger" small>REVERSED</Stage> on post-payout refund (clawback nets against next payout).
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
    <span style={{
      padding: small ? '2px 7px' : '4px 10px',
      fontSize: small ? 10 : 11,
      fontWeight: 700,
      borderRadius: 999,
      background: palette.bg,
      color: palette.fg,
      letterSpacing: '0.5px',
    }}>
      {children}
    </span>
  );
}

function Arrow() {
  return <span style={{ color: '#94a3b8', fontSize: 14 }}>→</span>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, marginTop: 2, wordBreak: mono ? 'break-all' : 'normal', fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>
        {value}
      </div>
    </div>
  );
}

function Subtle({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#94a3b8' }}>{children}</span>;
}

function Stat({ label, total, tone }: { label: string; total: { sum: string; count: number }; tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger' }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'info' ? '#1d4ed8' :
    tone === 'danger' ? '#b91c1c' :
    '#64748b';
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: fg, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(total.sum)}
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
        {total.count} {total.count === 1 ? 'commission' : 'commissions'}
      </div>
    </div>
  );
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
    <span style={{ padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 999, background: p.bg, color: p.fg }} title={hold ?? undefined}>
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
  };
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: align ?? 'left' }}>
      {children}
    </th>
  );
}

function Td({ children, align, strong }: { children: React.ReactNode; align?: 'left' | 'right'; strong?: boolean }) {
  return (
    <td style={{
      padding: '10px 12px',
      verticalAlign: 'top',
      textAlign: align ?? 'left',
      fontWeight: strong ? 600 : 400,
      fontVariantNumeric: align === 'right' ? 'tabular-nums' : 'normal',
    }}>
      {children}
    </td>
  );
}

/**
 * Pick the most natural unit for a future deadline. Avoids the
 * Math.ceil-to-days bug where short windows (e.g. 120s in dev) were
 * rendered as "1 day". Seconds → minutes → hours → days.
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

const errBox: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 12,
  color: '#991b1b',
};

const btnPrimary: React.CSSProperties = {
  padding: '7px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
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
