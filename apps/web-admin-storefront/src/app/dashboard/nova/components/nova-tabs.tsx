'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard/nova/warehouses', label: 'Warehouses' },
  { href: '/dashboard/nova/products', label: 'Products' },
  { href: '/dashboard/nova/stocks', label: 'Stocks' },
  { href: '/dashboard/nova/procurement', label: 'Procurement' },
];

export function NovaTabs() {
  const pathname = usePathname() || '';
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: '#F3F4F6',
        borderRadius: 9999,
        marginBottom: 20,
        width: 'fit-content',
      }}
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '8px 16px',
              borderRadius: 9999,
              background: active ? '#fff' : 'transparent',
              color: active ? '#0F1115' : '#525A65',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: active ? '0 1px 2px rgba(15,17,21,0.08)' : 'none',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
