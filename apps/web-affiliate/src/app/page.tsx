import Link from 'next/link';

/**
 * Affiliate portal landing page. Phase 1 placeholder — directs new
 * applicants to /register and existing affiliates to /login. The
 * full 10-page portal (dashboard, links, coupon, earnings, payouts,
 * KYC, profile, etc.) is built out in subsequent phases per the SRS
 * §25.1 page list.
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
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          margin: '0 0 12px',
          letterSpacing: '-0.5px',
        }}
      >
        SportsMart Affiliate Portal
      </h1>
      <p
        style={{
          fontSize: 15,
          color: '#64748b',
          maxWidth: 480,
          margin: '0 0 32px',
          lineHeight: 1.55,
        }}
      >
        Earn commissions by promoting SportsMart products. Apply once, get a
        unique referral link and coupon code, and track your earnings end-to-end.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/register"
          style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: '#2563eb',
            color: '#fff',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Apply to become an affiliate
        </Link>
        <Link
          href="/login"
          style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: '#fff',
            color: '#0f172a',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Affiliate login
        </Link>
      </div>
    </main>
  );
}
