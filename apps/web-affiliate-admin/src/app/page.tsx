import Link from 'next/link';

/**
 * Affiliate admin landing page. Phase 1 placeholder. The full
 * 13-page admin per SRS §25.2 (affiliate list/detail, orders,
 * commissions, payouts, fraud, audit, settings) is built out in
 * later phases. The API endpoints these pages will consume already
 * exist under /admin/affiliates/*.
 */
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '4px 12px',
          background: '#dbeafe',
          color: '#1d4ed8',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          marginBottom: 16,
        }}
      >
        Affiliate Admin
      </span>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          margin: '0 0 12px',
          letterSpacing: '-0.5px',
        }}
      >
        SportsMart Affiliate Admin
      </h1>
      <p
        style={{
          fontSize: 15,
          color: '#64748b',
          maxWidth: 520,
          margin: '0 0 32px',
          lineHeight: 1.55,
        }}
      >
        Approve applications, review commissions, process payouts (with TDS),
        and monitor fraud. Sign in with your admin credentials to continue.
      </p>
      <Link
        href="/login"
        style={{
          display: 'inline-block',
          padding: '12px 32px',
          background: '#0f172a',
          color: '#fff',
          borderRadius: 8,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Admin sign in
      </Link>
    </main>
  );
}
