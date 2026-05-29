'use client';

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

/**
 * Phase 45 (2026-05-21) — admin per-product tax-config attestation
 * panel.
 *
 * Closes audit Gap #5 — the verifyTaxConfig endpoint existed for
 * months but had zero UI exposure, so admins were forced to call it
 * via the API directly or use bulk-tax-config (which since Phase 29
 * resets the flag, not sets it).
 *
 * The panel surfaces:
 *   - the product's current tax columns
 *   - the verification status (verified by X on Y, version N, or
 *     "Not verified" with the timestamp of the last edit)
 *   - a "Verify Tax Config" button that calls the verify endpoint
 *     with the version the admin reviewed (Phase 45 optimistic lock)
 *   - the per-product attestation audit log
 */

interface Props {
  productId: string;
}

interface TaxConfig {
  hsnCode: string | null;
  gstRateBps: number | null;
  cessRateBps: number | null;
  supplyTaxability: string | null;
  taxInclusivePricing: boolean | null;
  defaultUqcCode: string | null;
  taxCategory: string | null;
  taxConfigVerified: boolean;
  taxConfigVerifiedAt: string | null;
  taxConfigVerifiedBy: string | null;
  taxConfigUpdatedAt: string | null;
  taxConfigUpdatedBy: string | null;
  taxConfigVersion: number;
}

interface AttestationLogEntry {
  id: string;
  action: 'ATTESTED' | 'RESET' | 'EDITED' | 'BULK_EDITED';
  prevHsn: string | null;
  prevGstRateBps: number | null;
  newHsn: string | null;
  newGstRateBps: number | null;
  taxConfigVersion: number;
  actorId: string;
  actorRole: string;
  reviewerNote: string | null;
  createdAt: string;
}

