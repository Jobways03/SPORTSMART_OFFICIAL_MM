'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  PayableEntry,
} from '@/services/admin-accounts.service';

const money = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export default function FranchisePayablesPage() {
  const [rows, setRows] = useState<PayableEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminAccountsService
      .listPayables({ nodeType: 'FRANCHISE', limit: 100 })
      .then((res) => setRows(res.data?.payables || []))
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
        Franchise Payables
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Pending and settled amounts owed to each franchise partner.
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
        ) : rows.length === 0 ? (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
            No franchise payables
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Franchise', 'Orders', 'Total', 'Pending', 'Settled', 'Last paid'].map(
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
              {rows.map((r) => (
                <tr key={r.nodeId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{r.nodeName}</td>
                  <td style={{ padding: '10px 12px' }}>{r.totalOrders}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{money(r.totalAmount)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#b45309' }}>{money(r.pendingAmount)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#15803d' }}>{money(r.settledAmount)}</td>
                  <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>
                    {r.lastPaidAt ? new Date(r.lastPaidAt).toLocaleDateString() : '—'}
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
