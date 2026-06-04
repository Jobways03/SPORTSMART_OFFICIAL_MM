'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/lib/permissions';
import {
  adminAuditService,
  AuditLogRow,
  AuditLogFilters,
  VerifyChainFastResponse,
  VerificationRun,
} from '@/services/admin-audit.service';

// Phase 205 (#6) — enum dropdowns instead of free-text so filters match the
// canonical vocabulary the backend records. Open-ended values are still
// reachable via the "Resource ID" / "Actor ID" text fields.
const MODULE_OPTIONS = [
  'orders', 'payments', 'refunds', 'returns', 'disputes', 'wallet',
  'settlements', 'reconciliation', 'catalog', 'discounts', 'sellers',
  'franchise', 'affiliate', 'identity', 'consent', 'tax', 'access',
  'audit', 'notifications', 'support', 'logistics',
];
const ACTOR_TYPE_OPTIONS = [
  'CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE',
  'SYSTEM', 'CRON', 'WEBHOOK', 'PAYMENT_PROVIDER', 'LOGISTICS_PROVIDER',
];

/**
 * Story 6.4 — Audit Logs viewer. Reads from /admin/audit/logs which
 * is the hash-chained audit trail (writes go through AuditPublicFacade
 * elsewhere — this surface is read-only). Filters mirror the backend's
 * query params one-for-one so the FE stays a thin lens over the API.
 */
