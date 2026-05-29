'use client';

/**
 * Phase 45 (2026-05-21) — admin bulk verify-tax-config page.
 *
 * Calls POST /admin/products/bulk/verify-tax-config with a paste-in
 * list of product IDs. Mirrors the per-product attestation flow but
 * lets the finance/CA admin work through a batch in one round.
 *
 * Pairs with the audit-readiness dashboard (/dashboard/tax/mode →
 * Readiness panel), which surfaces the `product.unverified_config`
 * blocker count + sampleIds. Admin copies the sample list, reviews
 * the configs in a spreadsheet, then pastes the verified ids here.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

interface BulkResult {
  attestedIds: string[];
  failed: Array<{ productId: string; reason: string }>;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default function BulkVerifyTaxConfigPage() {
  const { notify } = useModal();
  const [rawIds, setRawIds] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function parseIds(): { valid: string[]; invalid: string[] } {
    const tokens = rawIds
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const t of tokens) {
      if (!UUID_RE.test(t)) {
        invalid.push(t);
        continue;
      }
      if (!seen.has(t)) {
        seen.add(t);
        valid.push(t);
      }
    }
    return { valid, invalid };
  }

  const handleSubmit = async () => {
    setErr(null);
    setResult(null);
    const { valid, invalid } = parseIds();
    if (invalid.length > 0) {
      setErr(`${invalid.length} entries are not valid UUIDs — fix or remove them first.`);
      return;
    }
    if (valid.length === 0) {
      setErr('Paste at least one product UUID.');
      return;
    }
    if (valid.length > 500) {
      setErr(`Limit is 500 product IDs per request; you supplied ${valid.length}.`);
      return;
    }
    setRunning(true);
    try {
      const res = await apiClient<BulkResult>('/admin/products/bulk/verify-tax-config', {
        method: 'POST',
        body: JSON.stringify({
          productIds: valid,
          reviewerNote: reviewerNote.trim() || undefined,
        }),
      });
      setResult(res.data ?? null);
      notify(`Attested ${(res.data?.attestedIds ?? []).length} of ${valid.length}`);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Bulk attestation failed');
    } finally {
      setRunning(false);
    }
  };

  const parsed = parseIds();

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <header style={{ marginBottom: 18 }}>
        <Link href="/dashboard/tax/mode" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
          ← Tax mode
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '6px 0 4px' }}>Bulk verify tax config</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0, maxWidth: 720 }}>
          Attest the tax config of many products in one call. Each ID must already have
          a valid HSN, GST rate, and supply taxability — the server re-validates per row.
          Failures are reported individually; successes write a row to the per-product
          attestation log.
        </p>
      </header>

      {err && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}

      <section style={cardStyle}>
        <label style={labelStyle}>Product IDs (UUID per line, or comma-separated)</label>
        <textarea
          value={rawIds}
          onChange={(e) => setRawIds(e.target.value)}
          placeholder="d3a1...&#10;e5f2..."
          rows={10}
          style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
        />
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
          {parsed.valid.length} valid, {parsed.invalid.length > 0 ? `${parsed.invalid.length} invalid (fix or remove)` : '0 invalid'}
          {' · '}max 500 per request
        </div>

        <label style={{ ...labelStyle, marginTop: 16 }}>Reviewer note (optional)</label>
        <input
          type="text"
          value={reviewerNote}
          onChange={(e) => setReviewerNote(e.target.value)}
          placeholder="e.g. CA-team review week of 2026-05-21"
          maxLength={500}
          style={inputStyle}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={running || parsed.valid.length === 0 || parsed.invalid.length > 0}
          style={btnPrimary(running || parsed.valid.length === 0 || parsed.invalid.length > 0)}
        >
          {running ? 'Attesting…' : `Attest ${parsed.valid.length} product(s)`}
        </button>
      </section>

      {result && (
        <section style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Result</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <span style={pill('#dcfce7', '#166534')}>
              {result.attestedIds.length} attested
            </span>
            <span style={pill(result.failed.length > 0 ? '#fef3c7' : '#f3f4f6', result.failed.length > 0 ? '#92400e' : '#6b7280')}>
              {result.failed.length} failed
            </span>
          </div>
          {result.failed.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={labelStyle}>Failed</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={th}>Product ID</th>
                    <th style={th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failed.map((f) => (
                    <tr key={f.productId} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={td}><code>{f.productId}</code></td>
                      <td style={td}>{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  marginBottom: 18, padding: 18, background: '#fff',
  border: '1px solid #e5e7eb', borderRadius: 10,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', boxSizing: 'border-box',
};
const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280',
};
const td: React.CSSProperties = { padding: '6px 8px', color: '#111827', fontSize: 12 };

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 36, padding: '0 18px', background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff', fontSize: 13, fontWeight: 600, border: 0, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer', marginTop: 14,
  };
}
function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '4px 10px', fontSize: 12, fontWeight: 600,
    background: bg, color, borderRadius: 999,
  };
}
