'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  FranchiseOverview,
  OutstandingPayables,
  TopFranchise,
} from '@/services/admin-accounts.service';

const money = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '16px 18px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || '#0f172a' }}>
        {value}
      </div>
    </div>
  );
}

export default function FranchiseAccountsPage() {
  const [ov, setOv] = useState<FranchiseOverview | null>(null);
  const [out, setOut] = useState<OutstandingPayables | null>(null);
  const [top, setTop] = useState<TopFranchise[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminAccountsService.getFranchiseOverview().catch(() => null),
      adminAccountsService.getOutstanding().catch(() => null),
      adminAccountsService.getTopPerformers().catch(() => null),
    ])
      .then(([o, p, t]) => {
        if (o?.data) setOv(o.data);
        if (p?.data) setOut(p.data);
        if (t?.data) setTop(t.data.topFranchises || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Franchise Accounts</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            ['/dashboard/accounts/payables', 'Payables'],
            ['/dashboard/accounts/settlements', 'Settlements'],
            ['/dashboard/accounts/reports', 'Reports'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#2563eb',
                textDecoration: 'none',
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                padding: '8px 14px',
                borderRadius: 8,
              }}
            >
              {label} &rarr;
            </Link>
          ))}
        </div>
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Franchise finance overview — earnings, outstanding payables and
        settlements across all franchise partners.
      </p>

      {loading ? (
        <p style={{ color: '#9ca3af', padding: 40 }}>Loading...</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <Kpi label="Active franchises" value={String(ov?.activeFranchises ?? 0)} />
            <Kpi label="Franchise earnings" value={money(ov?.totalFranchiseEarnings)} />
            <Kpi label="Online order commission" value={money(ov?.totalOnlineOrderCommission)} />
            <Kpi label="Procurement fees" value={money(ov?.totalProcurementFees)} />
            <Kpi label="Pending settlement" value={money(ov?.pendingSettlementAmount)} tone="#b45309" />
            <Kpi label="Settled amount" value={money(ov?.settledAmount)} tone="#15803d" />
            <Kpi
              label="Outstanding (franchise)"
              value={money(out?.franchiseOutstanding?.amount)}
              tone="#b91c1c"
            />
            <Kpi
              label="Oldest unpaid"
              value={
                out?.oldestUnpaidDate
                  ? new Date(out.oldestUnpaidDate).toLocaleDateString()
                  : '—'
              }
            />
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
              Top franchises
            </h2>
            {top.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 13 }}>No data</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    {['Franchise', 'Online orders', 'Procurements', 'Revenue', 'Platform earning'].map(
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
                  {top.map((t) => (
                    <tr key={t.franchiseId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>{t.franchiseName}</td>
                      <td style={{ padding: '8px 10px' }}>{t.totalOnlineOrders}</td>
                      <td style={{ padding: '8px 10px' }}>{t.totalProcurements}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{money(t.totalRevenue)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{money(t.platformEarning)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
