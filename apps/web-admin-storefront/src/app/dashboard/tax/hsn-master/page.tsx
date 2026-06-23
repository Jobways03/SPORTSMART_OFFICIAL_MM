'use client';

// Phase 37 — HSN master admin page.
//
// CBIC HSN code list with effective-dated rate history. Adding a new
// row for an existing code closes the prior row's effectiveTo and
// supersedes it. Inactive rows are skipped by the tax engine.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  HsnMasterItem,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'ACTIVE' | 'TAXABLE' | 'EXEMPT' | 'SUPERSEDED';

const TAXABILITY_OPTIONS = [
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE',
];

const RATE_PRESETS_BPS = [0, 500, 1200, 1800, 2800];

// ── Page ──────────────────────────────────────────────────────────

export default function HsnMasterPage() {
  const { confirmDialog, notify } = useModal();
  const [rows, setRows] = useState<HsnMasterItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Phase 161 #11 — deactivation now requires a reason; modal collects it.
  const [deactivateRow, setDeactivateRow] = useState<HsnMasterItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Phase 161 #9 — the endpoint paginates. Pull a generous first page
      // (cap 200) for the client-side tabs/KPIs; `total`/`hasMore` tell the
      // operator when the catalogue exceeds the loaded window.
      const res = await adminTaxService.listHsn({ search: search || undefined, limit: 200 });
      setRows(res.data?.items ?? []);
      setTotal(res.data?.total ?? res.data?.items?.length ?? 0);
      setHasMore(res.data?.hasMore ?? false);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleActive = async (row: HsnMasterItem) => {
    // Phase 161 #11/#5 — deactivation routes through the reason modal
    // (captures reason + lets the admin force past the live-reference guard).
    if (row.isActive) {
      setDeactivateRow(row);
      return;
    }
    // Reactivation needs no reason.
    const ok = await confirmDialog({
      title: `Reactivate HSN ${row.hsnCode}?`,
      message: 'Reactivating allows the tax engine to pick this row again for new calculations.',
      confirmText: 'Reactivate',
      cancelText: 'Cancel',
      danger: false,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await adminTaxService.updateHsn(row.id, { isActive: true, expectedVersion: row.version });
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
    const taxable = rows.filter((r) => r.supplyTaxability === 'TAXABLE').length;
    const exempt = rows.filter((r) =>
      r.supplyTaxability === 'EXEMPT' || r.supplyTaxability === 'NIL_RATED' || r.supplyTaxability === 'ZERO_RATED'
    ).length;
    const superseded = rows.filter((r) => r.effectiveTo).length;
    return { active, inactive, taxable, exempt, superseded };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab === 'ACTIVE')     out = out.filter((r) => r.isActive);
    if (tab === 'TAXABLE')    out = out.filter((r) => r.supplyTaxability === 'TAXABLE');
    if (tab === 'EXEMPT')     out = out.filter((r) =>
      r.supplyTaxability === 'EXEMPT' || r.supplyTaxability === 'NIL_RATED' || r.supplyTaxability === 'ZERO_RATED'
    );
    if (tab === 'SUPERSEDED') out = out.filter((r) => r.effectiveTo);
    return [...out].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));
  }, [rows, tab]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            HSN master
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
            CBIC HSN code list with effective-dated rate history. Adding a row for an existing code
            supersedes the prior row's effective window. Inactive rows are skipped by the tax engine.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          <PlusIcon size={13} /> New HSN row
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
            placeholder="Search code, description, category…"
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
          <EmptyState tab={tab} hasSearch={Boolean(search.trim())} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>HSN code</th>
                <th style={th}>Description</th>
                <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                <th style={th}>Taxability</th>
                <th style={th}>UQC</th>
                <th style={th}>Category</th>
                <th style={th}>Effective</th>
                <th style={th}>Status</th>
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
}: { row: HsnMasterItem; onClose: () => void; onDone: () => Promise<void> }) {
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
      await adminTaxService.updateHsn(row.id, {
        isActive: false,
        deactivationReason: reason.trim(),
        force,
        expectedVersion: row.version,
      });
      await onDone();
    } catch (e: any) {
      // A live-reference guard (409) surfaces here — the admin can tick
      // "force" and retry once they understand the impact.
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
          Deactivate HSN {row.hsnCode}?
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          The tax engine will stop selecting this row for new calculations. Existing invoice
          snapshots are unaffected. A reason is recorded on the audit trail.
        </p>

        <div style={{ marginTop: 16 }}>
          <Field label="Reason *" hint="min 5 characters">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. CBIC merged this heading into 6109 from 01-Apr-2026"
              rows={3}
              style={{ ...input, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
            />
          </Field>
          <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#0F1115' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force — deactivate even if live products still reference this code
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
  counts: { active: number; inactive: number; taxable: number; exempt: number; superseded: number };
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
        hint="HSN rows on file (active + history)." />
      <Kpi label="Active"
        value={counts.active.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Available to the tax engine right now." />
      <Kpi label="Taxable"
        value={counts.taxable.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Supply taxability = TAXABLE." />
      <Kpi label="Exempt / nil / zero"
        value={counts.exempt.toLocaleString('en-IN')}
        tone="muted" loading={loading}
        hint="Non-taxable supply variants." />
      <Kpi label="Superseded"
        value={counts.superseded.toLocaleString('en-IN')}
        tone={counts.superseded > 0 ? 'warning' : 'muted'} loading={loading}
        hint="Rows with effectiveTo set — replaced by a newer rate row." />
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
  counts: { active: number; taxable: number; exempt: number; superseded: number };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ACTIVE',     label: 'Active',      count: counts.active },
    { key: 'TAXABLE',    label: 'Taxable',     count: counts.taxable },
    { key: 'EXEMPT',     label: 'Exempt/nil',  count: counts.exempt },
    { key: 'SUPERSEDED', label: 'Superseded',  count: counts.superseded },
    { key: 'ALL',        label: 'All',         count: total },
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
}: { item: HsnMasterItem; busy: boolean; onToggle: () => void }) {
  const superseded = Boolean(item.effectiveTo);
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6', opacity: item.isActive ? 1 : 0.7 }}>
      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: '#0F1115' }}>
          {item.hsnCode}
        </div>
        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {item.hsnCode.length}-digit
        </div>
      </td>

      <td style={{ ...td, maxWidth: 320 }}>
        <DescriptionCell text={item.description} />
      </td>

      <td style={{ ...td, textAlign: 'right' }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: '#0F1115',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {bpsToPercent(item.defaultGstRateBps)}%
        </div>
        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {item.defaultGstRateBps} bps
        </div>
      </td>

      <td style={td}>
        <TaxabilityPill kind={item.supplyTaxability} />
      </td>

      <td style={td}>
        {item.defaultUqcCode ? (
          <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 12,
            padding: '2px 8px', borderRadius: 9999,
            background: '#F3F4F6', color: '#525A65', fontWeight: 600,
          }}>
            {item.defaultUqcCode}
          </span>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>

      <td style={td}>
        {item.categoryHint ? (
          <span style={{ fontSize: 12, color: '#525A65' }}>{item.categoryHint}</span>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>

      <td style={td}>
        <div style={{ fontSize: 12, color: '#0F1115' }}>
          {new Date(item.effectiveFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div style={{ fontSize: 11, color: superseded ? '#b45309' : '#15803d', fontWeight: 600, marginTop: 2 }}>
          {item.effectiveTo
            ? `→ ${new Date(item.effectiveTo).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : '→ current'}
        </div>
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

function DescriptionCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 110;
  const display = expanded || !long ? text : text.slice(0, 110).trim() + '…';
  return (
    <div style={{ fontSize: 13, color: '#0F1115', lineHeight: 1.45 }}>
      {display}
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginLeft: 6, padding: 0, border: 'none', background: 'transparent',
            color: '#0F1115', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

// ── Pills ─────────────────────────────────────────────────────────

function TaxabilityPill({ kind }: { kind: string }) {
  const tone =
    kind === 'TAXABLE'      ? { color: '#1d4ed8', chip: '#dbeafe' } :
    kind === 'ZERO_RATED'   ? { color: '#15803d', chip: '#dcfce7' } :
    kind === 'NIL_RATED'    ? { color: '#525A65', chip: '#F3F4F6' } :
    kind === 'EXEMPT'       ? { color: '#525A65', chip: '#F3F4F6' } :
    kind === 'NON_GST'      ? { color: '#9a3412', chip: '#ffedd5' } :
    kind === 'OUT_OF_SCOPE' ? { color: '#7c3aed', chip: '#ede9fe' } :
                              { color: '#525A65', chip: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {kind.replace(/_/g, ' ')}
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
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    hsnCode: '',
    description: '',
    defaultGstRateBps: 1800,
    supplyTaxability: 'TAXABLE',
    defaultUqcCode: '',
    categoryHint: '',
    effectiveFrom: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // UQC options for the Default UQC dropdown — loaded from the UQC master so the
  // list always matches what the backend accepts (hsn-master.service.resolveUqc
  // rejects any code not active in uqc_master). The master is seeded with the
  // full CBIC UQC list (seed-tax-master UQC_LIST), so this offers ALL units —
  // not just the PCS/KGS the old free-text "e.g." hint implied.
  const [uqcOptions, setUqcOptions] = useState<{ code: string; description: string }[]>([]);
  useEffect(() => {
    let active = true;
    void adminTaxService
      .listUqc({ activeOnly: true, limit: 200 })
      .then((res) => {
        if (active) {
          setUqcOptions(
            (res.data?.items ?? []).map((u) => ({ code: u.code, description: u.description })),
          );
        }
      })
      .catch(() => {
        /* leave empty — the field still submits whatever was previously set */
      });
    return () => {
      active = false;
    };
  }, []);

  const valid =
    form.hsnCode.length >= 4 && form.hsnCode.length <= 8
    && form.description.trim().length > 0
    && form.defaultGstRateBps >= 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      await adminTaxService.createHsn({
        hsnCode: form.hsnCode.trim(),
        description: form.description.trim(),
        defaultGstRateBps: form.defaultGstRateBps,
        supplyTaxability: form.supplyTaxability,
        defaultUqcCode: form.defaultUqcCode.trim() || null,
        categoryHint: form.categoryHint.trim() || null,
        effectiveFrom: form.effectiveFrom || undefined,
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
          maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          New HSN row
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Adding a row for an existing HSN code will close the prior row's effective window and
          supersede it. Use this when CBIC notifies a rate change.
        </p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Field label="HSN code *" hint="4 to 8 digits">
            <input
              value={form.hsnCode}
              onChange={(e) => setForm({ ...form, hsnCode: e.target.value.replace(/\D/g, '').slice(0, 8) })}
              placeholder="61091000"
              style={{ ...input, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
          <Field label="Effective from" hint="ISO date (defaults to now)">
            <input
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              placeholder="2026-04-01"
              type="date"
              style={input}
            />
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Description *">
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="T-shirts, singlets and other vests, knitted or crocheted"
                style={input}
              />
            </Field>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Default GST rate *" hint={`= ${bpsToPercent(form.defaultGstRateBps)}%`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="number" min={0} max={4000}
                  value={form.defaultGstRateBps}
                  onChange={(e) => setForm({ ...form, defaultGstRateBps: Number(e.target.value) || 0 })}
                  placeholder="1800"
                  style={{ ...input, width: 120 }}
                />
                <span style={{ fontSize: 12, color: '#525A65' }}>bps</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {RATE_PRESETS_BPS.map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      onClick={() => setForm({ ...form, defaultGstRateBps: bps })}
                      style={{
                        height: 28, padding: '0 10px',
                        border: '1px solid #D2D6DC', borderRadius: 9999,
                        background: form.defaultGstRateBps === bps ? '#0F1115' : '#fff',
                        color: form.defaultGstRateBps === bps ? '#fff' : '#0F1115',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {bpsToPercent(bps)}%
                    </button>
                  ))}
                </div>
              </div>
            </Field>
          </div>

          <Field label="Supply taxability">
            <select
              value={form.supplyTaxability}
              onChange={(e) => setForm({ ...form, supplyTaxability: e.target.value })}
              style={input}
            >
              {TAXABILITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Default UQC" hint="optional — the statutory unit">
            <select
              value={form.defaultUqcCode}
              onChange={(e) => setForm({ ...form, defaultUqcCode: e.target.value })}
              style={input}
            >
              <option value="">— None —</option>
              {uqcOptions.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.description}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Category hint" hint="Free text, helpful for search">
              <input
                value={form.categoryHint}
                onChange={(e) => setForm({ ...form, categoryHint: e.target.value })}
                placeholder="apparel"
                style={input}
              />
            </Field>
          </div>
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
            disabled={busy || !valid}
            style={busy || !valid ? { ...btnPrimary, ...busyStyle } : btnPrimary}
          >
            {busy ? 'Creating…' : 'Create HSN row'}
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

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No HSN codes match your search.';
  else if (tab === 'ACTIVE') text = 'No active HSN rows.';
  else if (tab === 'TAXABLE') text = 'No taxable supply HSN rows.';
  else if (tab === 'EXEMPT') text = 'No exempt/nil/zero-rated HSN rows.';
  else if (tab === 'SUPERSEDED') text = 'No superseded rows — every code is on its first effective row.';
  else text = 'No HSN rows on file yet. Create one to get started.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <TagIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>Nothing here</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>{text}</div>
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
          <div style={{ width: 90, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 60, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 60, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 90, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
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
function TagIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12 12 3h7v7l-9 9z" /><circle cx="15.5" cy="8.5" r="1" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? pct.toString() : pct.toFixed(2);
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
  verticalAlign: 'top',
};
