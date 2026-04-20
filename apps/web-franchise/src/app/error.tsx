'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Application error:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        padding: '24px',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          textAlign: 'center',
          background: '#ffffff',
          padding: '48px 32px',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          border: '1px solid #e5e7eb',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 24px',
            borderRadius: '50%',
            background: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            color: '#dc2626',
          }}
        >
          !
        </div>
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: '#111827',
            margin: '0 0 12px',
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: '0 0 24px',
            lineHeight: 1.5,
          }}
        >
          We hit an unexpected error while loading this page. You can try again
          or go back to your dashboard.
        </p>
        {error.digest && (
          <p
            style={{
              fontSize: '12px',
              color: '#9ca3af',
              margin: '0 0 24px',
              fontFamily: 'monospace',
            }}
          >
            Error ID: {error.digest}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '10px 20px',
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            style={{
              padding: '10px 20px',
              background: '#ffffff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
