'use client';

// Public, token-authenticated MFA enrollment page. Self-contained (raw fetch,
// no app-specific api-client) so the SAME file drops into every admin portal
// — the invite link points at the invitee's home portal and this page must
// resolve there. The flow needs no session: the invite token is the auth.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// Normalise to "<host>/api/v1" whether the env var includes /api/v1 or not.
const API_BASE = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
  .replace(/\/+$/, '')
  .replace(/\/api\/v1$/, '')}/api/v1`;

async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const msg = Array.isArray(json?.message) ? json.message[0] : json?.message;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return json.data as T;
}

type Phase = 'loading' | 'setup' | 'done' | 'error';

interface BeginData {
  otpAuthUrl: string;
  secret: string;
}

export default function MfaEnrollPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [setupData, setSetupData] = useState<BeginData | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Email-OTP alternative — for admins without an authenticator app.
  const [emailMode, setEmailMode] = useState(false);
  const [emailInfo, setEmailInfo] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  // Email is the default factor. Authenticator setup is hidden behind a link.
  const requestEmail = useCallback(async () => {
    setErr('');
    setEmailSending(true);
    try {
      const data = await apiPost<{ maskedEmail: string }>(
        `/admin/mfa/enroll-invite/${encodeURIComponent(token)}/email/request`,
      );
      setEmailMode(true);
      setSetupData(null);
      setCode('');
      setEmailInfo(
        `We emailed a 6-digit code to ${data?.maskedEmail ?? 'your email'}. Enter it below (valid 10 minutes).`,
      );
      setPhase('setup');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not email a code. Try again.');
      setPhase('error');
    } finally {
      setEmailSending(false);
    }
  }, [token]);

  // Optional fallback — set up an authenticator app instead of email codes.
  const useAuthenticator = async () => {
    setErr('');
    try {
      const data = await apiPost<BeginData>(
        `/admin/mfa/enroll-invite/${encodeURIComponent(token)}/begin`,
      );
      if (!data?.secret) throw new Error('Could not start authenticator setup.');
      setSetupData(data);
      setEmailMode(false);
      setEmailInfo('');
      setCode('');
      setPhase('setup');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not start authenticator setup.');
    }
  };

  useEffect(() => {
    if (token) requestEmail();
  }, [token, requestEmail]);

  const complete = async () => {
    if (!/^\d{6}$/.test(code)) {
      setErr(`Enter the 6-digit code ${emailMode ? 'from your email.' : 'from your authenticator app.'}`);
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      const path = emailMode
        ? `/admin/mfa/enroll-invite/${encodeURIComponent(token)}/email/verify`
        : `/admin/mfa/enroll-invite/${encodeURIComponent(token)}/complete`;
      await apiPost(path, { code });
      setPhase('done');
    } catch (e: any) {
      setErr(e?.message ?? 'That code was not accepted. Try the latest code.');
    } finally {
      setSubmitting(false);
    }
  };

  const copySecret = async () => {
    if (!setupData) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* selectable fallback */
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.badge}>● ADMIN</div>
        <h1 style={styles.title}>Set up two-factor authentication</h1>
        <p style={styles.sub}>
          Your account requires a second factor before you can sign in.
        </p>

        {phase === 'loading' && (
          <div style={styles.muted}>Emailing you a verification code…</div>
        )}

        {phase === 'error' && (
          <>
            <div style={styles.error}>{err}</div>
            <button onClick={requestEmail} style={styles.primaryBtn}>
              Try again
            </button>
          </>
        )}

        {phase === 'setup' && (
          <>
            {!emailMode && setupData ? (
              <>
                <ol style={styles.steps}>
                  <li>
                    Open Google Authenticator, Authy, or 1Password and choose{' '}
                    <strong>add account → enter a setup key</strong>.
                  </li>
                  <li>Paste the key below, then enter the 6-digit code it shows.</li>
                </ol>

                <label style={styles.label}>Setup key</label>
                <div style={styles.secretRow}>
                  <code style={styles.secret}>{setupData.secret}</code>
                  <button onClick={copySecret} style={styles.copyBtn}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>

                <details style={styles.details}>
                  <summary style={styles.summary}>Show otpauth link</summary>
                  <code style={styles.otpauth}>{setupData.otpAuthUrl}</code>
                </details>
              </>
            ) : (
              <div style={styles.success}>{emailInfo}</div>
            )}

            <label style={styles.label} htmlFor="mfa-code">
              {emailMode ? 'Emailed 6-digit code' : '6-digit code'}
            </label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && complete()}
              placeholder="000000"
              style={styles.codeInput}
            />

            {err && <div style={styles.error}>{err}</div>}

            <button
              onClick={complete}
              disabled={submitting || code.length !== 6}
              style={{
                ...styles.primaryBtn,
                opacity: submitting || code.length !== 6 ? 0.6 : 1,
              }}
            >
              {submitting ? 'Verifying…' : 'Enable MFA'}
            </button>

            {emailMode ? (
              <>
                <button
                  onClick={requestEmail}
                  disabled={emailSending}
                  style={styles.linkBtn}
                >
                  {emailSending ? 'Sending…' : 'Resend email code'}
                </button>
                <button onClick={useAuthenticator} style={styles.linkBtnMuted}>
                  Prefer an authenticator app? Set it up instead
                </button>
              </>
            ) : (
              <button
                onClick={requestEmail}
                disabled={emailSending}
                style={styles.linkBtn}
              >
                {emailSending ? 'Sending…' : 'Email me a code instead'}
              </button>
            )}
          </>
        )}

        {phase === 'done' && (
          <>
            <div style={styles.success}>
              ✓ MFA is enabled. You can now sign in with your password and a 6-digit code emailed to you.
            </div>
            <a href="/login" style={{ ...styles.primaryBtn, textAlign: 'center', textDecoration: 'none', display: 'block' }}>
              Go to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#f8fafc',
    padding: 24,
  },
  card: {
    width: 440,
    maxWidth: '92vw',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 28,
    boxShadow: '0 10px 30px rgba(0,0,0,0.06)',
  },
  badge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    color: '#15803d',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 999,
    padding: '3px 10px',
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: 700, margin: '0 0 6px', color: '#0f172a' },
  sub: { fontSize: 13, color: '#64748b', margin: '0 0 16px' },
  muted: { fontSize: 13, color: '#64748b', padding: '16px 0' },
  steps: { fontSize: 13, color: '#334155', paddingLeft: 18, margin: '0 0 16px', lineHeight: 1.6 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', margin: '10px 0 6px' },
  secretRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  secret: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 15,
    letterSpacing: 1,
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '10px 12px',
    wordBreak: 'break-all',
  },
  copyBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    padding: '0 14px',
    cursor: 'pointer',
  },
  details: { marginTop: 8 },
  summary: { fontSize: 12, color: '#2563eb', cursor: 'pointer' },
  otpauth: {
    display: 'block',
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#475569',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    wordBreak: 'break-all',
  },
  codeInput: {
    width: '100%',
    fontFamily: 'monospace',
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '12px',
    boxSizing: 'border-box',
  },
  primaryBtn: {
    width: '100%',
    marginTop: 16,
    border: 'none',
    background: '#0f172a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    padding: '12px',
    cursor: 'pointer',
  },
  linkBtn: {
    width: '100%',
    marginTop: 12,
    border: 'none',
    background: 'none',
    color: '#2563eb',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  linkBtnMuted: {
    width: '100%',
    marginTop: 8,
    border: 'none',
    background: 'none',
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  error: {
    fontSize: 13,
    color: '#b91c1c',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 12,
  },
  success: {
    fontSize: 13,
    color: '#15803d',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
  },
  backupGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    margin: '8px 0',
  },
  backupCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    padding: '8px 10px',
    textAlign: 'center',
  },
};
