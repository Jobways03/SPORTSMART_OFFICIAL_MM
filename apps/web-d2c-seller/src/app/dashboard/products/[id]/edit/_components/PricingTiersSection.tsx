'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  sellerPricingTiersService,
  PricingTier,
} from '@/services/seller-pricing-tiers.service';

/**
 * Phase 44 (2026-05-21) — seller-facing tier management.
 *
 * The seller endpoint enforces product ownership, so this UI is safe
 * to mount on the product-edit page for the seller-owned product
 * being edited. Validation is mirrored from the admin panel (the
 * server is authoritative for shape checks; we surface 400 messages
 * unchanged).
 */

interface Props {
  productId: string;
  variants?: Array<{ id: string; title?: string | null; sku?: string | null }>;
}

interface DraftTier {
  variantId: string;
  minQuantity: string;
  maxQuantity: string;
  pricingMode: 'percent' | 'fixed';
  discountPercent: string;
  fixedUnitPrice: string;
  startAt: string;
  endAt: string;
  displayLabel: string;
}

const EMPTY_DRAFT: DraftTier = {
  variantId: '',
  minQuantity: '',
  maxQuantity: '',
  pricingMode: 'percent',
  discountPercent: '',
  fixedUnitPrice: '',
  startAt: '',
  endAt: '',
  displayLabel: '',
};

