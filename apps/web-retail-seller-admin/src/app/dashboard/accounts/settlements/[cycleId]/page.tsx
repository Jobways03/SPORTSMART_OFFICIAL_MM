'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  adminAccountsService,
  SettlementCycleDetail,
  SettlementCycleSettlementEntry,
  SettlementTaxBreakdown,
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

// Phase 33 — BigInt-paise → ₹X,XX,XXX.YY. Indian grouping, BigInt
// arithmetic so amounts > Number.MAX_SAFE_INTEGER paise still render
// exactly. Web-admin tsconfig targets ES2017; use BigInt() ctor
// rather than `Nn` literals.
function formatPaiseString(paise: string | undefined | null): string {
  if (!paise) return '₹0.00';
  let value: bigint;
  try {
    value = BigInt(paise);
  } catch {
    return '₹0.00';
  }
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const rupees = abs / HUNDRED;
  const remainder = abs % HUNDRED;
  const rupeesStr = rupees
    .toString()
    .replace(/\B(?=(\d{2})+(\d{3})(?!\d))/g, ',');
  const paiseStr = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}₹${rupeesStr}.${paiseStr}`;
}

export default function SettlementCycleDetailPage() {
  const router = useRouter();
  const params = useParams<{ cycleId: string }>();
  const cycleId = params?.cycleId;

  const [cycle, setCycle] = useState<SettlementCycleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'sellers' | 'franchises'>('sellers');
  // Phase 33 — per-row tax-breakdown expansion state. Keyed by
  // settlement id. Multiple rows may be open at once.
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) =>
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));

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
                    {/* Phase 33 — leading toggle column on the sellers
                        tab so admins can drill into the TCS/TDS/
                        commission-GST breakdown per settlement. */}
                    {activeTab === 'sellers' && <th style={{ width: 28 }}></th>}
                    <th>Name</th>
                    <th className="numeric">Total Amount</th>
                    <th className="numeric">Platform Earning</th>
                    {activeTab === 'sellers' && (
                      <>
                        <th className="numeric" title="Seller-funded discount deductions for this cycle">
                          Discount Deductions
                        </th>
                        <th className="numeric" title="Section 52 GST TCS + Section 194-O IT TDS + 18% GST on commission. Click row for breakdown.">
                          Tax Deductions
                        </th>
                        <th className="numeric" title="totalSettlement − TCS − TDS − Commission GST. The actual amount paid to the seller.">
                          Net Payout
                        </th>
                      </>
                    )}
                    <th className="numeric">Payable Amount</th>
                    <th>Status</th>
                    <th>Settled At</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const deductionBucket =
                      activeTab === 'sellers'
                        ? cycle.discountDeductionsBySeller?.[entry.nodeId]
                        : undefined;
                    const deductionAmount = deductionBucket
                      ? Number(deductionBucket.totalAmountInPaise) / 100
                      : 0;
                    // Phase 33 — pull the statutory-deduction breakdown
                    // for this settlement. Keyed by settlement id (entry.id)
                    // not sellerId (nodeId). Falls back to all-zero when
                    // legacy settlements predate the deduction columns.
                    const taxBreakdown =
                      activeTab === 'sellers'
                        ? cycle.taxBreakdownBySettlement?.[entry.id]
                        : undefined;
                    const taxTotalPaise =
                      taxBreakdown
                        ? sumPaise([
                            taxBreakdown.tcsDeductedInPaise,
                            taxBreakdown.tdsDeductedInPaise,
                            taxBreakdown.totalCommissionGstInPaise,
                          ])
                        : '0';
                    const isExpanded = !!expandedRows[entry.id];
                    return (
                      <Fragment key={entry.id}>
                        <tr
                          style={{
                            background: isExpanded ? '#eef2ff' : undefined,
                            borderBottom: isExpanded
                              ? '1px solid #c7d2fe'
                              : undefined,
                          }}
                        >
                          {activeTab === 'sellers' && (
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(entry.id);
                              }}
                              style={{
                                width: 28,
                                textAlign: 'center',
                                cursor: 'pointer',
                                color: '#6b7280',
                                userSelect: 'none',
                              }}
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? '▾' : '▸'}
                            </td>
                          )}
                          <td
                            style={{ fontWeight: 600, color: '#111827', cursor: 'pointer' }}
                            onClick={() => {
                              if (activeTab === 'sellers') {
                                router.push(`/dashboard/sellers/${entry.nodeId}`);
                              } else {
                                router.push(`/dashboard/franchises/${entry.nodeId}`);
                              }
                            }}
                          >
                            {entry.nodeName}
                          </td>
                          <td className="numeric">{formatCurrency(entry.totalAmount)}</td>
                          <td className="numeric">{formatCurrency(entry.platformEarning)}</td>
                          {activeTab === 'sellers' && (
                            <>
                              <td
                                className="numeric"
                                style={{
                                  color: deductionAmount > 0 ? '#dc2626' : '#9ca3af',
                                  fontWeight: deductionAmount > 0 ? 600 : 400,
                                }}
                              >
                                {deductionAmount > 0
                                  ? `−${formatCurrency(deductionAmount)}`
                                  : '—'}
                                {deductionBucket && deductionBucket.entries.length > 0 && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#6b7280',
                                      fontWeight: 400,
                                      marginTop: 2,
                                    }}
                                  >
                                    {deductionBucket.entries.length} discount
                                    {deductionBucket.entries.length === 1 ? '' : 's'}
                                  </div>
                                )}
                              </td>
                              <td
                                className="numeric"
                                style={{
                                  color: taxTotalPaise !== '0' ? '#dc2626' : '#9ca3af',
                                  fontWeight: taxTotalPaise !== '0' ? 600 : 400,
                                }}
                              >
                                {taxTotalPaise !== '0'
                                  ? `−${formatPaiseString(taxTotalPaise)}`
                                  : '—'}
                              </td>
                              <td
                                className="numeric"
                                style={{ color: '#16a34a', fontWeight: 600 }}
                              >
                                {taxBreakdown
                                  ? formatPaiseString(taxBreakdown.netPayoutInPaise)
                                  : '—'}
                              </td>
                            </>
                          )}
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
                        {activeTab === 'sellers' && isExpanded && (
                          <tr style={{ background: '#fafafe' }}>
                            <td colSpan={9} style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb' }}>
                              <TaxBreakdownPanel breakdown={taxBreakdown} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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

// Phase 33 — admin-side statutory deduction panel. Mirrors the
// seller payout statement layout from the seller portal's commission page
// so the same numbers tell the same story to both parties.
function TaxBreakdownPanel({
  breakdown,
}: {
  breakdown: SettlementTaxBreakdown | undefined;
}) {
  if (!breakdown) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
        No statutory-deduction data on this settlement (predates Phase 27
        deduction tracking).
      </div>
    );
  }
  const hasCommissionGst = breakdown.totalCommissionGstInPaise !== '0';
  const hasTcs = breakdown.tcsDeductedInPaise !== '0';
  const hasTds = breakdown.tdsDeductedInPaise !== '0';
  const isIntraState = breakdown.commissionGstSplitType === 'CGST_SGST';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 32,
        alignItems: 'flex-start',
      }}
    >
      <div>
        <h4
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#1f2937',
            margin: '0 0 12px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Statutory deductions
        </h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {hasCommissionGst ? (
              <>
                <BreakdownRow
                  label={`Commission GST @ ${breakdown.commissionGstRateBps / 100}% ${
                    isIntraState ? '(CGST + SGST)' : '(IGST)'
                  }`}
                  value={`−${formatPaiseString(breakdown.totalCommissionGstInPaise)}`}
                  valueColor="#dc2626"
                  hint="GST charged by platform on its commission. Reported on marketplace GSTR-1; claimable as ITC by the seller."
                />
                {isIntraState && (
                  <>
                    <BreakdownSubRow
                      label="CGST on commission"
                      value={formatPaiseString(breakdown.cgstOnCommissionInPaise)}
                    />
                    <BreakdownSubRow
                      label="SGST on commission"
                      value={formatPaiseString(breakdown.sgstOnCommissionInPaise)}
                    />
                  </>
                )}
              </>
            ) : (
              <BreakdownRow label="Commission GST" value="—" hint="No commission GST recorded on this settlement." />
            )}
            {hasTcs ? (
              <BreakdownRow
                label={`TCS @ ${breakdown.tcsRateBpsSnapshot / 100}% (Section 52)`}
                value={`−${formatPaiseString(breakdown.tcsDeductedInPaise)}`}
                valueColor="#dc2626"
                hint={
                  breakdown.tcsFilingPeriod
                    ? `GSTR-8 filing period ${breakdown.tcsFilingPeriod}`
                    : 'GSTR-8 filing'
                }
              />
            ) : (
              <BreakdownRow label="TCS (Section 52)" value="—" hint="Below the TCS threshold or not yet computed." />
            )}
            {hasTds ? (
              <BreakdownRow
                label={`TDS @ ${breakdown.tdsRateBpsSnapshot / 100}% (Section 194-O)`}
                value={`−${formatPaiseString(breakdown.tdsDeductedInPaise)}`}
                valueColor="#dc2626"
                hint={
                  breakdown.tdsFilingPeriod
                    ? `Form 26Q quarter ${breakdown.tdsFilingPeriod} → Form 16A`
                    : 'Form 26Q quarterly → Form 16A'
                }
              />
            ) : (
              <BreakdownRow
                label="TDS (Section 194-O)"
                value="—"
                hint="Seller is 194-O exempt OR no PAN on file → withhold cycle skipped."
              />
            )}
            <BreakdownRow
              label="Net payout to seller"
              value={formatPaiseString(breakdown.netPayoutInPaise)}
              emphasis
              valueColor="#16a34a"
              hint="totalSettlement − TCS − TDS − Commission GST"
            />
          </tbody>
        </table>
      </div>
      <aside
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '14px 16px',
          fontSize: 12,
          color: '#374151',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}
        >
          Lifecycle reminders
        </div>
        <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
          <li>TCS lifecycle: mark FILED after GSTR-8 upload; mark PAID_TO_GOVT after remittance.</li>
          <li>TDS lifecycle: mark DEPOSITED after challan; CERTIFICATE_ISSUED after Form 16A.</li>
          <li>Both lifecycles managed at <code>/dashboard/tax</code> in admin-storefront.</li>
        </ul>
      </aside>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  valueColor,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  valueColor?: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <tr
      style={{
        borderTop: emphasis ? '1px solid #e5e7eb' : undefined,
        borderBottom: emphasis ? '1px solid #e5e7eb' : undefined,
      }}
    >
      <td
        style={{
          padding: '6px 8px 6px 0',
          fontWeight: emphasis ? 700 : 500,
          color: emphasis ? '#1f2937' : '#374151',
          verticalAlign: 'top',
        }}
      >
        <div>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginTop: 2 }}>
            {hint}
          </div>
        )}
      </td>
      <td
        style={{
          padding: '6px 0',
          textAlign: 'right',
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: emphasis ? 700 : 500,
          color: valueColor ?? '#1f2937',
          whiteSpace: 'nowrap',
          verticalAlign: 'top',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function BreakdownSubRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '2px 8px 2px 24px', color: '#6b7280', fontSize: 12 }}>
        {label}
      </td>
      <td
        style={{
          padding: '2px 0',
          textAlign: 'right',
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#6b7280',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

// Sum a list of BigInt-paise strings, returning the result also as
// a string. Used by the row "Tax Deductions" cell to roll up the
// three statutory legs into one displayable figure.
function sumPaise(values: string[]): string {
  const ZERO = BigInt(0);
  let total = ZERO;
  for (const v of values) {
    try {
      total = total + BigInt(v);
    } catch {
      // skip unparseable entry
    }
  }
  return total.toString();
}
