'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { franchiseProfileService, FranchiseProfile } from '@/services/profile.service';
import { franchiseEarningsService } from '@/services/earnings.service';
import { franchiseInventoryService } from '@/services/inventory.service';
import { franchiseOrdersService } from '@/services/orders.service';
import { franchiseProcurementService } from '@/services/procurement.service';

interface FranchiseSessionInfo {
  franchiseId: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  status?: string;
}

function statusClass(status?: string): string {
  if (!status) return 'inactive';
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s.includes('PENDING')) return 'pending';
  if (s === 'SUSPENDED') return 'suspended';
  return 'inactive';
}

function formatStatus(status?: string): string {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

type DashboardStats = {
  inventorySkus: number | null;
  openOrders: number | null;
  activeProcurement: number | null;
  totalEarnings: number | null;
};

const EMPTY_STATS: DashboardStats = {
  inventorySkus: null,
  openOrders: null,
  activeProcurement: null,
  totalEarnings: null,
};

function formatINR(n: number): string {
  return '\u20B9' + Math.round(n).toLocaleString('en-IN');
}

export default function DashboardHomePage() {
  const [franchise, setFranchise] = useState<FranchiseSessionInfo | null>(null);
  const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('franchise');
      if (data) setFranchise(JSON.parse(data));
    } catch {
      // handled by layout
    }

    franchiseProfileService
      .getProfile()
      .then((res) => {
        if (res.data) setProfile(res.data);
      })
      .catch(() => {
        // ignore — use cached session data
      });

    // Fire all KPI calls in parallel; each failure is isolated so one broken
    // widget doesn't blank the whole dashboard.
    const settle = <T,>(p: Promise<T>) => p.catch(() => null as T | null);

    (async () => {
      const [inv, orders, proc, earn] = await Promise.all([
        settle(franchiseInventoryService.listStock({ page: 1, limit: 1 })),
        settle(franchiseOrdersService.list({ page: 1, limit: 1, acceptStatus: 'OPEN' })),
        settle(franchiseProcurementService.list({ page: 1, limit: 1, status: 'PENDING' })),
        settle(franchiseEarningsService.getSummary()),
      ]);

      setStats({
        inventorySkus: (inv?.data as any)?.total ?? null,
        openOrders: (orders?.data as any)?.pagination?.total ?? null,
        activeProcurement: (proc?.data as any)?.pagination?.total ?? null,
        totalEarnings: (earn?.data as any)?.totalEarnings ?? null,
      });
    })();
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (!franchise) return null;

  const displayStatus = profile?.status ?? franchise.status;
  const completionPct = profile?.profileCompletionPercentage ?? 0;
  const ownerFirst = franchise.ownerName.split(' ')[0] || franchise.ownerName;

  return (
    <div className="dashboard-home">
      {/* Welcome */}
      <div className="dashboard-welcome">
        <h1>
          {greeting()}, {ownerFirst}!
        </h1>
        <p>Welcome to your SPORTSMART franchise dashboard</p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`status-badge ${statusClass(displayStatus)}`}>
            {formatStatus(displayStatus)}
          </span>
          {franchise.franchiseCode && (
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Franchise Code: <strong style={{ color: 'var(--color-text)' }}>{franchise.franchiseCode}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Profile Completion */}
      <div className="progress-card">
        <div className="progress-text">
          <span>Profile Completion</span>
          <span>{completionPct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${completionPct}%` }} />
        </div>
        <p style={{ marginTop: 10 }}>
          Complete your profile to unlock all franchise features and start receiving orders.
        </p>
      </div>

      {/* Stats */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-icon blue">&#128230;</div>
          <div className="stat-content">
            <h3>Inventory</h3>
            <div className="stat-value">
              {stats.inventorySkus ?? '\u2014'}
            </div>
            <div className="stat-sub">SKUs mapped to your catalog</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">&#128195;</div>
          <div className="stat-content">
            <h3>Open orders</h3>
            <div className="stat-value">
              {stats.openOrders ?? '\u2014'}
            </div>
            <div className="stat-sub">Awaiting your acceptance</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber">&#128179;</div>
          <div className="stat-content">
            <h3>Procurement</h3>
            <div className="stat-value">
              {stats.activeProcurement ?? '\u2014'}
            </div>
            <div className="stat-sub">Pending requests</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">&#128176;</div>
          <div className="stat-content">
            <h3>Earnings</h3>
            <div className="stat-value">
              {stats.totalEarnings != null ? formatINR(stats.totalEarnings) : '\u2014'}
            </div>
            <div className="stat-sub">Total to date</div>
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
              <p>Add your business, address & tax details</p>
            </div>
          </Link>
          <Link href="/dashboard/inventory" className="quick-action-card">
            <div className="quick-action-icon">&#128722;</div>
            <div className="quick-action-text">
              <h3>Manage Inventory</h3>
              <p>Track stock across your warehouses</p>
            </div>
          </Link>
          <Link href="/dashboard/procurement" className="quick-action-card">
            <div className="quick-action-icon">&#128179;</div>
            <div className="quick-action-text">
              <h3>Procurement</h3>
              <p>Place orders with sellers & suppliers</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