export function PricingTiersSection({ productId, variants }: Props) {
  const [rows, setRows] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTier>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [busyRow, setBusyRow] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await sellerPricingTiersService.list(productId);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to load pricing tiers');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async () => {
    const minQty = parseInt(draft.minQuantity, 10);
    if (!Number.isInteger(minQty) || minQty <= 0) {
      setErr('Min quantity must be a positive integer');
      return;
    }
    let maxQty: number | null = null;
    if (draft.maxQuantity.trim()) {
      maxQty = parseInt(draft.maxQuantity, 10);
      if (!Number.isInteger(maxQty) || maxQty < minQty) {
        setErr('Max quantity must be a positive integer ≥ Min quantity');
        return;
      }
    }
    let pct: number | null = null;
    let fixedPrice: number | null = null;
    if (draft.pricingMode === 'percent') {
      pct = parseFloat(draft.discountPercent);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        setErr('Discount % must be a number between 0 and 100');
        return;
      }
    } else {
      fixedPrice = parseFloat(draft.fixedUnitPrice);
      if (Number.isNaN(fixedPrice) || fixedPrice < 0) {
        setErr('Fixed unit price must be a non-negative number');
        return;
      }
    }
    if (draft.startAt && draft.endAt && new Date(draft.endAt) <= new Date(draft.startAt)) {
      setErr('End date must be after start date');
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      await sellerPricingTiersService.create(productId, {
        variantId: draft.variantId || null,
        minQuantity: minQty,
        maxQuantity: maxQty,
        discountPercent: pct,
        fixedUnitPrice: fixedPrice,
        startAt: draft.startAt ? new Date(draft.startAt).toISOString() : null,
        endAt: draft.endAt ? new Date(draft.endAt).toISOString() : null,
        displayLabel: draft.displayLabel.trim() || null,
      });
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to create tier');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (tier: PricingTier) => {
    setBusyRow((prev) => new Set(prev).add(tier.id));
    setErr(null);
    try {
      await sellerPricingTiersService.update(productId, tier.id, {
        isActive: !tier.isActive,
      });
      await refresh();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to toggle tier');
    } finally {
      setBusyRow((prev) => {
        const next = new Set(prev);
        next.delete(tier.id);
        return next;
      });
    }
  };

  const handleDelete = async (tier: PricingTier) => {
    if (!confirm(`Delete tier "${tier.displayLabel}"? This cannot be undone.`)) return;
    setBusyRow((prev) => new Set(prev).add(tier.id));
    setErr(null);
    try {
      await sellerPricingTiersService.remove(productId, tier.id);
      await refresh();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to delete tier');
    } finally {
      setBusyRow((prev) => {
        const next = new Set(prev);
        next.delete(tier.id);
        return next;
      });
    }
  };

  return (
    <section style={{ marginTop: 24, padding: 20, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Volume pricing tiers</h2>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
          Offer customers a discount when they buy in bulk. Tiers apply
          automatically when cart line quantity qualifies. The best-discount
          tier wins.
        </p>
      </header>

      {err && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          {err}
        </div>
      )}

      <div style={{ marginBottom: 16, padding: 14, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <Field label="Variant scope">
            <select
              value={draft.variantId}
              onChange={(e) => setDraft({ ...draft, variantId: e.target.value })}
              style={inputStyle}
            >
              <option value="">All variants</option>
              {(variants ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title || v.sku || v.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Min quantity">
            <input
              type="number"
              min={1}
              value={draft.minQuantity}
              placeholder="e.g. 5"
              onChange={(e) => setDraft({ ...draft, minQuantity: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Max quantity (optional)">
            <input
              type="number"
              min={1}
              value={draft.maxQuantity}
              placeholder="leave blank for unbounded"
              onChange={(e) => setDraft({ ...draft, maxQuantity: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Pricing mode">
            <select
              value={draft.pricingMode}
              onChange={(e) =>
                setDraft({ ...draft, pricingMode: e.target.value as 'percent' | 'fixed' })
              }
              style={inputStyle}
            >
              <option value="percent">% off list</option>
              <option value="fixed">Fixed unit price</option>
            </select>
          </Field>
          {draft.pricingMode === 'percent' ? (
            <Field label="Discount %">
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.discountPercent}
                onChange={(e) => setDraft({ ...draft, discountPercent: e.target.value })}
                style={inputStyle}
              />
            </Field>
          ) : (
            <Field label="Fixed unit price (₹)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.fixedUnitPrice}
                onChange={(e) => setDraft({ ...draft, fixedUnitPrice: e.target.value })}
                style={inputStyle}
              />
            </Field>
          )}
          <Field label="Start at (optional)">
            <input
              type="datetime-local"
              value={draft.startAt}
              onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="End at (optional)">
            <input
              type="datetime-local"
              value={draft.endAt}
              onChange={(e) => setDraft({ ...draft, endAt: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Custom label (optional)">
            <input
              type="text"
              value={draft.displayLabel}
              placeholder="e.g. Bulk pricing!"
              onChange={(e) => setDraft({ ...draft, displayLabel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={
            creating
            || !draft.minQuantity.trim()
            || (draft.pricingMode === 'percent' ? !draft.discountPercent.trim() : !draft.fixedUnitPrice.trim())
          }
          style={{
            height: 32, padding: '0 14px', background: creating ? '#cbd5e1' : '#111827',
            color: '#fff', fontSize: 12, fontWeight: 600, border: 0, borderRadius: 6,
            cursor: creating ? 'not-allowed' : 'pointer',
          }}
        >
          {creating ? 'Adding…' : '+ Add tier'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Loading tiers…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          No pricing tiers yet. Add one above.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Qty range</th>
              <th style={th}>Pricing</th>
              <th style={th}>Variant</th>
              <th style={th}>Schedule</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = busyRow.has(r.id);
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6', opacity: busy ? 0.5 : 1 }}>
                  <td style={td}>{r.maxQuantity ? `${r.minQuantity}-${r.maxQuantity}` : `${r.minQuantity}+`}</td>
                  <td style={td}>
                    {r.discountPercent !== null ? `${r.discountPercent}% off` : null}
                    {r.fixedUnitPrice !== null ? `₹${r.fixedUnitPrice}` : null}
                  </td>
                  <td style={td}>{r.variantId ? r.variantId.slice(0, 8) + '…' : 'All variants'}</td>
                  <td style={td}>
                    {r.startAt || r.endAt
                      ? `${r.startAt ? new Date(r.startAt).toLocaleDateString() : '—'} → ${r.endAt ? new Date(r.endAt).toLocaleDateString() : '∞'}`
                      : 'Always'}
                  </td>
                  <td style={td}>
                    <span style={r.isActive ? activePill : inactivePill}>
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => handleToggleActive(r)} disabled={busy} style={btnSecondary}>
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(r)} disabled={busy} style={{ ...btnDanger, marginLeft: 6 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
};
const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = { padding: '8px 10px', color: '#111827' };
const activePill: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', fontSize: 11, fontWeight: 600,
  background: '#dcfce7', color: '#166534', borderRadius: 999,
};
const inactivePill: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', fontSize: 11, fontWeight: 600,
  background: '#f3f4f6', color: '#6b7280', borderRadius: 999,
};
const btnSecondary: React.CSSProperties = {
  height: 28, padding: '0 12px', background: '#fff', color: '#111827',
  fontSize: 12, fontWeight: 600, border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  height: 28, padding: '0 12px', background: '#dc2626', color: '#fff',
  fontSize: 12, fontWeight: 600, border: 0, borderRadius: 6, cursor: 'pointer',
};
