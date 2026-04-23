'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface KpiData {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  totalActiveSellers: number;
  totalCustomers: number;
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  totalPlatformMargin: number;
  avgOrderValue: number;
}

interface RecentOrder {
  id: string;
  orderNumber: string;
  totalAmount: number;
  discountAmount?: number;
  paymentStatus: string;
  itemCount: number;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string };
}

export default function AdminDashboardPage() {
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name);
      }
    } catch {}

    Promise.all([
      apiClient<KpiData>('/admin/dashboard/kpis').catch(() => null),
      apiClient<{ orders: RecentOrder[] }>('/admin/orders?limit=5').catch(() => null),
    ]).then(([kpiRes, ordersRes]) => {
      if (kpiRes?.data) setKpis(kpiRes.data);
      if (ordersRes?.data?.orders) setRecentOrders(ordersRes.data.orders);
      setLoading(false);
    });
  }, []);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Welcome back, {adminName || 'Admin'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Admin Control Tower -- marketplace overview and operations.
        </p>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading dashboard...</div>
      ) : kpis ? (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}>
            <KpiCard label="Total Orders" value={String(kpis.totalOrders)} color="#eff6ff" subLabel={`Today: ${kpis.ordersToday}`} />
            <KpiCard label="Total Revenue" value={formatCurrency(kpis.totalRevenue)} color="#f0fdf4" subLabel={`Today: ${formatCurrency(kpis.revenueToday)}`} />
            <KpiCard label="Active Products" value={String(kpis.totalProducts)} color="#fefce8" />
            <KpiCard label="Active Sellers" value={String(kpis.totalActiveSellers)} color="#fdf2f8" />
            <KpiCard label="Platform Margin" value={formatCurrency(kpis.totalPlatformMargin)} color="#f0f9ff" />
            <KpiCard label="Pending Orders" value={String(kpis.pendingOrders)} color={kpis.pendingOrders > 0 ? '#fef2f2' : '#f0fdf4'} />
          </div>

          {/* Quick Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}>
            <QuickStat label="Total Customers" value={String(kpis.totalCustomers)} />
            <QuickStat label="Avg Order Value" value={formatCurrency(kpis.avgOrderValue)} />
            <QuickStat label="Orders Today" value={String(kpis.ordersToday)} />
            <QuickStat label="Revenue Today" value={formatCurrency(kpis.revenueToday)} />
          </div>

          {/* Recent Orders */}
          {recentOrders.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Orders</h2>
                <Link href="/dashboard/orders" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
                  View all
                </Link>
              </div>
              <div style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={thStyle}>Order #</th>
                      <th style={thStyle}>Customer</th>
                      <th style={thStyle}>Amount</th>
                      <th style={thStyle}>Payment</th>
                      <th style={thStyle}>Items</th>
                      <th style={thStyle}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={tdStyle}>
                          <Link href={`/dashboard/orders/${order.id}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td style={tdStyle}>
                          {order.customer?.firstName} {order.customer?.lastName}
                        </td>
                        <td style={tdStyle}>
                          {formatCurrency(Number(order.totalAmount) + Number(order.discountAmount || 0))}
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: order.paymentStatus === 'PAID' ? '#dcfce7' : '#fef3c7',
                            color: order.paymentStatus === 'PAID' ? '#166534' : '#92400e',
                          }}>
                            {order.paymentStatus}
                          </span>
                        </td>
                        <td style={tdStyle}>{order.itemCount}</td>
                        <td style={tdStyle}>{new Date(order.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <ActionCard href="/dashboard/sellers" title="Manage Sellers" desc="View, edit, and manage sellers" />
              <ActionCard href="/dashboard/products" title="Manage Products" desc="Review and manage product catalog" />
              <ActionCard href="/dashboard/orders" title="Manage Orders" desc="Track and manage all orders" />
              <ActionCard href="/dashboard/commission" title="Commissions" desc="View commission records" />
            </div>
          </div>
        </>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
          Unable to load dashboard data. Please check your connection.
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  color: '#374151',
};

function KpiCard({ label, value, color, subLabel }: { label: string; value: string; color: string; subLabel?: string }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      borderLeft: `4px solid ${color === '#eff6ff' ? '#3b82f6' : color === '#f0fdf4' ? '#22c55e' : color === '#fefce8' ? '#eab308' : color === '#fdf2f8' ? '#ec4899' : color === '#f0f9ff' ? '#0ea5e9' : color === '#fef2f2' ? '#ef4444' : '#6b7280'}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{value}</div>
      {subLabel && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{subLabel}</div>
      )}
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '14px 18px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 13, color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{value}</span>
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
