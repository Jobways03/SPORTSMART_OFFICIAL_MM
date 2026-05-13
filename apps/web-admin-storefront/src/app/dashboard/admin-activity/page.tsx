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
      anyOf={['roles.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const [role, setRole] = useState<string>('SUPER_ADMIN');
  const [hours, setHours] = useState(24);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminActivityService.timeline({
        actorRole: role === 'ALL' ? undefined : role,
        actorType: 'ADMIN',
        hours,
        limit: 200,
      });
      if (res.data) {
        setItems(res.data.items);
        setSince(res.data.since);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [role, hours]);

  useEffect(() => { void fetch(); }, [fetch]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F1115', margin: 0 }}>
        Admin activity
      </h1>
      <p style={{ marginTop: 4, marginBottom: 20, fontSize: 14, color: '#525A65' }}>
        Unified timeline merging authentication events with RBAC and admin actions.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Admin role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={input}>
            <option value="ALL">All admin roles</option>
            {ADMIN_SUB_ROLES.map((r) => <option key={r} value={r}>{formatRoleLabel(r)}</option>)}
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
                    <span style={{
                      background: it.source === 'AUTH' ? '#DBEAFE' : '#FEF3C7',
                      color: it.source === 'AUTH' ? '#1E40AF' : '#92400E',
                      padding: '2px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
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
