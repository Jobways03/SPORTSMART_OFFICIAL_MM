'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminPricingTiersService,
  PricingTier,
} from '@/services/admin-pricing-tiers.service';

interface Props {
  productId: string;
  /**
   * Optional variant list — when present, the create form offers a
   * variant dropdown so ops can scope a tier to one SKU. Leave empty
   * to default to "any variant" (variantId = null).
   */
  variants?: Array<{ id: string; title?: string | null; sku?: string | null }>;
}

interface DraftTier {
  variantId: string;
  minQuantity: string;
  discountPercent: string;
  displayLabel: string;
}

const EMPTY_DRAFT: DraftTier = {
  variantId: '',
  minQuantity: '',
  discountPercent: '',
  displayLabel: '',
};

/**
 * Story 3.5 — admin panel for managing a product's pricing tiers.
 *
 * Mounted on the product-edit page. Lists existing tiers, lets ops
 * add/remove/update/activate/deactivate them. Server is the source of
 * truth for validation — we just translate its 400 responses into a
 * friendly error banner.
 */
export function PricingTiersPanel({ productId, variants }: Props) {
  const [rows, setRows] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTier>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  // Per-row busy state so toggling tier A doesn't lock the whole list.
  const [busyRow, setBusyRow] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminPricingTiersService.list(productId);
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
    const pct = parseFloat(draft.discountPercent);
    if (!Number.isInteger(minQty) || minQty <= 0) {
      setErr('Min quantity must be a positive integer');
      return;
    }
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setErr('Discount % must be a number between 0 and 100');
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      await adminPricingTiersService.create(productId, {
        variantId: draft.variantId || null,
        minQuantity: minQty,
        discountPercent: pct,
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
      await adminPricingTiersService.update(productId, tier.id, {
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
    if (!window.confirm(`Delete tier "${tier.displayLabel}"? This cannot be undone.`)) return;
    setBusyRow((prev) => new Set(prev).add(tier.id));
    setErr(null);
    try {
      await adminPricingTiersService.remove(productId, tier.id);
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
    <section style={cardStyle}>
      <header style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Volume pricing tiers</h2>
          <p style={subtitleStyle}>
            Display-only at v1 — these are shown as "Buy N+ save P%" hints on the
            product page. Cart pricing is not affected yet.
          </p>
        </div>
      </header>

      {err && <div style={errBanner}>{err}</div>}

      {/* Create form */}
      <div style={createCard}>
        <div style={createGrid}>
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
          <Field label="Discount %">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={draft.discountPercent}
              placeholder="e.g. 10"
              onChange={(e) => setDraft({ ...draft, discountPercent: e.target.value })}
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
          disabled={creating || !draft.minQuantity.trim() || !draft.discountPercent.trim()}
          style={btnPrimary(creating || !draft.minQuantity.trim() || !draft.discountPercent.trim())}
        >
          {creating ? 'Adding…' : '+ Add tier'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={emptyStyle}>Loading tiers…</div>
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>No pricing tiers yet. Add one above.</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Min qty</th>
                <th style={th}>Discount</th>
                <th style={th}>Variant</th>
                <th style={th}>Label</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const busy = busyRow.has(r.id);
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6', opacity: busy ? 0.5 : 1 }}>
                    <td style={td}>{r.minQuantity}</td>
                    <td style={td}>{r.discountPercent}%</td>
                    <td style={td}>
                      {r.variantId ? (
                        <code style={inlineCode}>{r.variantId.slice(0, 8)}…</code>
                      ) : (
                        <span style={{ color: '#6b7280' }}>All variants</span>
                      )}
                    </td>
                    <td style={td}>{r.displayLabel}</td>
                    <td style={td}>
                      <span style={r.isActive ? activePill : inactivePill}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(r)}
                        disabled={busy}
                        style={btnSecondary(busy)}
                      >
                        {r.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        disabled={busy}
                        style={{ ...btnDanger(busy), marginLeft: 6 }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: 24,
  padding: 20,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 16,
};
const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: 0 };
const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '4px 0 0',
  maxWidth: 600,
};
const createCard: React.CSSProperties = {
  marginBottom: 16,
  padding: 14,
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
};
const createGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
  marginBottom: 10,
};
const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
};
const tableWrap: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: '#f9fafb',
};
const td: React.CSSProperties = { padding: '8px 10px', color: '#111827' };
const inlineCode: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  background: '#f3f4f6',
  padding: '1px 5px',
  borderRadius: 4,
};
const activePill: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  background: '#dcfce7',
  color: '#166534',
  borderRadius: 999,
};
const inactivePill: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  background: '#f3f4f6',
  color: '#6b7280',
  borderRadius: 999,
};
const emptyStyle: React.CSSProperties = {
  padding: 20,
  textAlign: 'center',
  color: '#6b7280',
  fontSize: 13,
  background: '#f9fafb',
  borderRadius: 8,
};
const errBanner: React.CSSProperties = {
  marginBottom: 12,
  padding: '8px 12px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 13,
  color: '#991b1b',
};

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 12px',
    background: '#fff',
    color: '#111827',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 12px',
    background: disabled ? '#fecaca' : '#dc2626',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
