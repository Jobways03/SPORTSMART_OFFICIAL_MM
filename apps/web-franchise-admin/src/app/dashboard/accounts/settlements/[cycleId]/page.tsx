'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  adminAccountsService,
  SettlementCycleDetail,
} from '@/services/admin-accounts.service';

const money = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export default function FranchiseSettlementCycleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cycleId = (params?.cycleId as string) || '';
  const [cycle, setCycle] = useState<SettlementCycleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    adminAccountsService
      .getCycleDetail(cycleId)
      .then((res) => {
        if (res.data) setCycle(res.data);
        else setError('Cycle not found');
      })
      .catch(() => setError('Failed to load settlement cycle'))
      .finally(() => setLoading(false));
  }, [cycleId]);

  if (loading)
    return <p style={{ color: '#9ca3af', padding: 40 }}>Loading cycle...</p>;
  if (error || !cycle)
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.back()}
          style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', marginBottom: 16 }}
        >
          &larr; Back
        </button>
        <p style={{ color: '#9ca3af' }}>{error || 'Cycle not found'}</p>
      </div>
    );

  const fs = cycle.franchiseSettlements ?? [];

  return (
    <div style={{ maxWidth: 980 }}>
      <button
        onClick={() => router.back()}
        style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', marginBottom: 12, fontSize: 13 }}
      >
        &larr; Back to Settlement Cycles
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        Settlement Cycle
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        {new Date(cycle.periodStart).toLocaleDateString()} –{' '}
        {new Date(cycle.periodEnd).toLocaleDateString()} · {cycle.status?.replace(/_/g, ' ')}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          ['Franchise settlements', String(cycle.franchiseSettlementCount)],
          ['Franchise payable', money(cycle.totalFranchisePayable)],
          ['Platform earning', money(cycle.totalPlatformEarning)],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px' }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Franchise settlements
        </h2>
        {fs.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>
            No franchise settlements in this cycle
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Franchise', 'Total', 'Platform earning', 'Payable', 'Status', 'Settled'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
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
              {fs.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>{s.nodeName}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{money(s.totalAmount)}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{money(s.platformEarning)}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{money(s.payableAmount)}</td>
                  <td style={{ padding: '8px 10px' }}>{s.status?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '8px 10px', color: '#6b7280', fontSize: 12 }}>
                    {s.settledAt ? new Date(s.settledAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
