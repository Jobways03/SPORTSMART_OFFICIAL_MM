'use client';

// Phase 37 — HSN master admin page.
//
// Read + create + edit the CBIC HSN code list. Rate changes are
// effective-dated: a new row supersedes the prior active one for
// the same code (the service closes the prior row's effectiveTo).

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  HsnMasterItem,
} from '@/services/admin-tax.service';

const TAXABILITY_OPTIONS = [
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE',
];

export default function HsnMasterPage() {
  const { confirmDialog, notify } = useModal();
  const [rows, setRows] = useState<HsnMasterItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    hsnCode: '',
    description: '',
    defaultGstRateBps: 1800,
    supplyTaxability: 'TAXABLE',
    defaultUqcCode: '',
    categoryHint: '',
    effectiveFrom: '',
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listHsn({
        search: search || undefined,
        activeOnly,
      });
      setRows(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, activeOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleActive = async (row: HsnMasterItem) => {
    const next = !row.isActive;
    const ok = await confirmDialog({
      title: `${next ? 'Reactivate' : 'Deactivate'} HSN ${row.hsnCode}?`,
      message: next
        ? 'Reactivating allows the engine to use this row again.'
        : 'Deactivating stops the engine from selecting this row for new tax calculations. Existing snapshots are unaffected.',
      confirmText: next ? 'Reactivate' : 'Deactivate',
      cancelText: 'Cancel',
      danger: !next,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.updateHsn(row.id, { isActive: next });
      await refresh();
    } catch (err: any) {
      void notify({
        kind: 'error',
        message: err?.message ?? 'Update failed',
      });
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = async () => {
    setCreateError(null);
    setCreateBusy(true);
    try {
      await adminTaxService.createHsn({
        hsnCode: createForm.hsnCode.trim(),
        description: createForm.description.trim(),
        defaultGstRateBps: createForm.defaultGstRateBps,
        supplyTaxability: createForm.supplyTaxability,
        defaultUqcCode: createForm.defaultUqcCode.trim() || null,
        categoryHint: createForm.categoryHint.trim() || null,
        effectiveFrom: createForm.effectiveFrom || undefined,
      });
      setShowCreate(false);
      setCreateForm({
        hsnCode: '',
        description: '',
        defaultGstRateBps: 1800,
        supplyTaxability: 'TAXABLE',
        defaultUqcCode: '',
        categoryHint: '',
        effectiveFrom: '',
      });
      await refresh();
    } catch (err: any) {
      setCreateError(err?.message ?? 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1>HSN master</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        CBIC HSN code list. Rate changes add a new effective-dated row;
        the prior row's effective window is automatically closed.
      </p>

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, description, category"
            style={{ ...input, flex: 1 }}
          />
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            Active only
          </label>
          <button onClick={() => void refresh()} style={btnSecondary}>
            Refresh
          </button>
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>
            + New HSN
          </button>
        </div>

        {loading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>HSN code</th>
                <th style={th}>Description</th>
                <th style={{ ...th, textAlign: 'right' }}>Rate (bps)</th>
                <th style={th}>Taxability</th>
                <th style={th}>UQC</th>
                <th style={th}>Category</th>
                <th style={th}>Effective</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.hsnCode}</td>
                  <td style={td}>{r.description}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {r.defaultGstRateBps} ({(r.defaultGstRateBps / 100).toFixed(2)}%)
                  </td>
                  <td style={td}>{r.supplyTaxability}</td>
                  <td style={td}>{r.defaultUqcCode ?? '—'}</td>
                  <td style={td}>{r.categoryHint ?? '—'}</td>
                  <td style={{ ...td, fontSize: 11 }}>
                    {new Date(r.effectiveFrom).toLocaleDateString()}
                    {r.effectiveTo
                      ? ` – ${new Date(r.effectiveTo).toLocaleDateString()}`
                      : ' – current'}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: r.isActive ? '#dcfce7' : '#fee2e2',
                        color: r.isActive ? '#166534' : '#991b1b',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {r.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => void toggleActive(r)}
                      disabled={busyId === r.id}
                      style={btnSecondary}
                    >
                      {busyId === r.id
                        ? '…'
                        : r.isActive
                        ? 'Deactivate'
                        : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#888' }}>
                    No HSN rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {showCreate && (
        <div style={modalOverlay} onClick={() => !createBusy && setShowCreate(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New HSN row</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <Field
                label="HSN code (4-8 digits)"
                value={createForm.hsnCode}
                onChange={(v) => setCreateForm({ ...createForm, hsnCode: v.replace(/\D/g, '') })}
                placeholder="61091000"
              />
              <Field
                label="Description"
                value={createForm.description}
                onChange={(v) => setCreateForm({ ...createForm, description: v })}
                placeholder="T-shirts, singlets and other vests, knitted or crocheted"
              />
              <Field
                label="Default GST rate (bps; e.g. 1800 = 18%)"
                value={String(createForm.defaultGstRateBps)}
                onChange={(v) =>
                  setCreateForm({
                    ...createForm,
                    defaultGstRateBps: Number(v) || 0,
                  })
                }
                inputType="number"
              />
              <div>
                <label style={lbl}>Supply taxability</label>
                <select
                  value={createForm.supplyTaxability}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, supplyTaxability: e.target.value })
                  }
                  style={input}
                >
                  {TAXABILITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <Field
                label="Default UQC code (optional)"
                value={createForm.defaultUqcCode}
                onChange={(v) => setCreateForm({ ...createForm, defaultUqcCode: v })}
                placeholder="PCS"
              />
              <Field
                label="Category hint (optional)"
                value={createForm.categoryHint}
                onChange={(v) => setCreateForm({ ...createForm, categoryHint: v })}
                placeholder="apparel"
              />
              <Field
                label="Effective from (ISO date; default = now)"
                value={createForm.effectiveFrom}
                onChange={(v) => setCreateForm({ ...createForm, effectiveFrom: v })}
                placeholder="2026-04-01"
              />
              {createError && (
                <div style={{ color: '#dc2626', fontSize: 12 }}>{createError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowCreate(false)}
                  disabled={createBusy}
                  style={btnSecondary}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submitCreate()}
                  disabled={
                    createBusy ||
                    !createForm.hsnCode ||
                    !createForm.description
                  }
                  style={btnPrimary}
                >
                  {createBusy ? 'Saving…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputType?: string;
}) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input
        type={inputType ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={input}
      />
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
  width: 'min(540px, 92vw)',
  maxHeight: '90vh',
  overflowY: 'auto',
};
