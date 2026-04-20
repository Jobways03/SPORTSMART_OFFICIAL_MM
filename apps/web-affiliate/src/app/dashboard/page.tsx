'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function FranchiseAdminDashboardPage() {
  const [adminName, setAdminName] = useState('');

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name);
      }
    } catch {}
  }, []);

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Franchise Admin Dashboard
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Welcome back, {adminName || 'Admin'}. Manage franchises and operations.
        </p>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 32,
      }}>
        <StatCard label="Total Franchises" value="--" color="#3b82f6" />
        <StatCard label="Active Franchises" value="--" color="#22c55e" />
        <StatCard label="Pending Verification" value="--" color="#eab308" />
        <StatCard label="Total Orders" value="--" color="#0ea5e9" />
        <StatCard label="Pending Settlements" value="--" color="#f97316" />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <ActionCard href="/dashboard/franchises" title="Manage Franchises" desc="View, edit, and manage all franchises" />
          <ActionCard href="/dashboard/catalog" title="Catalog" desc="Review franchise catalog mappings" />
          <ActionCard href="/dashboard/orders" title="Orders" desc="Track franchise orders" />
          <ActionCard href="/dashboard/settlements" title="Settlements" desc="Manage franchise settlements" />
          <ActionCard href="/dashboard/commission" title="Commission" desc="View commission records" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
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
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{desc}</div>
      </div>
    </Link>
  );
}
