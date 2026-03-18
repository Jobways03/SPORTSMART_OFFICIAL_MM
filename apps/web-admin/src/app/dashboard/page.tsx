'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminSellersService } from '@/services/admin-sellers.service';

interface Stats {
  total: number;
  active: number;
  pending: number;
  suspended: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [adminName, setAdminName] = useState('');

  useEffect(() => {
    // Only fetch if we have a token (layout handles redirect if not)
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('adminAccessToken');
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name);
      }
    } catch {
      return;
    }

    if (!token) return;

    adminSellersService.listSellers({ limit: 1 }).then(res => {
      const total = res.data?.pagination.total || 0;
      setStats({ total, active: 0, pending: 0, suspended: 0 });

      Promise.all([
        adminSellersService.listSellers({ limit: 1, status: 'ACTIVE' }),
        adminSellersService.listSellers({ limit: 1, status: 'PENDING_APPROVAL' }),
        adminSellersService.listSellers({ limit: 1, status: 'SUSPENDED' }),
      ]).then(([activeRes, pendingRes, suspendedRes]) => {
        setStats({
          total,
          active: activeRes.data?.pagination.total || 0,
          pending: pendingRes.data?.pagination.total || 0,
          suspended: suspendedRes.data?.pagination.total || 0,
        });
      }).catch(() => { /* ignore */ });
    }).catch(() => { /* ignore */ });
  }, []);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Welcome back, {adminName || 'Admin'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Manage sellers, review applications, and oversee seller operations.
        </p>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard label="Total Sellers" value={stats.total} color="#eff6ff" />
          <StatCard label="Active" value={stats.active} color="#f0fdf4" />
          <StatCard label="Pending Approval" value={stats.pending} color="#fffbeb" />
          <StatCard label="Suspended" value={stats.suspended} color="#fef2f2" />
        </div>
      )}

      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Link
            href="/dashboard/sellers"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '16px 20px',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              textDecoration: 'none',
              color: 'var(--color-text)',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 22 }}>&#128101;</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Manage Sellers</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>View, edit, and manage sellers</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
    }}>
      <div style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        flexShrink: 0,
      }}>
        &#128101;
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}
