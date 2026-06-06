'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import {
  franchiseReturnsService,
  FranchiseReturnListItem,
} from '@/services/franchise-returns.service';

const statusColor = (s?: string): { bg: string; fg: string } => {
  const up = (s || '').toUpperCase();
  if (up.includes('REFUND') || up === 'COMPLETED' || up === 'CLOSED')
    return { bg: '#dcfce7', fg: '#15803d' };
  if (up.includes('REJECT') || up.includes('CANCEL'))
    return { bg: '#fee2e2', fg: '#b91c1c' };
  return { bg: '#dbeafe', fg: '#1d4ed8' };
};

export default function FranchiseAdminReturnsPage() {
  const router = useRouter();
  const [franchises, setFranchises] = useState<
    Array<{ id: string; businessName?: string; ownerName?: string }>
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [returns, setReturns] = useState<FranchiseReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retLoading, setRetLoading] = useState(false);

  useEffect(() => {
    adminFranchisesService
      .listFranchises({ limit: 100 })
      .then((res) => setFranchises(res.data?.franchises || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadReturns = async (id: string) => {
    setSelected(id);
    setRetLoading(true);
    try {
      const res = await franchiseReturnsService.list(id, { limit: 50 });
      setReturns(res.data?.returns || []);
    } catch {
      setReturns([]);
    } finally {
      setRetLoading(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Franchise Returns
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Returns raised against orders fulfilled by franchise partners.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 16,
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#6b7280',
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            Select Franchise
          </h3>
          {loading ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p>
          ) : (
            franchises.map((f) => (
              <button
                key={f.id}
                onClick={() => loadReturns(f.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  marginBottom: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  background: selected === f.id ? '#eff6ff' : 'transparent',
                  color: selected === f.id ? '#2563eb' : '#111827',
                }}
              >
                {f.businessName || f.ownerName}
              </button>
            ))
          )}
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 20,
          }}
        >
          {!selected ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              Select a franchise to view returns
            </p>
          ) : retLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              Loading returns...
            </p>
          ) : returns.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              No returns found
            </p>
          ) : (
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
            >
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Return #', 'Order #', 'Status', 'Items', 'Date'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => {
                  const c = statusColor(r.status);
                  return (
                    <tr
                      key={r.id}
                      onClick={() =>
                        router.push(
                          `/dashboard/returns/${r.id}?franchiseId=${selected}`,
                        )
                      }
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f9fafb';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '';
                      }}
                    >
                      <td
                        style={{
                          padding: '10px 12px',
                          fontFamily: 'monospace',
                          fontWeight: 500,
                        }}
                      >
                        {r.returnNumber || r.id.slice(0, 8)}
                      </td>
                      <td
                        style={{ padding: '10px 12px', fontFamily: 'monospace' }}
                      >
                        {r.subOrder?.masterOrder?.orderNumber || '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: c.bg,
                            color: c.fg,
                          }}
                        >
                          {r.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {Array.isArray(r.items) ? r.items.length : 0}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          color: '#6b7280',
                          fontSize: 12,
                        }}
                      >
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
