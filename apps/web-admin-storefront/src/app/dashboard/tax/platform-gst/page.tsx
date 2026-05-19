'use client';

// Phase 37 — Platform GST profile admin page.
//
// Manages Sportsmart's OWN GSTINs (one per state where Sportsmart is
// registered). Used as the supplier identity for OWN_BRAND / SPORTSMART
// supplies — no marketplace seller in the loop. The default profile is
// the one the tax engine falls back to when fulfilment is platform-owned.

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  PlatformGstProfileItem,
} from '@/services/admin-tax.service';

const REG_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED'];

export default function PlatformGstPage() {
  const { notify, confirmDialog } = useModal();
  const [rows, setRows] = useState<PlatformGstProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    legalBusinessName: '',
    gstin: '',
    registrationType: 'REGULAR',
    panNumber: '',
    isDefault: false,
    addressLine1: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listPlatformGst();
      setRows(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setDefault = async (row: PlatformGstProfileItem) => {
    if (row.isDefault) return;
    const ok = await confirmDialog({
      title: `Set ${row.gstin} as default platform GST?`,
      message:
        'OWN_BRAND / SPORTSMART supplies will be issued under this profile. The previous default is demoted but stays active.',
      confirmText: 'Set default',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.setDefaultPlatformGst(row.id);
      await refresh();
    } catch (err: any) {
      void notify({ kind: 'error', message: err?.message ?? 'Set default failed' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (row: PlatformGstProfileItem) => {
    if (row.isDefault && row.isActive) {
      void notify({
        kind: 'error',
        message: 'Cannot deactivate the default profile. Promote another first.',
      });
      return;
    }
    const next = !row.isActive;
    setBusyId(row.id);
    try {
      await adminTaxService.updatePlatformGst(row.id, { isActive: next });
      await refresh();
    } catch (err: any) {
      void notify({ kind: 'error', message: err?.message ?? 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = async () => {
    setCreateError(null);
    setCreateBusy(true);
    try {
      await adminTaxService.createPlatformGst({
        legalBusinessName: createForm.legalBusinessName.trim(),
        gstin: createForm.gstin.trim().toUpperCase(),
        registrationType: createForm.registrationType,
        panNumber: createForm.panNumber.trim().toUpperCase() || null,
        isDefault: createForm.isDefault,
        registeredAddressJson: {
          addressLine1: createForm.addressLine1.trim(),
          city: createForm.city.trim(),
          state: createForm.state.trim(),
          pincode: createForm.pincode.trim(),
        },
      });
      setShowCreate(false);
      setCreateForm({
        legalBusinessName: '',
        gstin: '',
        registrationType: 'REGULAR',
        panNumber: '',
        isDefault: false,
        addressLine1: '',
        city: '',
        state: '',
        pincode: '',
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
      <h1>Platform GST profiles</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Sportsmart's own GSTINs. Used as the supplier on OWN_BRAND /
        SPORTSMART invoices when fulfilment doesn't flow through a
        marketplace seller. Exactly one row should be marked default;
        the engine falls back to it when the supplier state can't be
        otherwise resolved.
      </p>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => void refresh()} style={btnSecondary}>Refresh</button>
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>+ New profile</button>
        </div>
        {loading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>GSTIN</th>
                <th style={th}>Legal name</th>
                <th style={th}>State</th>
                <th style={th}>Type</th>
                <th style={th}>PAN</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.gstin}</td>
                  <td style={td}>{r.legalBusinessName}</td>
                  <td style={td}>{r.gstStateCode}</td>
                  <td style={td}>{r.registrationType}</td>
                  <td style={td}>
                    {r.panLast4 ? `····${r.panLast4}` : '—'}
                  </td>
                  <td style={td}>
                    {r.isDefault && (
                      <span style={{ ...badge, background: '#dbeafe', color: '#1e40af' }}>
                        DEFAULT
                      </span>
                    )}{' '}
                    <span
                      style={{
                        ...badge,
                        background: r.isActive ? '#dcfce7' : '#fee2e2',
                        color: r.isActive ? '#166534' : '#991b1b',
                      }}
                    >
                      {r.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => void setDefault(r)}
                      disabled={busyId === r.id || r.isDefault || !r.isActive}
                      style={btnSecondary}
                    >
                      Set default
                    </button>{' '}
                    <button
                      onClick={() => void toggleActive(r)}
                      disabled={busyId === r.id}
                      style={btnSecondary}
                    >
                      {r.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#888' }}>
                    No platform GST profiles. Create the first one to enable
                    OWN_BRAND / SPORTSMART invoicing.
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
            <h2 style={{ marginTop: 0 }}>New platform GST profile</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <Field
                label="Legal business name"
                value={createForm.legalBusinessName}
                onChange={(v) => setCreateForm({ ...createForm, legalBusinessName: v })}
                placeholder="Sportsmart Retail Pvt Ltd"
              />
              <Field
                label="GSTIN (15 chars)"
                value={createForm.gstin}
                onChange={(v) =>
                  setCreateForm({ ...createForm, gstin: v.toUpperCase() })
                }
                placeholder="27ABCDE1234F1Z5"
              />
              <div>
                <label style={lbl}>Registration type</label>
                <select
                  value={createForm.registrationType}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, registrationType: e.target.value })
                  }
                  style={input}
                >
                  {REG_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <Field
                label="PAN (optional, 10 chars)"
                value={createForm.panNumber}
                onChange={(v) =>
                  setCreateForm({ ...createForm, panNumber: v.toUpperCase() })
                }
                placeholder="ABCDE1234F"
              />
              <Field
                label="Address line 1"
                value={createForm.addressLine1}
                onChange={(v) => setCreateForm({ ...createForm, addressLine1: v })}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Field
                    label="City"
                    value={createForm.city}
                    onChange={(v) => setCreateForm({ ...createForm, city: v })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Field
                    label="State"
                    value={createForm.state}
                    onChange={(v) => setCreateForm({ ...createForm, state: v })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Field
                    label="Pincode"
                    value={createForm.pincode}
                    onChange={(v) => setCreateForm({ ...createForm, pincode: v })}
                  />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={createForm.isDefault}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, isDefault: e.target.checked })
                  }
                />
                Make this the default profile
              </label>
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
                    !createForm.legalBusinessName.trim() ||
                    !createForm.gstin.trim()
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input
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
const badge: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
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
  width: 'min(560px, 92vw)',
  maxHeight: '90vh',
  overflowY: 'auto',
};
