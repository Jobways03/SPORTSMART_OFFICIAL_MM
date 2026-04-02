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

interface ProductPerformanceItem {
  productId: string;
  productCode: string | null;
  title: string;
  totalOrders: number;
  totalQuantitySold: number;
  totalRevenue: number;
  totalMargin: number;
}

interface SellerPerformanceItem {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  totalOrders: number;
  totalRevenue: number;
  avgDispatchSla: number;
  rejectionRate: number;
  totalMappedProducts: number;
  totalStock: number;
  isActive: boolean;
}

interface ProductPerformanceData {
  topByRevenue: ProductPerformanceItem[];
  mostSellersMapped: { productId: string; productCode: string | null; title: string; sellerCount: number }[];
  lowestStock: { productId: string; productCode: string | null; title: string; totalStock: number }[];
}

export default function DashboardHome() {
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [productPerf, setProductPerf] = useState<ProductPerformanceData | null>(null);
  const [sellerPerf, setSellerPerf] = useState<SellerPerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        setAdminName(JSON.parse(adminData).name || 'Admin');
      }
    } catch {}

    Promise.all([
      apiClient<KpiData>('/admin/dashboard/kpis').catch(() => null),
      apiClient<ProductPerformanceData>('/admin/dashboard/product-performance?period=30d&limit=5').catch(() => null),
      apiClient<SellerPerformanceItem[]>('/admin/dashboard/seller-performance').catch(() => null),
    ]).then(([kpiRes, prodRes, sellerRes]) => {
      if (kpiRes?.data) setKpis(kpiRes.data);
      if (prodRes?.data) setProductPerf(prodRes.data);
      if (sellerRes?.data) setSellerPerf(Array.isArray(sellerRes.data) ? sellerRes.data.slice(0, 5) : []);
      setLoading(false);
    });
  }, []);

  const fmt = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="home-page">
      {/* Top Bar */}
      <div className="home-topbar">
        <button className="topbar-date-filter">
          <span className="icon">&#128197;</span>
          Last 30 days
        </button>
        <div className="topbar-live">
          <span className="live-dot" />
          {kpis?.totalActiveSellers ?? 0} active sellers
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading dashboard...</div>
      ) : (
        <>
          {/* KPI Stats Grid */}
          {kpis && (
            <div className="stats-grid">
              <StatCard label="Total Orders" value={String(kpis.totalOrders)} sub={`Today: ${kpis.ordersToday}`} />
              <StatCard label="Total Revenue" value={fmt(kpis.totalRevenue)} sub={`Today: ${fmt(kpis.revenueToday)}`} />
              <StatCard label="Active Products" value={String(kpis.totalProducts)} />
              <StatCard label="Active Sellers" value={String(kpis.totalActiveSellers)} />
              <StatCard label="Platform Margin" value={fmt(kpis.totalPlatformMargin)} />
              <StatCard label="Pending Orders" value={String(kpis.pendingOrders)} />
              <StatCard label="Avg Order Value" value={fmt(kpis.avgOrderValue)} />
              <StatCard label="Total Customers" value={String(kpis.totalCustomers)} />
            </div>
          )}

          {/* Action Pills */}
          <div className="action-pills">
            <Link href="/dashboard/products" className="action-pill">
              <span className="pill-icon">&#128230;</span>
              {kpis?.totalProducts ?? 0} products to manage
            </Link>
            <Link href="/dashboard/orders" className="action-pill">
              <span className="pill-icon">&#128176;</span>
              {kpis?.pendingOrders ?? 0} pending orders
            </Link>
          </div>

          {/* Welcome */}
          <div className="welcome-section">
            <h2 className="welcome-title">Good morning, {adminName}. Here is your marketplace overview.</h2>
          </div>

          {/* Product Performance Section */}
          {productPerf && productPerf.topByRevenue.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1f2937' }}>Top Products by Revenue</h3>
              <div style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={sfTh}>Product</th>
                      <th style={sfTh}>Code</th>
                      <th style={sfTh}>Orders</th>
                      <th style={sfTh}>Qty Sold</th>
                      <th style={sfTh}>Revenue</th>
                      <th style={sfTh}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPerf.topByRevenue.map((p) => (
                      <tr key={p.productId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={sfTd}>{p.title?.substring(0, 40) || '--'}</td>
                        <td style={sfTd}>{p.productCode || '--'}</td>
                        <td style={sfTd}>{p.totalOrders}</td>
                        <td style={sfTd}>{p.totalQuantitySold}</td>
                        <td style={sfTd}>{fmt(p.totalRevenue)}</td>
                        <td style={sfTd}>{fmt(p.totalMargin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Seller Performance Section */}
          {sellerPerf.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1f2937' }}>Top Sellers by Revenue</h3>
              <div style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={sfTh}>Seller</th>
                      <th style={sfTh}>Shop</th>
                      <th style={sfTh}>Orders</th>
                      <th style={sfTh}>Revenue</th>
                      <th style={sfTh}>Rejection %</th>
                      <th style={sfTh}>Products</th>
                      <th style={sfTh}>Stock</th>
                      <th style={sfTh}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerPerf.map((s) => (
                      <tr key={s.sellerId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={sfTd}>{s.sellerName}</td>
                        <td style={sfTd}>{s.sellerShopName}</td>
                        <td style={sfTd}>{s.totalOrders}</td>
                        <td style={sfTd}>{fmt(s.totalRevenue)}</td>
                        <td style={sfTd}>{s.rejectionRate}%</td>
                        <td style={sfTd}>{s.totalMappedProducts}</td>
                        <td style={sfTd}>{s.totalStock}</td>
                        <td style={sfTd}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: s.isActive ? '#dcfce7' : '#fee2e2',
                            color: s.isActive ? '#16a34a' : '#dc2626',
                          }}>
                            {s.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
              <div className="feature-card-image">&#128101;</div>
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
              <div className="feature-card-image">&#128230;</div>
            </div>

            <div className="feature-card">
              <div className="feature-card-content">
                <div className="feature-card-title">Analytics dashboard</div>
                <div className="feature-card-desc">
                  Track sales performance, monitor marketplace growth, and gain insights into your business.
                </div>
                <div className="feature-card-actions">
                  <Link href="/dashboard/analytics" className="feature-btn primary">View analytics</Link>
                  <Link href="#" className="feature-btn link">Learn more</Link>
                </div>
              </div>
              <div className="feature-card-image">&#128202;</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const sfTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const sfTd: React.CSSProperties = {
  padding: '10px 14px',
  color: '#374151',
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const sparklineBars = [12, 18, 14, 22, 16, 28, 20, 24, 19, 26, 30, 22];
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-row">
        <span className="stat-value">{value}</span>
        <div className="stat-sparkline">
          {sparklineBars.map((h, i) => (
            <div key={i} className="sparkline-bar" style={{ height: h }} />
          ))}
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
