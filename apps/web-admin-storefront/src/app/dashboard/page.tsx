'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface Stats {
  totalSellers: number;
  totalProducts: number;
  activeSellers: number;
  pendingSellers: number;
}

export default function DashboardHome() {
  const [adminName, setAdminName] = useState('');
  const [stats, setStats] = useState<Stats>({ totalSellers: 0, totalProducts: 0, activeSellers: 0, pendingSellers: 0 });

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        setAdminName(JSON.parse(adminData).name || 'Admin');
      }
    } catch {}

    Promise.all([
      apiClient('/admin/sellers?limit=1').catch(() => null),
      apiClient('/admin/products?limit=1').catch(() => null),
      apiClient('/admin/sellers?limit=1&status=ACTIVE').catch(() => null),
      apiClient('/admin/sellers?limit=1&status=PENDING_APPROVAL').catch(() => null),
    ]).then(([sellersRes, productsRes, activeRes, pendingRes]) => {
      setStats({
        totalSellers: sellersRes?.data?.pagination?.total || 0,
        totalProducts: productsRes?.data?.pagination?.total || 0,
        activeSellers: activeRes?.data?.pagination?.total || 0,
        pendingSellers: pendingRes?.data?.pagination?.total || 0,
      });
    });
  }, []);

  const sparklineBars = [12, 18, 14, 22, 16, 28, 20, 24, 19, 26, 30, 22];

  return (
    <div className="home-page">
      {/* Top Filters */}
      <div className="home-topbar">
        <button className="topbar-date-filter">
          <span className="icon">📅</span>
          Last 30 days
        </button>
        <button className="topbar-channel-filter">
          All channels <span style={{ fontSize: 10 }}>▼</span>
        </button>
        <div className="topbar-live">
          <span className="live-dot" />
          {stats.activeSellers} active sellers
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Sellers</div>
          <div className="stat-row">
            <span className="stat-value">{stats.totalSellers}</span>
            <span className="stat-change">↑ 12%</span>
            <div className="stat-sparkline">
              {sparklineBars.map((h, i) => (
                <div key={i} className="sparkline-bar" style={{ height: h }} />
              ))}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Products</div>
          <div className="stat-row">
            <span className="stat-value">{stats.totalProducts}</span>
            <span className="stat-change">↑ 40%</span>
            <div className="stat-sparkline">
              {sparklineBars.slice().reverse().map((h, i) => (
                <div key={i} className="sparkline-bar" style={{ height: h }} />
              ))}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Sellers</div>
          <div className="stat-row">
            <span className="stat-value">{stats.activeSellers}</span>
            <span className="stat-change">↑ 43%</span>
            <div className="stat-sparkline">
              {sparklineBars.map((h, i) => (
                <div key={i} className="sparkline-bar" style={{ height: h * 0.8 }} />
              ))}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Approval</div>
          <div className="stat-row">
            <span className="stat-value">{stats.pendingSellers}</span>
            <span className="stat-change">↑ 8%</span>
            <div className="stat-sparkline">
              {sparklineBars.map((h, i) => (
                <div key={i} className="sparkline-bar" style={{ height: h * 0.6 }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Pills */}
      <div className="action-pills">
        <Link href="/dashboard/products" className="action-pill">
          <span className="pill-icon">📦</span>
          {stats.totalProducts} products to manage
        </Link>
        <Link href="/dashboard/orders" className="action-pill">
          <span className="pill-icon">💰</span>
          0 payments to capture
        </Link>
      </div>

      {/* Welcome */}
      <div className="welcome-section">
        <h2 className="welcome-title">Good morning, {adminName}. Let&apos;s get started.</h2>

        <div className="welcome-prompt">
          <input type="text" placeholder="Ask anything..." readOnly />
        </div>

        {/* Feature Cards */}
        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-card-content">
              <div className="feature-card-title">Manage your marketplace sellers</div>
              <div className="feature-card-desc">
                Review seller applications, manage active sellers, and oversee your marketplace operations.
              </div>
              <div className="feature-card-actions">
                <Link href="/dashboard/customers" className="feature-btn primary">View sellers</Link>
                <Link href="#" className="feature-btn link">Learn more</Link>
              </div>
            </div>
            <div className="feature-card-image">👥</div>
          </div>

          <div className="feature-card">
            <div className="feature-card-content">
              <div className="feature-card-title">Review product listings</div>
              <div className="feature-card-desc">
                Approve, reject, or request changes on seller product submissions to maintain quality.
              </div>
              <div className="feature-card-actions">
                <Link href="/dashboard/products" className="feature-btn primary">Review products</Link>
                <Link href="#" className="feature-btn link">Learn more</Link>
              </div>
            </div>
            <div className="feature-card-image">📦</div>
          </div>

          <div className="feature-card">
            <div className="feature-card-content">
              <div className="feature-card-title">Analytics coming soon</div>
              <div className="feature-card-desc">
                Track sales performance, monitor marketplace growth, and gain insights into your business.
              </div>
              <div className="feature-card-actions">
                <Link href="/dashboard/analytics" className="feature-btn primary">View analytics</Link>
                <Link href="#" className="feature-btn link">Learn more</Link>
              </div>
            </div>
            <div className="feature-card-image">📊</div>
          </div>
        </div>
      </div>
    </div>
  );
}
