'use client';

// Phase 15 GST — E-way bills admin panel.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  EWayBillItem,
} from '@/services/admin-tax.service';

type Status = 'ALL' | 'NOT_REQUIRED' | 'REQUIRED' | 'PENDING' | 'GENERATED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export default function EwayBillsPage() {
  const [filter, setFilter] = useState<Status>('ALL');
  const [items, setItems] = useState<EWayBillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [genFor, setGenFor] = useState<EWayBillItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listEwayBills(filter === 'ALL' ? undefined : filter);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const cancel = async (id: string) => {
    const reason = prompt('Cancellation reason (CBIC requires one):');
    if (!reason) return;
    setBusy(id);
    try {
      await adminTaxService.cancelEwayBill(id, reason);
      setMsg({ kind: 'ok', text: 'EWB cancelled' });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Cancel failed' });
    } finally { setBusy(null); }
  };

  const override = async (id: string) => {
    const reason = prompt('Override reason (audited — admin allowing ship without EWB):');
    if (!reason) return;
    setBusy(id);
    try {
      await adminTaxService.overrideEwayBill(id, reason);
      setMsg({ kind: 'ok', text: 'Override stamped — ship guard will allow dispatch' });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Override failed' });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>&larr; Tax / GST</Link>
      <h1>E-way bills (CBIC Rule 138)</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Required for consignments above ₹50,000. Currently using the <strong>stub</strong> provider
        (deterministic <code>EWB-STUB-&lt;uuid&gt;</code> numbers).
        Real NIC e-Waybill API integration lands when CA confirms (tied to e-invoicing decision).
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['ALL', 'REQUIRED', 'PENDING', 'GENERATED', 'FAILED', 'CANCELLED', 'EXPIRED', 'NOT_REQUIRED'] as Status[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)} style={filter === s ? btnFilterActive : btnFilter}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
        <button onClick={load} style={btnSecondary}>Refresh</button>
      </div>

      {msg && (
        <div style={{ ...note, background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.kind === 'ok' ? '#166534' : '#991b1b' }}>
          {msg.text}
        </div>
      )}

      {loading ? <p>Loading…</p> : items.length === 0 ? (
        <p style={{ color: '#666' }}>No EWB rows in this state.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>EWB #</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Consignment</th>
              <th style={th}>Transport</th>
              <th style={th}>Valid until</th>
              <th style={th}>Override</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                  {e.ewbNumber ?? '—'}
                  {e.failureReason && (
                    <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{e.failureReason}</div>
                  )}
                </td>
                <td style={td}>
                  <span style={statusBadge(e.status)}>{e.status}</span>
                  {e.retryCount > 0 && (
                    <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>retries: {e.retryCount}</div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>₹{paiseToRupees(e.consignmentValueInPaise)}</td>
                <td style={{ ...td, fontSize: 11 }}>
                  <div>{e.transportMode}</div>
                  {e.vehicleNumber && <div style={{ color: '#666' }}>{e.vehicleNumber}</div>}
                  {e.distanceKm != null && <div style={{ color: '#666' }}>{e.distanceKm} km</div>}
                </td>
                <td style={{ ...td, fontSize: 11 }}>
                  {e.validUntil ? new Date(e.validUntil).toLocaleString('en-IN') : '—'}
                </td>
                <td style={td}>
                  {e.overrideAdminId ? (
                    <span style={{ fontSize: 11, color: '#d97706' }}>
                      ✓ by {e.overrideAdminId.slice(0, 8)}
                    </span>
                  ) : '—'}
                </td>
                <td style={td}>
                  {(e.status === 'REQUIRED' || e.status === 'FAILED') && (
                    <button onClick={() => setGenFor(e)} style={btnPrimary}>Generate</button>
                  )}
                  {e.status === 'GENERATED' && (
                    <button
                      onClick={() => cancel(e.id)}
                      disabled={busy === e.id}
                      style={busy === e.id ? { ...btnDanger, ...busyStyle } : btnDanger}
                    >
                      {busy === e.id ? 'Cancelling…' : 'Cancel (24h)'}
                    </button>
                  )}
                  {(e.status === 'REQUIRED' || e.status === 'FAILED' || e.status === 'PENDING') && !e.overrideAdminId && (
                    <button
                      onClick={() => override(e.id)}
                      disabled={busy === e.id}
                      style={busy === e.id ? { ...btnWarning, ...busyStyle } : btnWarning}
                    >
                      {busy === e.id ? 'Overriding…' : 'Override'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {genFor && (
        <GenerateModal
          row={genFor}
          onClose={() => setGenFor(null)}
          onDone={async () => { setGenFor(null); await load(); }}
        />
      )}
    </div>
  );
}

function GenerateModal({ row, onClose, onDone }: { row: EWayBillItem; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'ROAD' | 'RAIL' | 'AIR' | 'SHIP'>(row.transportMode as any || 'ROAD');
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
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3>Generate e-way bill</h3>
        <p style={{ fontSize: 12, color: '#666' }}>Sub-order: <code>{row.subOrderId.slice(0, 12)}</code></p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label>Transport mode
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={input}>
              <option>ROAD</option><option>RAIL</option><option>AIR</option><option>SHIP</option>
            </select>
          </label>
          <label>Vehicle number
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="KA01AB1234" style={input} />
          </label>
          <label>Transporter ID
            <input value={transporterId} onChange={(e) => setTransporterId(e.target.value)} placeholder="optional" style={input} />
          </label>
          <label>Distance (km)
            <input type="number" value={distance} onChange={(e) => setDistance(parseInt(e.target.value) || 0)} style={input} />
          </label>
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? 'Generating…' : 'Generate EWB'}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusBadge(s: string): React.CSSProperties {
  const color =
    s === 'GENERATED' ? '#16a34a' :
    s === 'FAILED' ? '#dc2626' :
    s === 'CANCELLED' ? '#6b7280' :
    s === 'EXPIRED' ? '#dc2626' :
    s === 'PENDING' ? '#d97706' :
    s === 'REQUIRED' ? '#d97706' :
    '#6b7280';
  return { background: color, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 };
}
function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const n = BigInt(p);
  const whole = n / 100n;
  const cents = n % 100n;
  return whole.toString() + '.' + cents.toString().padStart(2, '0');
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 };
const btnDanger: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 };
const btnWarning: React.CSSProperties = { background: '#d97706', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const input: React.CSSProperties = { display: 'block', width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, marginTop: 4 };
const modalBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: React.CSSProperties = { background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 };
