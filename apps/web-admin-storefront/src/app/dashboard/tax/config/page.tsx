'use client';

// Phase 37 — Tax config (key/value) admin page.
//
// Values are stored as JSON in the DB so the editor accepts any
// JSON-valid input. Plain strings without quotes get auto-quoted
// before saving so an admin typing `9968` saves the number while
// typing `9968 (CGST 0% / IGST 18% — shipping)` saves a string.

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  TaxConfigRow,
} from '@/services/admin-tax.service';

// Convert the value JSON back into a friendly string for the editor.
// Numbers/booleans render as bare; objects + arrays as JSON; strings
// as plain text (no surrounding quotes).
function valueToEditorString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

// Parse the editor string into the JSON value the backend stores.
// Heuristic:
//   1. "true" / "false"        → boolean
//   2. "null"                  → null
//   3. Parses as number        → number
//   4. Parses as JSON          → JSON value
//   5. Anything else           → string (as-is)
function editorStringToValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  // Try strict JSON (objects/arrays); fall back to plain string.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export default function TaxConfigPage() {
  const { notify } = useModal();
  const [rows, setRows] = useState<TaxConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listTaxConfig();
      const list = res.data ?? [];
      setRows(list);
      const init: Record<string, string> = {};
      for (const r of list) init[r.key] = valueToEditorString(r.value);
      setEditValue(init);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (row: TaxConfigRow) => {
    const raw = editValue[row.key] ?? '';
    setSavingKey(row.key);
    try {
      await adminTaxService.upsertTaxConfig({
        key: row.key,
        value: editorStringToValue(raw),
        description: row.description,
      });
      void notify({ kind: 'success', message: `Saved ${row.key}` });
      await refresh();
    } catch (err: any) {
      void notify({
        kind: 'error',
        message: err?.message ?? 'Save failed',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const addNew = async () => {
    setAddError(null);
    if (!newKey.trim()) {
      setAddError('Key is required');
      return;
    }
    setSavingKey('__new__');
    try {
      await adminTaxService.upsertTaxConfig({
        key: newKey.trim(),
        value: editorStringToValue(newValue),
        description: newDesc.trim() || null,
      });
      setShowAdd(false);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      await refresh();
    } catch (err: any) {
      setAddError(err?.message ?? 'Create failed');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1>Tax config</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Runtime knobs read by the tax engine. Cache is invalidated on
        save so changes take effect immediately. Value editor accepts
        numbers (<code>9968</code>), booleans (<code>true</code> /{' '}
        <code>false</code>), null, JSON objects/arrays, and plain
        strings.
      </p>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <button onClick={() => void refresh()} style={btnSecondary}>Refresh</button>
          <button onClick={() => setShowAdd(true)} style={btnPrimary}>+ New key</button>
        </div>
        {loading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Key</th>
                <th style={th}>Value</th>
                <th style={th}>Description</th>
                <th style={th}>Updated</th>
                <th style={th}>Save</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.key}</td>
                  <td style={td}>
                    <input
                      value={editValue[r.key] ?? ''}
                      onChange={(e) =>
                        setEditValue({ ...editValue, [r.key]: e.target.value })
                      }
                      style={{ ...input, fontFamily: 'monospace' }}
                    />
                  </td>
                  <td style={{ ...td, color: '#666', fontSize: 12 }}>
                    {r.description ?? '—'}
                  </td>
                  <td style={{ ...td, color: '#666', fontSize: 11 }}>
                    {new Date(r.updatedAt).toLocaleString()}
                    {r.updatedBy ? ` · ${r.updatedBy}` : ''}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => void save(r)}
                      disabled={savingKey === r.key}
                      style={btnPrimary}
                    >
                      {savingKey === r.key ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#888' }}>
                    No tax_config rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {showAdd && (
        <div style={modalOverlay} onClick={() => savingKey !== '__new__' && setShowAdd(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New tax config key</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={lbl}>Key</label>
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="eway_bill_threshold_paise"
                  style={input}
                />
              </div>
              <div>
                <label style={lbl}>Value</label>
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="5000000"
                  style={{ ...input, fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={lbl}>Description (optional)</label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="EWB threshold in paise (₹50,000)"
                  style={input}
                />
              </div>
              {addError && (
                <div style={{ color: '#dc2626', fontSize: 12 }}>{addError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowAdd(false)}
                  disabled={savingKey === '__new__'}
                  style={btnSecondary}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void addNew()}
                  disabled={savingKey === '__new__' || !newKey.trim()}
                  style={btnPrimary}
                >
                  {savingKey === '__new__' ? 'Saving…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  background: '#f9fafb',
  fontWeight: 600,
};
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, color: '#444', marginBottom: 4 };
const input: React.CSSProperties = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111',
  border: '1px solid #d1d5db',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  width: 'min(460px, 92vw)',
};
