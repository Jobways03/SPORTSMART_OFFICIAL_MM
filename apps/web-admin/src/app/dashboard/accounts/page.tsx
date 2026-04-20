'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminAccountsService,
  PlatformOverview,
  SellerOverview,
  FranchiseOverview,
  OutstandingPayables,
  TopPerformersResponse,
} from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import './accounts.css';

function formatCurrency(amount: number): string {
  const safe = Number(amount) || 0;
  return `\u20B9${safe.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number): string {
  return (Number(value) || 0).toLocaleString('en-IN');
}

export default function AccountsDashboardPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformOverview | null>(null);
  const [sellerOverview, setSellerOverview] = useState<SellerOverview | null>(null);
  const [franchiseOverview, setFranchiseOverview] = useState<FranchiseOverview | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingPayables | null>(null);
  const [topPerformers, setTopPerformers] = useState<TopPerformersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTopTab, setActiveTopTab] = useState<'sellers' | 'franchises'>('sellers');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [overviewRes, sellerRes, franchiseRes, outstandingRes, topRes] = await Promise.all([
          adminAccountsService.getOverview(),
          adminAccountsService.getSellerOverview(),
          adminAccountsService.getFranchiseOverview(),
          adminAccountsService.getOutstanding(),
          adminAccountsService.getTopPerformers(),
        ]);
        if (cancelled) return;
        if (overviewRes.data) setPlatform(overviewRes.data);
        if (sellerRes.data) setSellerOverview(sellerRes.data);
        if (franchiseRes.data) setFranchiseOverview(franchiseRes.data);
        if (outstandingRes.data) setOutstanding(outstandingRes.data);
        if (topRes.data) setTopPerformers(topRes.data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load accounts dashboard. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const totalPendingPayables =
    (platform?.pendingSellerSettlements || 0) + (platform?.pendingFranchiseSettlements || 0);
  const totalSettled =
    (platform?.totalSettledToSellers || 0) + (platform?.totalSettledToFranchises || 0);

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h1>Accounts Dashboard</h1>
          <p>Platform financial overview, settlements and reports</p>
        </div>
      </div>

      {loading ? (
        <div className="accounts-loading">Loading accounts dashboard...</div>
      ) : error ? (
        <div className="accounts-error">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : (
        <>
          {/* Section 1: KPI Cards */}
          <div className="accounts-kpi-grid">
            <KpiCard
              variant="revenue"
              label="Total Platform Revenue"
              value={formatCurrency(platform?.totalPlatformRevenue || 0)}
              icon="&#8377;"
              subLabel={`Earnings: ${formatCurrency(platform?.totalPlatformEarnings || 0)}`}
            />
            <KpiCard
              variant="pending"
              label="Pending Payables"
              value={formatCurrency(totalPendingPayables)}
              icon="&#9202;"
              subLabel={`Sellers + Franchises`}
            />
            <KpiCard
              variant="settled"
              label="Total Settled"
              value={formatCurrency(totalSettled)}
              icon="&#10003;"
              subLabel={`Sellers + Franchises`}
            />
            <KpiCard
              variant="outstanding"
              label="Outstanding Amount"
              value={formatCurrency(outstanding?.totalOutstanding || 0)}
              icon="&#9888;"
              subLabel={
                outstanding?.oldestUnpaidDate
                  ? `Oldest: ${new Date(outstanding.oldestUnpaidDate).toLocaleDateString()}`
                  : 'No overdue items'
              }
            />
          </div>

          {/* Section 2: Two-column Overview */}
          <div className="accounts-two-col">
            <div className="accounts-section-card">
              <h2>
                Seller Financial Overview
                <span className="section-badge">
                  {sellerOverview?.activeSellers || 0} / {sellerOverview?.totalSellers || 0} Active
                </span>
              </h2>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Commission Records</span>
                <span className="accounts-stat-value">
                  {formatNumber(sellerOverview?.totalCommissionRecords || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Platform Amount</span>
                <span className="accounts-stat-value">
                  {formatCurrency(sellerOverview?.totalPlatformAmount || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Settlement Amount</span>
                <span className="accounts-stat-value highlight">
                  {formatCurrency(sellerOverview?.totalSettlementAmount || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Platform Margin</span>
                <span className="accounts-stat-value">
                  {formatCurrency(sellerOverview?.totalPlatformMargin || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Pending Settlement</span>
                <span className="accounts-stat-value pending">
                  {formatCurrency(sellerOverview?.pendingSettlementAmount || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Settled Amount</span>
                <span className="accounts-stat-value settled">
                  {formatCurrency(sellerOverview?.settledAmount || 0)}
                </span>
              </div>
            </div>

            <div className="accounts-section-card">
              <h2>
                Franchise Financial Overview
                <span className="section-badge">
                  {franchiseOverview?.activeFranchises || 0} / {franchiseOverview?.totalFranchises || 0} Active
                </span>
              </h2>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Ledger Entries</span>
                <span className="accounts-stat-value">
                  {formatNumber(franchiseOverview?.totalLedgerEntries || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Online Order Commission</span>
                <span className="accounts-stat-value">
                  {formatCurrency(franchiseOverview?.totalOnlineOrderCommission || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Procurement Fees</span>
                <span className="accounts-stat-value">
                  {formatCurrency(franchiseOverview?.totalProcurementFees || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Total Franchise Earnings</span>
                <span className="accounts-stat-value highlight">
                  {formatCurrency(franchiseOverview?.totalFranchiseEarnings || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Pending Settlement</span>
                <span className="accounts-stat-value pending">
                  {formatCurrency(franchiseOverview?.pendingSettlementAmount || 0)}
                </span>
              </div>
              <div className="accounts-stat-row">
                <span className="accounts-stat-label">Settled Amount</span>
                <span className="accounts-stat-value settled">
                  {formatCurrency(franchiseOverview?.settledAmount || 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Top Performers */}
          <div className="accounts-section-card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginBottom: 0 }}>Top Performers</h2>
            <div className="accounts-top-tabs" style={{ marginTop: 14 }}>
              <button
                className={`accounts-top-tab${activeTopTab === 'sellers' ? ' active' : ''}`}
                onClick={() => setActiveTopTab('sellers')}
              >
                Top Sellers
              </button>
              <button
                className={`accounts-top-tab${activeTopTab === 'franchises' ? ' active' : ''}`}
                onClick={() => setActiveTopTab('franchises')}
              >
                Top Franchises
              </button>
            </div>

            {activeTopTab === 'sellers' ? (
              <div className="top-performers-list">
                {(topPerformers?.topSellers || []).slice(0, 5).length === 0 ? (
                  <div className="accounts-empty" style={{ padding: '30px 0' }}>
                    <p>No sellers data available.</p>
                  </div>
                ) : (
                  (topPerformers?.topSellers || []).slice(0, 5).map((seller, idx) => (
                    <div
                      key={seller.sellerId}
                      className={`top-performer-row${
                        idx === 0 ? ' gold' : idx === 1 ? ' silver' : idx === 2 ? ' bronze' : ''
                      }`}
                    >
                      <div className="top-performer-rank">{idx + 1}</div>
                      <div className="top-performer-info">
                        <div className="top-performer-name">{seller.sellerName}</div>
                        <div className="top-performer-meta">
                          {formatNumber(seller.totalOrders)} orders
                        </div>
                      </div>
                      <div className="top-performer-value">
                        {formatCurrency(seller.totalRevenue)}
                        <span className="margin">
                          Margin: {formatCurrency(seller.platformMargin)} (
                          {(Number(seller.marginPercentage) || 0).toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="top-performers-list">
                {(topPerformers?.topFranchises || []).slice(0, 5).length === 0 ? (
                  <div className="accounts-empty" style={{ padding: '30px 0' }}>
                    <p>No franchises data available.</p>
                  </div>
                ) : (
                  (topPerformers?.topFranchises || []).slice(0, 5).map((franchise, idx) => (
                    <div
                      key={franchise.franchiseId}
                      className={`top-performer-row${
                        idx === 0 ? ' gold' : idx === 1 ? ' silver' : idx === 2 ? ' bronze' : ''
                      }`}
                    >
                      <div className="top-performer-rank">{idx + 1}</div>
                      <div className="top-performer-info">
                        <div className="top-performer-name">{franchise.franchiseName}</div>
                        <div className="top-performer-meta">
                          {formatNumber(franchise.totalOnlineOrders)} online orders &middot;{' '}
                          {formatNumber(franchise.totalProcurements)} procurements
                        </div>
                      </div>
                      <div className="top-performer-value">
                        {formatCurrency(franchise.totalRevenue)}
                        <span className="margin">
                          Earning: {formatCurrency(franchise.platformEarning)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Section 4: Quick Links */}
          <h3 className="accounts-section-title">Quick Links</h3>
          <div className="accounts-quick-links">
            <Link href="/dashboard/accounts/payables" className="accounts-quick-link">
              <div className="accounts-quick-link-icon">&#128181;</div>
              <div>
                <div className="accounts-quick-link-title">Payables List</div>
                <div className="accounts-quick-link-desc">
                  View sellers &amp; franchises awaiting payment
                </div>
              </div>
            </Link>
            <Link href="/dashboard/accounts/settlements" className="accounts-quick-link">
              <div className="accounts-quick-link-icon">&#128200;</div>
              <div>
                <div className="accounts-quick-link-title">Settlement Cycles</div>
                <div className="accounts-quick-link-desc">
                  Create and manage settlement cycles
                </div>
              </div>
            </Link>
            <Link href="/dashboard/accounts/reports" className="accounts-quick-link">
              <div className="accounts-quick-link-icon">&#128202;</div>
              <div>
                <div className="accounts-quick-link-title">Reports</div>
                <div className="accounts-quick-link-desc">
                  Revenue, margins, payouts &amp; reconciliation
                </div>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  variant,
  label,
  value,
  icon,
  subLabel,
}: {
  variant: 'revenue' | 'pending' | 'settled' | 'outstanding' | 'seller' | 'franchise' | 'earning' | 'procurement';
  label: string;
  value: string;
  icon: string;
  subLabel?: string;
}) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-card-header">
        <span className="kpi-card-label">{label}</span>
        <span className="kpi-card-icon" dangerouslySetInnerHTML={{ __html: icon }} />
      </div>
      <div className="kpi-card-value">{value}</div>
      {subLabel && <div className="kpi-card-sub">{subLabel}</div>}
    </div>
  );
}