export default function AuditLogsPage() {
  return (
    <RequirePermission
      anyOf={['audit.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

const DEFAULT_LIMIT = 100;

function Inner() {
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    limit: DEFAULT_LIMIT,
  });
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyChainFastResponse | null>(null);
  const [runs, setRuns] = useState<VerificationRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAuditService.list(filters);
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
      } else {
        setRows([]);
        setTotal(0);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleDownload = async () => {
    // Phase 206 (#4/#13) — the export now REQUIRES a date range and the server
    // caps the span/row-count. Guard + confirm before firing.
    if (!filters.fromDate || !filters.toDate) {
      setErr('Pick a From and To date in the filters before exporting.');
      return;
    }
    const ok = window.confirm(
      `Export audit rows from ${filters.fromDate} to ${filters.toDate}?\n\n` +
        'The file is REDACTED (IP truncated, raw JSON stripped). ' +
        'Full (PII) export requires elevated permission and is itself audited.',
    );
    if (!ok) return;
    setDownloading(true);
    setErr(null);
    try {
      await adminAuditService.downloadCsv({ ...filters, mode: 'redacted' });
    } catch (e: any) {
      setErr(e?.message || 'CSV export failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleVerify = async (mode: 'fast' | 'full') => {
    setVerifying(true);
    setVerifyResult(null);
    setErr(null);
    try {
      const res =
        mode === 'full'
          ? await adminAuditService.verifyChainFull()
          : await adminAuditService.verifyChainFast();
      if (res.data) setVerifyResult(res.data);
    } catch (e: any) {
      setErr(e?.message || 'Chain verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleToggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) {
      try {
        const res = await adminAuditService.listVerificationRuns();
        if (res.data) setRuns(res.data.items);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load verification history');
      }
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / (filters.limit ?? DEFAULT_LIMIT)));
  const page = filters.page ?? 1;

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Audit Logs</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Hash-chained, append-only record of business-critical mutations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleVerify('fast')}
            disabled={verifying}
            style={btnSecondary(verifying)}
          >
            {verifying ? 'Verifying…' : 'Verify chain (fast)'}
          </button>
          <button
            type="button"
            onClick={() => handleVerify('full')}
            disabled={verifying}
            style={btnSecondary(verifying)}
            title="Walks the entire chain. Slower on a large log."
          >
            Verify full
          </button>
          <button
            type="button"
            onClick={handleToggleHistory}
            style={btnSecondary(false)}
          >
            {showHistory ? 'Hide history' : 'Verify history'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            style={btnPrimary(downloading)}
            title="Requires a From + To date. Exports a redacted CSV."
          >
            {downloading ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </header>

      {verifyResult && (
        <div style={verifyBanner(verifyResult.breaks.length === 0)}>
          <strong style={{ fontSize: 13 }}>
            {verifyResult.breaks.length === 0 ? 'Chain healthy' : `${verifyResult.breaks.length} break(s) detected`}
          </strong>
          <span style={{ fontSize: 12, marginLeft: 8 }}>
            Scanned {verifyResult.scanned.toLocaleString()} rows
            {verifyResult.fromAnchorAt && ` from anchor pinned at ${formatWhen(verifyResult.fromAnchorAt)}`}.
          </span>
          {verifyResult.breaks.length > 0 && (
            <details style={{ marginTop: 6 }} open>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                Show {verifyResult.breaks.length} issue{verifyResult.breaks.length === 1 ? '' : 's'}
              </summary>
              <ul style={{ fontSize: 12, marginTop: 6, listStyle: 'none', paddingLeft: 0 }}>
                {verifyResult.breaks.slice(0, 50).map((b, i) => (
                  <li key={`${b.id ?? 'na'}-${i}`} style={{ marginBottom: 4 }}>
                    <span style={severityPill(b.severity)}>{b.severity}</span>{' '}
                    <strong>{b.issueType}</strong>
                    {b.id ? <> · <code>{b.id}</code></> : null}
                    {b.createdAt ? <> · {formatWhen(b.createdAt)}</> : null}
                    <div style={{ color: '#7f1d1d', marginTop: 2 }}>{b.reason}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {showHistory && (
        <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#f9fafb', fontSize: 12, fontWeight: 600, color: '#374151' }}>
            Verification history (most recent {runs.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#fff' }}>
              <tr>
                <th style={thStyle}>Started</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Rows</th>
                <th style={thStyle}>Issues</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={5} style={tdEmpty}>No verification runs yet.</td></tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{formatWhen(r.startedAt)}</td>
                    <td style={tdStyle}>{r.runType}</td>
                    <td style={tdStyle}>{r.status}</td>
                    <td style={tdStyle}>{r.rowsChecked.toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: r.issuesFound > 0 ? '#991b1b' : '#166534', fontWeight: 600 }}>
                      {r.issuesFound}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <FiltersBar
        filters={filters}
        onChange={(next) => setFilters({ ...next, page: 1, limit: filters.limit })}
      />

      {err && <div style={errBanner}>{err}</div>}

      <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={thStyle}>When</th>
              <th style={thStyle}>Module</th>
              <th style={thStyle}>Resource</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Resource ID</th>
              <th style={thStyle}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={tdEmpty}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={tdEmpty}>No audit rows match these filters.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{formatWhen(r.createdAt)}</td>
                  <td style={tdStyle}>{r.module}</td>
                  <td style={tdStyle}>{r.resource}</td>
                  <td style={tdStyle}><code style={codeStyle}>{r.action}</code></td>
                  <td style={tdStyle}>
                    {r.actorRole ? <span style={{ color: '#6b7280' }}>{r.actorRole} · </span> : null}
                    <code style={codeStyle}>{r.actorId ?? '—'}</code>
                  </td>
                  <td style={tdStyle}><code style={codeStyle}>{r.resourceId ?? '—'}</code></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button type="button" onClick={() => setSelected(r)} style={btnLink}>
                      Inspect →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={filters.limit ?? DEFAULT_LIMIT}
        onChange={(p) => setFilters({ ...filters, page: p })}
      />

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FiltersBar({
  filters,
  onChange,
}: {
  filters: AuditLogFilters;
  onChange: (next: AuditLogFilters) => void;
}) {
  return (
    <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <Select
        label="Module"
        value={filters.module ?? ''}
        options={MODULE_OPTIONS}
        onChange={(v) => onChange({ ...filters, module: v || undefined })}
      />
      <Input
        label="Resource"
        value={filters.resource ?? ''}
        placeholder="e.g. MasterOrder"
        onChange={(v) => onChange({ ...filters, resource: v || undefined })}
      />
      <Input
        label="Resource ID"
        value={filters.resourceId ?? ''}
        placeholder="UUID / order number"
        onChange={(v) => onChange({ ...filters, resourceId: v || undefined })}
      />
      <Input
        label="Actor ID"
        value={filters.actorId ?? ''}
        placeholder="admin / user ID"
        onChange={(v) => onChange({ ...filters, actorId: v || undefined })}
      />
      <Select
        label="Actor type"
        value={filters.actorType ?? ''}
        options={ACTOR_TYPE_OPTIONS}
        onChange={(v) => onChange({ ...filters, actorType: v || undefined })}
      />
      <Input
        label="Action"
        value={filters.action ?? ''}
        placeholder="e.g. order.cancelled"
        onChange={(v) => onChange({ ...filters, action: v || undefined })}
      />
      <Input
        label="From"
        type="date"
        value={filters.fromDate ?? ''}
        onChange={(v) => onChange({ ...filters, fromDate: v || undefined })}
      />
      <Input
        label="To"
        type="date"
        value={filters.toDate ?? ''}
        onChange={(v) => onChange({ ...filters, toDate: v || undefined })}
      />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#6b7280' }}>
      <span>
        {total === 0
          ? 'No results'
          : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} style={btnPager(page <= 1)}>
          ← Prev
        </button>
        <span style={{ padding: '4px 8px' }}>
          {page} / {totalPages}
        </span>
        <button type="button" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={btnPager(page >= totalPages)}>
          Next →
        </button>
      </span>
    </div>
  );
}

function DetailDrawer({ row, onClose }: { row: AuditLogRow; onClose: () => void }) {
  return (
    <div style={drawerOverlay} onClick={onClose}>
      <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Audit row</h2>
          <button type="button" onClick={onClose} style={btnLink}>Close ✕</button>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 12, fontSize: 13 }}>
          <dt style={dtStyle}>ID</dt>
          <dd style={ddStyle}><code style={codeStyle}>{row.id}</code></dd>
          <dt style={dtStyle}>When</dt>
          <dd style={ddStyle}>{formatWhen(row.createdAt)}</dd>
          <dt style={dtStyle}>Module</dt>
          <dd style={ddStyle}>{row.module}</dd>
          <dt style={dtStyle}>Resource</dt>
          <dd style={ddStyle}>{row.resource}</dd>
          <dt style={dtStyle}>Resource ID</dt>
          <dd style={ddStyle}><code style={codeStyle}>{row.resourceId ?? '—'}</code></dd>
          <dt style={dtStyle}>Action</dt>
          <dd style={ddStyle}><code style={codeStyle}>{row.action}</code></dd>
          <dt style={dtStyle}>Actor</dt>
          <dd style={ddStyle}>
            {row.actorRole ? <span style={{ color: '#6b7280' }}>{row.actorRole} · </span> : null}
            <code style={codeStyle}>{row.actorId ?? '—'}</code>
            {row.actorType ? <span style={{ color: '#6b7280' }}> ({row.actorType})</span> : null}
          </dd>
          <dt style={dtStyle}>Prev hash</dt>
          <dd style={ddStyle}><code style={hashStyle}>{row.prevHash ?? '(genesis)'}</code></dd>
          <dt style={dtStyle}>Hash</dt>
          <dd style={ddStyle}><code style={hashStyle}>{row.hash}</code></dd>
        </dl>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 16, marginBottom: 4 }}>Payload</h3>
        <pre style={preStyle}>{JSON.stringify(row.payload, null, 2)}</pre>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 32,
          padding: '0 8px',
          fontSize: 13,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          background: '#fff',
        }}
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 32,
          padding: '0 8px',
          fontSize: 13,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          background: '#fff',
        }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function severityPill(severity: string): React.CSSProperties {
  const crit = severity === 'CRITICAL';
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 4,
    background: crit ? '#fee2e2' : '#fef3c7',
    color: crit ? '#991b1b' : '#92400e',
  };
}

// ── Styles (kept inline to match access-logs / admin-activity page
// conventions in this app — no tailwind class soup at the dashboard
// level). ─────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
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
const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  background: '#f3f4f6',
  padding: '1px 6px',
  borderRadius: 4,
};
const hashStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  background: '#f3f4f6',
  padding: '2px 6px',
  borderRadius: 4,
  wordBreak: 'break-all',
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
  maxHeight: 360,
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
  background: 'rgba(15, 23, 42, 0.45)',
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
  boxShadow: '-10px 0 30px rgba(15, 23, 42, 0.2)',
};

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
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
function verifyBanner(ok: boolean): React.CSSProperties {
  return {
    marginTop: 12,
    padding: '10px 12px',
    background: ok ? '#f0fdf4' : '#fef2f2',
    border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
    color: ok ? '#166534' : '#991b1b',
    borderRadius: 8,
  };
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
