'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, notFound } from 'next/navigation';
import { NovaTabs } from '../../components/nova-tabs';
import {
  adminNovaService,
  OwnBrandWarehouse,
  inr,
} from '@/services/admin-nova.service';
import { validateAmount, validateBusinessName } from '@/lib/validators';

interface LineItem {
  productId: string;
  variantId: string;
  quantityOrdered: string;
  unitCost: string;
}

const EMPTY_LINE: LineItem = { productId: '', variantId: '', quantityOrdered: '', unitCost: '' };

export default function NewProcurementPage() {
  if (process.env.NEXT_PUBLIC_FEATURE_NOVA !== 'true') notFound();
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<OwnBrandWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    adminNovaService.listWarehouses(true).then((res) => res.data && setWarehouses(res.data)).catch((err) => console.warn(err));
  }, []);

  const addItem = () => setItems([...items, { ...EMPTY_LINE }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<LineItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const total = items.reduce((sum, it) => {
    const q = Number(it.quantityOrdered);
    const c = Number(it.unitCost);
    if (Number.isFinite(q) && Number.isFinite(c)) return sum + q * c;
    return sum;
  }, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!warehouseId) return setError('Pick a warehouse');
    const supplierErr = validateBusinessName(supplierName, 'Supplier name');
    if (supplierErr) return setError(supplierErr);
    if (items.length === 0) return setError('Add at least one line item');
    for (const [i, it] of items.entries()) {
      if (!it.productId.trim()) return setError(`Line ${i + 1}: product UUID is required`);
      const q = Number(it.quantityOrdered);
      if (!Number.isInteger(q) || q <= 0) return setError(`Line ${i + 1}: quantity must be a positive integer`);
      // Unit cost: required, >= 0, capped at ₹10,000,000 with 2dp.
      const costErr = validateAmount(it.unitCost, {
        label: `Line ${i + 1}: unit cost`,
      });
      if (costErr) return setError(costErr);
    }
    setSubmitting(true);
    try {
      const res = await adminNovaService.createProcurement({
        warehouseId,
        supplierName: supplierName.trim(),
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        supplierReference: supplierReference.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.map((it) => ({
          productId: it.productId.trim(),
          variantId: it.variantId.trim() || undefined,
          quantityOrdered: Number(it.quantityOrdered),
          unitCost: Number(it.unitCost),
        })),
      });
      if (res.data) router.push(`/dashboard/nova/procurement/${res.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create PO');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>
      <NovaTabs />

      <Link href="/dashboard/nova/procurement" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Back to PO list
      </Link>

      <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>New procurement order</h2>
      <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>
        PO is created in DRAFT. Mark it PLACED once you've sent it to the supplier.
      </p>

      <form onSubmit={submit} style={{ marginTop: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <h3 style={cardTitle}>Header</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Warehouse">
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={submitting} style={input}>
                <option value="">Pick a warehouse…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </Field>
            <Field label="Supplier name">
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={submitting} placeholder="e.g. Adidas India Pvt Ltd" style={input} />
            </Field>
            <Field label="Expected date">
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} disabled={submitting} style={input} />
            </Field>
            <Field label="Supplier reference">
              <input value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} disabled={submitting} placeholder="Their PO/quote ID" style={input} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} rows={2}
              style={{ ...input, height: 'auto', padding: 12, borderRadius: 12, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }} />
          </Field>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ ...cardTitle, marginBottom: 0 }}>Line items</h3>
            <button type="button" onClick={addItem} disabled={submitting} style={secondaryBtn}>+ Add line</button>
          </div>

          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 120px 32px', gap: 8, marginBottom: 8, alignItems: 'end' }}>
              <Field label={idx === 0 ? 'Product UUID' : ''}>
                <input value={it.productId} onChange={(e) => updateItem(idx, { productId: e.target.value })} disabled={submitting} style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
              </Field>
              <Field label={idx === 0 ? 'Variant UUID (optional)' : ''}>
                <input value={it.variantId} onChange={(e) => updateItem(idx, { variantId: e.target.value })} disabled={submitting} style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
              </Field>
              <Field label={idx === 0 ? 'Qty' : ''}>
                <input value={it.quantityOrdered} onChange={(e) => updateItem(idx, { quantityOrdered: e.target.value.replace(/\D/g, '') })} disabled={submitting} style={{ ...input, textAlign: 'right' }} />
              </Field>
              <Field label={idx === 0 ? 'Unit cost (₹)' : ''}>
                <input value={it.unitCost} onChange={(e) => updateItem(idx, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} disabled={submitting} style={{ ...input, textAlign: 'right' }} />
              </Field>
              <button type="button" onClick={() => removeItem(idx)} disabled={items.length <= 1 || submitting} style={{ height: 40, width: 40, border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 16, color: '#b91c1c', cursor: items.length <= 1 ? 'not-allowed' : 'pointer', opacity: items.length <= 1 ? 0.4 : 1 }}>×</button>
            </div>
          ))}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Estimated total</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>{inr(total)}</span>
          </div>
        </div>

        {error && <div style={alertBox}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Link href="/dashboard/nova/procurement" style={{ ...secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Cancel</Link>
          <button type="submit" disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.5 : 1 }}>
            {submitting ? 'Creating…' : 'Create PO (Draft)'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65', marginBottom: 6 }}>{label}</label>
      )}
      {children}
    </div>
  );
}

const cardTitle: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 12, color: '#0F1115' };
const input: React.CSSProperties = { width: '100%', height: 40, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const primaryBtn: React.CSSProperties = { height: 40, padding: '0 20px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { height: 36, padding: '0 14px', background: '#fff', color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 9999, fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const alertBox: React.CSSProperties = { marginBottom: 12, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 };
