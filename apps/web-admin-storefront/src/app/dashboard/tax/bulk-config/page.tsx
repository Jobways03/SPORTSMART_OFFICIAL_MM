'use client';

/**
 * Phase 46 (2026-05-21) — admin bulk tax-config UI.
 *
 * Closes audit Gap #2 — the bulk-tax-config endpoint had no UI; admins
 * could only invoke it via curl/Postman. Now ops can:
 *   1. Pick a filter (explicit productIds OR category + missingHsnOnly).
 *   2. Click "Preview" to see the match count + sample.
 *   3. Enter the tax field(s) to write.
 *   4. Confirm in a modal listing the first N affected products.
 *   5. Submit; receive an updated-count + the per-product audit-log
 *      writes happen server-side.
 *
 * Frontend hides the page in the layout when the admin lacks the
 * `tax.bulk-config` permission key; the backend 403s as a safety net.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

type Taxability = 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';

interface PreviewSample {
  id: string;
  title: string;
  hsnCode: string | null;
  gstRateBps: number | null;
  supplyTaxability: Taxability | null;
  taxConfigVerified: boolean;
}

interface PreviewResponse {
  matchingCount: number;
  capExceeded: boolean;
  cap: number;
  sample: PreviewSample[];
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type FilterMode = 'productIds' | 'category';

export default function BulkTaxConfigPage() {
  const { notify, confirmDialog } = useModal();

  // Filter state
  const [filterMode, setFilterMode] = useState<FilterMode>('productIds');
  const [productIdsRaw, setProductIdsRaw] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [missingHsnOnly, setMissingHsnOnly] = useState(false);

  // Mutation state
  const [hsnCode, setHsnCode] = useState('');
  const [gstRateBps, setGstRateBps] = useState('');
  const [cessRateBps, setCessRateBps] = useState('');
  const [supplyTaxability, setSupplyTaxability] = useState<'' | Taxability>('');
  const [defaultUqcCode, setDefaultUqcCode] = useState('');

  // Status
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);

  function parseProductIds(): { valid: string[]; invalid: string[] } {
    const tokens = productIdsRaw
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!UUID_RE.test(t)) {
        invalid.push(t);
      } else if (!seen.has(t)) {
        seen.add(t);
        valid.push(t);
      }
    }
    return { valid, invalid };
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (filterMode === 'productIds') {
      const { valid } = parseProductIds();
      body.productIds = valid;
    } else {
      body.categoryId = categoryId.trim();
      if (missingHsnOnly) body.missingHsnOnly = true;
    }
    if (hsnCode.trim()) body.hsnCode = hsnCode.trim();
    if (gstRateBps.trim()) body.gstRateBps = Number(gstRateBps);
    if (cessRateBps.trim()) body.cessRateBps = Number(cessRateBps);
    if (supplyTaxability) body.supplyTaxability = supplyTaxability;
    if (defaultUqcCode.trim()) body.defaultUqcCode = defaultUqcCode.trim();
    return body;
  }

  function validateBeforeSubmit(): string | null {
    if (filterMode === 'productIds') {
      const { valid, invalid } = parseProductIds();
      if (invalid.length > 0) return `${invalid.length} entries are not valid UUIDs.`;
      if (valid.length === 0) return 'Paste at least one product UUID.';
    } else {
      if (!UUID_RE.test(categoryId.trim())) return 'categoryId must be a UUID.';
    }
    const anyField =
      hsnCode.trim() || gstRateBps.trim() || cessRateBps.trim() || supplyTaxability || defaultUqcCode.trim();
    if (!anyField) return 'Supply at least one tax field to update.';
    if (hsnCode.trim() && !/^\d{4,8}$/.test(hsnCode.trim()))
      return 'HSN must be 4-8 digits.';
    if (gstRateBps.trim()) {
      const n = Number(gstRateBps);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return 'GST rate must be an integer 0-10000 bps.';
    }
    if (cessRateBps.trim()) {
      const n = Number(cessRateBps);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return 'Cess rate must be an integer 0-10000 bps.';
    }
    if (defaultUqcCode.trim() && !/^[A-Z]{2,6}$/.test(defaultUqcCode.trim()))
      return 'UQC must be 2-6 uppercase letters.';
    return null;
  }

  const handlePreview = async () => {
    setErr(null);
    setResultCount(null);
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setErr(validationError);
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiClient<PreviewResponse>(
        '/admin/products/bulk/tax-config/preview',
        { method: 'POST', body: JSON.stringify(buildBody()) },
      );
      setPreview(res.data ?? null);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    setErr(null);
    setResultCount(null);
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setErr(validationError);
      return;
    }
    if (!preview) {
      setErr('Run preview first so you can see how many products will be affected.');
      return;
    }
    if (preview.capExceeded) {
      setErr(`Filter matches ${preview.matchingCount} products, exceeding the per-call cap of ${preview.cap}. Narrow the filter.`);
      return;
    }
    const ok = await confirmDialog({
      title: `Update tax config on ${preview.matchingCount} product(s)?`,
      message:
        `This resets each product's taxConfigVerified flag to false; a follow-up ` +
        `attestation is required before STRICT-mode invoices can be issued. ` +
        `Audit-log rows will be written for every product touched.`,
      confirmText: `Update ${preview.matchingCount}`,
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const res = await apiClient<{ updated: number }>(
        '/admin/products/bulk/tax-config',
        { method: 'POST', body: JSON.stringify(buildBody()) },
      );
      setResultCount(res.data?.updated ?? 0);
      setPreview(null);
      notify(`Updated ${res.data?.updated ?? 0} products`);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Bulk update failed');
    } finally {
      setSubmitting(false);
    }
  };

  const parsedIds = parseProductIds();

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <header style={{ marginBottom: 18 }}>
        <Link href="/dashboard/tax/mode" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
          ← Tax mode
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '6px 0 4px' }}>Bulk tax-config update</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0, maxWidth: 760 }}>
          Apply HSN / GST rate / cess / UQC / supply taxability to many products in one
          call. Each touched row's <code>taxConfigVerified</code> flag is reset; a
          separate attestation step is required before STRICT-mode invoices issue. Capped
          at <strong>500 products per call</strong>.
        </p>
      </header>

      {err && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}
      {resultCount !== null && (
        <div style={{ padding: '10px 14px', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, color: '#166534', fontSize: 13, marginBottom: 14 }}>
          {resultCount} product(s) updated. Attestation reset — visit each product's tax-config panel to verify.
        </div>
      )}

      <section style={cardStyle}>
        <h2 style={h2}>1. Filter</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>
            <input
              type="radio"
              checked={filterMode === 'productIds'}
              onChange={() => setFilterMode('productIds')}
              style={{ marginRight: 6 }}
            />
            Explicit product IDs
          </label>
          <label style={{ fontSize: 13 }}>
            <input
              type="radio"
              checked={filterMode === 'category'}
              onChange={() => setFilterMode('category')}
              style={{ marginRight: 6 }}
            />
            Category filter
          </label>
        </div>
        {filterMode === 'productIds' ? (
          <>
            <label style={labelStyle}>Product IDs (UUID per line or comma-separated)</label>
            <textarea
              value={productIdsRaw}
              onChange={(e) => setProductIdsRaw(e.target.value)}
              rows={6}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              {parsedIds.valid.length} valid, {parsedIds.invalid.length} invalid · cap 500
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Category ID (UUID)</label>
            <input
              type="text"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
            <label style={{ fontSize: 13, marginTop: 8, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={missingHsnOnly}
                onChange={(e) => setMissingHsnOnly(e.target.checked)}
              />
              Only products in this category whose HSN is missing
            </label>
          </>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={h2}>2. Tax fields to write</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div>
            <label style={labelStyle}>HSN code (4-8 digits)</label>
            <input
              type="text"
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value)}
              placeholder="e.g. 95069900"
              maxLength={8}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>GST rate (basis points 0-10000)</label>
            <input
              type="number"
              value={gstRateBps}
              onChange={(e) => setGstRateBps(e.target.value)}
              placeholder="1800 = 18%"
              min={0}
              max={10000}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Cess rate (basis points 0-10000)</label>
            <input
              type="number"
              value={cessRateBps}
              onChange={(e) => setCessRateBps(e.target.value)}
              placeholder="e.g. 1500"
              min={0}
              max={10000}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Supply taxability</label>
            <select
              value={supplyTaxability}
              onChange={(e) => setSupplyTaxability(e.target.value as '' | Taxability)}
              style={inputStyle}
            >
              <option value="">— leave unchanged —</option>
              <option value="TAXABLE">TAXABLE</option>
              <option value="NIL_RATED">NIL_RATED</option>
              <option value="EXEMPT">EXEMPT</option>
              <option value="NON_GST">NON_GST</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>UQC (2-6 uppercase letters)</label>
            <input
              type="text"
              value={defaultUqcCode}
              onChange={(e) => setDefaultUqcCode(e.target.value.toUpperCase())}
              placeholder="e.g. NOS, KGS, PCS"
              maxLength={6}
              style={inputStyle}
            />
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={h2}>3. Preview &amp; submit</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handlePreview} disabled={previewing || submitting} style={btnSecondary(previewing || submitting)}>
            {previewing ? 'Previewing…' : 'Preview affected'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!preview || preview.capExceeded || submitting}
            style={btnPrimary(!preview || preview.capExceeded || submitting)}
          >
            {submitting ? 'Updating…' : 'Update'}
          </button>
        </div>

        {preview && (
          <div style={{ marginTop: 14, padding: 12, background: preview.capExceeded ? '#fef3c7' : '#f0f9ff', border: `1px solid ${preview.capExceeded ? '#fde68a' : '#bae6fd'}`, borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: preview.capExceeded ? '#92400e' : '#075985' }}>
              {preview.capExceeded
                ? `${preview.matchingCount} products match — exceeds cap of ${preview.cap}. Narrow the filter.`
                : `${preview.matchingCount} product(s) will be updated.`}
            </div>
            {preview.sample.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={th}>Title</th>
                    <th style={th}>HSN</th>
                    <th style={th}>GST</th>
                    <th style={th}>Taxability</th>
                    <th style={th}>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((s) => (
                    <tr key={s.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={td}>{s.title}</td>
                      <td style={td}>{s.hsnCode ?? '—'}</td>
                      <td style={td}>{s.gstRateBps !== null ? `${(s.gstRateBps / 100).toFixed(2)}%` : '—'}</td>
                      <td style={td}>{s.supplyTaxability ?? '—'}</td>
                      <td style={td}>{s.taxConfigVerified ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  marginBottom: 16, padding: 18, background: '#fff',
  border: '1px solid #e5e7eb', borderRadius: 10,
};
const h2: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 12px' };
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', boxSizing: 'border-box',
};
const th: React.CSSProperties = {
  padding: '4px 6px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280',
};
const td: React.CSSProperties = { padding: '4px 6px', color: '#111827', fontSize: 12 };

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 36, padding: '0 18px', background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff', fontSize: 13, fontWeight: 600, border: 0, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    height: 36, padding: '0 18px', background: '#fff', color: '#111827',
    fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}
