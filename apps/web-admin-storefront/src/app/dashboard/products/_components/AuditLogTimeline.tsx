'use client';

/**
 * Phase 36 (2026-05-21) — shared audit-log timeline used by the
 * brand and category audit-log pages. Both surfaces consume the
 * same row shape:
 *
 *   { id, action, adminId, previousState, newState, reason, createdAt }
 *
 * The page wraps this component with the entity-specific load
 * function + display name. Pagination is wired here (50 per page)
 * with newest-first sort.
 */

import { useCallback, useEffect, useState } from 'react';

interface AuditEntry {
  id: string;
  action: string;
  adminId: string | null;
  previousState: unknown;
  newState: unknown;
  reason: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

/**
 * Color hint per action. Keeps the visual scan-friendly without
 * loading icon libraries — short text label with a tinted pill.
 */
const ACTION_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  CREATE: { bg: '#dcfce7', fg: '#166534', label: 'Created' },
  UPDATE: { bg: '#dbeafe', fg: '#1e40af', label: 'Updated' },
  DELETE: { bg: '#fee2e2', fg: '#991b1b', label: 'Deleted' },
  DEACTIVATE: { bg: '#fef3c7', fg: '#92400e', label: 'Deactivated' },
  REORDER: { bg: '#e0e7ff', fg: '#3730a3', label: 'Reordered' },
  LOGO_CHANGE: { bg: '#fae8ff', fg: '#86198f', label: 'Logo changed' },
  BULK_ASSIGN: { bg: '#cffafe', fg: '#155e75', label: 'Bulk-assigned' },
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 400 ? json.slice(0, 400) + '\n…' : json;
  } catch {
    return String(value);
  }
}

export interface AuditLogTimelineProps {
  /** Function that loads one page of entries — page is 0-indexed. */
  load: (page: number) => Promise<AuditEntry[]>;
  /** Human-readable subject of the timeline ("Nike", "Apparel & Clothing") */
  subjectLabel?: string | null;
}

export function AuditLogTimeline({ load, subjectLabel }: AuditLogTimelineProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const rows = await load(p);
        setEntries(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        setError((err as Error).message || 'Failed to load audit log');
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    fetchPage(page);
  }, [fetchPage, page]);

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Audit log</h1>
      {subjectLabel && (
        <p style={{ fontSize: 14, color: '#6b7280', margin: '4px 0 24px' }}>
          {subjectLabel}
        </p>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>No audit entries yet.</p>
      ) : (
        <div style={{ borderLeft: '2px solid #e5e7eb', marginLeft: 8 }}>
          {entries.map((entry) => {
            const tone = ACTION_TONE[entry.action] ?? {
              bg: '#f3f4f6',
              fg: '#374151',
              label: entry.action,
            };
            return (
              <article
                key={entry.id}
                style={{
                  position: 'relative',
                  paddingLeft: 22,
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -7,
                    top: 4,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: tone.fg,
                    border: '2px solid #fff',
                    boxShadow: '0 0 0 1px #e5e7eb',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span
                    style={{
                      padding: '2px 10px',
                      borderRadius: 999,
                      background: tone.bg,
                      color: tone.fg,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {tone.label}
                  </span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtTime(entry.createdAt)}</span>
                  {entry.adminId && (
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>
                      by admin <code style={{ fontFamily: 'monospace' }}>{entry.adminId.slice(0, 8)}</code>
                    </span>
                  )}
                </div>
                {entry.reason && (
                  <p style={{ fontSize: 13, color: '#374151', margin: '4px 0 8px' }}>
                    {entry.reason}
                  </p>
                )}
                {(entry.previousState !== null || entry.newState !== null) && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }}>
                      View diff
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                      <pre style={preStyle}>
                        <div style={preHeaderStyle}>Before</div>
                        {compactJson(entry.previousState)}
                      </pre>
                      <pre style={preStyle}>
                        <div style={preHeaderStyle}>After</div>
                        {compactJson(entry.newState)}
                      </pre>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
        <button
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          style={btnStyle}
        >
          Newer
        </button>
        <span style={{ alignSelf: 'center', fontSize: 12, color: '#6b7280' }}>
          Page {page + 1}
        </span>
        <button
          disabled={!hasMore || loading}
          onClick={() => setPage((p) => p + 1)}
          style={btnStyle}
        >
          Older
        </button>
      </div>
    </div>
  );
}

export { PAGE_SIZE };

const preStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const preHeaderStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#6b7280',
  marginBottom: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
};
