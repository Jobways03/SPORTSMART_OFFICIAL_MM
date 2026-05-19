'use client';

// Phase 37 — Bulk product tax-config update page.
//
// Admin filters a set of products (by category OR explicit IDs) and
// applies the same HSN / GST rate / UQC / supply-taxability to all
// matched rows in one call. Sets taxConfigVerified=true since the
// admin is explicitly attesting the values.

import { useState } from 'react';
import { adminProductsService } from '@/services/admin-products.service';

const TAXABILITY_OPTIONS = [
  '',
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE',
];

export default function BulkTaxConfigPage() {
  // Filter
  const [productIdsText, setProductIdsText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [missingHsnOnly, setMissingHsnOnly] = useState(false);

  // Apply
  const [hsnCode, setHsnCode] = useState('');
  const [gstRateBps, setGstRateBps] = useState('');
  const [supplyTaxability, setSupplyTaxability] = useState('');
  const [defaultUqcCode, setDefaultUqcCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const productIds = productIdsText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Parameters<typeof adminProductsService.bulkUpdateTaxConfig>[0] = {};
      if (productIds.length > 0) payload.productIds = productIds;
      else if (categoryId.trim()) {
        payload.categoryId = categoryId.trim();
        payload.missingHsnOnly = missingHsnOnly;
      }
      if (hsnCode.trim()) payload.hsnCode = hsnCode.trim();
      if (gstRateBps.trim()) payload.gstRateBps = Number(gstRateBps);
      if (supplyTaxability) payload.supplyTaxability = supplyTaxability;
      if (defaultUqcCode.trim()) payload.defaultUqcCode = defaultUqcCode.trim().toUpperCase();

      const res = await adminProductsService.bulkUpdateTaxConfig(payload);
      setResult(`Updated ${res.data?.updated ?? 0} product(s).`);
    } catch (err: any) {
      setError(err?.message ?? 'Bulk update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <h1>Bulk product tax-config update</h1>
      <p style={{ color: '#666' }}>
        Apply HSN code + GST rate + UQC + supply taxability to many
        products at once. Sets <code>taxConfigVerified=true</code> with
        your admin ID as attester.
      </p>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>1. Filter</h2>
        <div>
          <label style={lbl}>Product IDs (comma- or whitespace-separated)</label>
          <textarea
            value={productIdsText}
            onChange={(e) => setProductIdsText(e.target.value)}
            placeholder="cm17... cm18..."
            rows={3}
            style={{ ...input, fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>
        <div style={{ color: '#666', fontSize: 12, margin: '8px 0' }}>
          — or —
        </div>
        <div>
          <label style={lbl}>Category ID</label>
          <input
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="category UUID"
            style={input}
          />
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            marginTop: 8,
          }}
        >
          <input
            type="checkbox"
            checked={missingHsnOnly}
            onChange={(e) => setMissingHsnOnly(e.target.checked)}
            disabled={!categoryId.trim()}
          />
          Only products in this category with missing/empty HSN
        </label>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>2. Apply</h2>
        <p style={{ color: '#666', fontSize: 12 }}>
          Leave a field blank to skip it. At least one must be set.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={lbl}>HSN code</label>
            <input
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value.replace(/\D/g, ''))}
              placeholder="61091000"
              style={input}
            />
          </div>
          <div>
            <label style={lbl}>GST rate (bps; e.g. 1800 = 18%)</label>
            <input
              type="number"
              value={gstRateBps}
              onChange={(e) => setGstRateBps(e.target.value)}
              placeholder="1800"
              style={input}
            />
          </div>
          <div>
            <label style={lbl}>Supply taxability</label>
            <select
              value={supplyTaxability}
              onChange={(e) => setSupplyTaxability(e.target.value)}
              style={input}
            >
              {TAXABILITY_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || '— (leave unchanged)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Default UQC code</label>
            <input
              value={defaultUqcCode}
              onChange={(e) =>
                setDefaultUqcCode(e.target.value.toUpperCase())
              }
              placeholder="PCS"
              style={input}
            />
          </div>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => void apply()} disabled={busy} style={btnPrimary}>
          {busy ? 'Applying…' : 'Apply to matched products'}
        </button>
        {result && <span style={{ color: '#16a34a' }}>{result}</span>}
        {error && <span style={{ color: '#dc2626' }}>{error}</span>}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, color: '#444', marginBottom: 4 };
const input: React.CSSProperties = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
};
