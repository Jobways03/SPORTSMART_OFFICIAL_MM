'use client';

// Phase 37 — UQC master admin page.
//
// CBIC Unit Quantity Codes referenced on every Tax Invoice line under
// Section 31 / Rule 46. Codes are alphanumeric (typically 3 letters).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  UqcMasterItem,
} from '@/services/admin-tax.service';

type Tab = 'ACTIVE' | 'INACTIVE' | 'ALL';

// Common CBIC UQC presets surfaced as quick-pick suggestions in the
// create form. Not exhaustive — admins can type any code.
const COMMON_PRESETS: Array<{ code: string; description: string }> = [
  { code: 'PCS', description: 'Pieces' },
  { code: 'NOS', description: 'Numbers' },
  { code: 'KGS', description: 'Kilograms' },
  { code: 'GMS', description: 'Grams' },
  { code: 'LTR', description: 'Litres' },
  { code: 'MTR', description: 'Metres' },
  { code: 'PRS', description: 'Pairs' },
  { code: 'SET', description: 'Sets' },
  { code: 'BOX', description: 'Boxes' },
  { code: 'DOZ', description: 'Dozen' },
];

// ── Page ──────────────────────────────────────────────────────────

export default function UqcMasterPage() {
  const { confirmDialog, notify } = useModal();
  const [rows, setRows] = useState<UqcMasterItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Phase 161 #11 — deactivation now requires a reason; modal collects it.
  const [deactivateRow, setDeactivateRow] = useState<UqcMasterItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Phase 161 #8 — the endpoint paginates (cap 200).
      const res = await adminTaxService.listUqc({ search: search || undefined, limit: 200 });
      setRows(res.data?.items ?? []);
      setTotal(res.data?.total ?? res.data?.items?.length ?? 0);
      setHasMore(res.data?.hasMore ?? false);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleActive = async (row: UqcMasterItem) => {
    // Phase 161 #11/#5 — deactivation routes through the reason modal.
    if (row.isActive) {
      setDeactivateRow(row);
      return;
    }
    const ok = await confirmDialog({
      title: `Reactivate UQC ${row.code}?`,
      message: 'Reactivating lets new invoices declare this UQC again.',
      confirmText: 'Reactivate',
      cancelText: 'Cancel',
      danger: false,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.updateUqc(row.id, { isActive: true, expectedVersion: row.version });
      await refresh();
    } catch (err: any) {
      void notify({ kind: 'error', message: err?.message ?? 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.isActive).length;
    const inactive = rows.length - active;
    return { active, inactive };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab === 'ACTIVE')   out = out.filter((r) => r.isActive);
    if (tab === 'INACTIVE') out = out.filter((r) => !r.isActive);
    return [...out].sort((a, b) => a.code.localeCompare(b.code));
  }, [rows, tab]);

  const existingCodes = useMemo(() => new Set(rows.map((r) => r.code.toUpperCase())), [rows]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            UQC master
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 680, lineHeight: 1.5 }}>
            CBIC Unit Quantity Code list. Every Tax Invoice line declares a UQC under Section 31 /
            Rule 46 — these codes appear on the printed invoice and in the GSTR-1 §12 HSN summary.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          <PlusIcon size={13} /> New UQC
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
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or description…"
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
                <th style={{ ...th, width: 140 }}>Code</th>
                <th style={th}>Description</th>
                <th style={{ ...th, width: 140 }}>Status</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Row
                  key={r.id}
                  item={r}
                  busy={busyId === r.id}
                  onToggle={() => void toggleActive(r)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} shown · {rows.length} loaded of {total.toLocaleString('en-IN')} total
        {hasMore ? ' · refine your search to narrow the list' : ''}
      </p>

      {showCreate && (
        <CreateModal
          existingCodes={existingCodes}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await refresh(); }}
        />
      )}

      {deactivateRow && (
        <DeactivateModal
          row={deactivateRow}
          onClose={() => setDeactivateRow(null)}
          onDone={async () => { setDeactivateRow(null); await refresh(); }}
        />
      )}
    </div>
  );
}

// ── Deactivate modal (Phase 161 #5/#11) ───────────────────────────

