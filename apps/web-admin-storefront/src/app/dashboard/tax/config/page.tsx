'use client';

// Phase 37 — Tax config (key/value) admin page.
//
// Runtime knobs read by the tax engine. Values are stored as JSON in
// the DB; the editor accepts numbers, booleans, null, JSON
// objects/arrays, and plain strings. Cache is invalidated on save so
// changes take effect immediately.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  TaxConfigRow,
} from '@/services/admin-tax.service';

type ValueKind = 'number' | 'boolean' | 'null' | 'string' | 'array' | 'object';
type Tab = 'ALL' | 'NUMBER' | 'BOOLEAN' | 'STRING' | 'JSON';

// ── Page ──────────────────────────────────────────────────────────

export default function TaxConfigPage() {
  const { notify, confirmDialog } = useModal();
  const [rows, setRows] = useState<TaxConfigRow[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('ALL');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Current text in each row's editor (keyed by config key).
  const [editValue, setEditValue] = useState<Record<string, string>>({});
  // Snapshot of the original editor string so we can detect dirty state.
  const [origValue, setOrigValue] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listTaxConfig();
      const list = res.data ?? [];
      setRows(list);
      const init: Record<string, string> = {};
      for (const r of list) init[r.key] = valueToEditorString(r.value);
      setEditValue(init);
      setOrigValue(init);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (row: TaxConfigRow) => {
    const raw = editValue[row.key] ?? '';
    const parsed = editorStringToValue(raw);
    const parsedKind = detectKind(parsed);
    if (parsedKind === 'object' || parsedKind === 'array') {
      const ok = await confirmDialog({
        title: `Save ${parsedKind} value to ${row.key}?`,
        message: `Storing structured JSON — make sure the consuming code expects this shape. Preview: ${truncate(JSON.stringify(parsed), 160)}`,
        confirmText: 'Save',
        cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    setSavingKey(row.key);
    try {
      await adminTaxService.upsertTaxConfig({
        key: row.key,
        value: parsed,
        description: row.description,
      });
      void notify({ kind: 'success', message: `Saved ${row.key}` });
      await refresh();
    } catch (err: any) {
      void notify({ kind: 'error', message: err?.message ?? 'Save failed' });
    } finally {
      setSavingKey(null);
    }
  };

  const revert = (row: TaxConfigRow) => {
    setEditValue((prev) => ({ ...prev, [row.key]: origValue[row.key] ?? '' }));
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    let number = 0, boolean = 0, string = 0, json = 0;
    for (const r of rows) {
      const k = detectKind(r.value);
      if (k === 'number') number++;
      else if (k === 'boolean') boolean++;
      else if (k === 'string' || k === 'null') string++;
      else if (k === 'object' || k === 'array') json++;
    }
    const modified = rows.filter((r) => (editValue[r.key] ?? '') !== (origValue[r.key] ?? '')).length;
    return { number, boolean, string, json, modified };
  }, [rows, editValue, origValue]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab === 'NUMBER')  out = out.filter((r) => detectKind(r.value) === 'number');
    if (tab === 'BOOLEAN') out = out.filter((r) => detectKind(r.value) === 'boolean');
    if (tab === 'STRING')  out = out.filter((r) => {
      const k = detectKind(r.value);
      return k === 'string' || k === 'null';
    });
    if (tab === 'JSON')    out = out.filter((r) => {
      const k = detectKind(r.value);
      return k === 'object' || k === 'array';
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) =>
        r.key.toLowerCase().includes(q)
        || (r.description ?? '').toLowerCase().includes(q)
        || valueToEditorString(r.value).toLowerCase().includes(q)
      );
    }
    return [...out].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, tab, search]);

  const existingKeys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Tax config
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
            Runtime knobs the tax engine reads on every invoice. Cache is invalidated on save so
            changes take effect immediately. Accepts numbers, booleans, null, JSON objects/arrays,
            and plain strings.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={btnPrimary}>
          <PlusIcon size={13} /> New key
        </button>
      </div>

      <KpiStrip counts={counts} total={rows.length} loading={loading && rows.length === 0} />

      <div style={{
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <Tabs current={tab} counts={counts} total={rows.length} onChange={setTab} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 460 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search key, value, description…"
            style={{ ...input, width: '100%', paddingLeft: 36 }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#7A828F', display: 'inline-flex',
          }}>
            <SearchIcon />
          </span>
        </div>
        <button onClick={() => void refresh()} style={btnGhost} disabled={loading}>
          <RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <div style={{
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
        }}>
          <EmptyState tab={tab} hasSearch={Boolean(search.trim())} onCreate={() => setShowAdd(true)} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((r) => {
            const current = editValue[r.key] ?? '';
            const original = origValue[r.key] ?? '';
            const dirty = current !== original;
            const parsed = editorStringToValue(current);
            const parsedKind = detectKind(parsed);
            return (
              <KeyCard
                key={r.key}
                row={r}
                value={current}
                dirty={dirty}
                parsedKind={parsedKind}
                onChange={(v) => setEditValue((prev) => ({ ...prev, [r.key]: v }))}
                onSave={() => void save(r)}
                onRevert={() => revert(r)}
                saving={savingKey === r.key}
              />
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {rows.length} loaded
        {counts.modified > 0 && (
          <>
            {' · '}<span style={{ color: '#b45309', fontWeight: 600 }}>
              {counts.modified} unsaved
            </span>
          </>
        )}
      </p>

      {showAdd && (
        <AddKeyModal
          existingKeys={existingKeys}
          onClose={() => setShowAdd(false)}
          onCreated={async () => { setShowAdd(false); await refresh(); }}
        />
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, total, loading,
}: {
  counts: { number: number; boolean: number; string: number; json: number; modified: number };
  total: number;
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total keys"
        value={total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Runtime config rows on file." />
      <Kpi label="Unsaved edits"
        value={counts.modified.toLocaleString('en-IN')}
        tone={counts.modified > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="Edited in this session but not yet saved." />
      <Kpi label="Numbers"      value={counts.number.toLocaleString('en-IN')}  tone="neutral" loading={loading} />
      <Kpi label="Booleans"     value={counts.boolean.toLocaleString('en-IN')} tone="neutral" loading={loading} />
      <Kpi label="Strings"      value={counts.string.toLocaleString('en-IN')}  tone="neutral" loading={loading} />
      <Kpi label="JSON values"  value={counts.json.toLocaleString('en-IN')}    tone="neutral" loading={loading} />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 22, width: '50%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: KPI_TONE[tone], fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 11, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

function Tabs({
  current, counts, total, onChange,
}: {
  current: Tab;
  counts: { number: number; boolean: number; string: number; json: number };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',     label: 'All',      count: total },
    { key: 'NUMBER',  label: 'Numbers',  count: counts.number },
    { key: 'BOOLEAN', label: 'Booleans', count: counts.boolean },
    { key: 'STRING',  label: 'Strings',  count: counts.string },
    { key: 'JSON',    label: 'JSON',     count: counts.json },
  ];
  return (
    <>
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key} type="button" onClick={() => onChange(t.key)}
            style={active ? tabActive : tabIdle}
          >
            {t.label}
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600,
              padding: '1px 7px', borderRadius: 9999,
              background: active ? '#0F1115' : '#F3F4F6',
              color: active ? '#fff' : '#525A65',
              fontVariantNumeric: 'tabular-nums',
            }}>{t.count}</span>
          </button>
        );
      })}
    </>
  );
}

// ── Key card (row) ────────────────────────────────────────────────

function KeyCard({
  row, value, dirty, parsedKind, onChange, onSave, onRevert, saving,
}: {
  row: TaxConfigRow;
  value: string;
  dirty: boolean;
  parsedKind: ValueKind;
  onChange: (v: string) => void;
  onSave: () => void;
  onRevert: () => void;
  saving: boolean;
}) {
  const multiline = value.length > 60 || value.includes('\n');
  return (
    <div style={{
      background: '#fff',
      border: '1px solid ' + (dirty ? '#fde68a' : '#E5E7EB'),
      borderRadius: 14,
      padding: 16,
      display: 'grid',
      gridTemplateColumns: 'minmax(220px, 280px) 1fr',
      gap: 16,
      transition: 'border-color 120ms ease',
    }}>
      {/* Left: key + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 700,
          color: '#0F1115', wordBreak: 'break-all',
        }}>
          {row.key}
        </div>
        <div style={{ marginTop: 6 }}>
          <KindPill kind={parsedKind} />
          {dirty && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginLeft: 6,
              height: 22, padding: '0 10px', borderRadius: 9999,
              background: '#fef3c7', color: '#b45309',
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#b45309' }} />
              Unsaved
            </span>
          )}
        </div>
        {row.description && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#525A65', lineHeight: 1.5 }}>
            {row.description}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11, color: '#7A828F' }}
             title={new Date(row.updatedAt).toLocaleString('en-IN')}>
          Updated {relTime(new Date(row.updatedAt))}
          {row.updatedBy && (
            <span style={{ fontFamily: 'ui-monospace, monospace', marginLeft: 4 }}>
              · by {row.updatedBy.slice(0, 8)}…
            </span>
          )}
        </div>
      </div>

      {/* Right: editor + actions */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={saving}
            rows={Math.min(8, Math.max(3, value.split('\n').length))}
            style={{
              ...input,
              fontFamily: 'ui-monospace, monospace',
              padding: '10px 12px',
              resize: 'vertical', height: 'auto',
              minHeight: 80,
            }}
          />
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={saving}
            style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
          />
        )}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#7A828F',
        }}>
          <span>
            Parses as <strong style={{ color: '#525A65', fontWeight: 600 }}>{parsedKind}</strong>
            {' · '}
            <button
              type="button"
              onClick={() => onChange(value.length < 60 ? `${value}\n` : value)}
              style={{
                padding: 0, border: 'none', background: 'transparent',
                color: '#525A65', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {multiline ? 'multi-line' : 'single-line'}
            </button>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onRevert}
              disabled={!dirty || saving}
              style={!dirty || saving ? { ...btnGhost, ...busyStyle } : btnGhost}
            >
              Revert
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              style={!dirty || saving ? { ...btnPrimary, ...busyStyle } : btnPrimary}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Kind pill ─────────────────────────────────────────────────────

function KindPill({ kind }: { kind: ValueKind }) {
  const tone =
    kind === 'number'  ? { color: '#1d4ed8', chip: '#dbeafe' } :
    kind === 'boolean' ? { color: '#15803d', chip: '#dcfce7' } :
    kind === 'string'  ? { color: '#b45309', chip: '#fef3c7' } :
    kind === 'null'    ? { color: '#525A65', chip: '#F3F4F6' } :
    kind === 'array'   ? { color: '#7c3aed', chip: '#ede9fe' } :
    kind === 'object'  ? { color: '#7c3aed', chip: '#ede9fe' } :
                          { color: '#525A65', chip: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
      fontFamily: 'ui-monospace, monospace',
    }}>
      {kind}
    </span>
  );
}

