'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

/**
 * Step 2 of the affiliate password reset flow. Reads the email from
 * sessionStorage (set by /forgot-password), submits the 6-digit OTP,
 * stashes the returned resetToken, and routes to /reset-password.
 */
export default function VerifyOtpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const stored = sessionStorage.getItem('affiliateResetEmail');
    if (!stored) {
      // No email in flight — bounce back to step 1.
      router.replace('/forgot-password');
      return;
    }
    setEmail(stored);
  }, [router]);

  // Resend cooldown ticker (matches the server-side 60s cooldown).
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const data = await apiFetch<{ resetToken: string }>(
        '/affiliate/auth/verify-reset-otp',
        {
          method: 'POST',
          body: JSON.stringify({ email, otp }),
        },
      );
      sessionStorage.setItem('affiliateResetToken', data.resetToken);
      router.push('/reset-password');
    } catch (e: any) {
      setError(e?.message ?? 'Could not verify the OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      await apiFetch('/affiliate/auth/resend-reset-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setInfo('A fresh OTP is on its way.');
      setCooldown(60);
    } catch (e: any) {
      setError(e?.message ?? 'Could not resend the OTP. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Enter the OTP
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          We sent a 6-digit code to{' '}
          <strong style={{ color: '#0f172a' }}>{email}</strong>. It expires in 10 minutes.
        </p>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}
        {info && !error && (
          <div role="status" style={infoStyle}>
            {info}
          </div>
        )}

        <label style={labelStyle}>6-digit OTP</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          pattern="\d{6}"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={loading}
          style={{
            ...inputStyle,
            fontSize: 22,
            letterSpacing: '0.4em',
            textAlign: 'center',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
          placeholder="••••••"
          autoFocus
        />

        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '11px 16px',
            background: loading || otp.length !== 6 ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading || otp.length !== 6 ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>

        <div style={{ marginTop: 18, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Didn&rsquo;t get it?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            style={{
              background: 'none',
              border: 'none',
              color: cooldown > 0 ? '#94a3b8' : '#2563eb',
              fontWeight: 600,
              cursor: cooldown > 0 || resending ? 'not-allowed' : 'pointer',
              padding: 0,
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {resending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend OTP'}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Wrong email?{' '}
          <Link href="/forgot-password" style={{ color: '#2563eb', fontWeight: 600 }}>
            Start over
          </Link>
        </div>
      </form>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 400,
  background: '#fff',
  padding: 32,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const errorStyle: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 12,
  color: '#991b1b',
};
const infoStyle: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#eff6ff',
  border: '1px solid #bfdbfe',
  borderRadius: 8,
  fontSize: 12,
  color: '#1e3a8a',
};
