'use client';

// Phase 37 — UQC master admin page.

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  UqcMasterItem,
} from '@/services/admin-tax.service';

export default function UqcMasterPage() {
  const { confirmDialog, notify } = useModal();
  const [rows, setRows] = useState<UqcMasterItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ code: '', description: '' });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listUqc({
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

  const toggleActive = async (row: UqcMasterItem) => {
    const next = !row.isActive;
    const ok = await confirmDialog({
      title: `${next ? 'Reactivate' : 'Deactivate'} UQC ${row.code}?`,
      message: next
        ? 'Reactivating allows new invoices to declare this UQC again.'
        : 'Existing line snapshots that reference this code are unaffected.',
      confirmText: next ? 'Reactivate' : 'Deactivate',
      cancelText: 'Cancel',
      danger: !next,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.updateUqc(row.id, { isActive: next });
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
      await adminTaxService.createUqc({
        code: createForm.code.trim(),
        description: createForm.description.trim(),
      });
      setShowCreate(false);
      setCreateForm({ code: '', description: '' });
      await refresh();
    } catch (err: any) {
      setCreateError(err?.message ?? 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1>UQC master</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        CBIC Unit Quantity Code list. Every tax invoice line must declare
        a UQC under Section 31 / Rule 46.
      </p>

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or description"
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
          <button onClick={() => void refresh()} style={btnSecondary}>Refresh</button>
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>+ New UQC</button>
        </div>

        {loading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Description</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>
                    {r.code}
                  </td>
                  <td style={td}>{r.description}</td>
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
                  <td colSpan={4} style={{ ...td, textAlign: 'center', color: '#888' }}>
                    No UQC rows.
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
            <h2 style={{ marginTop: 0 }}>New UQC row</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={lbl}>Code (2-8 alphanumeric)</label>
                <input
                  value={createForm.code}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })
                  }
                  placeholder="PCS"
                  style={input}
                />
              </div>
              <div>
                <label style={lbl}>Description</label>
                <input
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, description: e.target.value })
                  }
                  placeholder="Pieces"
                  style={input}
                />
              </div>
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
                  disabled={createBusy || !createForm.code || !createForm.description}
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
  width: 'min(420px, 92vw)',
};
