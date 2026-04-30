'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

/**
 * Step 1 of the affiliate password reset flow. Submits the email
 * address and (silently) triggers a 6-digit OTP email. The endpoint
 * always returns 200 to avoid leaking which emails have accounts.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/affiliate/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Stash the email so /verify-otp + /reset-password know who's resetting.
      sessionStorage.setItem('affiliateResetEmail', email.trim().toLowerCase());
      router.push('/verify-otp');
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Forgot your password?
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          Enter your email and we&rsquo;ll send a 6-digit code to reset it.
        </p>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          style={inputStyle}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '11px 16px',
            background: loading ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Sending…' : 'Send OTP'}
        </button>

        <div style={{ marginTop: 18, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Remembered it?{' '}
          <Link href="/login" style={{ color: '#2563eb', fontWeight: 600 }}>
            Back to sign in
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
