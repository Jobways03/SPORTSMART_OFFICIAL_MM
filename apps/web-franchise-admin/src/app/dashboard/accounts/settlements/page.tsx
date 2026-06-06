'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminAccountsService,
  SettlementCycleListItem,
} from '@/services/admin-accounts.service';

const money = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const statusColor = (s?: string): { bg: string; fg: string } => {
  const up = (s || '').toUpperCase();
  if (up === 'PAID' || up === 'COMPLETED') return { bg: '#dcfce7', fg: '#15803d' };
  if (up === 'CANCELLED' || up === 'FAILED') return { bg: '#fee2e2', fg: '#b91c1c' };
  return { bg: '#dbeafe', fg: '#1d4ed8' };
};

export default function FranchiseSettlementCyclesPage() {
  const router = useRouter();
  const [cycles, setCycles] = useState<SettlementCycleListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminAccountsService
      .listCycles({ limit: 50 })
      .then((res) => setCycles(res.data?.cycles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Link
        href="/dashboard/accounts"
        style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
      >
        &larr; Back to Accounts
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 4px' }}>
        Settlement Cycles
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Settlement cycles with franchise payouts. Click a cycle for its
        per-franchise settlements.
      </p>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 20,
        }}
      >
        {loading ? (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
            Loading...
          </p>
        ) : cycles.length === 0 ? (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
            No settlement cycles
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Period', 'Status', 'Franchise settlements', 'Franchise payable', 'Created'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        fontSize: 11,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => {
                const sc = statusColor(c.status);
                return (
                  <tr
                    key={c.id}
                    onClick={() =>
                      router.push(`/dashboard/accounts/settlements/${c.id}`)
                    }
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f9fafb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '';
                    }}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                      {new Date(c.periodStart).toLocaleDateString()} –{' '}
                      {new Date(c.periodEnd).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: sc.bg,
                          color: sc.fg,
                        }}
                      >
                        {c.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{c.franchiseSettlementCount}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {money(c.totalFranchisePayable)}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
