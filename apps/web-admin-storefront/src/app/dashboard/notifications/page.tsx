'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  adminNotificationsService,
  NotificationLog,
  NotificationTemplate,
  NotificationChannel,
  NotificationStatus,
  DispatchPayload,
  STATUS_COLOR,
  CHANNEL_LABEL,
} from '@/services/admin-notifications.service';

type Tab = 'logs' | 'templates' | 'dispatch';

export default function NotificationsAdminPage() {
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F1115', marginBottom: 4 }}>
        Notifications
      </h1>
      <p style={{ fontSize: 14, color: '#7A828F', marginBottom: 20 }}>
        Delivery logs, template editing, and customer preferences.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
        {(['logs', 'templates', 'dispatch'] as const).map((t) => (
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
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'logs' && <LogsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'dispatch' && <DispatchTab />}
    </div>
  );
}

// ── Logs ─────────────────────────────────────────────────────────

function LogsTab() {
  const [items, setItems] = useState<NotificationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<NotificationChannel | ''>('');
  const [status, setStatus] = useState<NotificationStatus | ''>('');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNotificationsService.listLogs({
        page,
        limit: 50,
        channel: channel || undefined,
        status: status || undefined,
        search: search.trim() || undefined,
      });
      if (res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, channel, status, search]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  async function retry(id: string) {
    setRetryingId(id);
    try {
      await adminNotificationsService.retry(id);
      void fetch();
    } finally {
      setRetryingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
          placeholder="Search subject / destination / template…"
          style={inputStyle}
        />
        <select
          value={channel}
          onChange={(e) => { setPage(1); setChannel(e.target.value as any); }}
          style={selectStyle}
        >
          <option value="">All channels</option>
          {Object.entries(CHANNEL_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => { setPage(1); setStatus(e.target.value as any); }}
          style={selectStyle}
        >
          <option value="">All statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="RETRY">Retry</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
          No notifications match these filters.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Channel</th>
                <th style={th}>Status</th>
                <th style={th}>To</th>
                <th style={th}>Subject / Template</th>
                <th style={th}>Attempt</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}>{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                  <td style={td}>{CHANNEL_LABEL[l.channel]}</td>
                  <td style={td}>
                    <span style={{
                      background: STATUS_COLOR[l.status] + '20',
                      color: STATUS_COLOR[l.status],
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={td}>
                    <div>{l.destination}</div>
                    {l.recipientId && (
                      <code style={{ fontSize: 10, color: '#9CA3AF' }}>{l.recipientId.slice(0, 8)}…</code>
                    )}
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.subject ?? l.body.slice(0, 80)}
                    </div>
                    {l.templateKey && (
                      <code style={{ fontSize: 10, color: '#6B7280' }}>{l.templateKey}</code>
                    )}
                    {l.failureReason && (
                      <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 2 }}>
                        {l.failureReason}
                      </div>
                    )}
                  </td>
                  <td style={td}>{l.attemptNumber}</td>
                  <td style={td}>
                    <button
                      onClick={() => retry(l.id)}
                      disabled={retryingId === l.id}
                      style={{
                        background: '#fff',
                        border: '1px solid #D2D6DC',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 12,
                        cursor: retryingId === l.id ? 'default' : 'pointer',
                        color: '#0F1115',
                      }}
                    >
                      {retryingId === l.id ? 'Re-queueing…' : 'Resend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn}>
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: '#525A65' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={pageBtn}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

// ── Templates ────────────────────────────────────────────────────

function TemplatesTab() {
  const [items, setItems] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNotificationsService.listTemplates();
      if (res.data) setItems(res.data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(key: string, active: boolean) {
    await adminNotificationsService.toggleActive(key, active);
    void refresh();
  }

  if (editingKey) {
    return (
      <TemplateEditor
        templateKey={editingKey}
        onClose={() => { setEditingKey(null); void refresh(); }}
      />
    );
  }

  return (
    <>
      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading templates…</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>Key</th>
                <th style={th}>Channel</th>
                <th style={th}>Subject</th>
                <th style={th}>Active</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.key} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}><code style={{ fontSize: 12 }}>{t.key}</code></td>
                  <td style={td}>{CHANNEL_LABEL[t.channel]}</td>
                  <td style={{ ...td, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject ?? '—'}
                  </td>
                  <td style={td}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!t.active}
                        onChange={(e) => toggle(t.key, e.target.checked)}
                      />
                      <span style={{ fontSize: 12, color: t.active ? '#16A34A' : '#9CA3AF' }}>
                        {t.active ? 'On' : 'Off'}
                      </span>
                    </label>
                  </td>
                  <td style={td}>
                    <button onClick={() => setEditingKey(t.key)} style={pageBtn}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TemplateEditor({ templateKey, onClose }: { templateKey: string; onClose: () => void }) {
  const [tpl, setTpl] = useState<NotificationTemplate | null>(null);
  const [previewVars, setPreviewVars] = useState<string>('{}');
  const [previewOut, setPreviewOut] = useState<{ subject: string | null; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void adminNotificationsService.getTemplate(templateKey).then((res) => {
      if (res.data) setTpl(res.data);
    });
  }, [templateKey]);

  if (!tpl) return <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await adminNotificationsService.upsertTemplate(templateKey, {
        channel: tpl!.channel,
        subject: tpl!.subject ?? undefined,
        body: tpl!.body,
        description: tpl!.description ?? undefined,
        active: tpl!.active ?? true,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setErr(null);
    try {
      const vars = JSON.parse(previewVars || '{}');
      const res = await adminNotificationsService.preview(templateKey, vars);
      if (res.data) setPreviewOut(res.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid JSON or preview failed');
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
      <button onClick={onClose} style={{ ...pageBtn, marginBottom: 16 }}>← Back</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F1115', margin: 0 }}>
          <code>{tpl.key}</code>
        </h2>
        <span style={{ fontSize: 12, color: '#7A828F' }}>{CHANNEL_LABEL[tpl.channel]}</span>
      </div>
      {tpl.fromDefault && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          Editing the code-side default. Saving creates a DB row that overrides it.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={lbl}>Subject (Email only)</label>
          <input
            type="text"
            value={tpl.subject ?? ''}
            onChange={(e) => setTpl({ ...tpl, subject: e.target.value })}
            style={inputStyle}
            disabled={tpl.channel !== 'EMAIL'}
          />

          <label style={lbl}>Body (Handlebars: {`{{var}}`})</label>
          <textarea
            value={tpl.body}
            onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
            rows={14}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
          />

          <label style={lbl}>Description (admin-only note)</label>
          <input
            type="text"
            value={tpl.description ?? ''}
            onChange={(e) => setTpl({ ...tpl, description: e.target.value })}
            style={inputStyle}
          />

          {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div>
          <label style={lbl}>Preview vars (JSON)</label>
          <textarea
            value={previewVars}
            onChange={(e) => setPreviewVars(e.target.value)}
            rows={4}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
            placeholder='{ "customerName": "Asha", "orderNumber": "SM-001" }'
          />
          <button onClick={runPreview} style={{ ...pageBtn, marginTop: 6 }}>Render preview</button>

          {previewOut && (
            <div style={{ marginTop: 12, border: '1px solid #E5E7EB', borderRadius: 8, padding: 12 }}>
              {previewOut.subject && (
                <>
                  <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5 }}>Subject</div>
                  <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600, marginBottom: 8 }}>
                    {previewOut.subject}
                  </div>
                </>
              )}
              <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5 }}>Body</div>
              <div
                style={{ marginTop: 4, fontSize: 13 }}
                dangerouslySetInnerHTML={{ __html: previewOut.body }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
};
const selectStyle: React.CSSProperties = { ...inputStyle, width: 'auto', minWidth: 140 };
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #D2D6DC',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
  color: '#0F1115',
};
const primaryBtn: React.CSSProperties = {
  ...pageBtn,
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  fontWeight: 600,
};
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#525A65',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginTop: 12,
  marginBottom: 4,
};

// ── Dispatch ─────────────────────────────────────────────────────
//
// Manual one-off notification dispatch. Two modes:
//   - Template path: pick a template key, supply a recipientId + vars;
//     respects user opt-out preferences.
//   - Raw path: pick a channel, supply recipient/to + body; bypasses
//     opt-out — use ONLY for account-security alerts.

type DispatchMode = 'template' | 'raw';

function DispatchTab() {
  const [mode, setMode] = useState<DispatchMode>('template');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ jobId: string; eventId: string } | null>(
    null,
  );

  // Template-mode fields
  const [templateKey, setTemplateKey] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [eventClass, setEventClass] = useState('admin.manual');
  const [varsText, setVarsText] = useState('{}');

  // Raw-mode fields
  const [rawChannel, setRawChannel] = useState<NotificationChannel>('EMAIL');
  const [rawTo, setRawTo] = useState('');
  const [rawSubject, setRawSubject] = useState('');
  const [rawBody, setRawBody] = useState('');
  const [rawEventType, setRawEventType] = useState('admin.manual');

  async function submit() {
    setErr(null);
    setResult(null);
    setSubmitting(true);
    try {
      let payload: DispatchPayload;
      if (mode === 'template') {
        if (!templateKey.trim()) throw new Error('templateKey is required');
        if (!recipientId.trim()) throw new Error('recipientId is required');
        let vars: Record<string, unknown> = {};
        try {
          vars = varsText.trim() ? JSON.parse(varsText) : {};
        } catch {
          throw new Error('Vars must be valid JSON');
        }
        payload = {
          templateKey: templateKey.trim(),
          recipientId: recipientId.trim(),
          vars,
          eventClass: eventClass.trim() || undefined,
        };
      } else {
        if (!rawBody.trim()) throw new Error('Body is required');
        if (!recipientId.trim() && !rawTo.trim()) {
          throw new Error('Either recipientId or "to" is required');
        }
        payload = {
          channel: rawChannel,
          recipientId: recipientId.trim() || undefined,
          to: rawTo.trim() || undefined,
          subject: rawSubject.trim() || undefined,
          body: rawBody,
          eventType: rawEventType.trim() || undefined,
        };
      }
      const res = await adminNotificationsService.dispatch(payload);
      if (res.data) setResult(res.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Dispatch failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        style={{
          padding: '10px 14px',
          background: '#fef3c7',
          border: '1px solid #fde68a',
          color: '#92400e',
          borderRadius: 10,
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <strong>Heads-up:</strong> the <em>raw</em> path bypasses
        recipient opt-out preferences. Reserve it for account-security
        notifications. For routine sends, use the <em>template</em> path.
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['template', 'raw'] as DispatchMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setErr(null);
              setResult(null);
            }}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: mode === m ? '#0F1115' : '#fff',
              color: mode === m ? '#fff' : '#525A65',
              border: `1px solid ${mode === m ? '#0F1115' : '#E5E7EB'}`,
              borderRadius: 9999,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {m} path
          </button>
        ))}
      </div>

      {mode === 'template' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <label style={lbl}>Template key</label>
          <input
            type="text"
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            placeholder="e.g. order.shipped"
            style={inp}
          />

          <label style={lbl}>Recipient ID</label>
          <input
            type="text"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            placeholder="customer / seller / admin UUID"
            style={inp}
          />

          <label style={lbl}>Event class (optional)</label>
          <input
            type="text"
            value={eventClass}
            onChange={(e) => setEventClass(e.target.value)}
            placeholder="admin.manual"
            style={inp}
          />

          <label style={lbl}>Vars (JSON)</label>
          <textarea
            value={varsText}
            onChange={(e) => setVarsText(e.target.value)}
            rows={6}
            style={{ ...inp, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
          />
        </div>
      )}

      {mode === 'raw' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <label style={lbl}>Channel</label>
          <select
            value={rawChannel}
            onChange={(e) => setRawChannel(e.target.value as NotificationChannel)}
            style={inp}
          >
            <option value="EMAIL">EMAIL</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WHATSAPP</option>
          </select>

          <label style={lbl}>Recipient ID (preferred)</label>
          <input
            type="text"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            placeholder="UUID — resolves to the user's saved channel address"
            style={inp}
          />

          <label style={lbl}>
            …or <em>to</em> (raw address)
          </label>
          <input
            type="text"
            value={rawTo}
            onChange={(e) => setRawTo(e.target.value)}
            placeholder="email@example.com or +91..."
            style={inp}
          />

          {rawChannel === 'EMAIL' && (
            <>
              <label style={lbl}>Subject</label>
              <input
                type="text"
                value={rawSubject}
                onChange={(e) => setRawSubject(e.target.value)}
                style={inp}
              />
            </>
          )}

          <label style={lbl}>Body</label>
          <textarea
            value={rawBody}
            onChange={(e) => setRawBody(e.target.value)}
            rows={6}
            style={{ ...inp, resize: 'vertical' }}
          />

          <label style={lbl}>Event type (for audit)</label>
          <input
            type="text"
            value={rawEventType}
            onChange={(e) => setRawEventType(e.target.value)}
            style={inp}
          />
        </div>
      )}

      {err && (
        <div
          style={{
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {err}
        </div>
      )}

      {result && (
        <div
          style={{
            padding: '10px 14px',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            color: '#065f46',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Enqueued — jobId{' '}
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>{result.jobId}</code>{' '}
          (eventId{' '}
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>{result.eventId}</code>)
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          height: 40,
          padding: '0 22px',
          border: 'none',
          background: '#0F1115',
          color: '#fff',
          borderRadius: 9999,
          fontWeight: 600,
          fontSize: 14,
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? 'Dispatching…' : 'Dispatch notification'}
      </button>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
