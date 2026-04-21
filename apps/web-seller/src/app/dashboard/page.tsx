'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface SellerInfo {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
}

interface KpiState {
  products: number | null;
  orders: number | null;
  revenue: number | null;
  pending: number | null;
}

// `null` means "still loading / errored"; a real zero renders as "0".
const INITIAL_KPIS: KpiState = {
  products: null,
  orders: null,
  revenue: null,
  pending: null,
};

const fmtCount = (v: number | null) => (v === null ? '--' : v.toLocaleString('en-IN'));
const fmtInr = (v: number | null) =>
  v === null ? '₹--' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function DashboardPage() {
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [kpis, setKpis] = useState<KpiState>(INITIAL_KPIS);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('seller');
      if (data) setSeller(JSON.parse(data));
    } catch {
      // handled by layout
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Three parallel fetches, each wrapped so one failure doesn't
      // blank every tile. limit=1 on list endpoints because we only
      // need `pagination.total` — the rows are thrown away.
      const [productsRes, ordersRes, earningsRes] = await Promise.all([
        apiClient<{ pagination: { total: number } }>('/seller/products?limit=1').catch(
          () => null,
        ),
        apiClient<{ pagination: { total: number } }>('/seller/orders?limit=1').catch(
          () => null,
        ),
        apiClient<{
          totalEarned: number;
          pendingSettlement: number;
        }>('/seller/earnings/summary').catch(() => null),
      ]);

      if (cancelled) return;

      setKpis({
        products: productsRes?.data?.pagination?.total ?? null,
        orders: ordersRes?.data?.pagination?.total ?? null,
        revenue: earningsRes?.data?.totalEarned ?? null,
        pending: earningsRes?.data?.pendingSettlement ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (!seller) return null;

  return (
    <div className="dashboard-home">
      {/* Welcome */}
      <div className="dashboard-welcome">
        <h1>{greeting()}, {seller.sellerName.split(' ')[0]}!</h1>
        <p>Here&apos;s an overview of your seller account</p>
      </div>

      {/* Stats */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-icon blue">&#128230;</div>
          <div className="stat-content">
            <h3>Products</h3>
            <div className="stat-value">{fmtCount(kpis.products)}</div>
            <div className="stat-sub">
              {kpis.products === 0 ? 'No products listed yet' : 'Products in catalog'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">&#128195;</div>
          <div className="stat-content">
            <h3>Orders</h3>
            <div className="stat-value">{fmtCount(kpis.orders)}</div>
            <div className="stat-sub">
              {kpis.orders === 0 ? 'No orders received yet' : 'Lifetime orders'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber">&#9203;</div>
          <div className="stat-content">
            <h3>Pending Settlement</h3>
            <div className="stat-value">{fmtInr(kpis.pending)}</div>
            <div className="stat-sub">Awaiting payout</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">&#128200;</div>
          <div className="stat-content">
            <h3>Total Earned</h3>
            <div className="stat-value">{fmtInr(kpis.revenue)}</div>
            <div className="stat-sub">Settled to date</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="dashboard-quick-actions">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          <Link href="/dashboard/profile" className="quick-action-card">
            <div className="quick-action-icon">&#128100;</div>
            <div className="quick-action-text">
              <h3>Complete Profile</h3>
              <p>Add store details, images & policies</p>
            </div>
          </Link>
          {/*
            Add Product is live — was previously shown as "coming soon"
            with a disabled tile, hiding working functionality at
            /dashboard/products/new.
          */}
          <Link href="/dashboard/products/new" className="quick-action-card">
            <div className="quick-action-icon">&#128722;</div>
            <div className="quick-action-text">
              <h3>Add Product</h3>
              <p>List a new product and its variants</p>
            </div>
          </Link>
          <Link href="/dashboard/orders" className="quick-action-card">
            <div className="quick-action-icon">&#128195;</div>
            <div className="quick-action-text">
              <h3>Manage Orders</h3>
              <p>Accept, dispatch and track orders</p>
            </div>
          </Link>
          <Link href="/dashboard/commission" className="quick-action-card">
            <div className="quick-action-icon">&#128176;</div>
            <div className="quick-action-text">
              <h3>Commission &amp; Earnings</h3>
              <p>Review per-order commission and settlements</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Account Info */}
      <div style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--color-text)' }}>
          Account Information
        </h2>
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 20,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Shop Name
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
              {seller.sellerShopName}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Email
            </div>
            <div style={{ fontSize: 15, color: 'var(--color-text)' }}>
              {seller.email}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Phone
            </div>
            <div style={{ fontSize: 15, color: 'var(--color-text)' }}>
              {seller.phoneNumber}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
