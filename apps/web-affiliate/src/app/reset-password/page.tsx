'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

/**
 * Step 3 of the affiliate password reset flow. Reads the resetToken
 * from sessionStorage (set by /verify-otp), POSTs the new password,
 * clears the cached reset state, and redirects to /login on success.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('affiliateResetToken');
    if (!stored) {
      router.replace('/forgot-password');
      return;
    }
    setResetToken(stored);
  }, [router]);

  const requirements = checkPassword(newPassword);
  const matches = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = requirements.allMet && matches && !loading;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await apiFetch('/affiliate/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
      });
      sessionStorage.removeItem('affiliateResetEmail');
      sessionStorage.removeItem('affiliateResetToken');
      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (e: any) {
      setError(e?.message ?? 'Could not reset your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12, color: '#16a34a' }} aria-hidden>
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            Password reset
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
            You can now sign in with your new password. Redirecting…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Set a new password
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          Pick something you haven&rsquo;t used before — at least 8 characters with a mix of cases, a digit, and a symbol.
        </p>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <label style={labelStyle}>New password</label>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={loading}
          style={inputStyle}
        />
        <PasswordRequirements requirements={requirements} />

        <label style={{ ...labelStyle, marginTop: 14 }}>Confirm new password</label>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
          style={inputStyle}
        />
        {confirmPassword.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: matches ? '#15803d' : '#b91c1c' }}>
            {matches ? '✓ Passwords match' : '✕ Passwords don’t match yet'}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '11px 16px',
            background: !canSubmit ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: !canSubmit ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Resetting…' : 'Reset password'}
        </button>

        <div style={{ marginTop: 18, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          <Link href="/login" style={{ color: '#2563eb', fontWeight: 600 }}>
            Back to sign in
          </Link>
        </div>
      </form>
    </main>
  );
}

interface PasswordCheck {
  length: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
  special: boolean;
  allMet: boolean;
}

function checkPassword(value: string): PasswordCheck {
  const length = value.length >= 8;
  const lower = /[a-z]/.test(value);
  const upper = /[A-Z]/.test(value);
  const digit = /\d/.test(value);
  const special = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value);
  return { length, lower, upper, digit, special, allMet: length && lower && upper && digit && special };
}

function PasswordRequirements({ requirements }: { requirements: PasswordCheck }) {
  const rows: Array<[boolean, string]> = [
    [requirements.length, 'At least 8 characters'],
    [requirements.lower, 'A lowercase letter'],
    [requirements.upper, 'An uppercase letter'],
    [requirements.digit, 'A number'],
    [requirements.special, 'A symbol (e.g. ! @ # $)'],
  ];
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 4 }}>
      {rows.map(([ok, label]) => (
        <li
          key={label}
          style={{
            fontSize: 11,
            color: ok ? '#15803d' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden style={{ width: 12 }}>{ok ? '✓' : '○'}</span>
          {label}
        </li>
      ))}
    </ul>
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