// ── Add modal ─────────────────────────────────────────────────────

function AddKeyModal({
  existingKeys, onClose, onCreated,
}: {
  existingKeys: Set<string>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmedKey = key.trim();
  const duplicate = trimmedKey.length > 0 && existingKeys.has(trimmedKey);
  const keyValid = /^[a-z][a-z0-9_]{1,63}$/.test(trimmedKey);
  const valid = keyValid && !duplicate;
  const parsedKind = detectKind(editorStringToValue(value));

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      await adminTaxService.upsertTaxConfig({
        key: trimmedKey,
        value: editorStringToValue(value),
        description: description.trim() || null,
      });
      await onCreated();
    } catch (e: any) {
      setErr(e?.message ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 17, 21, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 24,
          maxWidth: 600, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          New tax config key
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Cache is invalidated on save so the new key takes effect immediately. Use snake_case for
          keys to match the rest of the engine's runtime knobs.
        </p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <Field label="Key *" hint="snake_case · letters, digits, underscore">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64))}
              placeholder="eway_bill_threshold_paise"
              style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
              autoFocus
            />
          </Field>
          <Field label="Value" hint={`Parses as ${parsedKind}`}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="5000000  (or true, false, null, JSON, plain string)"
              style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
          <Field label="Description" hint="Optional — what this knob controls">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="EWB threshold in paise (₹50,000)"
              style={input}
            />
          </Field>
        </div>

        {duplicate && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
          }}>
            <strong>{trimmedKey}</strong> already exists. Edit the existing row inline instead.
          </div>
        )}
        {err && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
          }}>{err}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={btnGhost}>Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy || !valid}
            style={busy || !valid ? { ...btnPrimary, ...busyStyle } : btnPrimary}
          >
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={kpiLabel}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: '#7A828F' }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// ── Empty / skeleton ──────────────────────────────────────────────

