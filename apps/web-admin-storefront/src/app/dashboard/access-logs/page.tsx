'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  adminAccessLogsService,
  AccessActorType,
  AccessEventKind,
  AccessLogEntry,
  ADMIN_SUB_ROLES,
  AdminSubRole,
  RecentActorRow,
  SpikeRow,
  KIND_LABEL,
  KIND_COLOR,
  browserOf,
  formatRoleLabel,
} from '@/services/admin-access-logs.service';
import {
  adminActivityService,
  ActivityItem,
} from '@/services/admin-activity.service';

const ACTOR_TYPES: AccessActorType[] = ['CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE'];
const KINDS: AccessEventKind[] = [
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
  'TOKEN_REFRESH', 'PASSWORD_RESET', 'NEW_DEVICE_DETECTED',
];

type Tab = 'spike' | 'lookup' | 'byRole';
const TAB_LABEL: Record<Tab, string> = {
  spike: 'Failed-login spikes',
  lookup: 'Per-actor lookup',
  byRole: 'By admin role',
};

export default function AccessLogsPage() {
  const [tab, setTab] = useState<Tab>('spike');

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F1115', margin: 0 }}>Access logs</h1>
      <p style={{ marginTop: 4, marginBottom: 20, fontSize: 14, color: '#525A65' }}>
        Cross-actor sign-in audit trail and brute-force detection.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
        {(['spike', 'lookup', 'byRole'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #2563EB' : '2px solid transparent',
              color: tab === t ? '#2563EB' : '#525A65',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'spike' ? <SpikeTab /> : tab === 'lookup' ? <LookupTab /> : <ByRoleTab />}
    </div>
  );
}

// ── Spike summary ───────────────────────────────────────────────────

function SpikeTab() {
  const [hours, setHours] = useState(24);
  const [minFailures, setMinFailures] = useState(5);
  const [items, setItems] = useState<SpikeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<string>('');
  // PR 3.2 — raw failed-login stream so the operator has a continuous
  // view even when the spike threshold isn't hit.
  const [recentFails, setRecentFails] = useState<AccessLogEntry[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [actorTypeFilter, setActorTypeFilter] = useState<AccessActorType | ''>('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setRecentLoading(true);
    try {
      const [spikeRes, recentRes] = await Promise.all([
        adminAccessLogsService.failedLoginSpike({ hours, minFailures }),
        adminAccessLogsService.recentFailures({
          actorType: actorTypeFilter || undefined,
          hours,
          limit: 50,
        }),
      ]);
      if (spikeRes.data) {
        setItems(spikeRes.data.items);
        setSince(spikeRes.data.since);
      }
      if (recentRes.data) {
        setRecentFails(recentRes.data.items);
      }
    } finally {
      setLoading(false);
      setRecentLoading(false);
    }
  }, [hours, minFailures, actorTypeFilter]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Group recent fails by actorType for the operator-friendly summary.
  const recentByType = recentFails.reduce<Record<string, number>>((acc, r) => {
    acc[r.actorType] = (acc[r.actorType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Window (hours)</label>
          <input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 24)}
            style={input}
          />
        </div>
        <div>
          <label style={lbl}>Min failures (spike threshold)</label>
          <input
            type="number"
            min={2}
            max={1000}
            value={minFailures}
            onChange={(e) => setMinFailures(Number(e.target.value) || 5)}
            style={input}
          />
        </div>
        {since && (
          <div style={{ fontSize: 12, color: '#7A828F', marginLeft: 'auto' }}>
            Since {new Date(since).toLocaleString('en-IN')}
          </div>
        )}
      </div>

      {/* ── Section 1: Spike summary (existing) ────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Actors above the spike threshold ({minFailures}+ failures in {hours}h)
        </div>
        {loading ? (
          <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 20, color: '#16A34A', textAlign: 'center', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, fontSize: 13 }}>
            🛡 No actors above the threshold in this window.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#F9FAFB' }}>
                <tr>
                  <th style={th}>Actor type</th>
                  <th style={th}>Actor id / email</th>
                  <th style={th}>From IP</th>
                  <th style={{ ...th, textAlign: 'right' }}>Failures</th>
                  <th style={th}>Last failure</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={`${r.actorType}-${r.actorId}-${r.ipAddress}-${i}`} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={td}>{r.actorType}</td>
                    <td style={td}><code style={{ fontSize: 12 }}>{r.actorId}</code></td>
                    <td style={td}><code style={{ fontSize: 12 }}>{r.ipAddress ?? '—'}</code></td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#B91C1C', fontVariantNumeric: 'tabular-nums' }}>
                      {r.failureCount}
                    </td>
                    <td style={td}>{new Date(r.lastFailureAt).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 2: Recent failed-login event stream (PR 3.2) ─── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Recent failed logins (last {hours}h, any count)
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#7A828F' }}>
            {recentLoading ? 'Loading…' : `${recentFails.length} ${recentFails.length === 1 ? 'event' : 'events'}`}
          </span>
        </div>

        {/* Per-actor-type chip filter */}
        {!recentLoading && recentFails.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['', 'CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE'] as const).map((t) => {
              const count = t === '' ? recentFails.length : (recentByType[t] ?? 0);
              const active = actorTypeFilter === t;
              return (
                <button
                  key={t || 'all'}
                  onClick={() => setActorTypeFilter(t as AccessActorType | '')}
                  disabled={t !== '' && count === 0}
                  style={{
                    background: active ? '#0F1115' : '#fff',
                    color: active ? '#fff' : '#525A65',
                    border: `1px solid ${active ? '#0F1115' : '#E5E7EB'}`,
                    borderRadius: 999,
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: count === 0 && t !== '' ? 'not-allowed' : 'pointer',
                    opacity: count === 0 && t !== '' ? 0.4 : 1,
                  }}
                >
                  {t || 'All'} · {count}
                </button>
              );
            })}
          </div>
        )}

        {recentLoading ? (
          <div style={{ padding: 24, color: '#7A828F', fontSize: 13 }}>Loading…</div>
        ) : recentFails.length === 0 ? (
          <div style={{ padding: 20, color: '#7A828F', textAlign: 'center', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, fontSize: 13 }}>
            No failed-login attempts in this window.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#F9FAFB' }}>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Actor type</th>
                  <th style={th}>Actor id / email</th>
                  <th style={th}>From IP</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentFails.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={td}>{new Date(e.createdAt).toLocaleString('en-IN')}</td>
                    <td style={td}>
                      <span style={{ background: '#FEF2F2', color: '#B91C1C', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
                        {e.actorType}
                      </span>
                    </td>
                    <td style={td}><code style={{ fontSize: 12 }}>{e.actorId}</code></td>
                    <td style={td}><code style={{ fontSize: 12 }}>{e.ipAddress ?? '—'}</code></td>
                    <td style={{ ...td, color: '#7A828F', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.reason ?? ''}>
                      {e.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Per-actor lookup ────────────────────────────────────────────────

function LookupTab() {
  const [actorType, setActorType] = useState<AccessActorType>('ADMIN');
  const [actorId, setActorId] = useState('');
  const [kind, setKind] = useState<AccessEventKind | ''>('');
  const [items, setItems] = useState<AccessLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentActorRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // Recent actors refresh whenever actorType changes — gives the operator
  // a click-to-load shortcut so they don't need a UUID to start.
  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    adminAccessLogsService
      .recentActors({ actorType, hours: 24 * 7, limit: 20 })
      .then((res) => {
        if (cancelled) return;
        setRecent(res.data?.items ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setRecent([]);
      })
      .finally(() => { if (!cancelled) setRecentLoading(false); });
    return () => { cancelled = true; };
  }, [actorType]);

  const searchFor = useCallback(async (idOverride?: string) => {
    const id = (idOverride ?? actorId).trim();
    if (!id) {
      setErr('actorId is required');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccessLogsService.listForActor(actorType, id, {
        kind: kind || undefined,
        limit: 200,
      });
      setItems(res.data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [actorType, actorId, kind]);

  const pick = useCallback((row: RecentActorRow) => {
    setActorId(row.actorId);
    void searchFor(row.actorId);
  }, [searchFor]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Actor type</label>
          <select value={actorType} onChange={(e) => { setActorType(e.target.value as AccessActorType); setItems(null); setActorId(''); }} style={input}>
            {ACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={lbl}>Actor id (uuid or email for failed logins)</label>
          <input
            type="text"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="paste a UUID or click a recent actor below"
            style={{ ...input, width: '100%' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void searchFor(); }}
          />
        </div>
        <div>
          <label style={lbl}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccessEventKind | '')} style={input}>
            <option value="">All kinds</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <button onClick={() => void searchFor()} disabled={loading} style={primaryBtn}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Recent actors quick-pick */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Recent {actorType} actors (last 7d) — click to load
        </div>
        {recentLoading ? (
          <div style={{ padding: 16, color: '#7A828F', fontSize: 12 }}>Loading…</div>
        ) : recent.length === 0 ? (
          <div style={{ padding: 16, color: '#7A828F', fontSize: 12, fontStyle: 'italic' }}>
            No recent {actorType} activity. You can still paste an actor id above to search the full history.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {recent.map((r) => {
              // Prefer displayName → email → truncated UUID for the title.
              // For ADMIN actors enriched server-side this surfaces a human
              // identity instead of an opaque ID.
              const title = r.displayName ?? r.email ?? r.actorId;
              const subtitle =
                r.displayName && r.email
                  ? r.email
                  : r.displayName
                    ? `${r.actorId.slice(0, 12)}…`
                    : null;
              return (
                <button
                  key={`${r.actorType}-${r.actorId}`}
                  onClick={() => pick(r)}
                  style={{
                    textAlign: 'left',
                    background: actorId === r.actorId ? '#EFF6FF' : '#fff',
                    border: actorId === r.actorId ? '1px solid #2563EB' : '1px solid #E5E7EB',
                    borderRadius: 8,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {/* Identity row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#0F1115',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={title}
                      >
                        {title}
                      </div>
                      {subtitle && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#7A828F',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: r.displayName && r.email ? 'inherit' : 'ui-monospace, monospace',
                          }}
                          title={subtitle}
                        >
                          {subtitle}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: '#7A828F', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {r.eventCount} {r.eventCount === 1 ? 'event' : 'events'}
                    </span>
                  </div>

                  {/* Roles row — primary role + any additional custom roles */}
                  {(r.actorRole || (r.customRoles && r.customRoles.length > 0)) && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.actorRole && (
                        <span style={{ background: '#F3F4F6', padding: '1px 6px', borderRadius: 6, fontWeight: 600, fontSize: 11, color: '#374151' }}>
                          {formatRoleLabel(r.actorRole)}
                        </span>
                      )}
                      {r.customRoles?.map((cr) => (
                        <span
                          key={cr}
                          style={{
                            background: '#EDE9FE',
                            color: '#5B21B6',
                            padding: '1px 6px',
                            borderRadius: 6,
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                          title={`Custom role: ${cr}`}
                        >
                          + {cr}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Last event row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 11, color: '#7A828F' }}>
                    {r.lastEventKind ? (
                      <span style={{ color: r.lastEventSucceeded === false ? '#B91C1C' : '#16A34A', fontWeight: 600 }}>
                        {KIND_LABEL[r.lastEventKind] ?? r.lastEventKind}
                      </span>
                    ) : <span />}
                    <span>{new Date(r.lastEventAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {items === null ? null : items.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
          No events for this actor.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Event</th>
                <th style={th}>Browser</th>
                <th style={th}>IP</th>
                <th style={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}>{new Date(e.createdAt).toLocaleString('en-IN')}</td>
                  <td style={td}>
                    <span style={{
                      background: KIND_COLOR[e.kind] + '20',
                      color: KIND_COLOR[e.kind],
                      padding: '2px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {KIND_LABEL[e.kind]}
                    </span>
                  </td>
                  <td style={td}>{browserOf(e.userAgent)}</td>
                  <td style={td}><code style={{ fontSize: 12 }}>{e.ipAddress ?? '—'}</code></td>
                  <td style={{ ...td, color: '#7A828F', fontSize: 12 }}>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── By admin role: 5-card dashboard ─────────────────────────────────
//
// Five buckets:
//   1. SUPER_ADMIN         — system admins
//   2. SELLER ADMINS       — SELLER_ADMIN + SELLER_OPERATIONS + SELLER_SUPPORT
//   3. FRANCHISE           — actorType=FRANCHISE (no admin sub-role exists)
//   4. AFFILIATE_ADMIN     — affiliate-side admins
//   5. RBAC                — role.created / updated / deleted / assigned /
//                            revoked, regardless of which admin triggered them
//
// Each card calls /admin/activity in parallel with its own filter, then
// shows count + last N events. Click "View all" jumps to the full Admin
// Activity page pre-filtered to that bucket.

type RoleBucket = {
  key: string;
  label: string;
  description: string;
  color: string;
  // Either AUTH+BUSINESS for a given admin sub-role (actorRole) OR by
  // actorType (FRANCHISE) OR source-only (RBAC).
  query:
    | { kind: 'role'; actorRole: string | string[] }
    | { kind: 'actorType'; actorType: 'FRANCHISE' }
    | { kind: 'rbac' };
};

const BUCKETS: RoleBucket[] = [
  {
    key: 'SUPER_ADMIN',
    label: 'Super Admin',
    description: 'System administrators with full access.',
    color: '#7C3AED',
    query: { kind: 'role', actorRole: 'SUPER_ADMIN' },
  },
  {
    key: 'SELLER_ADMIN',
    label: 'Seller Admins',
    description: 'SELLER_ADMIN, SELLER_OPERATIONS, SELLER_SUPPORT — admins who manage seller-side ops.',
    color: '#2563EB',
    query: {
      kind: 'role',
      actorRole: ['SELLER_ADMIN', 'SELLER_OPERATIONS', 'SELLER_SUPPORT'],
    },
  },
  {
    key: 'FRANCHISE',
    label: 'Franchise',
    description: 'Franchise actors (actorType=FRANCHISE — no admin sub-role exists today).',
    color: '#16A34A',
    query: { kind: 'actorType', actorType: 'FRANCHISE' },
  },
  {
    key: 'AFFILIATE_ADMIN',
    label: 'Affiliate Admin',
    description: 'AFFILIATE_ADMIN — admins who manage the affiliate program.',
    color: '#F59E0B',
    query: { kind: 'role', actorRole: 'AFFILIATE_ADMIN' },
  },
  {
    key: 'RBAC',
    label: 'RBAC Mutations',
    description: 'Every role create / update / delete / assign / revoke — across all admins.',
    color: '#DC2626',
    query: { kind: 'rbac' },
  },
];

async function fetchBucket(b: RoleBucket, hours: number): Promise<ActivityItem[]> {
  if (b.query.kind === 'rbac') {
    const res = await adminActivityService.timeline({
      source: 'BUSINESS',
      hours,
      limit: 50,
    });
    return res.data?.items ?? [];
  }
  if (b.query.kind === 'actorType') {
    const res = await adminActivityService.timeline({
      actorType: b.query.actorType,
      hours,
      limit: 50,
    });
    return res.data?.items ?? [];
  }
  // kind: 'role' — one or more admin sub-roles rolled up
  const roles = Array.isArray(b.query.actorRole) ? b.query.actorRole : [b.query.actorRole];
  const results = await Promise.all(
    roles.map((r) =>
      adminActivityService.timeline({
        actorRole: r,
        actorType: 'ADMIN',
        hours,
        limit: 50,
      }),
    ),
  );
  return results
    .flatMap((r) => r.data?.items ?? [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);
}

function ByRoleTab() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Record<string, ActivityItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await Promise.all(
        BUCKETS.map(async (b) => [b.key, await fetchBucket(b, hours)] as const),
      );
      setData(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
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
        <button onClick={() => void fetchAll()} style={primaryBtn} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <div style={{ fontSize: 12, color: '#7A828F', marginLeft: 'auto' }}>
          Showing last {hours}h · auto-merged AUTH + BUSINESS streams
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {BUCKETS.map((b) => (
          <RoleCard
            key={b.key}
            bucket={b}
            items={data[b.key] ?? []}
            loading={loading}
            expanded={expanded === b.key}
            onToggle={() => setExpanded((cur) => (cur === b.key ? null : b.key))}
          />
        ))}
      </div>
    </>
  );
}

function RoleCard({
  bucket,
  items,
  loading,
  expanded,
  onToggle,
}: {
  bucket: RoleBucket;
  items: ActivityItem[];
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const preview = expanded ? items : items.slice(0, 6);
  const authCount = items.filter((i) => i.source === 'AUTH').length;
  const bizCount = items.filter((i) => i.source === 'BUSINESS').length;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderTop: `3px solid ${bucket.color}`,
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 220,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            background: bucket.color + '20',
            color: bucket.color,
            padding: '3px 10px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {bucket.label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 700, color: '#0F1115' }}>
          {items.length}
        </span>
      </div>
      <p style={{ fontSize: 11, color: '#7A828F', margin: '0 0 12px', lineHeight: 1.4 }}>
        {bucket.description}
      </p>

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 10 }}>
          <span style={{ color: '#1E40AF' }}>{authCount} AUTH</span>
          <span style={{ color: '#92400E' }}>{bizCount} BUSINESS</span>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#7A828F', fontSize: 12 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#7A828F', fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>
          No events in this window.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {preview.map((it) => (
              <ActivityRow key={it.id} item={it} />
            ))}
          </div>
          {items.length > 6 && (
            <button
              onClick={onToggle}
              style={{
                marginTop: 10,
                alignSelf: 'flex-start',
                background: 'none',
                border: 'none',
                color: bucket.color,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {expanded ? '↑ Show less' : `↓ Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const sourceBg = item.source === 'AUTH' ? '#DBEAFE' : '#FEF3C7';
  const sourceFg = item.source === 'AUTH' ? '#1E40AF' : '#92400E';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 44px 1fr',
        gap: 6,
        alignItems: 'center',
        fontSize: 12,
        padding: '4px 0',
        borderBottom: '1px solid #F3F4F6',
      }}
    >
      <span style={{ color: '#7A828F', fontVariantNumeric: 'tabular-nums' }}>
        {new Date(item.createdAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <span
        style={{
          background: sourceBg,
          color: sourceFg,
          padding: '1px 6px',
          borderRadius: 8,
          fontSize: 10,
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {item.source === 'AUTH' ? 'AUTH' : 'BIZ'}
      </span>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: '#0F1115',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={item.kind}
      >
        {item.kind}
      </span>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
};
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};
const primaryBtn: React.CSSProperties = {
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 8,
  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
