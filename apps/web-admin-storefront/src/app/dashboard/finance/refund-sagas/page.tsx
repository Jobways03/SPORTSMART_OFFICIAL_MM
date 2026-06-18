'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/lib/permissions';
import {
  adminRefundSagasService,
  RefundSagaRow,
  RefundSagaStatus,
} from '@/services/admin-refund-sagas.service';

/**
 * Story 4.1 follow-up — live queue of in-flight refund sagas. The
 * stuck-saga sweep cron handles escalation, but operators want a
 * direct view of what's running, failing, and compensating right now.
 *
 * Read-only — state transitions still belong to RefundSagaService and
 * the cron sweep. Operators who need to retry a stuck saga use the
 * admin task created by the cron escalation flow.
 */
export default function RefundSagasPage() {
  return (
    <RequirePermission
      anyOf={['refunds.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

// The backend treats an absent `status` as "non-terminal only", so a true
// "All" must send the explicit full status list (otherwise COMPLETED /
// COMPENSATED rows silently never show under the old empty-string "All").
const STATUS_ALL =
  'STARTED,IN_PROGRESS,COMPENSATING,COMPENSATED,COMPENSATION_FAILED,FAILED,COMPLETED';
const STATUS_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'In flight (active)', value: 'STARTED,IN_PROGRESS' },
  { label: 'Open (incl. failed)', value: 'STARTED,IN_PROGRESS,FAILED' },
  { label: 'Started', value: 'STARTED' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Compensated', value: 'COMPENSATED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'All statuses', value: STATUS_ALL },
];

function Inner() {
  const [statusFilter, setStatusFilter] = useState<string>('STARTED,IN_PROGRESS,FAILED');
  const [stuckOnly, setStuckOnly] = useState(false);
  const [rows, setRows] = useState<RefundSagaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefundSagaRow | null>(null);
  const [counts, setCounts] = useState<SagaCounts>({
    inflight: null,
    failed: null,
    stuck: null,
    completed: null,
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const limit = 50;

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminRefundSagasService.list({
        status: statusFilter || undefined,
        stuckOnly,
        page,
        limit,
      });
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
      }
      setLastUpdated(new Date());
    } catch (e: any) {
      setErr(e?.message || 'Failed to load sagas');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, stuckOnly, page]);

  // Best-effort headline counts for the KPI strip — four cheap total-only
  // probes. Decorative, so failures are swallowed rather than surfaced.
  const fetchCounts = useCallback(async () => {
    try {
      const [inflight, failed, stuck, completed] = await Promise.all([
        adminRefundSagasService.list({ status: 'STARTED,IN_PROGRESS', page: 1, limit: 1 }),
        adminRefundSagasService.list({ status: 'FAILED', page: 1, limit: 1 }),
        adminRefundSagasService.list({ stuckOnly: true, page: 1, limit: 1 }),
        adminRefundSagasService.list({ status: 'COMPLETED', page: 1, limit: 1 }),
      ]);
      setCounts({
        inflight: inflight.data?.total ?? 0,
        failed: failed.data?.total ?? 0,
        stuck: stuck.data?.total ?? 0,
        completed: completed.data?.total ?? 0,
      });
    } catch {
      // counts are decoration — ignore
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const refreshAll = useCallback(() => {
    fetchRows();
    fetchCounts();
  }, [fetchRows, fetchCounts]);

  const applyKpi = (kind: 'inflight' | 'failed' | 'stuck' | 'completed') => {
    setPage(1);
    if (kind === 'inflight') {
      setStuckOnly(false);
      setStatusFilter('STARTED,IN_PROGRESS');
    } else if (kind === 'failed') {
      setStuckOnly(false);
      setStatusFilter('FAILED');
    } else if (kind === 'stuck') {
      setStuckOnly(true);
      setStatusFilter('STARTED,IN_PROGRESS,FAILED');
    } else {
      setStuckOnly(false);
      setStatusFilter('COMPLETED');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const activeKpi: string | null = stuckOnly
    ? 'stuck'
    : statusFilter === 'STARTED,IN_PROGRESS'
      ? 'inflight'
      : statusFilter === 'FAILED'
        ? 'failed'
        : statusFilter === 'COMPLETED'
          ? 'completed'
          : null;

  return (
    <div style={pageWrap}>
      <style>{`.saga-row td{transition:background .12s ease}.saga-row:hover td{background:#f8fafc}.saga-skel{display:block;height:12px;border-radius:4px;background:#eef2f7;animation:sagaPulse 1.2s ease-in-out infinite}@keyframes sagaPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>

      <header style={headerRow}>
        <div>
          <div style={titleRow}>
            <h1 style={pageTitle}>Refund Sagas</h1>
            <span style={readOnlyChip}>Read-only</span>
          </div>
          <p style={pageSubtitle}>
            Live queue of refund sagas — what’s running, failing, and compensating right now.
            The sweep cron auto-escalates anything stuck into admin tasks.
          </p>
        </div>
        <div style={headerActions}>
          {lastUpdated && <span style={lastUpdatedText}>Updated {formatClock(lastUpdated)}</span>}
          <button type="button" onClick={refreshAll} disabled={loading} style={btnSecondary(loading)}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <div style={kpiStrip}>
        <KpiCard label="In flight" hint="Actively processing" value={counts.inflight} tone="blue" active={activeKpi === 'inflight'} onClick={() => applyKpi('inflight')} />
        <KpiCard label="Failed" hint="Needs attention" value={counts.failed} tone="red" active={activeKpi === 'failed'} onClick={() => applyKpi('failed')} />
        <KpiCard label="Stuck > 15 min" hint="Escalation candidates" value={counts.stuck} tone="amber" active={activeKpi === 'stuck'} onClick={() => applyKpi('stuck')} />
        <KpiCard label="Completed" hint="Settled successfully" value={counts.completed} tone="green" active={activeKpi === 'completed'} onClick={() => applyKpi('completed')} />
      </div>

      <div style={toolbar}>
        <label style={labelWrap}>
          <span style={labelSpan}>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            style={inputStyle}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label style={checkboxWrap}>
          <input
            type="checkbox"
            checked={stuckOnly}
            onChange={(e) => {
              setStuckOnly(e.target.checked);
              setPage(1);
            }}
          />
          <span style={{ ...labelSpan, textTransform: 'none' }}>Stuck only (&gt;15 min)</span>
        </label>
        <span style={resultCount}>
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {err && <div style={errBanner}>{err}</div>}

      <div style={tableCard}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={th}>Started</th>
              <th style={th}>Status</th>
              <th style={th}>Type</th>
              <th style={th}>Source / Instruction</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={{ ...th, textAlign: 'right' }}>Age</th>
              <th style={{ ...th, textAlign: 'right' }}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={tdEmpty}>
                  <EmptyState />
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const stuck = isStuck(r);
                return (
                  <tr key={r.id} className="saga-row" style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ ...tdStyle, borderLeft: `3px solid ${stuck ? '#f59e0b' : 'transparent'}` }}>
                      {formatWhen(r.startedAt)}
                    </td>
                    <td style={tdStyle}>
                      <span style={statusPill(r.status)}>{r.status}</span>
                    </td>
                    <td style={tdStyle}>{r.refundType}</td>
                    <td style={tdStyle}>
                      <div><code style={inlineCode}>{r.sourceId}</code></div>
                      {r.instructionId && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                          → <code style={inlineCode}>{r.instructionId.slice(0, 8)}…</code>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {formatPaise(r.amountInPaise)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {stuck ? (
                        <span style={stuckBadge}>⚠ {formatAge(r.ageMs)}</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>{formatAge(r.ageMs)}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button type="button" onClick={() => setSelected(r)} style={btnInspect}>
                        Inspect →
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={pagerRow}>
        <span>
          {total === 0
            ? 'No results'
            : `Page ${page} of ${totalPages} · ${total.toLocaleString()} total`}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={btnPager(page <= 1)}>
            ← Prev
          </button>
          <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={btnPager(page >= totalPages)}>
            Next →
          </button>
        </span>
      </div>

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

type SagaCounts = {
  inflight: number | null;
  failed: number | null;
  stuck: number | null;
  completed: number | null;
};

const KPI_TONES: Record<'blue' | 'red' | 'amber' | 'green', string> = {
  blue: '#2563eb',
  red: '#dc2626',
  amber: '#d97706',
  green: '#16a34a',
};

function KpiCard({
  label,
  hint,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  value: number | null;
  tone: 'blue' | 'red' | 'amber' | 'green';
  active: boolean;
  onClick: () => void;
}) {
  const accent = KPI_TONES[tone];
  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={kpiCard(active, accent)}>
      <span style={kpiTop}>
        <span style={{ ...kpiDot, background: accent }} aria-hidden />
        <span style={kpiLabel}>{label}</span>
      </span>
      <span style={kpiValue}>{value === null ? '—' : value.toLocaleString()}</span>
      <span style={kpiHint}>{hint}</span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
          {Array.from({ length: 7 }).map((__, j) => (
            <td key={j} style={tdStyle}>
              <span className="saga-skel" style={{ width: j === 3 ? '70%' : '55%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '20px 0' }}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
        No refund sagas match these filters
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        Try a different status, or clear the “Stuck only” filter.
      </div>
    </div>
  );
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const pageWrap: React.CSSProperties = { padding: 24, maxWidth: 1200 };
const headerRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 16,
};
const titleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const pageTitle: React.CSSProperties = { fontSize: 22, fontWeight: 700, margin: 0, color: '#111827' };
const readOnlyChip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#475569',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  padding: '2px 8px',
  borderRadius: 999,
};
const pageSubtitle: React.CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
  margin: '6px 0 0',
  maxWidth: 680,
  lineHeight: 1.5,
};
const headerActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const lastUpdatedText: React.CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
  fontVariantNumeric: 'tabular-nums',
};
const kpiStrip: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 12,
  marginBottom: 16,
};
function kpiCard(active: boolean, accent: string): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    textAlign: 'left',
    padding: '12px 14px',
    borderRadius: 10,
    cursor: 'pointer',
    background: active ? '#f8fafc' : '#fff',
    border: `1px solid ${active ? accent : '#e5e7eb'}`,
    boxShadow: active ? `inset 0 0 0 1px ${accent}` : '0 1px 2px rgba(15,23,42,0.04)',
    transition: 'border-color .12s, box-shadow .12s',
  };
}
const kpiTop: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const kpiDot: React.CSSProperties = { width: 8, height: 8, borderRadius: 999, flexShrink: 0 };
const kpiLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const kpiValue: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: '#111827',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.1,
};
const kpiHint: React.CSSProperties = { fontSize: 11, color: '#9ca3af' };
const toolbar: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  marginBottom: 12,
};
const checkboxWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};
const resultCount: React.CSSProperties = {
  marginLeft: 'auto',
  alignSelf: 'center',
  fontSize: 12,
  color: '#6b7280',
};
const tableCard: React.CSSProperties = {
  marginTop: 4,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  overflow: 'hidden',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
};
const stuckBadge: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 7px',
  fontSize: 11,
  fontWeight: 600,
  color: '#92400e',
  background: '#fef3c7',
  borderRadius: 999,
};
const btnInspect: React.CSSProperties = {
  padding: '4px 10px',
  background: '#fff',
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const pagerRow: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: '#6b7280',
};

function DetailDrawer({ row, onClose }: { row: RefundSagaRow; onClose: () => void }) {
  return (
    <div style={drawerOverlay} onClick={onClose}>
      <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={drawerHeader}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Saga {row.id.slice(0, 8)}…</h2>
          <button type="button" onClick={onClose} style={btnLink}>Close ✕</button>
        </div>
        <div style={drawerBody}>
        <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 6, columnGap: 12, fontSize: 13 }}>
          <dt style={dtStyle}>Status</dt>
          <dd style={ddStyle}>
            <span style={statusPill(row.status)}>{row.status}</span>
          </dd>
          <dt style={dtStyle}>Type</dt>
          <dd style={ddStyle}>{row.refundType}</dd>
          <dt style={dtStyle}>Source ID</dt>
          <dd style={ddStyle}><code style={inlineCode}>{row.sourceId}</code></dd>
          <dt style={dtStyle}>Instruction</dt>
          <dd style={ddStyle}>
            {row.instructionId ? <code style={inlineCode}>{row.instructionId}</code> : '—'}
          </dd>
          <dt style={dtStyle}>Customer</dt>
          <dd style={ddStyle}><code style={inlineCode}>{row.customerId}</code></dd>
          <dt style={dtStyle}>Amount</dt>
          <dd style={{ ...ddStyle, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {formatPaise(row.amountInPaise)}
          </dd>
          <dt style={dtStyle}>Started</dt>
          <dd style={ddStyle}>{formatWhen(row.startedAt)}</dd>
          <dt style={dtStyle}>Completed</dt>
          <dd style={ddStyle}>{row.completedAt ? formatWhen(row.completedAt) : '—'}</dd>
          {row.failureReason && (
            <>
              <dt style={dtStyle}>Failure reason</dt>
              <dd style={{ ...ddStyle, color: '#991b1b' }}>{row.failureReason}</dd>
            </>
          )}
        </dl>
        <SagaStepList title="Steps" items={row.steps} />
        {row.compensations !== null && row.compensations !== undefined && (
          <SagaStepList title="Compensations" items={row.compensations} isCompensation />
        )}
        </div>
      </div>
    </div>
  );
}

function isStuck(r: RefundSagaRow): boolean {
  if (r.status === 'COMPLETED' || r.status === 'COMPENSATED') return false;
  return r.ageMs > 15 * 60 * 1000;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function formatPaise(paiseStr: string): string {
  // Server sends paise as a BigInt-safe string. Display as ₹X,XXX.XX.
  // Number() loses precision above 2^53 paise (~₹90T), which we won't hit
  // for a single refund — order totals are bounded.
  const rupees = Number(paiseStr) / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusPill(s: RefundSagaStatus): React.CSSProperties {
  const palette: Record<RefundSagaStatus, { bg: string; fg: string }> = {
    STARTED: { bg: '#dbeafe', fg: '#1e3a8a' },
    IN_PROGRESS: { bg: '#fef3c7', fg: '#92400e' },
    COMPLETED: { bg: '#dcfce7', fg: '#166534' },
    FAILED: { bg: '#fee2e2', fg: '#991b1b' },
    COMPENSATED: { bg: '#f3e8ff', fg: '#6b21a8' },
  };
  const c = palette[s] ?? { bg: '#f3f4f6', fg: '#6b7280' };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.fg,
    borderRadius: 999,
  };
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  color: '#111827',
  verticalAlign: 'top',
};
const tdEmpty: React.CSSProperties = {
  padding: '24px 10px',
  textAlign: 'center',
  color: '#6b7280',
  fontSize: 13,
};
const inlineCode: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  background: '#f3f4f6',
  padding: '1px 5px',
  borderRadius: 4,
};
const labelWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelSpan: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  minWidth: 180,
};
const errBanner: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 12px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 13,
  color: '#991b1b',
};
const drawerOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.45)',
  display: 'flex',
  justifyContent: 'flex-end',
  // Above the fixed app navbar (z-index 200) so the drawer's own header
  // + Close button aren't hidden behind it.
  zIndex: 300,
};
const drawerPanel: React.CSSProperties = {
  width: 'min(640px, 100%)',
  height: '100%',
  background: '#fff',
  // Padding lives on the header + body so the sticky header can be
  // full-bleed without negative-margin overlap.
  padding: 0,
  overflow: 'auto',
  boxShadow: '-10px 0 30px rgba(15,23,42,0.2)',
};
// Full-bleed sticky header so the Saga title + Close stay visible while
// the (potentially long) step list scrolls.
const drawerHeader: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: '#fff',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 20px',
  borderBottom: '1px solid #e5e7eb',
};
const drawerBody: React.CSSProperties = { padding: '16px 20px 24px' };
const dtStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  alignSelf: 'baseline',
};
const ddStyle: React.CSSProperties = { margin: 0 };
const preStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 12,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  maxHeight: 320,
  overflow: 'auto',
};
const btnLink: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#2563eb',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
};

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    background: '#fff',
    color: '#111827',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
function btnPager(disabled: boolean): React.CSSProperties {
  return {
    height: 24,
    padding: '0 10px',
    background: '#fff',
    color: '#374151',
    fontSize: 12,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

// ── Saga step timeline ───────────────────────────────────────────────
// The server persists `steps` / `compensations` as opaque JSON. Rather
// than dump the raw blob, render each step as a status-dotted timeline
// row (humanised name, duration, result surfaced as labelled chips,
// errors highlighted). The raw JSON stays one click away for power
// users. Falls back to the JSON dump if the payload isn't an array.

interface SagaStepRecordLike {
  name?: string;
  status?: string;
  attempts?: number;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  reversesStep?: string;
}

function SagaStepList({
  title,
  items,
  isCompensation,
}: {
  title: string;
  items: unknown;
  isCompensation?: boolean;
}) {
  const list = Array.isArray(items) ? (items as SagaStepRecordLike[]) : null;
  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
        {list && list.length > 0 && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>{summarizeSteps(list)}</span>
        )}
      </div>
      {!list ? (
        <pre style={preStyle}>{JSON.stringify(items, null, 2)}</pre>
      ) : list.length === 0 ? (
        <div style={stepEmpty}>No {title.toLowerCase()} recorded.</div>
      ) : (
        <>
          <ol style={timelineList}>
            {list.map((s, i) => (
              <StepRow
                key={i}
                step={s}
                isLast={i === list.length - 1}
                isCompensation={isCompensation}
              />
            ))}
          </ol>
          <details style={{ marginTop: 8 }}>
            <summary style={rawSummary}>Raw JSON</summary>
            <pre style={{ ...preStyle, marginTop: 6 }}>{JSON.stringify(items, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}

function StepRow({
  step,
  isLast,
  isCompensation,
}: {
  step: SagaStepRecordLike;
  isLast: boolean;
  isCompensation?: boolean;
}) {
  const status = step.status ?? 'PENDING';
  const ms = stepDurationMs(step);
  const resultEntries = resultToEntries(step.result);
  return (
    <li style={stepItem}>
      <div style={stepRail}>
        <span style={stepDot(status)} aria-hidden>
          {stepGlyph(status)}
        </span>
        {!isLast && <span style={stepConnector} />}
      </div>
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14, minWidth: 0 }}>
        <div style={stepHeadRow}>
          <span style={stepName}>{humanizeStep(step.name ?? 'step')}</span>
          {ms !== null && <span style={stepDuration}>{formatMs(ms)}</span>}
        </div>
        <div style={stepMetaRow}>
          <span style={stepStatusBadge(status)}>{status}</span>
          {typeof step.attempts === 'number' && step.attempts > 1 && (
            <span style={metaChip}>{step.attempts} attempts</span>
          )}
          {isCompensation && step.reversesStep && (
            <span style={metaChip}>reverses {humanizeStep(step.reversesStep)}</span>
          )}
        </div>
        {resultEntries.length > 0 && (
          <div style={resultWrap}>
            {resultEntries.map(([k, v]) => (
              <div key={k} style={resultChip}>
                <span style={resultKey}>{humanizeKey(k)}</span>
                <code style={resultVal}>{v}</code>
              </div>
            ))}
          </div>
        )}
        {step.error && <div style={stepError}>⚠ {step.error}</div>}
      </div>
    </li>
  );
}

function summarizeSteps(list: SagaStepRecordLike[]): string {
  const total = list.length;
  const ok = list.filter((s) => s.status === 'SUCCEEDED').length;
  const failed = list.filter((s) => s.status === 'FAILED').length;
  if (ok === total) return total === 1 ? 'all succeeded' : `all ${total} succeeded`;
  const parts = [`${ok}/${total} succeeded`];
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

function resultToEntries(result: unknown): Array<[string, string]> {
  if (result === null || result === undefined) return [];
  if (typeof result !== 'object') return [['value', String(result)]];
  return Object.entries(result as Record<string, unknown>).map(([k, v]) => [
    k,
    typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
  ]);
}

function stepDurationMs(s: SagaStepRecordLike): number | null {
  if (!s.startedAt || !s.completedAt) return null;
  const ms = new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function humanizeStep(name: string): string {
  const words = name.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Step';
}

function humanizeKey(k: string): string {
  const spaced = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .toLowerCase()
    .trim();
  const cap = spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : k;
  return cap.replace(/\bid\b/g, 'ID');
}

function stepGlyph(status: string): string {
  switch (status) {
    case 'SUCCEEDED':
      return '✓';
    case 'FAILED':
      return '✕';
    case 'IN_PROGRESS':
      return '⟳';
    case 'COMPENSATED':
      return '↩';
    case 'SKIPPED':
      return '–';
    default:
      return '○';
  }
}

function stepPalette(status: string): { bg: string; fg: string; ring: string } {
  switch (status) {
    case 'SUCCEEDED':
      return { bg: '#dcfce7', fg: '#166534', ring: '#86efac' };
    case 'FAILED':
      return { bg: '#fee2e2', fg: '#991b1b', ring: '#fca5a5' };
    case 'IN_PROGRESS':
      return { bg: '#fef3c7', fg: '#92400e', ring: '#fcd34d' };
    case 'COMPENSATED':
      return { bg: '#f3e8ff', fg: '#6b21a8', ring: '#d8b4fe' };
    case 'SKIPPED':
      return { bg: '#f3f4f6', fg: '#6b7280', ring: '#d1d5db' };
    default:
      return { bg: '#f1f5f9', fg: '#475569', ring: '#cbd5e1' };
  }
}

const timelineList: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };
const stepItem: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'stretch' };
const stepRail: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: 24,
};
const stepConnector: React.CSSProperties = {
  flex: 1,
  width: 2,
  background: '#e5e7eb',
  marginTop: 2,
  borderRadius: 1,
};
function stepDot(status: string): React.CSSProperties {
  const c = stepPalette(status);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    flexShrink: 0,
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.ring}`,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
  };
}
const stepHeadRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
};
const stepName: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#111827' };
const stepDuration: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};
const stepMetaRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
  alignItems: 'center',
};
function stepStatusBadge(status: string): React.CSSProperties {
  const c = stepPalette(status);
  return {
    display: 'inline-block',
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.03em',
    background: c.bg,
    color: c.fg,
    borderRadius: 999,
  };
}
const metaChip: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 7px',
  fontSize: 10,
  fontWeight: 600,
  background: '#f3f4f6',
  color: '#4b5563',
  borderRadius: 999,
};
const resultWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
};
const resultChip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const resultKey: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 110,
};
const resultVal: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#111827',
  background: '#f3f4f6',
  padding: '1px 6px',
  borderRadius: 4,
  wordBreak: 'break-all',
};
const stepError: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: '#991b1b',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  padding: '6px 8px',
};
const stepEmpty: React.CSSProperties = { fontSize: 12, color: '#6b7280', padding: '8px 0' };
const rawSummary: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  cursor: 'pointer',
  userSelect: 'none',
};
