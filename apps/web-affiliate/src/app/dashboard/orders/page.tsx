'use client';

import { useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

export default function FranchiseOrdersPage() {
  const [franchises, setFranchises] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordLoading, setOrdLoading] = useState(false);

  useEffect(() => {
    adminFranchisesService.listFranchises({ limit: 100 }).then(res => {
      setFranchises(res.data?.franchises || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadOrders = async (id: string) => {
    setSelected(id);
    setOrdLoading(true);
    try {
      const res = await adminFranchisesService.listFranchiseOrders(id, { limit: 50 });
      setOrders((res.data as any)?.orders || []);
    } catch { setOrders([]); }
    finally { setOrdLoading(false); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Orders</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>View orders fulfilled by franchise partners.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase' }}>Select Franchise</h3>
          {loading ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p> : franchises.map(f => (
            <button key={f.id} onClick={() => loadOrders(f.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none',
              borderRadius: 6, marginBottom: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: selected === f.id ? '#eff6ff' : 'transparent', color: selected === f.id ? '#2563eb' : '#111827',
            }}>
              {f.businessName || f.ownerName}
            </button>
          ))}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          {!selected ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Select a franchise to view orders</p>
          ) : ordLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading orders...</p>
          ) : orders.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No orders found</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Order #', 'Customer', 'Status', 'Items', 'Total', 'Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500 }}>{o.orderNumber}</td>
                    <td style={{ padding: '10px 12px' }}>{o.customerName}</td>
                    <td style={{ padding: '10px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: o.status === 'DELIVERED' ? '#dcfce7' : '#dbeafe', color: o.status === 'DELIVERED' ? '#15803d' : '#1d4ed8' }}>{o.status?.replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '10px 12px' }}>{o.itemsCount}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(o.totalAmount || 0).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{new Date(o.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
