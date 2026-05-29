'use client';

import { useEffect, useState } from 'react';
import {
  getAdminTimeline,
  type CaseKind,
  type TimelineEvent,
} from '@/services/admin-timeline.service';
import { ApiError } from '@/lib/api-client';

interface Props {
  caseKind: CaseKind;
  caseId: string;
  refreshKey?: number | string;
}

const FALLBACK_COLOR = { dot: '#94a3b8', bg: '#f1f5f9' };

const KIND_COLOR: Record<string, { dot: string; bg: string }> = {
  // returns
  'returns.timeline.requested': { dot: '#0ea5e9', bg: '#e0f2fe' },
  'returns.timeline.approved': { dot: '#16a34a', bg: '#dcfce7' },
  'returns.timeline.rejected': { dot: '#dc2626', bg: '#fee2e2' },
  'returns.timeline.received': { dot: '#7c3aed', bg: '#ede9fe' },
  'returns.timeline.refunded': { dot: '#16a34a', bg: '#dcfce7' },
  'returns.timeline.refund_pending': { dot: '#f59e0b', bg: '#fef3c7' },
  'returns.timeline.refund_succeeded': { dot: '#16a34a', bg: '#dcfce7' },
  'returns.timeline.refund_failed': { dot: '#dc2626', bg: '#fee2e2' },
  // disputes
  'disputes.timeline.opened': { dot: '#0ea5e9', bg: '#e0f2fe' },
  'disputes.timeline.message': { dot: '#3b82f6', bg: '#dbeafe' },
  'disputes.timeline.internal_note': { dot: '#7c3aed', bg: '#ede9fe' },
  'disputes.timeline.resolved_buyer': { dot: '#f59e0b', bg: '#fef3c7' },
  'disputes.timeline.resolved_seller': { dot: '#16a34a', bg: '#dcfce7' },
  'disputes.timeline.resolved_split': { dot: '#6366f1', bg: '#e0e7ff' },
  'disputes.timeline.closed': { dot: '#64748b', bg: '#f1f5f9' },
  // support tickets
  'support.timeline.opened': { dot: '#0ea5e9', bg: '#e0f2fe' },
  'support.timeline.message': { dot: '#3b82f6', bg: '#dbeafe' },
  'support.timeline.internal_note': { dot: '#7c3aed', bg: '#ede9fe' },
  'support.timeline.resolved': { dot: '#16a34a', bg: '#dcfce7' },
  'support.timeline.closed': { dot: '#64748b', bg: '#f1f5f9' },
};

function colorFor(kind: string) {
  return KIND_COLOR[kind] ?? FALLBACK_COLOR;
}

function formatWhen(at: string) {
  const d = new Date(at);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isInternal(ev: TimelineEvent): boolean {
  return ev.kind.endsWith('.internal_note');
}

function bodyOf(ev: TimelineEvent): string | null {
  const b = ev.payload?.['body'];
  return typeof b === 'string' && b.trim().length > 0 ? b : null;
}

function notesOf(ev: TimelineEvent): string | null {
  const n = ev.payload?.['notes'];
  return typeof n === 'string' && n.trim().length > 0 ? n : null;
}

function rationaleOf(ev: TimelineEvent): string | null {
  const r = ev.payload?.['rationale'];
  return typeof r === 'string' && r.trim().length > 0 ? r : null;
}

function failureReasonOf(ev: TimelineEvent): string | null {
  const f = ev.payload?.['failureReason'];
  return typeof f === 'string' && f.trim().length > 0 ? f : null;
}

export default function CaseTimeline({ caseKind, caseId, refreshKey }: Props) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminTimeline(caseKind, caseId)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.data ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Failed to load timeline';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseKind, caseId, refreshKey]);

  return (
    <section style={card}>
      <header style={cardHeader}>
        <h3 style={cardTitle}>Timeline</h3>
        <span style={badge}>{events?.length ?? 0} events</span>
      </header>

      {loading && <div style={muted}>Loading timeline…</div>}

      {error && !loading && (
        <div style={errorBox}>
          {error}
          {' — '}
          <button
            type="button"
            onClick={() => setError(null)}
            style={retryBtn}
          >
            dismiss
          </button>
        </div>
      )}

      {!loading && !error && events && events.length === 0 && (
        <div style={muted}>No events recorded yet.</div>
      )}

      {!loading && !error && events && events.length > 0 && (
        <ol style={list}>
          {events.map((ev, idx) => {
            const c = colorFor(ev.kind);
            const internal = isInternal(ev);
            const body = bodyOf(ev);
            const notes = notesOf(ev);
            const rationale = rationaleOf(ev);
            const failure = failureReasonOf(ev);
            return (
              <li key={`${ev.at}-${idx}`} style={item}>
                <div style={{ ...dot, background: c.dot }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowHeader}>
                    <span style={summary}>{ev.summary}</span>
                    {internal && <span style={internalTag}>internal</span>}
                    <span style={when}>{formatWhen(ev.at)}</span>
                  </div>
                  {ev.actor && (
                    <div style={actorLine}>by {ev.actor}</div>
                  )}
                  {(body || notes || rationale || failure) && (
                    <div
                      style={{
                        ...detail,
                        background: c.bg,
                      }}
                    >
                      {body && <div style={detailText}>{body}</div>}
                      {notes && (
                        <div style={detailMeta}>
                          <strong>Notes:</strong> {notes}
                        </div>
                      )}
                      {rationale && (
                        <div style={detailMeta}>
                          <strong>Rationale:</strong> {rationale}
                        </div>
                      )}
                      {failure && (
                        <div style={detailMeta}>
                          <strong>Failure:</strong> {failure}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ── styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 20,
};

const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 14,
};

const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const badge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  background: '#f1f5f9',
  color: '#475569',
  padding: '3px 8px',
  borderRadius: 8,
};

const muted: React.CSSProperties = {
  fontSize: 13,
  color: '#94a3b8',
  padding: '12px 0',
};

const errorBox: React.CSSProperties = {
  fontSize: 13,
  color: '#991b1b',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  padding: '10px 12px',
  borderRadius: 8,
};

const retryBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#991b1b',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
};

const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const item: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
};

const dot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 5,
  marginTop: 6,
  flexShrink: 0,
};

const rowHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
};

const summary: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
};

const internalTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  background: '#ede9fe',
  color: '#5b21b6',
  padding: '2px 6px',
  borderRadius: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const when: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  marginLeft: 'auto',
};

const actorLine: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginTop: 2,
};

const detail: React.CSSProperties = {
  marginTop: 8,
  padding: '10px 12px',
  borderRadius: 8,
  fontSize: 13,
  color: '#1f2937',
};

const detailText: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const detailMeta: React.CSSProperties = {
  fontSize: 12,
  color: '#475569',
  marginTop: 6,
};
