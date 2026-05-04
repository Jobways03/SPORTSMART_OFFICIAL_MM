'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { NovaTabs } from '../components/nova-tabs';
import {
  adminNovaService,
  OwnBrandStock,
  OwnBrandWarehouse,
  inr,
} from '@/services/admin-nova.service';
import { ApiError } from '@/lib/api-client';

interface AdjustForm {
  warehouseId: string;
  productId: string;
  variantId: string;
  delta: string;
  reason: string;
}

const EMPTY_ADJUST: AdjustForm = {
  warehouseId: '', productId: '', variantId: '', delta: '', reason: '',
};

export default function NovaStocksPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<OwnBrandStock[]>([]);
  const [warehouses, setWarehouses] = useState<OwnBrandWarehouse[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adjustModal, setAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(EMPTY_ADJUST);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        adminNovaService.listStocks({
          warehouseId: warehouseFilter || undefined,
          lowStockOnly: lowStockOnly || undefined,
        }),
        warehouses.length === 0 ? adminNovaService.listWarehouses() : Promise.resolve({ data: warehouses } as any),
      ]);
      if (s.data) setStocks(s.data);
      if (w.data) setWarehouses(w.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [warehouseFilter, lowStockOnly, warehouses, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const submitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const delta = Number(adjustForm.delta);
    if (!adjustForm.warehouseId || !adjustForm.productId) return setError('Warehouse and product are required');
    if (!Number.isInteger(delta) || delta === 0) return setError('Delta must be a non-zero integer');
    if (!adjustForm.reason.trim()) return setError('Reason is required');
    setAdjusting(true);
    try {
      await adminNovaService.adjustStock({
        warehouseId: adjustForm.warehouseId,
        productId: adjustForm.productId,
        variantId: adjustForm.variantId.trim() || undefined,
        delta,
        reason: adjustForm.reason.trim(),
      });
      setAdjustModal(false);
      setAdjustForm(EMPTY_ADJUST);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adjust stock');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>
      <NovaTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: '#0F1115' }}>Stocks</h2>
        <button type="button" onClick={() => setAdjustModal(true)} style={primaryBtn}>+ Adjust stock</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} style={selectStyle}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} style={{ accentColor: '#0F1115' }} />
          Low-stock only
        </label>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Warehouse</th><th style={th}>Product</th>
              <th style={{ ...th, textAlign: 'right' }}>On hand</th>
              <th style={{ ...th, textAlign: 'right' }}>Reserved</th>
              <th style={{ ...th, textAlign: 'right' }}>Available</th>
              <th style={{ ...th, textAlign: 'right' }}>Last cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : stocks.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                No stock records yet. Receive a procurement order or adjust manually.
              </td></tr>
            ) : (
              stocks.map((s) => {
                const available = s.stockQty - s.reservedQty;
                const isLow = available <= s.lowStockThreshold;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#0F1115' }}>{s.warehouse.name}</div>
                      <div style={{ fontSize: 12, color: '#7A828F', fontFamily: 'ui-monospace, monospace' }}>{s.warehouse.code}</div>
                    </td>
                    <td style={{ ...td, color: '#525A65', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {s.productId.slice(0, 8)}…
                      {s.variantId && (
                        <span style={{ marginLeft: 4 }}>· var {s.variantId.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.stockQty}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#7A828F' }}>{s.reservedQty}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: isLow ? '#b91c1c' : '#15803d' }}>
                      {available}
                      {isLow && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', background: '#fee2e2', color: '#b91c1c', borderRadius: 9999, fontWeight: 700 }}>LOW</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#525A65' }}>
                      {s.lastLandedCost ? inr(s.lastLandedCost) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adjustModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={() => setAdjustModal(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 16, color: '#0F1115' }}>Adjust stock</h3>
            <form onSubmit={submitAdjust}>
              <Field label="Warehouse">
                <select value={adjustForm.warehouseId} onChange={(e) => setAdjustForm({ ...adjustForm, warehouseId: e.target.value })} disabled={adjusting} style={input}>
                  <option value="">Choose…</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </Field>
              <Field label="Product UUID">
                <input value={adjustForm.productId} onChange={(e) => setAdjustForm({ ...adjustForm, productId: e.target.value })} disabled={adjusting} style={{ ...input, fontFamily: 'ui-monospace, monospace' }} />
              </Field>
              <Field label="Variant UUID (optional)">
                <input value={adjustForm.variantId} onChange={(e) => setAdjustForm({ ...adjustForm, variantId: e.target.value })} disabled={adjusting} style={{ ...input, fontFamily: 'ui-monospace, monospace' }} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
                <Field label="Delta (+/−)">
                  <input value={adjustForm.delta} onChange={(e) => setAdjustForm({ ...adjustForm, delta: e.target.value })} disabled={adjusting} placeholder="-5 or +10" style={input} />
                </Field>
                <Field label="Reason">
                  <input value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} disabled={adjusting} placeholder="Stocktake correction, write-off…" style={input} />
                </Field>
              </div>
              {error && <div style={alertBox}>{error}</div>}
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setAdjustModal(false)} disabled={adjusting} style={secondaryBtn}>Cancel</button>
                <button type="submit" disabled={adjusting} style={{ ...primaryBtn, opacity: adjusting ? 0.5 : 1 }}>
                  {adjusting ? 'Applying…' : 'Apply adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const input: React.CSSProperties = { width: '100%', height: 40, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const selectStyle: React.CSSProperties = { height: 40, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none' };
const primaryBtn: React.CSSProperties = { height: 40, padding: '0 20px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { height: 40, padding: '0 16px', background: '#fff', color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const alertBox: React.CSSProperties = { marginTop: 8, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 };