export function TaxConfigPanel({ productId }: Props) {
  const { notify } = useModal();
  const [config, setConfig] = useState<TaxConfig | null>(null);
  const [log, setLog] = useState<AttestationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [reviewerNote, setReviewerNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [productRes, logRes] = await Promise.all([
        apiClient<TaxConfig>(`/admin/products/${productId}`),
        apiClient<AttestationLogEntry[]>(`/admin/products/${productId}/tax-attestation-log?limit=10`),
      ]);
      setConfig((productRes.data as unknown as { data?: TaxConfig })?.data ?? (productRes.data as any));
      setLog(Array.isArray(logRes.data) ? logRes.data : []);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to load tax config');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleVerify = async () => {
    if (!config) return;
    setVerifying(true);
    setErr(null);
    try {
      await apiClient(`/admin/products/${productId}/verify-tax-config`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: config.taxConfigVersion,
          reviewerNote: reviewerNote.trim() || undefined,
        }),
      });
      setReviewerNote('');
      await refresh();
      notify('Tax config attested');
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to attest tax config');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Tax config attestation</h2>
        <p style={mutedStyle}>Loading…</p>
      </section>
    );
  }
  if (!config) {
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Tax config attestation</h2>
        <p style={mutedStyle}>Tax config not available for this product.</p>
      </section>
    );
  }

  const verified = config.taxConfigVerified === true;

  return (
    <section style={cardStyle}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={titleStyle}>Tax config attestation</h2>
        <p style={mutedStyle}>
          Admin sign-off on the product's HSN / GST / supply taxability. STRICT-mode
          invoice generation refuses to emit a Tax Invoice for products without
          this attestation.
        </p>
      </header>

      {err && <div style={errBanner}>{err}</div>}

      <div style={statusRow}>
        <div style={statusCell}>
          <div style={statusLabel}>Status</div>
          <div style={verified ? pillActive : pillInactive}>
            {verified ? `Verified (v${config.taxConfigVersion})` : `Not verified (v${config.taxConfigVersion})`}
          </div>
        </div>
        <div style={statusCell}>
          <div style={statusLabel}>Last attested</div>
          <div style={statusValue}>
            {config.taxConfigVerifiedAt
              ? `${new Date(config.taxConfigVerifiedAt).toLocaleString()} by ${shortId(config.taxConfigVerifiedBy)}`
              : '—'}
          </div>
        </div>
        <div style={statusCell}>
          <div style={statusLabel}>Last edited</div>
          <div style={statusValue}>
            {config.taxConfigUpdatedAt
              ? `${new Date(config.taxConfigUpdatedAt).toLocaleString()} by ${shortId(config.taxConfigUpdatedBy)}`
              : '—'}
          </div>
        </div>
      </div>

      <div style={fieldsGrid}>
        <Field label="HSN code" value={config.hsnCode || '—'} />
        <Field label="GST rate" value={config.gstRateBps !== null ? `${(config.gstRateBps / 100).toFixed(2)}%` : '—'} />
        <Field label="Cess rate" value={config.cessRateBps !== null ? `${(config.cessRateBps / 100).toFixed(2)}%` : '—'} />
        <Field label="Supply taxability" value={config.supplyTaxability || '—'} />
        <Field label="Tax-inclusive pricing" value={config.taxInclusivePricing ? 'Yes' : 'No'} />
        <Field label="UQC" value={config.defaultUqcCode || '—'} />
        <Field label="Tax category" value={config.taxCategory || '—'} />
      </div>

      {!verified && (
        <div style={attestBox}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Attest this tax config
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Confirms that you have reviewed the HSN, GST rate, supply taxability, and
            UQC values for this product. Required for STRICT-mode invoicing.
          </div>
          <input
            type="text"
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            placeholder="Reviewer note (optional) — e.g. CA-team spreadsheet review 2026-05-21"
            maxLength={500}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            style={btnPrimary(verifying)}
          >
            {verifying ? 'Attesting…' : 'Verify Tax Config'}
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={statusLabel}>Attestation history</div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Action</th>
                <th style={th}>Actor</th>
                <th style={th}>Version</th>
                <th style={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}>{new Date(row.createdAt).toLocaleString()}</td>
                  <td style={td}>{row.action}</td>
                  <td style={td}>{row.actorRole}: {shortId(row.actorId)}</td>
                  <td style={td}>v{row.taxConfigVersion}</td>
                  <td style={td}>{row.reviewerNote ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={statusLabel}>{label}</div>
      <div style={statusValue}>{value}</div>
    </div>
  );
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

const cardStyle: React.CSSProperties = {
  marginTop: 24, padding: 20, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
};
const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: 0 };
const mutedStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280', margin: '4px 0 0' };
const statusRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 12, marginBottom: 16,
};
const statusCell: React.CSSProperties = {};
const statusLabel: React.CSSProperties = {
  fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
};
const statusValue: React.CSSProperties = { fontSize: 13, color: '#111827', marginTop: 2 };
const pillActive: React.CSSProperties = {
  display: 'inline-block', padding: '4px 10px', fontSize: 12, fontWeight: 600,
  background: '#dcfce7', color: '#166534', borderRadius: 999, marginTop: 2,
};
const pillInactive: React.CSSProperties = {
  display: 'inline-block', padding: '4px 10px', fontSize: 12, fontWeight: 600,
  background: '#fef3c7', color: '#92400e', borderRadius: 999, marginTop: 2,
};
const fieldsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 16, padding: 14, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
};
const attestBox: React.CSSProperties = {
  marginTop: 16, padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
};
const inputStyle: React.CSSProperties = {
  width: '100%', height: 32, padding: '0 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', marginBottom: 10,
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8,
};
const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = { padding: '6px 8px', color: '#111827' };
const errBanner: React.CSSProperties = {
  marginBottom: 12, padding: '8px 12px', background: '#fef2f2',
  border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#991b1b',
};

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 16px', background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff', fontSize: 13, fontWeight: 600, border: 0, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
