'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';

interface KycRecord {
  status: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  panLast4?: string | null;
  aadhaarLast4?: string | null;
  panDocumentUrl?: string | null;
  aadhaarDocumentUrl?: string | null;
  verifiedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export default function KycPage() {
  const [kyc, setKyc] = useState<KycRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [panDoc, setPanDoc] = useState('');
  const [aadhaarDoc, setAadhaarDoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<KycRecord | null>('/affiliate/me/kyc');
      setKyc(data ?? { status: 'NOT_STARTED' });
    } catch (e: any) {
      setError(e?.message ?? 'Could not load KYC.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      await apiFetch('/affiliate/me/kyc', {
        method: 'POST',
        body: JSON.stringify({
          panNumber: pan.trim().toUpperCase(),
          aadhaarNumber: aadhaar.trim() || undefined,
          panDocumentUrl: panDoc.trim() || undefined,
          aadhaarDocumentUrl: aadhaarDoc.trim() || undefined,
        }),
      });
      setPan('');
      setAadhaar('');
      setPanDoc('');
      setAadhaarDoc('');
      await load();
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p style={{ color: '#64748b' }}>Loading…</p>;
  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!kyc) return null;

  const canSubmit = kyc.status === 'NOT_STARTED' || kyc.status === 'REJECTED';

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>KYC verification</h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
        Required by Indian tax law (Section 194H). PAN is mandatory for TDS reporting; Aadhaar is optional.
      </p>

      <StatusCard kyc={kyc} />

      {canSubmit && (
        <form
          onSubmit={handleSubmit}
          style={{
            marginTop: 20,
            padding: 24,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>
            {kyc.status === 'REJECTED' ? 'Resubmit KYC' : 'Submit KYC'}
          </h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 18px' }}>
            We encrypt PAN and Aadhaar at rest. Only the last 4 characters are visible to admins.
          </p>

          <Field label="PAN number" required>
            <input
              type="text"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              maxLength={10}
              required
              style={inputStyle}
            />
            <Hint>5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).</Hint>
          </Field>

          <Field label="PAN document image" optional>
            <DocumentUploader
              kind="pan"
              currentUrl={panDoc}
              onChange={setPanDoc}
            />
          </Field>

          <Field label="Aadhaar number" optional>
            <input
              type="text"
              value={aadhaar}
              onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ''))}
              placeholder="12 digits"
              maxLength={12}
              style={inputStyle}
            />
          </Field>

          <Field label="Aadhaar document image" optional>
            <DocumentUploader
              kind="aadhaar"
              currentUrl={aadhaarDoc}
              onChange={setAadhaarDoc}
            />
          </Field>

          {submitError && (
            <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
              {submitError}
            </div>
          )}

          <button type="submit" disabled={submitting} style={btnPrimary}>
            {submitting ? 'Submitting…' : kyc.status === 'REJECTED' ? 'Resubmit' : 'Submit for review'}
          </button>
        </form>
      )}
    </div>
  );
}

function StatusCard({ kyc }: { kyc: KycRecord }) {
  const styles: Record<KycRecord['status'], { bg: string; border: string; fg: string; title: string; body: string }> = {
    NOT_STARTED: {
      bg: '#f8fafc', border: '#e2e8f0', fg: '#475569',
      title: 'KYC not started',
      body: 'Submit your PAN to enable payouts.',
    },
    PENDING: {
      bg: '#fef3c7', border: '#fde68a', fg: '#92400e',
      title: 'Under review',
      body: 'Our team is reviewing your submission. This usually takes 1–2 business days.',
    },
    VERIFIED: {
      bg: '#dcfce7', border: '#bbf7d0', fg: '#15803d',
      title: 'KYC verified',
      body: 'Your account is fully verified. You can request payouts.',
    },
    REJECTED: {
      bg: '#fee2e2', border: '#fecaca', fg: '#991b1b',
      title: 'KYC rejected',
      body: kyc.rejectionReason || 'Please review the issue and resubmit.',
    },
  };
  const s = styles[kyc.status];
  return (
    <div style={{ padding: 18, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: s.fg, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {s.title}
      </div>
      <div style={{ fontSize: 13, color: s.fg, marginTop: 4, lineHeight: 1.5 }}>
        {s.body}
      </div>
      {(kyc.panLast4 || kyc.aadhaarLast4) && (
        <div style={{ marginTop: 14, display: 'flex', gap: 24, fontSize: 13 }}>
          {kyc.panLast4 && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PAN</div>
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2 }}>
                XXXXXX{kyc.panLast4}
              </div>
            </div>
          )}
          {kyc.aadhaarLast4 && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Aadhaar</div>
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2 }}>
                XXXX-XXXX-{kyc.aadhaarLast4}
              </div>
            </div>
          )}
          {kyc.verifiedAt && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Verified</div>
              <div style={{ marginTop: 2 }}>{formatDate(kyc.verifiedAt)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentUploader({
  kind,
  currentUrl,
  onChange,
}: {
  kind: 'pan' | 'aadhaar';
  currentUrl: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setErr('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErr('Only JPG, PNG, and WEBP images are allowed.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErr('File must be 8 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('document', file);
      const result = await apiFetch<{ secureUrl: string }>(
        `/affiliate/me/kyc/upload/${kind}`,
        { method: 'POST', body: fd },
      );
      onChange(result.secureUrl);
    } catch (e: any) {
      setErr(e?.message ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  if (currentUrl) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <img
          src={currentUrl}
          alt={`${kind} document`}
          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid #e2e8f0' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Uploaded</div>
          <a href={currentUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1d4ed8', textDecoration: 'none', wordBreak: 'break-all' }}>
            View document ↗
          </a>
        </div>
        <button type="button" onClick={() => onChange('')} style={btnGhost}>
          Replace
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: '#fff',
          border: '1.5px dashed #cbd5e1',
          borderRadius: 8,
          cursor: uploading ? 'wait' : 'pointer',
          fontSize: 13,
          color: '#475569',
        }}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={uploading}
          style={{ display: 'none' }}
        />
        <span style={{ fontSize: 18 }}>📷</span>
        <span style={{ fontWeight: 500 }}>
          {uploading ? 'Uploading…' : `Choose ${kind === 'pan' ? 'PAN' : 'Aadhaar'} card image`}
        </span>
      </label>
      <Hint>JPG / PNG / WEBP up to 8 MB. We store your scan encrypted on our CDN.</Hint>
      {err && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>{err}</div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
        {optional && <span style={{ color: '#94a3b8', fontWeight: 500 }}> (optional)</span>}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>{children}</p>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
