'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface MenuListRow {
  id: string;
  handle: string;
  name: string;
  itemCount: number;
  updatedAt: string;
}

export default function MenusListPage() {
  const [menus, setMenus] = useState<MenuListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newMenu, setNewMenu] = useState({ handle: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiClient<MenuListRow[]>('/admin/storefront/menus')
      .then((res) => setMenus(res.data ?? []))
      .catch(() => setMenus([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newMenu.handle.trim() || !newMenu.name.trim()) return;
    try {
      await apiClient('/admin/storefront/menus', {
        method: 'POST',
        body: JSON.stringify(newMenu),
      });
      setCreating(false);
      setNewMenu({ handle: '', name: '' });
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create menu');
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: '#111', margin: 0 }}>Navigation menus</h1>
          <p style={{ color: '#6b7280', marginTop: 6, fontSize: 14 }}>
            Manage the storefront navigation. The <code>main-menu</code> drives the public website&apos;s top nav.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            style={{ background: '#111', color: '#fff', border: 'none', padding: '10px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderRadius: 6 }}
          >
            + New menu
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={onCreate}
          style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 16 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Name</span>
              <input
                type="text"
                value={newMenu.name}
                onChange={(e) => setNewMenu({ ...newMenu, name: e.target.value })}
                placeholder="Footer menu"
                required
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Handle</span>
              <input
                type="text"
                value={newMenu.handle}
                onChange={(e) => setNewMenu({ ...newMenu, handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                placeholder="footer-menu"
                required
                pattern="[a-z0-9-]+"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace' }}
              />
            </label>
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ background: '#111', color: '#fff', border: 'none', padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderRadius: 6 }}>
              Create
            </button>
            <button type="button" onClick={() => { setCreating(false); setError(null); }} style={{ background: '#fff', color: '#111', border: '1px solid #d1d5db', padding: '8px 16px', fontSize: 14, cursor: 'pointer', borderRadius: 6 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>Loading…</div>
        ) : menus.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
            No menus yet. Click <strong>+ New menu</strong> to create one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Name</th>
                <th style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Handle</th>
                <th style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Items</th>
                <th style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {menus.map((m) => (
                <tr key={m.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: '#111' }}>{m.name}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>{m.handle}</td>
                  <td style={{ padding: '14px 16px', fontSize: 14, color: '#374151' }}>{m.itemCount}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: '#6b7280' }}>
                    {new Date(m.updatedAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <Link
                      href={`/dashboard/menus/${m.id}`}
                      style={{ color: '#2563eb', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}
                    >
                      Edit →
                    </Link>
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
