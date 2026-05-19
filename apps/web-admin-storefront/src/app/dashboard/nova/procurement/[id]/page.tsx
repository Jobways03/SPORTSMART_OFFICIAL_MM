'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { NovaTabs } from '../../components/nova-tabs';
import {
  adminNovaService,
  ProcurementDetail,
  OwnBrandProcurementStatus,
  PROCUREMENT_STATUS_COLOR,
  inr,
} from '@/services/admin-nova.service';

const ALLOWED_TRANSITIONS: Record<OwnBrandProcurementStatus, OwnBrandProcurementStatus[]> = {
  DRAFT: ['PLACED', 'CANCELLED'],
  PLACED: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export default function ProcurementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProcurementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Per-item receive quantity inputs
  const [receipts, setReceipts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNovaService.getProcurement(id);
      if (res.data) {
        setDetail(res.data);
        setReceipts({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const transition = async (status: OwnBrandProcurementStatus) => {
    setBusy(true);
    try {
      await adminNovaService.transitionProcurement(id, status);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transition');
    } finally {
      setBusy(false);
    }
  };

  const submitReceipts = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = Object.entries(receipts)
      .map(([itemId, qty]) => ({ itemId, quantityReceived: Number(qty) }))
      .filter((l) => l.quantityReceived > 0);
    if (!lines.length) return setError('Enter at least one quantity to receive');
    setBusy(true);
    try {
      await adminNovaService.receiveProcurement(id, lines);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not receive');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !detail) return <div style={{ padding: 32, color: '#7A828F' }}>Loading PO…</div>;
  if (!detail) return (
    <div style={{ padding: 32 }}>
      <Link href="/dashboard/nova/procurement" style={{ color: '#525A65', fontSize: 13 }}>← Back</Link>
      <div style={{ marginTop: 12, color: '#b91c1c' }}>{error || 'PO not found'}</div>
    </div>
  );

  const transitions = ALLOWED_TRANSITIONS[detail.status];
  const canReceive = detail.status === 'PLACED' || detail.status === 'IN_TRANSIT';

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>
      <NovaTabs />

      <Link href="/dashboard/nova/procurement" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Back to PO list
      </Link>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65', textTransform: 'uppercase' }}>{detail.poNumber}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
            borderRadius: 9999, background: PROCUREMENT_STATUS_COLOR[detail.status] + '22', color: PROCUREMENT_STATUS_COLOR[detail.status],
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {detail.status}
          </span>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>{detail.supplierName}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginTop: 16, fontSize: 13 }}>
          <div>
            <div style={metaLabel}>Warehouse</div>
            <div style={{ fontWeight: 600 }}>{detail.warehouse.name}</div>
            <div style={{ color: '#7A828F', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{detail.warehouse.code}</div>
          </div>
          <div>
            <div style={metaLabel}>Total</div>
            <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inr(detail.totalAmount)}</div>
          </div>
          <div>
            <div style={metaLabel}>Expected</div>
            <div style={{ color: '#525A65' }}>{detail.expectedDate ? new Date(detail.expectedDate).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          <div>
            <div style={metaLabel}>Received</div>
            <div style={{ color: '#525A65' }}>{detail.receivedAt ? new Date(detail.receivedAt).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          <div>
            <div style={metaLabel}>Supplier ref</div>
            <div style={{ color: '#525A65' }}>{detail.supplierReference || '—'}</div>
          </div>
        </div>
        {detail.notes && (
          <div style={{ marginTop: 12, padding: 10, background: '#FAFAFA', borderRadius: 10, fontSize: 13, color: '#525A65' }}>
            {detail.notes}
          </div>
        )}
        {transitions.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {transitions.map((s) => (
              <button key={s} type="button" onClick={() => transition(s)} disabled={busy} style={{
                height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: s === 'CANCELLED' ? '#fef2f2' : '#fff',
                color: s === 'CANCELLED' ? '#b91c1c' : '#0F1115', borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
              }}>
                Mark {s.toLowerCase().replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div style={{ marginBottom: 16, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>{error}</div>}

      <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0F1115', marginBottom: 12 }}>Line items</h3>

      <form onSubmit={submitReceipts} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Product</th><th style={{ ...th, textAlign: 'right' }}>Ordered</th>
              <th style={{ ...th, textAlign: 'right' }}>Received</th><th style={{ ...th, textAlign: 'right' }}>Unit cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Line total</th>
              {canReceive && <th style={{ ...th, textAlign: 'right' }}>Receive now</th>}
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => {
              const remaining = it.quantityOrdered - it.quantityReceived;
              return (
                <tr key={it.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: '#0F1115' }}>{it.productTitle}</div>
                    <div style={{ fontSize: 12, color: '#7A828F', fontFamily: 'ui-monospace, monospace' }}>
                      {it.ownBrandSku || it.productId.slice(0, 8) + '…'}
                      {it.variantTitle && <span> · {it.variantTitle}</span>}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.quantityOrdered}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: it.quantityReceived === it.quantityOrdered ? '#15803d' : '#525A65' }}>
                    {it.quantityReceived}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(it.unitCost)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{inr(it.lineTotal)}</td>
                  {canReceive && (
                    <td style={{ ...td, textAlign: 'right' }}>
                      {remaining > 0 ? (
                        <input
                          type="text" inputMode="numeric"
                          value={receipts[it.id] || ''}
                          onChange={(e) => setReceipts({ ...receipts, [it.id]: e.target.value.replace(/\D/g, '') })}
                          placeholder={`max ${remaining}`} disabled={busy}
                          style={{ width: 80, height: 32, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, outline: 'none', textAlign: 'right' }}
                        />
                      ) : (
                        <span style={{ fontSize: 11, color: '#15803d', fontWeight: 600, textTransform: 'uppercase' }}>Complete</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {canReceive && (
          <div style={{ padding: 16, borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Receiving…' : 'Apply receipts'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const metaLabel: React.CSSProperties = { fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 };
const primaryBtn: React.CSSProperties = { height: 40, padding: '0 20px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