function EmptyState({
  tab, hasSearch, onCreate,
}: { tab: Tab; hasSearch: boolean; onCreate: () => void }) {
  let text: string;
  if (hasSearch) text = 'No config keys match your search.';
  else if (tab === 'NUMBER') text = 'No numeric config values yet.';
  else if (tab === 'BOOLEAN') text = 'No boolean config values yet.';
  else if (tab === 'STRING') text = 'No string config values yet.';
  else if (tab === 'JSON') text = 'No structured JSON config values yet.';
  else text = 'No tax_config rows yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <SlidersIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>Nothing here</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>{text}</div>
      {!hasSearch && (
        <button onClick={onCreate} style={{ ...btnPrimary, marginTop: 16 }}>
          <PlusIcon size={13} /> New key
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16,
          display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16,
        }}>
          <div>
            <div style={{ width: '70%', height: 16, background: '#F3F4F6', borderRadius: 4 }} />
            <div style={{ width: 60, height: 22, background: '#F3F4F6', borderRadius: 9999, marginTop: 8 }} />
            <div style={{ width: '90%', height: 12, background: '#F3F4F6', borderRadius: 4, marginTop: 10 }} />
          </div>
          <div>
            <div style={{ width: '100%', height: 36, background: '#F3F4F6', borderRadius: 9 }} />
            <div style={{ width: '40%', height: 12, background: '#F3F4F6', borderRadius: 4, marginTop: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" /><path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" /><path d="M21 21v-5h-5" />
    </svg>
  );
}
function PlusIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function SlidersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h11M19 6h1M4 12h6M14 12h6M4 18h13M21 18h-1" />
      <circle cx="17" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" />
    </svg>
  );
}

// ── Value parsing / formatting ───────────────────────────────────

function valueToEditorString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
    return String(v);
  }
  try { return JSON.stringify(v, null, 2); }
  catch { return ''; }
}

function editorStringToValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); }
    catch { return trimmed; }
  }
  return trimmed;
}

function detectKind(v: unknown): ValueKind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// ── Shared styles ─────────────────────────────────────────────────

const crumb: React.CSSProperties = {
  fontSize: 13, color: '#525A65', textDecoration: 'none',
  marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
};
const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const tabIdle: React.CSSProperties = {
  background: 'transparent', border: 'none',
  padding: '10px 14px', marginBottom: -1,
  fontSize: 13, fontWeight: 600, color: '#525A65',
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  display: 'inline-flex', alignItems: 'center',
};
const tabActive: React.CSSProperties = {
  ...tabIdle, color: '#0F1115', borderBottom: '2px solid #0F1115',
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
