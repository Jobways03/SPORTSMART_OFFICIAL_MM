'use client';

import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';

interface SettingTile {
  title: string;
  description: string;
  href: string;
  icon: string;
  requires?: 'superAdmin' | { anyOf: string[] };
}

const SETTINGS_TILES: SettingTile[] = [
  {
    title: 'Roles & Permissions',
    description: 'Define what each admin role can do. System roles ship pre-configured; create custom roles for finer slicing.',
    href: '/dashboard/roles',
    icon: '🛡️',
    requires: 'superAdmin',
  },
  {
    title: 'Admin Users',
    description: 'Create, suspend, or reassign internal admin accounts and the roles attached to them.',
    href: '/dashboard/users',
    icon: '👤',
    requires: 'superAdmin',
  },
  {
    title: 'Authorization Readiness',
    description: 'Operator dashboard for the authz stack: strict / soak mode, registry coverage, SUPER_ADMIN permission count, warnings.',
    href: '/dashboard/settings/authz-readiness',
    icon: '🚦',
    requires: { anyOf: ['roles.read'] },
  },
  {
    title: 'Shipping',
    description: 'Shipping zones, rates, and surcharges. Affects checkout for every customer.',
    href: '/dashboard/settings/shipping',
    icon: '🚚',
    requires: { anyOf: ['shipping.read', 'shipping.write'] },
  },
];

export default function SettingsHubPage() {
  const { loading, me, isSuperAdmin, hasAnyPermission } = usePermissions();

  const canAccess = (tile: SettingTile): boolean => {
    if (loading || !me) return false;
    if (!tile.requires) return true;
    if (tile.requires === 'superAdmin') return isSuperAdmin;
    return hasAnyPermission(tile.requires.anyOf);
  };

  const accessibleTiles = SETTINGS_TILES.filter(canAccess);
  const lockedTiles = SETTINGS_TILES.filter((t) => !canAccess(t));

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080 }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0f172a' }}>Settings</h1>
        <p style={{ marginTop: 6, fontSize: 14, color: '#64748b' }}>
          Platform-wide controls. Some sections require Super Admin or specific permissions.
        </p>
      </header>

      {loading && <div style={{ color: '#64748b' }}>Loading…</div>}

      {!loading && accessibleTiles.length === 0 && (
        <div style={emptyBox}>
          You don&apos;t have access to any settings sections. Contact a Super Admin if you think this is wrong.
        </div>
      )}

      {!loading && accessibleTiles.length > 0 && (
        <div style={grid}>
          {accessibleTiles.map((tile) => (
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
      )}

      {!loading && lockedTiles.length > 0 && (
        <details style={{ marginTop: 32 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#94a3b8', userSelect: 'none' }}>
            {lockedTiles.length} section{lockedTiles.length === 1 ? '' : 's'} hidden — you don&apos;t have permission
          </summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lockedTiles.map((tile) => (
              <div key={tile.href} style={lockedTile}>
                <span>{tile.icon}</span>
                <span style={{ color: '#475569' }}>{tile.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
                  requires{' '}
                  {tile.requires === 'superAdmin'
                    ? 'Super Admin'
                    : tile.requires?.anyOf.join(' or ')}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
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

const emptyBox: React.CSSProperties = {
  padding: 24,
  background: '#fef3c7',
  border: '1px solid #fde68a',
  borderRadius: 10,
  color: '#92400e',
  fontSize: 13,
};

const lockedTile: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
};
