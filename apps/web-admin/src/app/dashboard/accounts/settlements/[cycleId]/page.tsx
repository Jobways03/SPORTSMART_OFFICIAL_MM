'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  adminAccountsService,
  SettlementCycleDetail,
  SettlementCycleSettlementEntry,
} from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import '../../accounts.css';

function formatCurrency(amount: number): string {
  const safe = Number(amount) || 0;
  return `\u20B9${safe.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(input: string | null): string {
  if (!input) return '—';
  try {
    return new Date(input).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return input;
  }
}

export default function SettlementCycleDetailPage() {
  const router = useRouter();
  const params = useParams<{ cycleId: string }>();
  const cycleId = params?.cycleId;

  const [cycle, setCycle] = useState<SettlementCycleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'sellers' | 'franchises'>('sellers');

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await adminAccountsService.getCycleDetail(cycleId as string);
        if (cancelled) return;
        if (res.data) setCycle(res.data as SettlementCycleDetail);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load settlement cycle. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [cycleId, router]);

  const getStatusClass = (statusValue: string) => {
    const value = (statusValue || '').toLowerCase();
    if (value.includes('complete') || value === 'paid') return 'cycle-status-badge completed';
    if (value.includes('process')) return 'cycle-status-badge processing';
    if (value.includes('pend')) return 'cycle-status-badge pending';
    if (value.includes('draft')) return 'cycle-status-badge draft';
    if (value.includes('cancel') || value.includes('fail')) return 'cycle-status-badge cancelled';
    return 'cycle-status-badge draft';
  };

  const entries: SettlementCycleSettlementEntry[] =
    activeTab === 'sellers' ? cycle?.sellerSettlements || [] : cycle?.franchiseSettlements || [];

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h1>Settlement Cycle Detail</h1>
          <p>View seller and franchise settlements within this cycle</p>
        </div>
        <Link href="/dashboard/accounts/settlements" className="accounts-btn-secondary">
          &larr; Back to Cycles
        </Link>
      </div>

      {loading ? (
        <div className="accounts-loading">Loading cycle details...</div>
      ) : error ? (
        <div className="accounts-error">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : cycle ? (
        <>
          <div className="cycle-detail-header">
            <div className="period">
              {formatDate(cycle.periodStart)} - {formatDate(cycle.periodEnd)}
            </div>
            <div className="meta">
              <span className={getStatusClass(cycle.status)}>
                {cycle.status.replace(/_/g, ' ')}
              </span>
              <span style={{ marginLeft: 12 }}>
                Created: {formatDate(cycle.createdAt)}
              </span>
            </div>

            <div className="totals">
              <div className="total-item">
                <div className="total-item-label">Total Seller Payable</div>
                <div className="total-item-value">{formatCurrency(cycle.totalSellerPayable)}</div>
              </div>
              <div className="total-item">
                <div className="total-item-label">Total Franchise Payable</div>
                <div className="total-item-value">
                  {formatCurrency(cycle.totalFranchisePayable)}
                </div>
              </div>
              <div className="total-item">
                <div className="total-item-label">Platform Earning</div>
                <div className="total-item-value">{formatCurrency(cycle.totalPlatformEarning)}</div>
              </div>
              <div className="total-item">
                <div className="total-item-label">Settlements</div>
                <div className="total-item-value">
                  {cycle.sellerSettlementCount + cycle.franchiseSettlementCount}
                </div>
              </div>
            </div>
          </div>

          <div className="accounts-tabs">
            <button
              className={`accounts-tab${activeTab === 'sellers' ? ' active' : ''}`}
              onClick={() => setActiveTab('sellers')}
            >
              Seller Settlements ({cycle.sellerSettlementCount})
            </button>
            <button
              className={`accounts-tab${activeTab === 'franchises' ? ' active' : ''}`}
              onClick={() => setActiveTab('franchises')}
            >
              Franchise Settlements ({cycle.franchiseSettlementCount})
            </button>
          </div>

          <div className="accounts-table-wrap">
            {entries.length === 0 ? (
              <div className="accounts-empty">
                <h3>No {activeTab === 'sellers' ? 'seller' : 'franchise'} settlements</h3>
                <p>There are no settlements recorded in this cycle for this category.</p>
              </div>
            ) : (
              <table className="accounts-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="numeric">Total Amount</th>
                    <th className="numeric">Platform Earning</th>
                    <th className="numeric">Payable Amount</th>
                    <th>Status</th>
                    <th>Settled At</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      onClick={() => {
                        if (activeTab === 'sellers') {
                          router.push(`/dashboard/sellers/${entry.nodeId}`);
                        } else {
                          router.push(`/dashboard/franchises/${entry.nodeId}`);
                        }
                      }}
                    >
                      <td style={{ fontWeight: 600, color: '#111827' }}>{entry.nodeName}</td>
                      <td className="numeric">{formatCurrency(entry.totalAmount)}</td>
                      <td className="numeric">{formatCurrency(entry.platformEarning)}</td>
                      <td className="numeric amount-positive">
                        {formatCurrency(entry.payableAmount)}
                      </td>
                      <td>
                        <span className={getStatusClass(entry.status)}>
                          {entry.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: '#6b7280' }}>
                        {formatDate(entry.settledAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="accounts-empty">
          <h3>Cycle not found</h3>
          <p>The requested settlement cycle could not be loaded.</p>
        </div>
      )}
    </div>
  );
}
