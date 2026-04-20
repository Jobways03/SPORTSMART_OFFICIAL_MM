import Link from 'next/link';

export default function NotFound() {
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
            fontSize: '72px',
            fontWeight: 800,
            color: '#7c3aed',
            lineHeight: 1,
            marginBottom: '16px',
          }}
        >
          404
        </div>
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: '#111827',
            margin: '0 0 12px',
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: '0 0 24px',
            lineHeight: 1.5,
          }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-block',
            padding: '10px 24px',
            background: '#7c3aed',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
