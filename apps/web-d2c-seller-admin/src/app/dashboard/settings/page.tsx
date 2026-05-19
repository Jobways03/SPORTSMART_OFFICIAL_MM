'use client';

import Link from 'next/link';

interface SettingTile {
  title: string;
  description: string;
  href: string;
  icon: string;
}

const SETTINGS_TILES: SettingTile[] = [
  {
    title: 'Two-factor authentication',
    description:
      'Enrol a TOTP authenticator on your account, save backup codes, or confirm your existing enrolment. Protects against credential leaks.',
    href: '/dashboard/settings/mfa',
    icon: '🔐',
  },
];

export default function SettingsHubPage() {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080 }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Settings
        </h1>
        <p style={{ marginTop: 6, fontSize: 14, color: '#64748b' }}>
          Account-level controls for your seller-admin profile.
        </p>
      </header>

      <div style={grid}>
        {SETTINGS_TILES.map((tile) => (
          <Link key={tile.href} href={tile.href} style={tileStyle}>
            <div style={tileIcon}>{tile.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={tileTitle}>{tile.title}</div>
              <div style={tileDesc}>{tile.description}</div>
            </div>
            <div style={chevron}>›</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
  gap: 16,
};

const tileStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '20px 22px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  textDecoration: 'none',
  color: 'inherit',
  transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
};

const tileIcon: React.CSSProperties = {
  fontSize: 28,
  width: 48,
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f1f5f9',
  borderRadius: 10,
  flexShrink: 0,
};

const tileTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#0f172a',
  marginBottom: 4,
};

const tileDesc: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  lineHeight: 1.5,
};

const chevron: React.CSSProperties = {
  fontSize: 22,
  color: '#cbd5e1',
  fontWeight: 300,
};
