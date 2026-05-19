'use client';

// Phase 15 GST — E-way bills admin panel (CBIC Rule 138).
//
// EWBs are required for consignments above ₹50,000. This page lets ops
// generate, cancel (within 24h per CBIC), or admin-override the
// ship-guard when an EWB can't be obtained but goods must move.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  EWayBillItem,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'REQUIRED' | 'PENDING' | 'GENERATED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'NOT_REQUIRED';

// ── Page ──────────────────────────────────────────────────────────

export default function EwayBillsPage() {
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<EWayBillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [generateFor, setGenerateFor] = useState<EWayBillItem | null>(null);
  const [reasonModal, setReasonModal] = useState<
    | { kind: 'cancel'; row: EWayBillItem }
    | { kind: 'override'; row: EWayBillItem }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      // Load all and filter client-side so tab switches don't refetch.
      const res = await adminTaxService.listEwayBills();
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cancelEwb = async (id: string, reason: string) => {
    setBusy(id);
    try {
      await adminTaxService.cancelEwayBill(id, reason);
      setMsg({ kind: 'ok', text: 'E-way bill cancelled.' });
      setReasonModal(null);
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Cancel failed' });
    } finally { setBusy(null); }
  };

  const overrideEwb = async (id: string, reason: string) => {
    setBusy(id);
    try {
      await adminTaxService.overrideEwayBill(id, reason);
      setMsg({ kind: 'ok', text: 'Override stamped — ship guard will allow dispatch.' });
      setReasonModal(null);
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Override failed' });
    } finally { setBusy(null); }
  };

  // ── Counts ─────────────────────────────────────────────

  const counts = useMemo(() => {
    const by = (s: EWayBillItem['status']) => items.filter((x) => x.status === s).length;
    const generated = items.filter((x) => x.status === 'GENERATED');
    const now = Date.now();
    const expiringSoon = generated.filter((x) => {
      if (!x.validUntil) return false;
      const diff = new Date(x.validUntil).getTime() - now;
      return diff > 0 && diff < 24 * 3600 * 1000;
    }).length;
    const overrides = items.filter((x) => x.overrideAdminId).length;
    const consignmentSumPaise = items
      .filter((x) => x.status === 'GENERATED')
      .reduce((acc, x) => acc + BigInt(x.consignmentValueInPaise || '0'), BigInt(0));

    return {
      required: by('REQUIRED'),
      pending: by('PENDING'),
      generated: by('GENERATED'),
      failed: by('FAILED'),
      cancelled: by('CANCELLED'),
      expired: by('EXPIRED'),
      notRequired: by('NOT_REQUIRED'),
      actionNeeded: by('REQUIRED') + by('FAILED'),
      expiringSoon,
      overrides,
      consignmentSumPaise: consignmentSumPaise.toString(),
    };
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (tab !== 'ALL') out = out.filter((x) => x.status === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((x) =>
        (x.ewbNumber ?? '').toLowerCase().includes(q)
        || x.subOrderId.toLowerCase().includes(q)
        || (x.vehicleNumber ?? '').toLowerCase().includes(q)
        || (x.transporterId ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, tab, search]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          E-way bills <span style={{ fontSize: 14, fontWeight: 500, color: '#7A828F', marginLeft: 8 }}>CBIC Rule 138</span>
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Required for any consignment above ₹50,000. Generate before dispatch, cancel within 24h if
          plans change, or stamp an admin override when an EWB can't be obtained but goods must move.
        </p>
      </div>

      <ProviderBanner />

      <KpiStrip counts={counts} loading={loading && items.length === 0} />

      {/* Tabs */}
      <div style={{
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <Tabs current={tab} counts={counts} total={items.length} onChange={setTab} />
      </div>

      {/* Search + refresh */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 460 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search EWB #, sub-order, vehicle, transporter…"
            style={{ ...input, width: '100%', paddingLeft: 36 }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#7A828F', display: 'inline-flex',
          }}>
            <SearchIcon />
          </span>
        </div>
        <button onClick={() => void load()} style={btnGhost} disabled={loading}>
          <RefreshIcon /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {msg && <Banner msg={msg} onClose={() => setMsg(null)} />}

      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && items.length === 0 ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} hasSearch={Boolean(search.trim())} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>EWB</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Consignment</th>
                <th style={th}>Transport</th>
                <th style={th}>Validity</th>
                <th style={th}>Override</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <Row
                  key={e.id}
                  item={e}
                  busy={busy === e.id}
                  onGenerate={() => setGenerateFor(e)}
                  onCancel={() => setReasonModal({ kind: 'cancel', row: e })}
                  onOverride={() => setReasonModal({ kind: 'override', row: e })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {items.length} loaded · client-filtered
      </p>

      {generateFor && (
        <GenerateModal
          row={generateFor}
          onClose={() => setGenerateFor(null)}
          onDone={async () => { setGenerateFor(null); await load(); }}
        />
      )}

      {reasonModal && (
        <ReasonModal
          kind={reasonModal.kind}
          row={reasonModal.row}
          busy={busy === reasonModal.row.id}
          onCancel={() => setReasonModal(null)}
          onConfirm={(reason) =>
            reasonModal.kind === 'cancel'
              ? void cancelEwb(reasonModal.row.id, reason)
              : void overrideEwb(reasonModal.row.id, reason)
          }
        />
      )}
    </div>
  );
}

// ── Provider banner (stub notice) ─────────────────────────────────

function ProviderBanner() {
  return (
    <div style={{
      marginBottom: 16, padding: '10px 14px', borderRadius: 12, fontSize: 12,
      border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
      display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1.5,
    }}>
      <InfoIcon size={16} />
      <span>
        <strong>Stub provider active.</strong> EWB numbers are deterministic{' '}
        <code style={mono}>EWB-STUB-&lt;uuid&gt;</code> placeholders. The real NIC e-Waybill API
        integration ships once CA confirms (tied to the e-invoicing decision).
      </span>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: {
    actionNeeded: number; pending: number; generated: number;
    expiringSoon: number; overrides: number; consignmentSumPaise: string;
  };
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Action needed"
        value={counts.actionNeeded.toLocaleString('en-IN')}
        tone={counts.actionNeeded > 0 ? 'danger' : 'muted'}
        loading={loading} hint="Required + failed — won't ship without an EWB or override." />
      <Kpi label="Active EWBs"
        value={counts.generated.toLocaleString('en-IN')}
        tone="success" loading={loading} hint="Generated and within validity window." />
      <Kpi label="Expiring < 24h"
        value={counts.expiringSoon.toLocaleString('en-IN')}
        tone={counts.expiringSoon > 0 ? 'warning' : 'muted'}
        loading={loading} hint="Generated EWBs about to lapse — extend or dispatch." />
      <Kpi label="Active overrides"
        value={counts.overrides.toLocaleString('en-IN')}
        tone={counts.overrides > 0 ? 'warning' : 'muted'}
        loading={loading} hint="Ship-guard bypasses stamped by admins (audited)." />
      <Kpi label="Active value"
        value={`₹${paiseToRupees(counts.consignmentSumPaise)}`}
        tone="neutral" loading={loading} hint="Total consignment value under active EWBs." />
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
  counts: {
    required: number; pending: number; generated: number; failed: number;
    cancelled: number; expired: number; notRequired: number;
  };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',          label: 'All',          count: total },
    { key: 'REQUIRED',     label: 'Required',     count: counts.required },
    { key: 'PENDING',      label: 'Pending',      count: counts.pending },
    { key: 'GENERATED',    label: 'Generated',    count: counts.generated },
    { key: 'FAILED',       label: 'Failed',       count: counts.failed },
    { key: 'CANCELLED',    label: 'Cancelled',    count: counts.cancelled },
    { key: 'EXPIRED',      label: 'Expired',      count: counts.expired },
    { key: 'NOT_REQUIRED', label: 'Not required', count: counts.notRequired },
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
  item, busy, onGenerate, onCancel, onOverride,
}: {
  item: EWayBillItem;
  busy: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onOverride: () => void;
}) {
  const canGenerate = item.status === 'REQUIRED' || item.status === 'FAILED';
  const canCancel = item.status === 'GENERATED';
  const canOverride =
    (item.status === 'REQUIRED' || item.status === 'FAILED' || item.status === 'PENDING') &&
    !item.overrideAdminId;

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115', fontWeight: 600 }}>
          {item.ewbNumber ?? <span style={{ color: '#7A828F', fontWeight: 400 }}>—</span>}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          sub-ord {item.subOrderId.slice(0, 8)}…
        </div>
        {item.failureReason && (
          <div style={{
            marginTop: 6, fontSize: 11, color: '#b91c1c', lineHeight: 1.4, maxWidth: 240,
          }}>
            {item.failureReason}
          </div>
        )}
      </td>

      <td style={td}>
        <StatusPill status={item.status} />
        {item.retryCount > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#7A828F' }}>
            {item.retryCount} retr{item.retryCount === 1 ? 'y' : 'ies'}
          </div>
        )}
      </td>

      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        ₹{paiseToRupees(item.consignmentValueInPaise)}
        {item.fromPincode && item.toPincode && (
          <div style={{ fontSize: 11, color: '#7A828F', fontWeight: 400, marginTop: 2 }}>
            {item.fromPincode} → {item.toPincode}
          </div>
        )}
      </td>

      <td style={td}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ModeIcon mode={item.transportMode} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#0F1115' }}>{item.transportMode}</span>
        </div>
        {item.vehicleNumber && (
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#525A65', marginTop: 4 }}>
            {item.vehicleNumber}
          </div>
        )}
        {item.distanceKm != null && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
            {item.distanceKm} km
          </div>
        )}
      </td>

      <td style={td}>
        <ValidityCell validUntil={item.validUntil} status={item.status} />
      </td>

      <td style={td}>
        {item.overrideAdminId ? (
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 700, color: '#b45309',
              padding: '2px 8px', borderRadius: 9999, background: '#fef3c7',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <ShieldIcon size={11} /> Override
            </span>
            <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F' }}>
              by {item.overrideAdminId.slice(0, 8)}…
            </div>
            {item.overrideAt && (
              <div style={{ fontSize: 11, color: '#7A828F' }}
                   title={new Date(item.overrideAt).toLocaleString('en-IN')}>
                {relTime(new Date(item.overrideAt))}
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>

      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {canGenerate && (
          <button onClick={onGenerate} disabled={busy}
            style={busy ? { ...btnPrimary, ...busyStyle } : btnPrimary}>
            <PlusIcon size={12} /> Generate
          </button>
        )}
        {canCancel && (
          <button onClick={onCancel} disabled={busy}
            style={busy ? { ...btnDanger, ...busyStyle } : btnDanger}
            title="CBIC allows cancellation within 24h of generation.">
            <XIcon size={12} /> {busy ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {canOverride && (
          <button onClick={onOverride} disabled={busy}
            style={busy ? { ...btnWarning, ...busyStyle } : btnWarning}
            title="Allow dispatch without an EWB. Audited.">
            <ShieldIcon size={12} /> Override
          </button>
        )}
        {!canGenerate && !canCancel && !canOverride && (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>
    </tr>
  );
}

function ValidityCell({
  validUntil, status,
}: { validUntil: string | null; status: EWayBillItem['status'] }) {
  if (!validUntil) return <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>;
  const d = new Date(validUntil);
  const diff = d.getTime() - Date.now();
  const expired = status === 'EXPIRED' || diff <= 0;
  const expiringSoon = !expired && diff < 24 * 3600 * 1000;
  const color = expired ? '#b91c1c' : expiringSoon ? '#b45309' : '#15803d';
  return (
    <div>
      <div style={{ fontSize: 12, color: '#0F1115', fontWeight: 600 }}
           title={d.toLocaleString('en-IN')}>
        {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ·{' '}
        {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>
        {expired ? 'Expired' : expiringSoon ? `In ${relFuture(d)}` : relFuture(d)}
      </div>
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────

function StatusPill({ status }: { status: EWayBillItem['status'] }) {
  const tone =
    status === 'GENERATED'     ? { color: '#15803d', chip: '#dcfce7', label: 'Generated' } :
    status === 'FAILED'        ? { color: '#b91c1c', chip: '#fee2e2', label: 'Failed' } :
    status === 'CANCELLED'     ? { color: '#525A65', chip: '#F3F4F6', label: 'Cancelled' } :
    status === 'EXPIRED'       ? { color: '#b91c1c', chip: '#fee2e2', label: 'Expired' } :
    status === 'PENDING'       ? { color: '#1d4ed8', chip: '#dbeafe', label: 'Pending' } :
    status === 'REQUIRED'      ? { color: '#b45309', chip: '#fef3c7', label: 'Required' } :
                                  { color: '#525A65', chip: '#F3F4F6', label: 'Not required' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone.color }} />
      {tone.label}
    </span>
  );
}

// ── Mode icon ─────────────────────────────────────────────────────

function ModeIcon({ mode }: { mode: string }) {
  if (mode === 'RAIL') return <TrainIcon />;
  if (mode === 'AIR') return <PlaneIcon />;
  if (mode === 'SHIP') return <ShipIcon />;
  return <TruckIcon />;
}

// ── Generate modal ────────────────────────────────────────────────

function GenerateModal({
  row, onClose, onDone,
}: {
  row: EWayBillItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'ROAD' | 'RAIL' | 'AIR' | 'SHIP'>(
    (row.transportMode as any) || 'ROAD'
  );
  const [vehicle, setVehicle] = useState(row.vehicleNumber ?? '');
  const [transporterId, setTransporterId] = useState(row.transporterId ?? '');
  const [distance, setDistance] = useState(row.distanceKm ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await adminTaxService.generateEwayBill(row.subOrderId, {
        transportMode: mode,
        vehicleNumber: vehicle || undefined,
        transporterId: transporterId || undefined,
        distanceKm: distance || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Generate failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
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
          maxWidth: 560, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Generate e-way bill
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Files the EWB with the provider for this consignment. Fields below mirror the
          NIC e-Waybill schema.
        </p>

        <div style={{
          marginTop: 14, padding: 12, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div>
            <div style={kpiLabel}>Sub-order</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
              {row.subOrderId.slice(0, 12)}…
            </div>
          </div>
          <div>
            <div style={{ ...kpiLabel, textAlign: 'right' }}>Consignment</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>
              ₹{paiseToRupees(row.consignmentValueInPaise)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Field label="Transport mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as any)}
                    style={input}>
              <option value="ROAD">Road</option>
              <option value="RAIL">Rail</option>
              <option value="AIR">Air</option>
              <option value="SHIP">Ship</option>
            </select>
          </Field>
          <Field label="Distance (km)">
            <input
              type="number" value={distance}
              onChange={(e) => setDistance(parseInt(e.target.value) || 0)}
              style={input} placeholder="0"
            />
          </Field>
          <Field label="Vehicle number">
            <input
              value={vehicle} onChange={(e) => setVehicle(e.target.value)}
              placeholder="KA01AB1234" style={input}
            />
          </Field>
          <Field label="Transporter ID">
            <input
              value={transporterId} onChange={(e) => setTransporterId(e.target.value)}
              placeholder="optional" style={input}
            />
          </Field>
        </div>

        {err && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
          }}>{err}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnGhost} disabled={submitting}>Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            style={submitting ? { ...btnPrimaryLarge, ...busyStyle } : btnPrimaryLarge}
          >
            {submitting ? 'Generating…' : 'Generate EWB'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reason modal (cancel + override) ──────────────────────────────

function ReasonModal({
  kind, row, busy, onCancel, onConfirm,
}: {
  kind: 'cancel' | 'override';
  row: EWayBillItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isCancel = kind === 'cancel';
  const title = isCancel ? 'Cancel e-way bill?' : 'Override ship guard?';
  const desc = isCancel
    ? 'CBIC allows cancellation within 24h of generation. Reason is logged with the provider.'
    : 'Allow dispatch without an EWB. The ship-guard bypass is audited — finance + legal review periodically.';
  const confirmLabel = isCancel ? 'Cancel EWB' : 'Stamp override';
  const placeholder = isCancel
    ? 'e.g. Order edited — items reduced below ₹50k threshold.'
    : 'e.g. Provider downtime past dispatch deadline; legal cleared bypass.';

  return (
    <div
      onClick={onCancel}
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
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>{title}</h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>{desc}</p>

        <div style={{
          marginTop: 14, padding: 12, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div>
            <div style={kpiLabel}>EWB</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: '#0F1115' }}>
              {row.ewbNumber ?? '—'}
            </div>
          </div>
          <div>
            <div style={{ ...kpiLabel, textAlign: 'right' }}>Consignment</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>
              ₹{paiseToRupees(row.consignmentValueInPaise)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={kpiLabel}>Reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            rows={4}
            disabled={busy}
            autoFocus
            style={{
              marginTop: 6, width: '100%', padding: '10px 12px',
              border: '1px solid #D2D6DC', borderRadius: 10,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
              outline: 'none', minHeight: 90, boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost} disabled={busy}>Back</button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={busy || !reason.trim()}
            style={
              isCancel
                ? (busy || !reason.trim() ? { ...btnDangerLarge, ...busyStyle } : btnDangerLarge)
                : (busy || !reason.trim() ? { ...btnWarningLarge, ...busyStyle } : btnWarningLarge)
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner / field ─────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No EWBs match your search.';
  else if (tab === 'REQUIRED') text = 'Nothing waiting on EWB generation.';
  else if (tab === 'FAILED') text = 'No failed generation attempts.';
  else if (tab === 'GENERATED') text = 'No active EWBs in this set.';
  else if (tab === 'EXPIRED') text = 'No expired EWBs in this set.';
  else if (tab === 'CANCELLED') text = 'No cancelled EWBs in this set.';
  else if (tab === 'NOT_REQUIRED') text = 'No below-threshold consignments tracked.';
  else if (tab === 'PENDING') text = 'No EWB generation in flight.';
  else text = 'No e-way bills yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <CheckIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>All clear</div>
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
          <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 200, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

function Banner({
  msg, onClose,
}: { msg: { kind: 'ok' | 'err'; text: string }; onClose: () => void }) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px', borderRadius: 12, fontSize: 13,
      border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fca5a5'}`,
      background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
      color: msg.kind === 'ok' ? '#15803d' : '#b91c1c',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    }}>
      <span>{msg.text}</span>
      <button
        onClick={onClose}
        style={{
          padding: 4, border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'inherit', opacity: 0.6, lineHeight: 1, fontSize: 16,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={kpiLabel}>{label}</span>
      {children}
    </label>
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
function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}
function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ShieldIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" />
    </svg>
  );
}
function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 8v.01M11 12h1v5h1" />
    </svg>
  );
}
function TruckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="12" height="10" rx="1" />
      <path d="M14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
    </svg>
  );
}
function TrainIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14M9 17l-2 3M15 17l2 3" />
      <circle cx="9" cy="14" r=".5" fill="currentColor" /><circle cx="15" cy="14" r=".5" fill="currentColor" />
    </svg>
  );
}
function PlaneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 16l8-3 4-9 2 1-2 9 8-3 1 2-7 5 1 5-2 1-3-4-4 3-1-2 3-4z" />
    </svg>
  );
}
function ShipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
      <path d="M4 13l8-3 8 3-1 5H5z" />
      <path d="M12 4v6M9 7h6" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const negative = p.startsWith('-');
  const abs = negative ? p.slice(1) : p;
  const whole = abs.length > 2 ? abs.slice(0, -2) : '0';
  const cents = abs.length > 2 ? abs.slice(-2) : abs.padStart(2, '0');
  const grouped = formatIndianGrouping(whole);
  return (negative ? '-' : '') + grouped + '.' + cents;
}
function formatIndianGrouping(n: string): string {
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3);
  const groups: string[] = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  return `${groups.join(',')},${last3}`;
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
function relFuture(d: Date): string {
  const diff = Math.max(0, d.getTime() - Date.now());
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h left`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d left`;
  const mo = Math.floor(days / 30);
  return `${mo}mo left`;
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
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: 11,
  padding: '1px 4px', background: '#fef3c7', borderRadius: 4,
};
const btnPrimary: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  marginRight: 6,
};
const btnPrimaryLarge: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnDanger: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#fff', color: '#b91c1c',
  border: '1px solid #fca5a5', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  marginRight: 6,
};
const btnDangerLarge: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#b91c1c', color: '#fff',
  border: '1px solid #b91c1c', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnWarning: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#fff', color: '#b45309',
  border: '1px solid #fde68a', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnWarningLarge: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#b45309', color: '#fff',
  border: '1px solid #b45309', borderRadius: 9999,
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
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'top',
};
