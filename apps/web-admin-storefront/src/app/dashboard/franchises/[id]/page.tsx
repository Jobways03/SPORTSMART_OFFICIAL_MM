'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RequirePermission, usePermissions } from '@/lib/permissions';
import {
  adminFranchisesService,
  FranchiseDetail,
} from '@/services/admin-franchises.service';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#16a34a', APPROVED: '#16a34a', VERIFIED: '#16a34a',
  PENDING: '#d97706', UNDER_REVIEW: '#d97706',
  NOT_VERIFIED: '#7A828F',
  SUSPENDED: '#b91c1c', REJECTED: '#b91c1c', DEACTIVATED: '#b91c1c',
};

function Pill({ value }: { value?: string }) {
  const color = STATUS_COLOR[value ?? ''] ?? '#525A65';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
      background: color + '22', color, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{(value ?? '—').replace(/_/g, ' ')}</span>
  );
}

const rupees = (paise?: number) =>
  paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

type Tab = 'overview' | 'inventory' | 'pincodes' | 'catalog' | 'pos';
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview', inventory: 'Inventory', pincodes: 'Pincodes', catalog: 'Catalog', pos: 'POS report',
};

// ── Action modal (reason capture) ─────────────────────────────────────────
function ActionModal({
  title, label, requireReason, busy, onClose, onConfirm,
}: {
  title: string; label: string; requireReason: boolean; busy: boolean;
  onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const valid = !requireReason || reason.trim().length >= 3;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>{title}</h3>
        <label style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>
          {label}{requireReason ? ' (required)' : ' (optional)'}
        </label>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          style={{ ...inputStyle, width: '100%', marginTop: 6, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={pageBtn}>Cancel</button>
          <button disabled={busy || !valid} onClick={() => onConfirm(reason.trim())}
            style={{ ...primaryBtn, opacity: busy || !valid ? 0.6 : 1 }}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FranchiseDetailInner({ id }: { id: string }) {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('franchise.approve');
  const canCatalog = hasPermission('franchise.catalog.approve');

  const [f, setF] = useState<FranchiseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // action modal: { kind, run }
  const [modal, setModal] = useState<null | {
    title: string; label: string; requireReason: boolean;
    run: (reason: string) => Promise<{ success?: boolean; message?: string }>;
  }>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await adminFranchisesService.get(id);
      if (res.data) setF(res.data);
      else setErr(res.message || 'Franchise not found');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function runModal(reason: string) {
    if (!modal) return;
    setBusy(true);
    try {
      const res = await modal.run(reason);
      if (res.success === false) { setErr(res.message || 'Action failed'); }
      else { setModal(null); await load(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !f) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!f) return <div style={{ padding: 24, color: '#dc2626' }}>{err || 'Not found'}</div>;

  const isVerified = f.verificationStatus === 'VERIFIED';
  const isActive = f.status === 'ACTIVE' || f.status === 'APPROVED';

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Link href="/dashboard/franchises" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Franchises</Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '10px 0 4px', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F1115', margin: 0 }}>{f.businessName}</h1>
          <div style={{ fontSize: 13, color: '#7A828F', marginTop: 2 }}>
            {f.franchiseCode} · {f.ownerName || '—'} · {f.email || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill value={f.status} />
          <Pill value={f.verificationStatus} />
          {f.fulfillmentHold && <Pill value="HOLD" />}
        </div>
      </div>

      {/* Action bar */}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
          {!isVerified && (
            <button style={successBtn} onClick={() => setModal({
              title: 'Verify franchise KYC', label: 'Note', requireReason: false,
              run: (reason) => adminFranchisesService.setVerification(id, { verificationStatus: 'VERIFIED', reason }),
            })}>Verify KYC</button>
          )}
          {f.verificationStatus !== 'REJECTED' && !isVerified && (
            <button style={dangerBtn} onClick={() => setModal({
              title: 'Reject franchise KYC', label: 'Rejection reason', requireReason: true,
              run: (reason) => adminFranchisesService.setVerification(id, { verificationStatus: 'REJECTED', reason }),
            })}>Reject KYC</button>
          )}
          {isActive ? (
            <button style={dangerBtn} onClick={() => setModal({
              title: 'Suspend franchise', label: 'Suspension reason', requireReason: true,
              run: (reason) => adminFranchisesService.setStatus(id, { status: 'SUSPENDED', reason }),
            })}>Suspend</button>
          ) : (
            <button style={successBtn} onClick={() => setModal({
              title: 'Activate franchise', label: 'Note', requireReason: false,
              run: (reason) => adminFranchisesService.setStatus(id, { status: 'ACTIVE', reason }),
            })}>Activate</button>
          )}
          {f.fulfillmentHold ? (
            <button style={pageBtn} onClick={() => setModal({
              title: 'Release fulfillment hold', label: 'Note', requireReason: false,
              run: (reason) => adminFranchisesService.setFulfillmentHold(id, false, reason),
            })}>Release hold</button>
          ) : (
            <button style={pageBtn} onClick={() => setModal({
              title: 'Place fulfillment hold', label: 'Hold reason', requireReason: true,
              run: (reason) => adminFranchisesService.setFulfillmentHold(id, true, reason),
            })}>Hold fulfillment</button>
          )}
        </div>
      )}

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px', flexWrap: 'wrap' }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{TAB_LABELS[t]}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab f={f} />}
      {tab === 'inventory' && <InventoryTab id={id} />}
      {tab === 'pincodes' && <PincodesTab id={id} />}
      {tab === 'catalog' && <CatalogTab id={id} canApprove={canCatalog} />}
      {tab === 'pos' && <PosTab id={id} />}

      {modal && (
        <ActionModal
          title={modal.title} label={modal.label} requireReason={modal.requireReason}
          busy={busy} onClose={() => setModal(null)} onConfirm={runModal}
        />
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function OverviewTab({ f }: { f: FranchiseDetail }) {
  const rows: [string, React.ReactNode][] = [
    ['Owner', f.ownerName || '—'],
    ['Email', f.email || '—'],
    ['Phone', f.phoneNumber || '—'],
    ['Address', [f.address, f.locality, f.city, f.state, f.pincode].filter(Boolean).join(', ') || '—'],
    ['Warehouse', [f.warehouseAddress, f.warehousePincode].filter(Boolean).join(', ') || '—'],
    ['GSTIN', f.gstNumber || '—'],
    ['PAN', f.panNumber || '—'],
    ['Assigned zone', f.assignedZone || '—'],
    ['Online fulfillment rate', f.onlineFulfillmentRate != null ? `${f.onlineFulfillmentRate}%` : '—'],
    ['Procurement fee rate', f.procurementFeeRate != null ? `${f.procurementFeeRate}%` : '—'],
    ['Contract', [f.contractStartDate, f.contractEndDate].filter(Boolean).join(' → ') || '—'],
    ['Profile completion', `${f.profileCompletionPercentage ?? 0}%`],
    ['Created', f.createdAt ? new Date(f.createdAt).toLocaleString() : '—'],
  ];
  return (
    <div style={card}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderTop: '1px solid #F3F4F6' }}>
              <td style={{ ...td, color: '#7A828F', width: 220, fontWeight: 600 }}>{k}</td>
              <td style={td}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryTab({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  useEffect(() => {
    let ok = true;
    setLoading(true); setErr(null);
    adminFranchisesService.listInventory(id, { limit: 50, lowStockOnly: lowOnly })
      .then((r) => {
        if (!ok) return;
        const d: any = r.data;
        setRows(d?.items ?? d?.inventory ?? d?.products ?? (Array.isArray(d) ? d : []));
        if (!r.data) setErr(r.message || 'Failed to load inventory');
      })
      .catch((e) => ok && setErr(e instanceof Error ? e.message : 'Failed'))
      .finally(() => ok && setLoading(false));
    return () => { ok = false; };
  }, [id, lowOnly]);
  return (
    <div style={card}>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#525A65', marginBottom: 10 }}>
        <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
      </label>
      {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
      {loading ? <div style={muted}>Loading…</div> : rows.length === 0 ? <div style={muted}>No inventory.</div> : (
        <table style={tableStyle}>
          <thead><tr><th style={th}>Product</th><th style={th}>SKU</th><th style={th}>Stock</th><th style={th}>Reserved</th><th style={th}>Available</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? r.productId ?? i} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={td}>{r.productName ?? r.product?.name ?? r.productId ?? '—'}</td>
                <td style={{ ...td, color: '#525A65' }}>{r.sku ?? r.product?.sku ?? '—'}</td>
                <td style={td}>{r.stockQty ?? '—'}</td>
                <td style={{ ...td, color: '#525A65' }}>{r.reservedQty ?? 0}</td>
                <td style={td}>{r.availableQty ?? (r.stockQty != null ? r.stockQty - (r.reservedQty ?? 0) : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PincodesTab({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    setLoading(true); setErr(null);
    adminFranchisesService.listPincodes(id)
      .then((r) => {
        if (!ok) return;
        const d: any = r.data;
        setRows(d?.mappings ?? d?.pincodes ?? (Array.isArray(d) ? d : []));
        if (!r.data) setErr(r.message || 'Failed to load pincodes');
      })
      .catch((e) => ok && setErr(e instanceof Error ? e.message : 'Failed'))
      .finally(() => ok && setLoading(false));
    return () => { ok = false; };
  }, [id]);
  return (
    <div style={card}>
      {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
      {loading ? <div style={muted}>Loading…</div> : rows.length === 0 ? <div style={muted}>No pincode territories mapped.</div> : (
        <table style={tableStyle}>
          <thead><tr><th style={th}>Pincode</th><th style={th}>Priority</th><th style={th}>City / State</th><th style={th}>Active</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ ...td, fontWeight: 600 }}>{r.pincode}</td>
                <td style={td}>{r.priority ?? '—'}</td>
                <td style={{ ...td, color: '#525A65' }}>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={td}>{r.isActive === false ? 'No' : 'Yes'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CatalogTab({ id, canApprove }: { id: string; canApprove: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    let ok = true;
    setLoading(true); setErr(null);
    adminFranchisesService.listCatalog({ franchiseId: id, limit: 50 })
      .then((r) => {
        if (!ok) return;
        const d: any = r.data;
        setRows(d?.mappings ?? (Array.isArray(d) ? d : []));
        if (!r.data) setErr(r.message || 'Failed to load catalog');
      })
      .catch((e) => ok && setErr(e instanceof Error ? e.message : 'Failed'))
      .finally(() => ok && setLoading(false));
    return () => { ok = false; };
  }, [id]);
  useEffect(() => { const c = load(); return c; }, [load]);

  async function act(mappingId: string, kind: 'approve' | 'reject' | 'stop') {
    let reason = '';
    if (kind !== 'approve') {
      reason = window.prompt(`${kind === 'reject' ? 'Reject' : 'Stop'} reason:`) ?? '';
      if (!reason.trim()) return;
    }
    setBusyId(mappingId); setErr(null);
    try {
      const r = kind === 'approve'
        ? await adminFranchisesService.approveCatalog(mappingId)
        : kind === 'reject'
          ? await adminFranchisesService.rejectCatalog(mappingId, reason)
          : await adminFranchisesService.stopCatalog(mappingId, reason);
      if (r.success === false) setErr(r.message || 'Action failed');
      else load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={card}>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {loading ? <div style={muted}>Loading…</div> : rows.length === 0 ? <div style={muted}>No catalog mappings.</div> : (
        <table style={tableStyle}>
          <thead><tr><th style={th}>Product</th><th style={th}>SKU</th><th style={th}>Status</th><th style={th}>Stock</th>{canApprove && <th style={th}>Actions</th>}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={td}>{r.productName ?? r.product?.name ?? r.productId ?? '—'}</td>
                <td style={{ ...td, color: '#525A65' }}>{r.sku ?? r.product?.sku ?? '—'}</td>
                <td style={td}><Pill value={r.approvalStatus} /></td>
                <td style={td}>{r.stockQty ?? r.stock?.stockQty ?? '—'}</td>
                {canApprove && (
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.approvalStatus !== 'APPROVED' && (
                        <button disabled={busyId === r.id} style={smallSuccess} onClick={() => act(r.id, 'approve')}>Approve</button>
                      )}
                      {r.approvalStatus === 'PENDING_APPROVAL' && (
                        <button disabled={busyId === r.id} style={smallDanger} onClick={() => act(r.id, 'reject')}>Reject</button>
                      )}
                      {r.approvalStatus === 'APPROVED' && (
                        <button disabled={busyId === r.id} style={smallDanger} onClick={() => act(r.id, 'stop')}>Stop</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PosTab({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState('');
  useEffect(() => {
    let ok = true;
    setLoading(true); setErr(null);
    adminFranchisesService.getPosReport(id, date || undefined)
      .then((r) => {
        if (!ok) return;
        if (r.data) setData(r.data); else setErr(r.message || 'Failed to load POS report');
      })
      .catch((e) => ok && setErr(e instanceof Error ? e.message : 'Failed'))
      .finally(() => ok && setLoading(false));
    return () => { ok = false; };
  }, [id, date]);
  const kpis: [string, React.ReactNode][] = data ? [
    ['Net revenue', rupees(data.netRevenuePaise ?? data.netRevenue)],
    ['Gross revenue', rupees(data.grossRevenuePaise ?? data.grossRevenue)],
    ['Sales', data.saleCount ?? data.sales ?? '—'],
    ['Returns', data.returnCount ?? '—'],
    ['Voids', data.voidCount ?? '—'],
    ['Day closure', data.closureStatus ?? '—'],
  ] : [];
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: '#525A65' }}>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
      {loading ? <div style={muted}>Loading…</div> : !data ? <div style={muted}>No report.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {kpis.map(([k, v]) => (
            <div key={k} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', fontWeight: 600 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0F1115', marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FranchiseDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission anyOf={['franchise.read']} fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <FranchiseDetailInner id={id} />
    </RequirePermission>
  );
}

// ── styles ──────────────────────────────────────────────────────────────
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const muted: React.CSSProperties = { fontSize: 13, color: '#7A828F', padding: '8px 0' };
const inputStyle: React.CSSProperties = { border: '1px solid #D2D6DC', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#0F1115', background: '#fff' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: '#0F1115', fontWeight: 600 };
const primaryBtn: React.CSSProperties = { ...pageBtn, background: '#0F1115', color: '#fff', border: '1px solid #0F1115' };
const successBtn: React.CSSProperties = { ...pageBtn, background: '#16a34a', color: '#fff', border: '1px solid #16a34a' };
const dangerBtn: React.CSSProperties = { ...pageBtn, background: '#b91c1c', color: '#fff', border: '1px solid #b91c1c' };
const smallSuccess: React.CSSProperties = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
const smallDanger: React.CSSProperties = { background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
const tabBtn = (active: boolean): React.CSSProperties => ({ background: active ? '#0F1115' : '#fff', color: active ? '#fff' : '#525A65', border: '1px solid #D2D6DC', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 });
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, width: 'min(460px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
