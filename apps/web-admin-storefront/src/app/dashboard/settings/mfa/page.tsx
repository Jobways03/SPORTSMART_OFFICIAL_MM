'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminMfaService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';

type Phase =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'already-enrolled' }
  | { kind: 'enrolling'; secret: string; otpAuthUrl: string }
  | { kind: 'verifying'; secret: string; otpAuthUrl: string }
  | { kind: 'success'; backupCodes: string[] };

function qrUrl(otpAuthUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&qzone=1&data=${encodeURIComponent(otpAuthUrl)}`;
}

export default function AdminMfaSettingsPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codesAck, setCodesAck] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const ranOnce = useRef(false);

  const probe = useCallback(async () => {
    setError('');
    setPhase({ kind: 'loading' });
    try {
      const res = await adminMfaService.beginEnrollment();
      if (res.data) {
        setPhase({
          kind: 'enrolling',
          secret: res.data.secret,
          otpAuthUrl: res.data.otpAuthUrl,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setPhase({ kind: 'already-enrolled' });
        return;
      }
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Failed to start MFA enrollment'
          : 'Failed to start MFA enrollment',
      );
      setPhase({ kind: 'idle' });
    }
  }, [router]);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    void probe();
  }, [probe]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase.kind !== 'enrolling' || submitting) return;
    const trimmed = code.replace(/\s+/g, '');
    const otpErr = validateOtp(trimmed);
    if (otpErr) {
      setError(otpErr);
      return;
    }
    setSubmitting(true);
    setError('');
    setPhase({
      kind: 'verifying',
      secret: phase.secret,
      otpAuthUrl: phase.otpAuthUrl,
    });
    try {
      const res = await adminMfaService.completeEnrollment(trimmed);
      if (res.data) {
        setPhase({ kind: 'success', backupCodes: res.data.backupCodes });
        setCode('');
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Verification failed'
          : 'Verification failed',
      );
      setPhase({
        kind: 'enrolling',
        secret: phase.secret,
        otpAuthUrl: phase.otpAuthUrl,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async (text: string, hint = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyHint(hint);
      setTimeout(() => setCopyHint(''), 1500);
    } catch {
      setCopyHint('Copy failed — select manually');
      setTimeout(() => setCopyHint(''), 2500);
    }
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([codes.join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sportsmart-mfa-backup-codes-${new Date()
      .toISOString()
      .slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 880, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0F1115' }}>
        Two-factor authentication
      </h1>
      <p style={{ marginTop: 4, marginBottom: 24, fontSize: 13, color: '#525A65' }}>
        Adds a one-time TOTP code to your sign-in. Strongly recommended for
        every admin — protects the account even if your password leaks.
      </p>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {phase.kind === 'loading' && (
        <Panel>
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            Checking your MFA status…
          </div>
        </Panel>
      )}

      {phase.kind === 'idle' && (
        <Panel>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <button onClick={() => void probe()} style={primaryBtn}>
              Retry
            </button>
          </div>
        </Panel>
      )}

      {phase.kind === 'already-enrolled' && (
        <Panel>
          <div style={{ padding: 22, display: 'flex', gap: 14, alignItems: 'center' }}>
            <span style={tickPill}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#111827' }}>
                MFA is enabled on your account
              </div>
              <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>
                You will be prompted for a code on every sign-in and for
                destructive admin actions.
              </div>
            </div>
          </div>
          <div
            style={{
              padding: '14px 22px 22px',
              borderTop: '1px solid #e5e7eb',
              fontSize: 13,
              color: '#525A65',
            }}
          >
            <strong style={{ color: '#374151' }}>Lost access?</strong> Use one
            of the backup codes you saved during enrollment. Each is single-use.
            If you've exhausted them, ask a SUPER_ADMIN to reset your MFA.
          </div>
        </Panel>
      )}

      {(phase.kind === 'enrolling' || phase.kind === 'verifying') && (
        <Panel>
          <div style={{ padding: '22px 24px', borderBottom: '1px solid #e5e7eb' }}>
            <Eyebrow>Step 1 of 2</Eyebrow>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#111827' }}>
              Add SportsMart to your authenticator
            </h2>
            <p style={{ fontSize: 13, color: '#525A65', marginTop: 6, margin: 0 }}>
              Use Google Authenticator, 1Password, Authy, Microsoft Authenticator,
              or any RFC&nbsp;6238 TOTP app.
            </p>
          </div>

          <div
            style={{
              padding: 24,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 24,
              alignItems: 'start',
            }}
          >
            <QrBox otpAuthUrl={phase.otpAuthUrl} />

            <div>
              <Eyebrow>Can't scan? Enter manually</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 14,
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    letterSpacing: '0.08em',
                    padding: '8px 12px',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    color: '#111827',
                    wordBreak: 'break-all',
                  }}
                >
                  {phase.secret}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(phase.secret, 'Secret copied')}
                  style={secondaryBtn}
                >
                  {copyHint || 'Copy'}
                </button>
              </div>

              <Eyebrow>Step 2 of 2 — Enter the 6-digit code</Eyebrow>
              <form onSubmit={onSubmit}>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                  }
                  placeholder="000000"
                  autoFocus
                  style={{
                    width: 200,
                    padding: '11px 14px',
                    fontSize: 22,
                    fontFamily: 'ui-monospace, monospace',
                    letterSpacing: '0.4em',
                    textAlign: 'center',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    background: '#fff',
                    outline: 'none',
                  }}
                  disabled={submitting || phase.kind === 'verifying'}
                />
                <div style={{ marginTop: 12 }}>
                  <button
                    type="submit"
                    disabled={
                      code.length !== 6 || submitting || phase.kind === 'verifying'
                    }
                    style={{
                      ...primaryBtn,
                      background:
                        code.length === 6 && !submitting
                          ? '#2563eb'
                          : '#9ca3af',
                      cursor:
                        code.length === 6 && !submitting
                          ? 'pointer'
                          : 'not-allowed',
                    }}
                  >
                    {submitting || phase.kind === 'verifying'
                      ? 'Verifying…'
                      : 'Verify and enable'}
                  </button>
                </div>
              </form>

              <div
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  color: '#9ca3af',
                  lineHeight: 1.5,
                }}
              >
                The code rotates every 30 seconds. If verification fails, check
                that your device clock is correct — TOTP is clock-sensitive.
              </div>
            </div>
          </div>
        </Panel>
      )}

      {phase.kind === 'success' && (
        <Panel tone="success">
          <div style={{ padding: '22px 24px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <span style={tickPill}>✓</span>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#15803d' }}>
                MFA enabled
              </h2>
            </div>
            <p style={{ fontSize: 13, color: '#525A65', margin: 0 }}>
              Save these backup codes <strong>now</strong>. Each is single-use,
              stored as a hash on the server, and is the only way back in if you
              lose your authenticator device.
            </p>
          </div>

          <div style={{ padding: '20px 24px' }}>
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              The API <strong>cannot show these again</strong>. If you close
              this page without saving them, you'll have to regenerate them via
              a SUPER_ADMIN reset.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                marginBottom: 16,
              }}
            >
              {phase.backupCodes.map((c, i) => (
                <code
                  key={i}
                  style={{
                    padding: '10px 12px',
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 14,
                    letterSpacing: '0.06em',
                    color: '#111827',
                    textAlign: 'center',
                    userSelect: 'all',
                  }}
                >
                  {c}
                </code>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button
                onClick={() =>
                  void copy(phase.backupCodes.join('\n'), 'All codes copied')
                }
                style={secondaryBtn}
              >
                {copyHint || 'Copy all'}
              </button>
              <button
                onClick={() => downloadCodes(phase.backupCodes)}
                style={secondaryBtn}
              >
                Download .txt
              </button>
              <label
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  fontSize: 13,
                  color: '#374151',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={codesAck}
                  onChange={(e) => setCodesAck(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                I've saved these codes somewhere safe
              </label>
            </div>

            {codesAck && (
              <div
                style={{
                  marginTop: 16,
                  padding: '12px 14px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#166534',
                }}
              >
                You're all set. From the next sign-in, you'll be prompted for
                a 6-digit code from your authenticator app.
              </div>
            )}
          </div>
        </Panel>
      )}

      <div style={{ marginTop: 24 }}>
        <Link
          href="/dashboard"
          style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function QrBox({ otpAuthUrl }: { otpAuthUrl: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      style={{
        width: 240,
        minWidth: 240,
        height: 240,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrUrl(otpAuthUrl)}
          alt="MFA QR code"
          width={224}
          height={224}
          onError={() => setFailed(true)}
          style={{ display: 'block' }}
        />
      ) : (
        <div
          style={{
            fontSize: 12,
            color: '#9ca3af',
            textAlign: 'center',
            padding: 14,
          }}
        >
          QR image failed to load.
          <br />
          Use the manual secret on the right.
        </div>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 6,
        marginTop: 8,
      }}
    >
      {children}
    </div>
  );
}

function Panel({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'success';
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderTop: tone === 'success' ? '3px solid #16a34a' : undefined,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {children}
    </section>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 22px',
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  background: '#2563eb',
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
};

const tickPill: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 13,
  background: '#dcfce7',
  color: '#15803d',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  fontWeight: 700,
};
