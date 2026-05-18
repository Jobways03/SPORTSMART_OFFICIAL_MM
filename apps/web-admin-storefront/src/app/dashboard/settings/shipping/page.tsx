'use client';

import { useEffect, useState, useCallback } from 'react';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';
import ShippingOptionForm from './_components/ShippingOptionForm';

interface ShippingOption {
  id: string;
  name: string;
  deliveryDetails: string | null;
  rateType: 'FLAT' | 'FREE';
  priceInPaise: string;
  freeShippingMinCartPaise: string | null;
  transitMinDays: number | null;
  transitMaxDays: number | null;
  isActive: boolean;
  sortOrder: number;
}

export default function ShippingSettingsPage() {
  const { confirmDialog, notify } = useModal();
  const [items, setItems] = useState<ShippingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ShippingOption | 'new' | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiClient<ShippingOption[]>('/admin/shipping-options?includeInactive=true')
      .then((r) => setItems(r.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Delete shipping option?',
      message: 'This cannot be undone. Customers will no longer see this option at checkout.',
      confirmText: 'Delete',
      cancelText: 'Keep',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiClient(`/admin/shipping-options/${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      notify({ kind: 'error', message: e?.message ?? 'Delete failed' });
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Shipping</h1>
          <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
            Manage flat shipping fees and free-shipping rules customers see at checkout.
          </div>
        </div>
        <button
          onClick={() => setEditing('new')}
          style={{
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            background: '#303030',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Create shipping option
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 60,
            color: '#6b7280',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
          }}
        >
          No shipping options yet. Customers will check out without a delivery fee until you create one.
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafbfc', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Name</th>
                <th style={th}>Rate type</th>
                <th style={thRight}>Price</th>
                <th style={th}>Transit</th>
                <th style={th}>Free above</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{it.name}</div>
                    {it.deliveryDetails && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {it.deliveryDetails}
                      </div>
                    )}
                  </td>
                  <td style={td}>{it.rateType}</td>
                  <td style={tdRight}>
                    {it.rateType === 'FREE'
                      ? '—'
                      : `₹${(Number(it.priceInPaise) / 100).toFixed(2)}`}
                  </td>
                  <td style={td}>
                    {it.transitMinDays && it.transitMaxDays
                      ? `${it.transitMinDays}–${it.transitMaxDays} days`
                      : '—'}
                  </td>
                  <td style={td}>
                    {it.freeShippingMinCartPaise
                      ? `₹${(Number(it.freeShippingMinCartPaise) / 100).toFixed(0)}`
                      : '—'}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 999,
                        background: it.isActive ? '#dcfce7' : '#fee2e2',
                        color: it.isActive ? '#15803d' : '#991b1b',
                      }}
                    >
                      {it.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => setEditing(it)} style={linkBtn}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(it.id)} style={{ ...linkBtn, color: '#dc2626' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ShippingOptionForm
          option={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '12px 16px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3 };
const thRight: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '14px 16px', verticalAlign: 'top' };
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '4px 8px' };
