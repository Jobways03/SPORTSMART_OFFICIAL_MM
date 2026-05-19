'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminAccountsService,
  RevenueBreakdownEntry,
  MarginReportResponse,
  PayoutsReportResponse,
  ReconciliationReport,
} from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import '../accounts.css';

type TabKey = 'revenue' | 'margins' | 'payouts' | 'reconciliation';
type GroupBy = 'day' | 'week' | 'month';

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

function formatDate(input: string): string {
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

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('revenue');

  // Shared date range
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(defaultToDate());
  const [groupBy, setGroupBy] = useState<GroupBy>('day');

  // Revenue
  const [revenueData, setRevenueData] = useState<RevenueBreakdownEntry[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueError, setRevenueError] = useState('');

  // Margins
  const [marginsData, setMarginsData] = useState<MarginReportResponse | null>(null);
  const [marginsLoading, setMarginsLoading] = useState(false);
  const [marginsError, setMarginsError] = useState('');

  // Payouts
  const [payoutsData, setPayoutsData] = useState<PayoutsReportResponse | null>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [payoutsError, setPayoutsError] = useState('');

  // Reconciliation
  const [reconciliationData, setReconciliationData] = useState<ReconciliationReport | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState('');

  const handle401 = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  const loadRevenue = useCallback(async () => {
    setRevenueLoading(true);
    setRevenueError('');
    try {
      const res = await adminAccountsService.getRevenueReport(fromDate, toDate, groupBy);
      setRevenueData(res.data || []);
    } catch (err) {
      if (handle401(err)) return;
      setRevenueError('Failed to load revenue report.');
    } finally {
      setRevenueLoading(false);
    }
  }, [fromDate, toDate, groupBy, handle401]);

  const loadMargins = useCallback(async () => {
    setMarginsLoading(true);
    setMarginsError('');
    try {
      const res = await adminAccountsService.getMarginsReport(fromDate, toDate);
      setMarginsData(res.data || null);
    } catch (err) {
      if (handle401(err)) return;
      setMarginsError('Failed to load margins report.');
    } finally {
      setMarginsLoading(false);
    }
  }, [fromDate, toDate, handle401]);

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    setPayoutsError('');
    try {
      const res = await adminAccountsService.getPayoutsReport(fromDate, toDate);
      setPayoutsData(res.data || null);
    } catch (err) {
      if (handle401(err)) return;
      setPayoutsError('Failed to load payouts report.');
    } finally {
      setPayoutsLoading(false);
    }
  }, [fromDate, toDate, handle401]);

  const loadReconciliation = useCallback(async () => {
    setReconciliationLoading(true);
    setReconciliationError('');
    try {
      const res = await adminAccountsService.getReconciliation();
      setReconciliationData(res.data || null);
    } catch (err) {
      if (handle401(err)) return;
      setReconciliationError('Failed to load reconciliation report.');
    } finally {
      setReconciliationLoading(false);
    }
  }, [handle401]);

  useEffect(() => {
    if (activeTab === 'revenue') loadRevenue();
    else if (activeTab === 'margins') loadMargins();
    else if (activeTab === 'payouts') loadPayouts();
    // reconciliation loads on demand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const applyFilters = () => {
    if (activeTab === 'revenue') loadRevenue();
    else if (activeTab === 'margins') loadMargins();
    else if (activeTab === 'payouts') loadPayouts();
  };

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h1>Reports</h1>
          <p>Revenue, margins, payouts and reconciliation reports</p>
        </div>
        <Link href="/dashboard/accounts" className="accounts-btn-secondary">
          &larr; Back
        </Link>
      </div>

      <div className="accounts-tabs">
        <button
          className={`accounts-tab${activeTab === 'revenue' ? ' active' : ''}`}
          onClick={() => setActiveTab('revenue')}
        >
          Revenue
        </button>
        <button
          className={`accounts-tab${activeTab === 'margins' ? ' active' : ''}`}
          onClick={() => setActiveTab('margins')}
        >
          Margins
        </button>
        <button
          className={`accounts-tab${activeTab === 'payouts' ? ' active' : ''}`}
          onClick={() => setActiveTab('payouts')}
        >
          Payouts
        </button>
        <button
          className={`accounts-tab${activeTab === 'reconciliation' ? ' active' : ''}`}
          onClick={() => setActiveTab('reconciliation')}
        >
          Reconciliation
        </button>
      </div>

      {activeTab !== 'reconciliation' && (
        <div className="date-range-row">
          <label>From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <label>To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          {activeTab === 'revenue' && (
            <>
              <label>Group by</label>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </>
          )}
          <button className="accounts-btn-primary" onClick={applyFilters}>
            Apply
          </button>
        </div>
      )}

      {/* Revenue Tab */}
      {activeTab === 'revenue' && (
        <div className="accounts-table-wrap">
          {revenueLoading ? (
            <div className="accounts-loading">Loading revenue report...</div>
          ) : revenueError ? (
            <div className="accounts-error">
              <p>{revenueError}</p>
              <button onClick={loadRevenue}>Retry</button>
            </div>
          ) : revenueData.length === 0 ? (
            <div className="accounts-empty">
              <h3>No revenue data</h3>
              <p>Adjust the date range and try again.</p>
            </div>
          ) : (
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="numeric">Total Revenue</th>
                  <th className="numeric">Seller Fulfilled</th>
                  <th className="numeric">Franchise Fulfilled</th>
                  <th className="numeric">Platform Earning</th>
                </tr>
              </thead>
              <tbody>
                {revenueData.map((entry, idx) => (
                  <tr key={`${entry.period}-${idx}`}>
                    <td style={{ fontWeight: 600, color: '#111827' }}>{entry.period}</td>
                    <td className="numeric">{formatCurrency(entry.totalRevenue)}</td>
                    <td className="numeric">{formatCurrency(entry.sellerFulfilledAmount)}</td>
                    <td className="numeric">{formatCurrency(entry.franchiseFulfilledAmount)}</td>
                    <td className="numeric amount-positive">
                      {formatCurrency(entry.platformEarning)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Margins Tab */}
      {activeTab === 'margins' && (
        <>
          {marginsLoading ? (
            <div className="accounts-loading">Loading margins report...</div>
          ) : marginsError ? (
            <div className="accounts-error">
              <p>{marginsError}</p>
              <button onClick={loadMargins}>Retry</button>
            </div>
          ) : marginsData ? (
            <>
              <div className="reconcile-summary">
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Total Revenue</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(marginsData.overall?.totalRevenue || 0)}
                  </div>
                </div>
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Platform Earning</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(marginsData.overall?.platformEarning || 0)}
                  </div>
                </div>
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Margin Percentage</div>
                  <div className="reconcile-tile-value">
                    {(Number(marginsData.overall?.marginPercentage) || 0).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="accounts-table-wrap">
                {(marginsData.breakdown || []).length === 0 ? (
                  <div className="accounts-empty">
                    <h3>No breakdown data</h3>
                    <p>There is no category breakdown for the selected range.</p>
                  </div>
                ) : (
                  <table className="accounts-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="numeric">Total Revenue</th>
                        <th className="numeric">Platform Earning</th>
                        <th className="numeric">Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(marginsData.breakdown || []).map((entry, idx) => (
                        <tr key={`${entry.category}-${idx}`}>
                          <td style={{ fontWeight: 600, color: '#111827' }}>{entry.category}</td>
                          <td className="numeric">{formatCurrency(entry.totalRevenue)}</td>
                          <td className="numeric">{formatCurrency(entry.platformEarning)}</td>
                          <td className="numeric">
                            {(Number(entry.marginPercentage) || 0).toFixed(2)}%
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
              <h3>No margins data</h3>
            </div>
          )}
        </>
      )}

      {/* Payouts Tab */}
      {activeTab === 'payouts' && (
        <>
          {payoutsLoading ? (
            <div className="accounts-loading">Loading payouts report...</div>
          ) : payoutsError ? (
            <div className="accounts-error">
              <p>{payoutsError}</p>
              <button onClick={loadPayouts}>Retry</button>
            </div>
          ) : payoutsData ? (
            <>
              <div className="reconcile-summary">
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Total Paid</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(payoutsData.totalPaid || 0)}
                  </div>
                </div>
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Payout Count</div>
                  <div className="reconcile-tile-value">{formatNumber(payoutsData.count || 0)}</div>
                </div>
              </div>

              <div className="accounts-table-wrap">
                {(payoutsData.payouts || []).length === 0 ? (
                  <div className="accounts-empty">
                    <h3>No payouts</h3>
                    <p>There are no payouts in the selected range.</p>
                  </div>
                ) : (
                  <table className="accounts-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th className="numeric">Amount</th>
                        <th>Paid At</th>
                        <th>Reference</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payoutsData.payouts || []).map((payout) => (
                        <tr key={payout.id}>
                          <td>
                            <span className={`node-type-badge ${payout.nodeType.toLowerCase()}`}>
                              {payout.nodeType}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600, color: '#111827' }}>
                            {payout.nodeName}
                          </td>
                          <td className="numeric amount-positive">
                            {formatCurrency(payout.amount)}
                          </td>
                          <td style={{ fontSize: 13, color: '#6b7280' }}>
                            {formatDate(payout.paidAt)}
                          </td>
                          <td style={{ fontSize: 13, color: '#6b7280' }}>
                            {payout.referenceId || '—'}
                          </td>
                          <td>
                            <span className="cycle-status-badge completed">{payout.status}</span>
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
              <h3>No payouts data</h3>
            </div>
          )}
        </>
      )}

      {/* Reconciliation Tab */}
      {activeTab === 'reconciliation' && (
        <>
          <div className="date-range-row">
            <button className="accounts-btn-primary" onClick={loadReconciliation}>
              {reconciliationLoading ? 'Running...' : 'Run Reconciliation'}
            </button>
            {reconciliationData && (
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                Last run: {formatDate(reconciliationData.runAt)}
              </span>
            )}
          </div>

          {reconciliationLoading ? (
            <div className="accounts-loading">Running reconciliation...</div>
          ) : reconciliationError ? (
            <div className="accounts-error">
              <p>{reconciliationError}</p>
              <button onClick={loadReconciliation}>Retry</button>
            </div>
          ) : reconciliationData ? (
            <>
              <div className="reconcile-summary">
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Total Expected</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(reconciliationData.totalExpected || 0)}
                  </div>
                </div>
                <div className="reconcile-tile">
                  <div className="reconcile-tile-label">Total Actual</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(reconciliationData.totalActual || 0)}
                  </div>
                </div>
                <div
                  className={`reconcile-tile${
                    Math.abs(reconciliationData.totalDifference || 0) > 0 ? ' mismatch' : ''
                  }`}
                >
                  <div className="reconcile-tile-label">Difference</div>
                  <div className="reconcile-tile-value">
                    {formatCurrency(reconciliationData.totalDifference || 0)}
                  </div>
                </div>
                <div
                  className={`reconcile-tile${
                    (reconciliationData.mismatchCount || 0) > 0 ? ' mismatch' : ''
                  }`}
                >
                  <div className="reconcile-tile-label">Mismatches</div>
                  <div className="reconcile-tile-value">
                    {formatNumber(reconciliationData.mismatchCount || 0)}
                  </div>
                </div>
              </div>

              <div className="accounts-table-wrap">
                {(reconciliationData.mismatches || []).length === 0 ? (
                  <div className="accounts-empty">
                    <h3>No mismatches found</h3>
                    <p>All records are reconciled correctly.</p>
                  </div>
                ) : (
                  <table className="accounts-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Node</th>
                        <th>Mismatch</th>
                        <th className="numeric">Expected</th>
                        <th className="numeric">Actual</th>
                        <th className="numeric">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reconciliationData.mismatches || []).map((m, idx) => (
                        <tr key={`${m.nodeId}-${idx}`}>
                          <td>
                            <span className={`node-type-badge ${m.nodeType.toLowerCase()}`}>
                              {m.nodeType}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600, color: '#111827' }}>{m.nodeName}</td>
                          <td>
                            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>
                              {m.type}
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>{m.description}</div>
                          </td>
                          <td className="numeric">{formatCurrency(m.expected)}</td>
                          <td className="numeric">{formatCurrency(m.actual)}</td>
                          <td className="numeric amount-pending">{formatCurrency(m.difference)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="accounts-empty">
              <h3>No reconciliation report</h3>
              <p>Click "Run Reconciliation" to generate a report.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
