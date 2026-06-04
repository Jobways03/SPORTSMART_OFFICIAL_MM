'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, usePermissions } from '@/lib/permissions';
import {
  adminSessionsService,
  ActiveSessionRow,
  ActorType,
  ListFilters,
} from '@/services/admin-sessions.service';

/**
 * Story 6.3 — admin session-revocation surface. Lists currently-active
 * refresh-token sessions across admins, users, sellers, franchises.
 * Read is gated on `sessions.read`; revocation actions on `sessions.revoke`.
 */
export default function SessionsPage() {
  return (
    <RequirePermission
      anyOf={['sessions.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

// Phase 27 (2026-05-21) — AFFILIATE added in lockstep with the
// backend admin-sessions surface. Affiliates handle commission
// payouts so admin-side revoke is needed for incident response.
const ACTOR_TYPES: ActorType[] = [
  'ADMIN',
  'USER',
  'SELLER',
  'FRANCHISE',
  'AFFILIATE',
];

function Inner() {
  const { hasAnyPermission } = usePermissions();
  const canRevoke = hasAnyPermission(['sessions.revoke']);

  const [filters, setFilters] = useState<ListFilters>({ limit: 200 });
  const [rows, setRows] = useState<ActiveSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Tracks which row IDs are currently mid-revoke so the button can
  // show a per-row spinner without blocking the whole table.
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminSessionsService.list(filters);
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
      } else {
        setRows([]);
        setTotal(0);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleRevoke = async (row: ActiveSessionRow) => {
    const reason = window.prompt(
      `Revoke this ${row.actorType.toLowerCase()} session for ${row.actorEmail ?? row.actorId}?\n\nOptional reason (logged in audit chain):`,
      '',
    );
    if (reason === null) return; // user cancelled
    setRevoking((prev) => new Set(prev).add(row.id));
    try {
      const res = await adminSessionsService.revoke({
        sessionId: row.id,
        actorType: row.actorType,
        reason: reason || undefined,
      });
      // Phase 209 (#12) — distinguish "already revoked" from a fresh kill.
      if (res.data?.alreadyRevoked) {
        setErr(`That ${row.actorType.toLowerCase()} session was already revoked.`);
      }
      // Optimistic — drop the row immediately. Refetch in the
      // background so any new sessions also surface.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setTotal((t) => Math.max(0, t - 1));
      fetchRows();
    } catch (e: any) {
      setErr(e?.message || 'Revoke failed');
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleRevokeAllForActor = async (row: ActiveSessionRow) => {
    const reason = window.prompt(
      `Revoke ALL active sessions for this ${row.actorType.toLowerCase()} (${row.actorEmail ?? row.actorId})?\n\nOptional reason (logged in audit chain):`,
      '',
    );
    if (reason === null) return;
    setRevoking((prev) => new Set(prev).add(row.id));
    try {
      const res = await adminSessionsService.revokeAllForActor({
        actorType: row.actorType,
        actorId: row.actorId,
        reason: reason || undefined,
      });
      if (res.data) {
        alert(`Revoked ${res.data.revoked} session(s) for ${row.actorEmail ?? row.actorId}.`);
      }
      fetchRows();
    } catch (e: any) {
      setErr(e?.message || 'Bulk revoke failed');
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Active sessions</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Refresh-token sessions across admins, users, sellers, and franchises. Revocation flips
            <code style={inlineCode}>revoked_at</code> so the next refresh fails and the actor is forced to log in again.
          </p>
        </div>
        <button type="button" onClick={fetchRows} disabled={loading} style={btnSecondary(loading)}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <FiltersBar
        filters={filters}
        onChange={(next) => setFilters({ ...next, limit: filters.limit })}
      />

      {err && <div style={errBanner}>{err}</div>}

      <div style={{ marginTop: 12, color: '#6b7280', fontSize: 12 }}>
        {loading ? 'Loading…' : `${rows.length.toLocaleString()} session(s) shown · ${total.toLocaleString()} total active`}
      </div>

      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Device / IP</th>
              <th style={thStyle}>User agent</th>
              <th style={thStyle}>Created</th>
              {/* Phase 209 (#4) — last refresh-rotation; the freshness signal. */}
              <th style={thStyle}>Last used</th>
              <th style={thStyle}>Expires</th>
              <th style={thStyle}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={tdEmpty}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={tdEmpty}>No active sessions match these filters.</td></tr>
            ) : (
              rows.map((r) => {
                const isRevoking = revoking.has(r.id);
                return (
                  <tr key={`${r.actorType}-${r.id}`} style={{ borderTop: '1px solid #f3f4f6', opacity: isRevoking ? 0.5 : 1 }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.actorName || r.actorEmail || '—'}</div>
                      {r.actorEmail && r.actorName && (
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{r.actorEmail}</div>
                      )}
                      {r.actorRole && (
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{r.actorRole}</div>
                      )}
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        <code style={inlineCode}>{r.actorId}</code>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={actorTypeBadge(r.actorType)}>{r.actorType}</span>
                    </td>
                    <td style={tdStyle}>
                      {r.deviceLabel && (
                        <div style={{ fontSize: 12, color: '#111827' }}>{r.deviceLabel}</div>
                      )}
                      {/* Phase 209 (#20) — mask the IP in the UI. Full value
                          stays server-side (behind sessions.read + audit); the
                          masked form is enough to recognise a network without
                          casually exposing every operator's exact address. */}
                      <span title="IP masked — full value in audit log" style={{ fontSize: 12, color: '#6b7280' }}>
                        {maskIp(r.ipAddress)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 200 }}>
                      {/* Phase 209 (#20) — show a compact UA summary, not the
                          raw fingerprintable string. */}
                      <span title="User agent summarised" style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {summariseUa(r.userAgent)}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatWhen(r.createdAt)}</td>
                    <td style={tdStyle}>{r.lastUsedAt ? formatWhen(r.lastUsedAt) : <span style={{ color: '#9ca3af' }}>never</span>}</td>
                    <td style={tdStyle}>{formatWhen(r.expiresAt)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canRevoke ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRevoke(r)}
                            disabled={isRevoking}
                            style={btnDanger(isRevoking)}
                          >
                            Revoke
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeAllForActor(r)}
                            disabled={isRevoking}
                            style={{ ...btnSecondary(isRevoking), marginLeft: 6 }}
                            title={`Revoke every active session for ${r.actorEmail ?? r.actorId}`}
                          >
                            Revoke all
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FiltersBar({
  filters,
  onChange,
}: {
  filters: ListFilters;
  onChange: (next: ListFilters) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={labelStyle}>
        <span style={labelSpan}>Actor type</span>
        <select
          value={filters.actorType ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              actorType: (e.target.value || undefined) as ActorType | undefined,
            })
          }
          style={inputStyle}
        >
          <option value="">All</option>
          {ACTOR_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={labelSpan}>Actor ID</span>
        <input
          type="text"
          value={filters.actorId ?? ''}
          placeholder="UUID"
          onChange={(e) => onChange({ ...filters, actorId: e.target.value || undefined })}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        <span style={labelSpan}>IP address</span>
        <input
          type="text"
          value={filters.ipAddress ?? ''}
          placeholder="e.g. 10.0.0.5"
          onChange={(e) => onChange({ ...filters, ipAddress: e.target.value || undefined })}
          style={inputStyle}
        />
      </label>
    </div>
  );
}

// ── Styles (inline; matches access-logs / admin-activity convention) ─
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
const inlineCode: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  background: '#f3f4f6',
  padding: '1px 5px',
  borderRadius: 4,
};
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
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
function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 12px',
    background: disabled ? '#fecaca' : '#dc2626',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function actorTypeBadge(t: ActorType): React.CSSProperties {
  const palette: Record<ActorType, { bg: string; fg: string }> = {
    ADMIN: { bg: '#dbeafe', fg: '#1e3a8a' },
    USER: { bg: '#dcfce7', fg: '#166534' },
    SELLER: { bg: '#fef3c7', fg: '#92400e' },
    FRANCHISE: { bg: '#f3e8ff', fg: '#6b21a8' },
    AFFILIATE: { bg: '#fce7f3', fg: '#9d174d' },
  };
  const c = palette[t];
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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Phase 209 (#20) — mask the client IP for display. IPv4: keep the first
// two octets (203.0.x.x). IPv6: keep the first two hextets (2001:db8:…).
// The unmasked address remains server-side behind sessions.read + the
// SESSIONS_VIEWED audit row.
function maskIp(ip: string | null): string {
  if (!ip) return '—';
  const addr = ip.split('%')[0] ?? ip;
  if (addr.includes(':')) {
    const parts = addr.split(':').filter(Boolean);
    return parts.length <= 2 ? addr : `${parts.slice(0, 2).join(':')}:…`;
  }
  const octets = addr.split('.');
  if (octets.length !== 4) return addr;
  return `${octets[0]}.${octets[1]}.x.x`;
}

// Phase 209 (#20) — summarise the user-agent into a coarse, non-
// fingerprintable label instead of rendering the raw string.
function summariseUa(ua: string | null): string {
  if (!ua) return '—';
  const os =
    /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Unknown OS';
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : 'Unknown';
  return `${browser} · ${os}`;
}