function DeactivateModal({
  row, onClose, onDone,
}: { row: UqcMasterItem; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      await adminTaxService.updateUqc(row.id, {
        isActive: false,
        deactivationReason: reason.trim(),
        force,
        expectedVersion: row.version,
      });
      await onDone();
    } catch (e: any) {
      // A reference guard (409) surfaces here — tick "force" + retry.
      setErr(e?.message ?? 'Deactivate failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 17, 21, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 24,
          maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Deactivate UQC {row.code}?
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          New invoices won&apos;t be able to pick this UQC. Existing line snapshots are unaffected.
          A reason is recorded on the audit trail.
        </p>

        <div style={{ marginTop: 16 }}>
          <Field label="Reason *" hint="min 5 characters">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Replaced by PCS per the 2026 UQC consolidation"
              rows={3}
              style={{ ...input, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
            />
          </Field>
          <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#0F1115' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force — deactivate even if HSN rows / products still reference this code
          </label>
        </div>

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
            disabled={busy || reason.trim().length < 5}
            style={busy || reason.trim().length < 5
              ? { ...btnPrimary, ...busyStyle, background: '#b91c1c', border: '1px solid #b91c1c' }
              : { ...btnPrimary, background: '#b91c1c', border: '1px solid #b91c1c' }}
          >
            {busy ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, total, loading,
}: {
  counts: { active: number; inactive: number };
  total: number;
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total codes"
        value={total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="UQC entries on file." />
      <Kpi label="Active"
        value={counts.active.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Available to new invoices." />
      <Kpi label="Inactive"
        value={counts.inactive.toLocaleString('en-IN')}
        tone={counts.inactive > 0 ? 'warning' : 'muted'} loading={loading}
        hint="Hidden from new invoices. Past snapshots keep working." />
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
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: KPI_TONE[tone], fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
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
  item, busy, onToggle,
}: { item: UqcMasterItem; busy: boolean; onToggle: () => void }) {
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6', opacity: item.isActive ? 1 : 0.7 }}>
      <td style={td}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: '#0F1115',
          padding: '4px 10px', borderRadius: 9, background: '#F3F4F6',
          letterSpacing: '0.06em',
        }}>
          {item.code}
        </span>
      </td>
      <td style={td}>
        <div style={{ fontSize: 13, color: '#0F1115' }}>{item.description}</div>
      </td>
      <td style={td}>
        <StatusPill active={item.isActive} />
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button
          onClick={onToggle}
          disabled={busy}
          style={busy ? { ...btnSecondary, ...busyStyle } : btnSecondary}
        >
          {busy ? 'Working…' : item.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </td>
    </tr>
  );
}

// ── Pills ─────────────────────────────────────────────────────────

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
  existingCodes, onClose, onCreated,
}: {
  existingCodes: Set<string>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const normalisedCode = code.trim().toUpperCase();
  const duplicate = normalisedCode.length > 0 && existingCodes.has(normalisedCode);
  const codeValid = /^[A-Z0-9]{2,8}$/.test(normalisedCode);
  const valid = codeValid && description.trim().length > 0 && !duplicate;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      await adminTaxService.createUqc({
        code: normalisedCode,
        description: description.trim(),
      });
      await onCreated();
    } catch (e: any) {
      setErr(e?.message ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const availablePresets = COMMON_PRESETS.filter((p) => !existingCodes.has(p.code));

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
          maxWidth: 520, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          New UQC row
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Add a Unit Quantity Code. Codes are 2–8 alphanumeric characters and unique across the
          system. Use the presets below if a common code is still missing.
        </p>

        {availablePresets.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={kpiLabel}>Common presets (not yet on file)</div>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availablePresets.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => { setCode(p.code); setDescription(p.description); }}
                  style={{
                    height: 28, padding: '0 10px',
                    border: '1px solid #D2D6DC', borderRadius: 9999,
                    background: '#fff', color: '#0F1115',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                  title={p.description}
                >
                  {p.code}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
          <Field label="Code *" hint="2–8 alphanumeric">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="PCS"
              style={{ ...input, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.06em' }}
              autoFocus
            />
          </Field>
          <Field label="Description *">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pieces"
              style={input}
            />
          </Field>
        </div>

        {duplicate && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
          }}>
            <strong>{normalisedCode}</strong> is already on file. Reactivate the existing row
            instead of creating a duplicate.
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
            {busy ? 'Creating…' : 'Create UQC'}
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
  if (hasSearch) text = 'No UQC codes match your search.';
  else if (tab === 'ACTIVE') text = 'No active UQC codes. Add one to get started.';
  else if (tab === 'INACTIVE') text = 'No inactive UQC codes.';
  else text = 'No UQC rows on file yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <RulerIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>Nothing here</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>{text}</div>
      {!hasSearch && tab !== 'INACTIVE' && (
        <button onClick={onCreate} style={{ ...btnPrimary, marginTop: 16 }}>
          <PlusIcon size={13} /> New UQC
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 80, height: 24, background: '#F3F4F6', borderRadius: 9 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 100, height: 32, background: '#F3F4F6', borderRadius: 9999 }} />
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
function RulerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17 17 3l4 4L7 21z" />
      <path d="m7 7 2 2M11 11l2 2M15 15l2 2" />
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
  verticalAlign: 'middle',
};
