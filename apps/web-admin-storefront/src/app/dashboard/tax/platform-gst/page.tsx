'use client';

// Phase 37 — Platform GST profile admin page.
//
// Sportsmart's OWN GSTINs (one per state where Sportsmart is registered).
// Used as the supplier identity on OWN_BRAND / SPORTSMART supplies. The
// default profile is what the tax engine falls back to when the supplier
// state can't otherwise be resolved.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  PlatformGstProfileItem,
} from '@/services/admin-tax.service';

type Tab = 'ACTIVE' | 'INACTIVE' | 'ALL';

const REG_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED'];

// ── Page ──────────────────────────────────────────────────────────

export default function PlatformGstPage() {
  const { notify, confirmDialog } = useModal();
  const [rows, setRows] = useState<PlatformGstProfileItem[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTaxService.listPlatformGst();
      setRows(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setDefault = async (row: PlatformGstProfileItem) => {
    if (row.isDefault) return;
    const ok = await confirmDialog({
      title: `Set ${row.gstin} as default platform GST?`,
      message: 'OWN_BRAND / SPORTSMART supplies will be issued under this profile. The previous default is demoted but stays active.',
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
    } finally { setBusyId(null); }
  };

  const toggleActive = async (row: PlatformGstProfileItem) => {
    if (row.isDefault && row.isActive) {
      void notify({
        kind: 'error',
        message: 'Cannot deactivate the default profile. Promote another to default first.',
      });
      return;
    }
    const next = !row.isActive;
    const ok = await confirmDialog({
      title: `${next ? 'Reactivate' : 'Deactivate'} ${row.gstin}?`,
      message: next
        ? 'Reactivating allows the tax engine to use this profile again.'
        : 'Deactivating stops the engine from picking this profile for new supplies. Existing snapshots are unaffected.',
      confirmText: next ? 'Reactivate' : 'Deactivate',
      cancelText: 'Cancel',
      danger: !next,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.updatePlatformGst(row.id, { isActive: next });
      await refresh();
    } catch (err: any) {
      void notify({ kind: 'error', message: err?.message ?? 'Update failed' });
    } finally { setBusyId(null); }
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.isActive).length;
    const inactive = rows.length - active;
    const defaultRow = rows.find((r) => r.isDefault) ?? null;
    const stateCodes = new Set(rows.filter((r) => r.isActive).map((r) => r.gstStateCode));
    return { active, inactive, default: defaultRow, states: stateCodes.size };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab === 'ACTIVE')   out = out.filter((r) => r.isActive);
    if (tab === 'INACTIVE') out = out.filter((r) => !r.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) =>
        r.gstin.toLowerCase().includes(q)
        || r.legalBusinessName.toLowerCase().includes(q)
        || r.gstStateCode.toLowerCase().includes(q)
        || (STATE_NAMES[r.gstStateCode] ?? '').toLowerCase().includes(q)
        || (r.panNumber ?? '').toLowerCase().includes(q)
      );
    }
    // Sort: default first, then active, then by state code.
    return [...out].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.gstStateCode.localeCompare(b.gstStateCode);
    });
  }, [rows, tab, search]);

  const noDefaultWarning = !loading && rows.length > 0 && !counts.default;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Platform GST profiles
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
            Sportsmart's own GSTINs. Used as the supplier on OWN_BRAND / SPORTSMART invoices when
            fulfilment doesn't flow through a marketplace seller. Exactly one row must be marked
            default — the engine falls back to it when supplier state can't otherwise be resolved.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          <PlusIcon size={13} /> New profile
        </button>
      </div>

      {noDefaultWarning && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 12, fontSize: 13,
          border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
          display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1.5,
        }}>
          <WarningIcon size={16} />
          <span>
            <strong>No default profile set.</strong> OWN_BRAND / SPORTSMART invoices can't be
            issued until you promote one row to default.
          </span>
        </div>
      )}

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
            placeholder="Search GSTIN, legal name, state, PAN…"
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

      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && rows.length === 0 ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} hasSearch={Boolean(search.trim())} onCreate={() => setShowCreate(true)} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>GSTIN</th>
                <th style={th}>Legal name</th>
                <th style={th}>State</th>
                <th style={th}>Type</th>
                <th style={th}>PAN</th>
                <th style={th}>Status</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Row
                  key={r.id}
                  item={r}
                  busy={busyId === r.id}
                  onSetDefault={() => void setDefault(r)}
                  onToggleActive={() => void toggleActive(r)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {rows.length} loaded
      </p>

      {showCreate && (
        <CreateModal
          existingGstins={new Set(rows.map((r) => r.gstin))}
          hasDefault={Boolean(counts.default)}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await refresh(); }}
        />
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, total, loading,
}: {
  counts: {
    active: number; inactive: number;
    default: PlatformGstProfileItem | null;
    states: number;
  };
  total: number;
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total profiles"
        value={total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="GSTIN rows on file." />
      <Kpi label="Active"
        value={counts.active.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Available to the engine." />
      <Kpi label="States covered"
        value={counts.states.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Distinct active state codes." />
      <Kpi
        label="Current default"
        value={counts.default ? counts.default.gstStateCode : '—'}
        tone={counts.default ? 'neutral' : 'danger'}
        loading={loading}
        hint={counts.default
          ? `${counts.default.gstin}`
          : 'Promote one row to default.'}
      />
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
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: KPI_TONE[tone],
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && (
        <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
             title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

function Tabs({
  current, counts, total, onChange,
}: {
  current: Tab;
  counts: { active: number; inactive: number };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ACTIVE',   label: 'Active',   count: counts.active },
    { key: 'INACTIVE', label: 'Inactive', count: counts.inactive },
    { key: 'ALL',      label: 'All',      count: total },
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

// ── Row ───────────────────────────────────────────────────────────

function Row({
  item, busy, onSetDefault, onToggleActive,
}: {
  item: PlatformGstProfileItem;
  busy: boolean;
  onSetDefault: () => void;
  onToggleActive: () => void;
}) {
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6', opacity: item.isActive ? 1 : 0.7 }}>
      <td style={td}>
        <div style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700,
          color: '#0F1115', letterSpacing: '0.02em',
        }}>
          {item.gstin}
        </div>
      </td>
      <td style={{ ...td, maxWidth: 280 }}>
        <div style={{ fontSize: 13, color: '#0F1115' }}>{item.legalBusinessName}</div>
      </td>
      <td style={td}>
        <div style={{ fontSize: 13, color: '#0F1115', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {item.gstStateCode}
        </div>
        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {STATE_NAMES[item.gstStateCode] ?? '—'}
        </div>
      </td>
      <td style={td}>
        <RegistrationPill reg={item.registrationType} />
      </td>
      <td style={td}>
        {item.panLast4 ? (
          <>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
              ••••{item.panLast4}
            </div>
            {item.panVerified ? (
              <div style={{
                marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 700, color: '#15803d',
                padding: '2px 7px', borderRadius: 9999, background: '#dcfce7',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                <CheckIcon size={10} /> Verified
              </div>
            ) : (
              <div style={{
                marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 700, color: '#b45309',
                padding: '2px 7px', borderRadius: 9999, background: '#fef3c7',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                Unverified
              </div>
            )}
          </>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          {item.isDefault && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 700, color: '#1d4ed8',
              padding: '2px 10px', borderRadius: 9999, background: '#dbeafe',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <StarIcon size={11} /> Default
            </span>
          )}
          <StatusPill active={item.isActive} />
        </div>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onSetDefault}
            disabled={busy || item.isDefault || !item.isActive}
            style={busy || item.isDefault || !item.isActive ? { ...btnSecondary, ...busyStyle } : btnSecondary}
            title={item.isDefault ? 'Already the default' : !item.isActive ? 'Activate first' : 'Promote to default'}
          >
            <StarIcon size={12} /> Set default
          </button>
          <button
            onClick={onToggleActive}
            disabled={busy}
            style={busy ? { ...btnSecondary, ...busyStyle } : btnSecondary}
          >
            {item.isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Pills ─────────────────────────────────────────────────────────

function RegistrationPill({ reg }: { reg: string }) {
  const tone =
    reg === 'REGULAR'      ? { color: '#1d4ed8', chip: '#dbeafe' } :
    reg === 'COMPOSITION'  ? { color: '#b45309', chip: '#fef3c7' } :
    reg === 'UNREGISTERED' ? { color: '#525A65', chip: '#F3F4F6' } :
                              { color: '#525A65', chip: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {reg}
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#15803d' : '#b91c1c',
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: active ? '#15803d' : '#b91c1c' }} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

// ── Create modal ──────────────────────────────────────────────────

function CreateModal({
  existingGstins, hasDefault, onClose, onCreated,
}: {
  existingGstins: Set<string>;
  hasDefault: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    legalBusinessName: '',
    gstin: '',
    registrationType: 'REGULAR',
    panNumber: '',
    isDefault: !hasDefault,
    addressLine1: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const gstin = form.gstin.trim().toUpperCase();
  const pan = form.panNumber.trim().toUpperCase();
  // GSTIN format: 15 chars, [0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]
  const gstinValid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(gstin);
  const panValid = pan === '' || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const duplicate = gstin.length > 0 && existingGstins.has(gstin);
  // Auto-fill state hint from GSTIN's first 2 digits.
  const derivedStateCode = gstin.length >= 2 ? gstin.slice(0, 2) : null;
  const derivedStateName = derivedStateCode ? STATE_NAMES[derivedStateCode] : null;

  const valid =
    form.legalBusinessName.trim().length > 0
    && gstinValid
    && panValid
    && !duplicate;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      await adminTaxService.createPlatformGst({
        legalBusinessName: form.legalBusinessName.trim(),
        gstin,
        registrationType: form.registrationType,
        panNumber: pan || null,
        isDefault: form.isDefault,
        registeredAddressJson: {
          addressLine1: form.addressLine1.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
        },
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
          maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          New platform GST profile
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Add one of Sportsmart's own GSTINs. The state code is derived from the GSTIN's first two
          digits and matched against the CBIC state list.
        </p>

        <h3 style={subhead}>Identity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Legal business name *">
              <input
                value={form.legalBusinessName}
                onChange={(e) => setForm({ ...form, legalBusinessName: e.target.value })}
                placeholder="Sportsmart Retail Pvt Ltd"
                style={input}
              />
            </Field>
          </div>
          <Field label="GSTIN *" hint="15 chars · auto-uppercase">
            <input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15) })}
              placeholder="27ABCDE1234F1Z5"
              style={{ ...input, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em' }}
              autoFocus
            />
            {gstin.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: gstinValid ? '#15803d' : '#7A828F' }}>
                {gstinValid ? (
                  <>
                    ✓ Valid format
                    {derivedStateName && <> · state <strong>{derivedStateCode} {derivedStateName}</strong></>}
                  </>
                ) : (
                  <>Format: 2 digits + 5 letters + 4 digits + 1 letter + 1 alnum + Z + 1 alnum</>
                )}
              </div>
            )}
          </Field>
          <Field label="Registration type">
            <select
              value={form.registrationType}
              onChange={(e) => setForm({ ...form, registrationType: e.target.value })}
              style={input}
            >
              {REG_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="PAN" hint="10 chars · optional">
            <input
              value={form.panNumber}
              onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })}
              placeholder="ABCDE1234F"
              style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
            />
            {pan.length > 0 && !panValid && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>
                Format: 5 letters + 4 digits + 1 letter
              </div>
            )}
          </Field>
        </div>

        <h3 style={subhead}>Registered address</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Address line 1">
              <input
                value={form.addressLine1}
                onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                placeholder="Plot 12, Industrial Estate, Sector 17"
                style={input}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Mumbai"
              style={input}
            />
          </Field>
          <Field label="State">
            <input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              placeholder="Maharashtra"
              style={input}
            />
          </Field>
          <Field label="Pincode">
            <input
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="400001"
              style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
        </div>

        <label style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: '#0F1115', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          <span>
            <strong>Make this the default profile</strong>
            {!hasDefault && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                (recommended — no default currently set)
              </span>
            )}
          </span>
        </label>

        {duplicate && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
          }}>
            <strong>{gstin}</strong> is already on file. Reactivate or promote that row instead.
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
            {busy ? 'Creating…' : 'Create profile'}
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
  if (hasSearch) text = 'No platform GST profiles match your search.';
  else if (tab === 'ACTIVE') text = 'No active platform GST profiles. Add one to enable OWN_BRAND / SPORTSMART invoicing.';
  else if (tab === 'INACTIVE') text = 'No inactive profiles.';
  else text = 'No platform GST profiles on file yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <StoreIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>Nothing here</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 420, margin: '4px auto 0' }}>
        {text}
      </div>
      {!hasSearch && tab !== 'INACTIVE' && (
        <button onClick={onCreate} style={{ ...btnPrimary, marginTop: 16 }}>
          <PlusIcon size={13} /> New profile
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 160, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 200, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 90, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 200, height: 32, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

// ── Indian state codes ────────────────────────────────────────────

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

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
function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}
function StarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
         stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 2 3 7 7 .8-5 5 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.8 9 9z" />
    </svg>
  );
}
function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2 21h20L12 3z" /><path d="M12 9v5M12 17v.01" />
    </svg>
  );
}
function StoreIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9 4 4h16l1 5" /><path d="M3 9v11h18V9" />
      <path d="M3 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3" />
    </svg>
  );
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
const subhead: React.CSSProperties = {
  fontSize: 13, color: '#525A65', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
  margin: '20px 0 12px 0',
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
const btnSecondary: React.CSSProperties = {
  height: 32, padding: '0 14px',
  background: '#fff', color: '#0F1115',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'top',
};
