'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  adminAccessLogsService,
  AccessActorType,
  AccessEventKind,
  AccessLogEntry,
  SpikeRow,
  KIND_LABEL,
  KIND_COLOR,
  browserOf,
} from '@/services/admin-access-logs.service';

const ACTOR_TYPES: AccessActorType[] = ['CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE'];
const KINDS: AccessEventKind[] = [
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
  'TOKEN_REFRESH', 'PASSWORD_RESET', 'NEW_DEVICE_DETECTED',
];

export default function AccessLogsPage() {
  const [tab, setTab] = useState<'lookup' | 'spike'>('spike');

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F1115', margin: 0 }}>Access logs</h1>
      <p style={{ marginTop: 4, marginBottom: 20, fontSize: 14, color: '#525A65' }}>
        Cross-actor sign-in audit trail and brute-force detection.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
        {(['spike', 'lookup'] as const).map((t) => (
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
            {t === 'spike' ? 'Failed-login spikes' : 'Per-actor lookup'}
          </button>
        ))}
      </div>

      {tab === 'spike' ? <SpikeTab /> : <LookupTab />}
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

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAccessLogsService.failedLoginSpike({ hours, minFailures });
      if (res.data) {
        setItems(res.data.items);
        setSince(res.data.since);
      }
    } finally {
      setLoading(false);
    }
  }, [hours, minFailures]);

  useEffect(() => { void fetch(); }, [fetch]);

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
          <label style={lbl}>Min failures</label>
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

      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, color: '#16A34A', textAlign: 'center', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12 }}>
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
    </>
  );
}

// ── Per-actor lookup ────────────────────────────────────────────────

function LookupTab() {
  const [actorType, setActorType] = useState<AccessActorType>('CUSTOMER');
  const [actorId, setActorId] = useState('');
  const [kind, setKind] = useState<AccessEventKind | ''>('');
  const [items, setItems] = useState<AccessLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    if (!actorId.trim()) {
      setErr('actorId is required');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccessLogsService.listForActor(actorType, actorId.trim(), {
        kind: kind || undefined,
        limit: 200,
      });
      setItems(res.data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Actor type</label>
          <select value={actorType} onChange={(e) => setActorType(e.target.value as AccessActorType)} style={input}>
            {ACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={lbl}>Actor id (uuid or email for failed logins)</label>
          <input
            type="text"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="e.g. e3b0c442-..."
            style={{ ...input, width: '100%' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          />
        </div>
        <div>
          <label style={lbl}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccessEventKind | '')} style={input}>
            <option value="">All kinds</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <button onClick={search} disabled={loading} style={primaryBtn}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {items === null ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
          Enter an actor id and search to load history.
        </div>
      ) : items.length === 0 ? (
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
