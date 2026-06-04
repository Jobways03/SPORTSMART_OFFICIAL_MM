'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/lib/permissions';
import {
  adminActivityService,
  ActivityItem,
} from '@/services/admin-activity.service';
import {
  ADMIN_SUB_ROLES,
  formatRoleLabel,
} from '@/services/admin-access-logs.service';

/**
 * PR 4 — Admin Activity. One timeline per admin role (or all admins),
 * merging access_logs (LOGIN / LOGOUT / etc.) with
 * admin_action_audit_logs (RBAC role mutations, seller impersonation,
 * etc.). Gated by `roles.read` — same level as the authz-readiness
 * page.
 */
export default function AdminActivityPage() {
  return (
    <RequirePermission
      // Phase 208 (#3) — dedicated permission split out of the coarse
      // roles.read; only the security/risk/compliance tiers hold it.
      anyOf={['admin.activity.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

const SOURCES = ['ALL', 'AUTH', 'ADMIN_ACTION', 'BUSINESS', 'IMPERSONATION'] as const;

function Inner() {
  const [role, setRole] = useState<string>('SUPER_ADMIN');
  // Phase 208 (#11) — pin the timeline to a single admin id (overrides the
  // role filter when set). Empty = role-based filtering.
  const [actorId, setActorId] = useState<string>('');
  const [source, setSource] = useState<string>('ALL');
  const [hours, setHours] = useState(24);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const trimmedId = actorId.trim();
      const res = await adminActivityService.timeline({
        // When an explicit actorId is given, drop the role filter so the
        // operator sees that admin's full activity regardless of role.
        actorRole: trimmedId ? undefined : role === 'ALL' ? undefined : role,
        actorId: trimmedId || undefined,
        actorType: 'ADMIN',
        hours,
        limit: 200,
        source: source === 'ALL' ? undefined : (source as any),
      });
      if (res.data) {
        setItems(res.data.items);
        setSince(res.data.since);
        setTruncated(Boolean(res.data.truncated));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [role, actorId, source, hours]);

  useEffect(() => { void fetch(); }, [fetch]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F1115', margin: 0 }}>
        Admin activity
      </h1>
      <p style={{ marginTop: 4, marginBottom: 20, fontSize: 14, color: '#525A65' }}>
        Unified timeline merging authentication events with RBAC and admin actions.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Admin role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={input}
            disabled={actorId.trim().length > 0}
            title={actorId.trim() ? 'Cleared while an admin id is set' : undefined}
          >
            <option value="ALL">All admin roles</option>
            {ADMIN_SUB_ROLES.map((r) => <option key={r} value={r}>{formatRoleLabel(r)}</option>)}
          </select>
        </div>
        {/* Phase 208 (#11) — single-admin drill-down. */}
        <div>
          <label style={lbl}>Admin ID (overrides role)</label>
          <input
            type="text"
            placeholder="UUID"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            style={{ ...input, minWidth: 260 }}
          />
        </div>
        {/* Phase 208 (#1/#8) — stream filter incl. the new business +
            impersonation sources. */}
        <div>
          <label style={lbl}>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={input}>
            {SOURCES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All sources' : s}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Window (hours)</label>
          <input
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 24)}
            style={input}
          />
        </div>
        {since && (
          <div style={{ fontSize: 12, color: '#7A828F', marginLeft: 'auto' }}>
            Since {new Date(since).toLocaleString('en-IN')}
          </div>
        )}
      </div>

      {err && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Phase 208 (#9) — warn when the merged window may be cutting older
          events, so the operator narrows the window instead of trusting a
          silently-truncated list. */}
      {truncated && !loading && (
        <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, color: '#92400E', fontSize: 13, marginBottom: 12 }}>
          Showing the most recent {items.length} events — one or more streams
          hit the page limit, so older activity in this window may be hidden.
          Narrow the window or filter by source / admin to see everything.
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
          No activity in the last {hours}h.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Source</th>
                <th style={th}>Actor</th>
                <th style={th}>Role</th>
                <th style={th}>Event</th>
                <th style={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}>{new Date(it.createdAt).toLocaleString('en-IN')}</td>
                  <td style={td}>
                    <span style={{ ...sourceBadge(it.source), padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {it.source}
                    </span>
                  </td>
                  <td style={td}><code style={{ fontSize: 12 }}>{it.actorId.slice(0, 8)}…</code></td>
                  <td style={td}>{it.actorRole ? formatRoleLabel(it.actorRole) : '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{it.kind}</td>
                  <td style={td}><code style={{ fontSize: 12 }}>{it.ipAddress ?? '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
};
const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
  color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5,
};
const td: React.CSSProperties = {
  padding: '12px 14px', fontSize: 13, color: '#0F1115',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};

// Phase 208 (#1/#8) — per-source badge palette across the four streams.
function sourceBadge(source: string): React.CSSProperties {
  switch (source) {
    case 'AUTH':
      return { background: '#DBEAFE', color: '#1E40AF' };
    case 'ADMIN_ACTION':
      return { background: '#FEF3C7', color: '#92400E' };
    case 'BUSINESS':
      return { background: '#DCFCE7', color: '#166534' };
    case 'IMPERSONATION':
      return { background: '#FCE7F3', color: '#9D174D' };
    default:
      return { background: '#F3F4F6', color: '#374151' };
  }
}
