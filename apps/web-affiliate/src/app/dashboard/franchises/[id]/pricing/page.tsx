'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { useModal } from '@sportsmart/ui';

// A row in the render table. The admin sees every catalog mapping the
// franchise has (so they can set a price on any of them) plus a
// synthetic column for the current override.
interface Row {
  key: string; // productId::variantId
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  variantSku: string | null;
  // Override id (if one exists) so we can pass it to DELETE.
  overrideId: string | null;
  currentOverride: number | null;
  // Draft (editable) landed cost.
  draft: string;
  saving: boolean;
}

const fmt = (v: number | string | null | undefined) => {
  if (v == null || Number(v) === 0) return '\u2014';
  return `\u20B9${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export default function FranchisePricingPage() {
const params = useParams();
  const franchiseId = String(params?.id ?? '');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Two parallel fetches: the franchise's catalog mappings (so we
      // have every SKU they can procure) and the current set of
      // price overrides. Merge them client-side: every mapping gets a
      // row, overrides hydrate the `currentOverride` cell.
      const [catalogRes, pricesRes] = await Promise.all([
        adminFranchisesService.listCatalog({
          franchiseId,
          limit: 500,
          approvalStatus: 'APPROVED',
        }),
        adminFranchisesService.listProcurementPrices(franchiseId),
      ]);

      const overridesByKey = new Map<string, { id: string; landedUnitCost: number }>();
      for (const p of pricesRes.data?.prices ?? []) {
        const key = `${p.productId}::${p.variantId ?? ''}`;
        overridesByKey.set(key, {
          id: p.id,
          landedUnitCost: Number(p.landedUnitCost),
        });
      }

      const mappings = (catalogRes.data as any)?.mappings ?? [];
      const built: Row[] = mappings.map((m: any) => {
        const key = `${m.productId}::${m.variantId ?? ''}`;
        const override = overridesByKey.get(key) ?? null;
        return {
          key,
          productId: m.productId,
          variantId: m.variantId ?? null,
          productTitle: m.product?.title ?? '(unknown product)',
          variantTitle: m.variant?.title ?? null,
          variantSku: m.variant?.sku ?? m.globalSku ?? null,
          overrideId: override?.id ?? null,
          currentOverride: override?.landedUnitCost ?? null,
          draft: override ? String(override.landedUnitCost) : '',
          saving: false,
        };
      });
      setRows(built);
    } catch (err) {
      setError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to load pricing',
      );
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    if (franchiseId) load();
  }, [franchiseId, load]);

  const handleDraftChange = (key: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, draft: value } : r)),
    );
  };

  const handleSave = async (row: Row) => {
    const n = Number(row.draft);
    if (!row.draft || Number.isNaN(n) || n < 0.01) {
      setError('Enter a landed cost greater than 0');
      return;
    }
    setError('');
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, saving: true } : r)),
    );
    try {
      await adminFranchisesService.upsertProcurementPrice(franchiseId, {
        productId: row.productId,
        variantId: row.variantId ?? undefined,
        landedUnitCost: n,
      });
      setSavedKey(row.key);
      setTimeout(() => setSavedKey(null), 2000);
      await load();
    } catch (err) {
      setError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to save price',
      );
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, saving: false } : r)),
      );
    }
  };

  const handleRemove = async (row: Row) => {if (!row.overrideId) return;
    if (
      !(await confirmDialog(
        'Remove this negotiated price? Approval will fall back to the variant default.',
      ))
    ) {
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, saving: true } : r)),
    );
    try {
      await adminFranchisesService.deleteProcurementPrice(franchiseId, row.overrideId);
      await load();
    } catch (err) {
      setError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to remove price',
      );
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, saving: false } : r)),
      );
    }
  };

  const summary = useMemo(() => {
    const set = rows.filter((r) => r.currentOverride != null).length;
    return { total: rows.length, withOverride: set };
  }, [rows]);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard/franchises" style={{ color: '#2563eb', fontSize: 13 }}>
          &larr; Back to franchises
        </Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Procurement Pricing
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Set a negotiated landed cost for this franchise per SKU. The value
        here overrides the variant default in procurement approvals for{' '}
        <strong>this franchise only</strong> — other franchises continue to
        default to the platform cost.
      </p>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 20,
          fontSize: 13,
          color: '#6b7280',
          marginBottom: 12,
        }}
      >
        <span>
          <strong>{summary.withOverride}</strong> of <strong>{summary.total}</strong> SKUs
          have a negotiated price
        </span>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            This franchise has no approved catalog mappings yet. Approve some
            mappings on the catalog page first — negotiated prices attach to
            existing mappings.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['SKU', 'Product', 'Variant', 'Current override', 'New cost', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const justSaved = savedKey === r.key;
                const dirty =
                  r.draft !== '' &&
                  Number(r.draft) !== (r.currentOverride ?? 0);
                return (
                  <tr key={r.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: '#374151',
                      }}
                    >
                      {r.variantSku ?? '\u2014'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{r.productTitle}</td>
                    <td style={{ padding: '10px 14px', color: '#6b7280' }}>
                      {r.variantTitle ?? '\u2014'}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                      {fmt(r.currentOverride)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#6b7280' }}>&#8377;</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={r.draft}
                          onChange={(e) => handleDraftChange(r.key, e.target.value)}
                          placeholder="0.00"
                          disabled={r.saving}
                          style={{
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                            fontSize: 13,
                            fontFamily: 'monospace',
                            width: 110,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          disabled={!dirty || r.saving}
                          onClick={() => handleSave(r)}
                          style={{
                            padding: '6px 12px',
                            border: 'none',
                            borderRadius: 6,
                            background:
                              !dirty || r.saving ? '#93c5fd' : '#2563eb',
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: !dirty || r.saving ? 'default' : 'pointer',
                          }}
                        >
                          {r.saving ? '...' : 'Save'}
                        </button>
                        {r.overrideId && !r.saving && (
                          <button
                            onClick={() => handleRemove(r)}
                            style={{
                              padding: '6px 10px',
                              border: '1px solid #d1d5db',
                              background: '#fff',
                              color: '#991b1b',
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        )}
                        {justSaved && (
                          <span style={{ color: '#15803d', fontSize: 11 }}>Saved</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
