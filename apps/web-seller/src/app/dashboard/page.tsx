'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SellerInfo {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
}

export default function DashboardPage() {
  const [seller, setSeller] = useState<SellerInfo | null>(null);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('seller');
      if (data) setSeller(JSON.parse(data));
    } catch {
      // handled by layout
    }
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
            <div className="stat-value">0</div>
            <div className="stat-sub">No products listed yet</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">&#128195;</div>
          <div className="stat-content">
            <h3>Orders</h3>
            <div className="stat-value">0</div>
            <div className="stat-sub">No orders received yet</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber">&#11088;</div>
          <div className="stat-content">
            <h3>Reviews</h3>
            <div className="stat-value">--</div>
            <div className="stat-sub">No reviews yet</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">&#128200;</div>
          <div className="stat-content">
            <h3>Revenue</h3>
            <div className="stat-value">&#8377;0</div>
            <div className="stat-sub">This month</div>
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
          <div className="quick-action-card" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            <div className="quick-action-icon">&#128722;</div>
            <div className="quick-action-text">
              <h3>Add Product</h3>
              <p>List your first product — coming soon</p>
            </div>
          </div>
          <div className="quick-action-card" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            <div className="quick-action-icon">&#128176;</div>
            <div className="quick-action-text">
              <h3>Setup Payments</h3>
              <p>Configure payout details — coming soon</p>
            </div>
          </div>
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
