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

const STATUS_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'Open (in flight)', value: 'STARTED,IN_PROGRESS,FAILED' },
  { label: 'STARTED', value: 'STARTED' },
  { label: 'IN_PROGRESS', value: 'IN_PROGRESS' },
  { label: 'FAILED', value: 'FAILED' },
  { label: 'COMPENSATED', value: 'COMPENSATED' },
  { label: 'COMPLETED', value: 'COMPLETED' },
  { label: 'All', value: '' },
];

function Inner() {
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTERS[0].value);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [rows, setRows] = useState<RefundSagaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefundSagaRow | null>(null);

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
    } catch (e: any) {
      setErr(e?.message || 'Failed to load sagas');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, stuckOnly, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Refund Sagas</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0', maxWidth: 660 }}>
            Live queue of in-flight refund sagas. Default view shows non-terminal rows
            (STARTED / IN_PROGRESS / FAILED). The sweep cron auto-escalates orphans into
            admin tasks — this surface is read-only.
          </p>
        </div>
        <button type="button" onClick={fetchRows} disabled={loading} style={btnSecondary(loading)}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
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
        <label style={{ ...labelWrap, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
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
      </div>

      {err && <div style={errBanner}>{err}</div>}

      <div style={{ marginTop: 4, color: '#6b7280', fontSize: 12 }}>
        {loading
          ? 'Loading…'
          : `${rows.length.toLocaleString()} of ${total.toLocaleString()} saga(s) shown`}
      </div>

      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={th}>Started</th>
              <th style={th}>Status</th>
              <th style={th}>Type</th>
              <th style={th}>Source / Instruction</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={th}>Age</th>
              <th style={th}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={tdEmpty}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={tdEmpty}>No sagas match these filters.</td></tr>
            ) : (
              rows.map((r) => {
                const stuck = isStuck(r);
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: '1px solid #f3f4f6',
                      background: stuck ? '#fef2f2' : 'transparent',
                    }}
                  >
                    <td style={tdStyle}>{formatWhen(r.startedAt)}</td>
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
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatPaise(r.amountInPaise)}
                    </td>
                    <td style={tdStyle}>{formatAge(r.ageMs)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button type="button" onClick={() => setSelected(r)} style={btnLink}>
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

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#6b7280' }}>
        <span>{total === 0 ? '—' : `Page ${page} / ${totalPages}`}</span>
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

function DetailDrawer({ row, onClose }: { row: RefundSagaRow; onClose: () => void }) {
  return (
    <div style={drawerOverlay} onClick={onClose}>
      <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Saga {row.id.slice(0, 8)}…</h2>
          <button type="button" onClick={onClose} style={btnLink}>Close ✕</button>
        </div>
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
        <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 16, marginBottom: 4 }}>Steps</h3>
        <pre style={preStyle}>{JSON.stringify(row.steps, null, 2)}</pre>
        {row.compensations !== null && row.compensations !== undefined && (
          <>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Compensations</h3>
            <pre style={preStyle}>{JSON.stringify(row.compensations, null, 2)}</pre>
          </>
        )}
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
  zIndex: 60,
};
const drawerPanel: React.CSSProperties = {
  width: 'min(640px, 100%)',
  height: '100%',
  background: '#fff',
  padding: 20,
  overflow: 'auto',
  boxShadow: '-10px 0 30px rgba(15,23,42,0.2)',
};
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
