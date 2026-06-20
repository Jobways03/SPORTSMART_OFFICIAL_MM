'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { validateDateRange } from '@/lib/validators';

// Small presentational helpers for the settlement detail modal.
function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13, color: '#374151' }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

type SettlementStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'FAILED';

interface Settlement {
  id: string;
  // The API returns the net payout on the settlement row and the period on the
  // eager-loaded cycle relation. (totalAmount/amount/periodStart/periodEnd are
  // kept as fallbacks so the row still renders if the shape ever changes.)
  netPayableToFranchise?: number | string | null;
  totalAmount?: number | string | null;
  amount?: number | string | null;
  cycle?: {
    periodStart?: string | null;
    periodEnd?: string | null;
  } | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: SettlementStatus;
  franchise?: {
    id?: string;
    businessName?: string | null;
    franchiseCode?: string | null;
  } | null;
  // Full breakdown — the list endpoint already returns all of these on each
  // row, so the detail view reads them straight from the row (no extra fetch).
  franchiseName?: string | null;
  createdAt?: string | null;
  totalOnlineOrders?: number | null;
  totalOnlineAmount?: number | string | null;
  totalOnlineCommission?: number | string | null;
  totalProcurements?: number | null;
  totalProcurementAmount?: number | string | null;
  totalProcurementFees?: number | string | null;
  totalPosSales?: number | null;
  totalPosAmount?: number | string | null;
  totalPosFees?: number | string | null;
  reversalAmount?: number | string | null;
  adjustmentAmount?: number | string | null;
  grossFranchiseEarning?: number | string | null;
  totalPlatformEarning?: number | string | null;
  discountFundedDeductionInPaise?: string | null;
  commissionGstRateBps?: number | null;
  totalCommissionGstInPaise?: string | null;
  tcsDeductedInPaise?: string | null;
  tdsDeductedInPaise?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paymentReference?: string | null;
  paymentMethod?: string | null;
  paymentProofUrl?: string | null;
}

// One franchise_finance_ledger row behind a settlement — the per-order detail.
interface LedgerEntry {
  id: string;
  sourceType: string;
  description?: string | null;
  baseAmount?: number | string | null;
  computedAmount?: number | string | null;
  franchiseEarning?: number | string | null;
  createdAt?: string | null;
}

// Friendly labels for the ledger source types shown to a franchise.
const SOURCE_LABELS: Record<string, string> = {
  ONLINE_ORDER: 'Online order',
  POS_SALE: 'POS sale',
  POS_SALE_REVERSAL: 'POS return',
  RETURN_REVERSAL: 'Return reversal',
  ADJUSTMENT: 'Adjustment',
  PROCUREMENT_FEE: 'Procurement fee',
  PROCUREMENT_COST: 'Procurement cost',
};

// The ledger description carries the order ref, e.g.
// "Online order commission for SM20260033" → "SM20260033".
const orderRefOf = (e: LedgerEntry): string => {
  const d = e.description ?? '';
  const idx = d.lastIndexOf(' for ');
  return idx >= 0 ? d.slice(idx + 5).trim() : d || '—';
};

interface PreviewResult {
  franchiseCount: number;
  entryCount: number;
  totalNetPayable: string;
  franchiseBreakdown: Array<{
    franchiseId: string;
    franchiseName: string;
    franchiseCode: string | null;
    entryCount: number;
    netPayableToFranchise: string;
  }>;
  overlap: { periodStart: string; periodEnd: string; status: string } | null;
}

const STATUS_LABELS: Record<SettlementStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  FAILED: 'Failed',
};

const STATUS_COLORS: Record<SettlementStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dbeafe', fg: '#1d4ed8' },
  PAID: { bg: '#dcfce7', fg: '#15803d' },
  FAILED: { bg: '#fee2e2', fg: '#991b1b' },
};

const fmt = (v: number | string | null | undefined) =>
  `\u20B9${Number(v ?? 0).toLocaleString('en-IN')}`;

// Paise (BigInt \u2192 string over the wire) \u2192 \u20B9 rupees.
const fmtPaise = (v: string | number | null | undefined) =>
  fmt(Number(v ?? 0) / 100);

const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN') : '\u2014';

const toYmd = (d: Date) => d.toISOString().slice(0, 10);

export default function FranchiseSettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rowAction, setRowAction] = useState<string | null>(null);

  // Create-cycle modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ periodStart: string; periodEnd: string }>(() => {
    // Default to "today and the past 30 days". Freshly-locked commissions
    // carry today's date, so the previous "last full week ending yesterday"
    // default silently excluded them — a default Create-cycle then found
    // nothing to settle and looked broken.
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 30);
    return { periodStart: toYmd(start), periodEnd: toYmd(end) };
  });
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  // Dry-run preview shown before committing the cycle — mirrors the seller
  // settlements Preview → Create flow so the admin doesn't commit blind.
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Mark-paid modal — captures the payout reference (UTR) + optional metadata.
  const [payTarget, setPayTarget] = useState<Settlement | null>(null);
  const [payForm, setPayForm] = useState({
    paymentReference: '',
    paymentMethod: '',
    paymentProofUrl: '',
  });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  // Detail modal — opened by clicking a settlement row. The aggregate totals
  // come from the row; the per-order lines are fetched from the detail endpoint
  // (the list endpoint omits them).
  const [detailTarget, setDetailTarget] = useState<Settlement | null>(null);
  const [detailEntries, setDetailEntries] = useState<LedgerEntry[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = useCallback(async (s: Settlement) => {
    setDetailTarget(s);
    setDetailEntries(null);
    setDetailLoading(true);
    try {
      const res = await adminFranchisesService.getSettlement(s.id);
      const entries = (res.data as { ledgerEntries?: LedgerEntry[] })?.ledgerEntries;
      setDetailEntries(Array.isArray(entries) ? entries : []);
    } catch {
      // Fall back to the aggregate-only view if the detail fetch fails.
      setDetailEntries([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await adminFranchisesService.listSettlements({ limit: 50 });
      const d = res.data as any;
      const list: Settlement[] =
        d?.settlements ?? (Array.isArray(d) ? d : []);
      setSettlements(list);
    } catch (err) {
      // Surface the failure instead of silently showing "no settlements
      // yet" — the prior empty catch hid every network / auth error.
      setLoadError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to load settlements',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePreview = async () => {
    setCreateError('');
    setPreview(null);
    const rangeError = validateDateRange(
      createForm.periodStart,
      createForm.periodEnd,
    );
    if (rangeError) {
      setCreateError(rangeError);
      return;
    }
    setPreviewing(true);
    try {
      const res = await adminFranchisesService.previewSettlementCycle(
        createForm.periodStart,
        createForm.periodEnd,
      );
      setPreview((res as { data?: PreviewResult })?.data ?? null);
    } catch (err) {
      setCreateError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Preview failed',
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError('');

    // Inline range validation. Without this the backend accepts an
    // inverted range and returns an empty cycle, which looks like a
    // silent no-op to the admin.
    const rangeError = validateDateRange(
      createForm.periodStart,
      createForm.periodEnd,
    );
    if (rangeError) {
      setCreateError(rangeError);
      return;
    }

    setCreateSaving(true);
    try {
      const res = await adminFranchisesService.createSettlementCycle(
        createForm.periodStart,
        createForm.periodEnd,
      );
      // The API returns 201 even when no PENDING ledger entries fell in the
      // period — it just opens an empty draft cycle (data.empty). Pre-fix the
      // modal closed and the (still-empty) list reloaded, so it read as a
      // silent no-op. Surface it as an explicit, actionable message instead.
      const data = (res as { data?: { empty?: boolean; settlements?: unknown[] } })?.data;
      const settledCount = Array.isArray(data?.settlements) ? data!.settlements!.length : 0;
      if (data?.empty || settledCount === 0) {
        setCreateError(
          'No pending franchise payables fall in this period, so nothing was settled. Widen the dates to include the entries you want to settle — newly locked commissions carry today’s date.',
        );
        return;
      }
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to create cycle',
      );
    } finally {
      setCreateSaving(false);
    }
  };

  const handleApprove = async (id: string) => {
    setRowAction(id);
    try {
      await adminFranchisesService.approveSettlement(id);
      await load();
    } catch {
      /* row stays; admin can retry */
    } finally {
      setRowAction(null);
    }
  };

  const openMarkPaid = (s: Settlement) => {
    setPayError('');
    setPayForm({ paymentReference: '', paymentMethod: '', paymentProofUrl: '' });
    setPayTarget(s);
  };

  const submitMarkPaid = async (e: FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setPayError('');
    const ref = payForm.paymentReference.trim();
    if (ref.length < 6) {
      setPayError('Payment reference (UTR) must be at least 6 characters.');
      return;
    }
    setPaySaving(true);
    try {
      await adminFranchisesService.markSettlementPaid(payTarget.id, {
        paymentReference: ref,
        paymentMethod: payForm.paymentMethod.trim() || undefined,
        paymentProofUrl: payForm.paymentProofUrl.trim() || undefined,
      });
      setPayTarget(null);
      await load();
    } catch (err) {
      // Surface the real reason (duplicate UTR, validation, step-up) instead of
      // silently leaving the row — the prior handler swallowed every error.
      setPayError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to mark as paid',
      );
    } finally {
      setPaySaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Settlements</h1>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Manage payout cycles and settlement history for franchise partners.
          </p>
        </div>
        <button
          onClick={() => {
            setCreateError('');
            setPreview(null);
            setShowCreate(true);
          }}
          style={{
            padding: '8px 14px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Create cycle
        </button>
      </div>

      {loadError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{loadError}</span>
          <button
            onClick={load}
            style={{
              background: 'transparent',
              color: '#991b1b',
              border: '1px solid #991b1b',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : settlements.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            {loadError ? 'Could not load settlements' : 'No settlements yet. Click \u201cCreate cycle\u201d to start one.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Period', 'Franchise', 'Amount', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => {
                const color = STATUS_COLORS[s.status] ?? STATUS_COLORS.PENDING;
                const busy = rowAction === s.id;
                return (
                  <tr
                    key={s.id}
                    onClick={() => openDetail(s)}
                    title="View full settlement details"
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      {(() => {
                        const start = s.cycle?.periodStart ?? s.periodStart;
                        const end = s.cycle?.periodEnd ?? s.periodEnd;
                        return (
                          <>
                            {start ? new Date(start).toLocaleDateString() : '\u2014'}{' '}
                            &mdash;{' '}
                            {end ? new Date(end).toLocaleDateString() : '\u2014'}
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {s.franchise?.businessName || '\u2014'}
                      {s.franchise?.franchiseCode && (
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.franchise.franchiseCode}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {fmt(s.netPayableToFranchise ?? s.totalAmount ?? s.amount)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </td>
                    <td
                      style={{ padding: '10px 14px' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.status === 'PENDING' && (
                        <button
                          disabled={busy}
                          onClick={() => handleApprove(s.id)}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                            background: '#fff',
                            cursor: busy ? 'default' : 'pointer',
                          }}
                        >
                          {busy ? '...' : 'Approve'}
                        </button>
                      )}
                      {(s.status === 'APPROVED' || s.status === 'FAILED') && (
                        <button
                          onClick={() => openMarkPaid(s)}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            border: 'none',
                            borderRadius: 6,
                            background: '#2563eb',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {s.status === 'FAILED' ? 'Retry Pay' : 'Mark Paid'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div
          onClick={() => !createSaving && setShowCreate(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 24,
              width: 420,
              maxWidth: '90vw',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Create settlement cycle</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Creates one settlement per franchise whose PENDING ledger entries fall within the selected
              period. <strong>Preview</strong> first to see exactly what will be settled, then Create. The
              cycle starts in PENDING and can then be Approved, then Marked Paid.
            </p>

            <form onSubmit={handleCreate} noValidate>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
                    Period start
                  </label>
                  <input
                    type="date"
                    value={createForm.periodStart}
                    max={createForm.periodEnd || undefined}
                    onChange={(e) => {
                      setPreview(null);
                      setCreateForm((f) => ({ ...f, periodStart: e.target.value }));
                    }}
                    disabled={createSaving}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
                    Period end
                  </label>
                  <input
                    type="date"
                    value={createForm.periodEnd}
                    min={createForm.periodStart || undefined}
                    onChange={(e) => {
                      setPreview(null);
                      setCreateForm((f) => ({ ...f, periodEnd: e.target.value }));
                    }}
                    disabled={createSaving}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewing || createSaving}
                  style={{
                    padding: '8px 14px',
                    border: '1px solid #2563eb',
                    background: '#fff',
                    color: '#2563eb',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: previewing || createSaving ? 'default' : 'pointer',
                  }}
                >
                  {previewing ? 'Previewing…' : 'Preview'}
                </button>
              </div>

              {preview && (
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 14,
                    fontSize: 13,
                    background: '#f9fafb',
                  }}
                >
                  {preview.entryCount === 0 ? (
                    <div style={{ color: '#92400e' }}>
                      No pending franchise payables fall in this period — nothing to settle.
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 8,
                          paddingBottom: 8,
                          borderBottom: '1px solid #e5e7eb',
                        }}
                      >
                        <span style={{ color: '#6b7280' }}>
                          {preview.franchiseCount} franchise
                          {preview.franchiseCount === 1 ? '' : 's'} · {preview.entryCount} entr
                          {preview.entryCount === 1 ? 'y' : 'ies'}
                        </span>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                          ₹{Number(preview.totalNetPayable).toLocaleString('en-IN')}
                        </span>
                      </div>
                      {preview.franchiseBreakdown.map((f) => (
                        <div
                          key={f.franchiseId}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '3px 0',
                            color: '#374151',
                          }}
                        >
                          <span>
                            {f.franchiseName}
                            <span style={{ color: '#9ca3af' }}> · {f.entryCount}</span>
                          </span>
                          <span style={{ fontFamily: 'monospace' }}>
                            ₹{Number(f.netPayableToFranchise).toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                      {preview.overlap && (
                        <div style={{ marginTop: 8, color: '#991b1b' }}>
                          A settled cycle already overlaps this period — create will be blocked.
                          Pick a non-overlapping range.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {createError && (
                <div
                  style={{
                    background: '#fee2e2',
                    color: '#991b1b',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={createSaving}
                  style={{
                    padding: '8px 14px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: createSaving ? 'default' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  // Gate Create on a successful, non-empty, non-overlapping
                  // preview so the admin always sees what will be settled first.
                  disabled={
                    createSaving ||
                    !preview ||
                    preview.entryCount === 0 ||
                    !!preview.overlap
                  }
                  title={!preview ? 'Run Preview first' : undefined}
                  style={{
                    padding: '8px 14px',
                    background:
                      createSaving ||
                      !preview ||
                      preview.entryCount === 0 ||
                      !!preview.overlap
                        ? '#93c5fd'
                        : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: createSaving ? 'default' : 'pointer',
                  }}
                >
                  {createSaving ? 'Creating...' : 'Create cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payTarget && (
        <div
          onClick={() => !paySaving && setPayTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 24,
              width: 440,
              maxWidth: '90vw',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              Mark settlement as paid
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              {payTarget.franchise?.businessName || 'Franchise'} ·{' '}
              {fmt(
                payTarget.netPayableToFranchise ??
                  payTarget.totalAmount ??
                  payTarget.amount,
              )}
              . Record the bank payout reference (UTR) — a reference can only be
              used once.
            </p>

            <form onSubmit={submitMarkPaid} noValidate>
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}
                >
                  Payout reference (UTR) *
                </label>
                <input
                  value={payForm.paymentReference}
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, paymentReference: e.target.value }))
                  }
                  disabled={paySaving}
                  placeholder="e.g. NEFT / IMPS / RTGS reference"
                  autoFocus
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label
                    style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}
                  >
                    Method
                  </label>
                  <input
                    value={payForm.paymentMethod}
                    onChange={(e) =>
                      setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))
                    }
                    disabled={paySaving}
                    placeholder="NEFT / IMPS / RTGS"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}
                  >
                    Proof URL
                  </label>
                  <input
                    value={payForm.paymentProofUrl}
                    onChange={(e) =>
                      setPayForm((f) => ({ ...f, paymentProofUrl: e.target.value }))
                    }
                    disabled={paySaving}
                    placeholder="bank statement / receipt"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>

              {payError && (
                <div
                  style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}
                >
                  {payError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  disabled={paySaving}
                  style={{ padding: '8px 14px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, fontSize: 13, cursor: paySaving ? 'default' : 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paySaving || payForm.paymentReference.trim().length < 6}
                  style={{
                    padding: '8px 14px',
                    background:
                      paySaving || payForm.paymentReference.trim().length < 6
                        ? '#93c5fd'
                        : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: paySaving ? 'default' : 'pointer',
                  }}
                >
                  {paySaving ? 'Saving…' : 'Confirm paid'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailTarget && (
        <div
          onClick={() => setDetailTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 24,
              width: 540,
              maxWidth: '92vw',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                {detailTarget.franchise?.businessName ||
                  detailTarget.franchiseName ||
                  'Franchise'}{' '}
                settlement
              </h2>
              <button
                onClick={() => setDetailTarget(null)}
                style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6b7280' }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
              {detailTarget.franchise?.franchiseCode
                ? `${detailTarget.franchise.franchiseCode} · `
                : ''}
              {(() => {
                const a = detailTarget.cycle?.periodStart ?? detailTarget.periodStart;
                const b = detailTarget.cycle?.periodEnd ?? detailTarget.periodEnd;
                return `${a ? new Date(a).toLocaleDateString() : '—'} — ${b ? new Date(b).toLocaleDateString() : '—'}`;
              })()}
              {' · '}
              <span
                style={{
                  fontWeight: 600,
                  color: (STATUS_COLORS[detailTarget.status] ?? STATUS_COLORS.PENDING).fg,
                }}
              >
                {STATUS_LABELS[detailTarget.status] ?? detailTarget.status}
              </span>
            </div>

            {/* Per-order breakdown — every order/sale that makes up this
                settlement, so the franchise can reconcile line by line. Only
                sale entries are listed (procurement carries no payout). */}
            {(() => {
              const sales = (detailEntries ?? []).filter(
                (e) => e.sourceType === 'ONLINE_ORDER' || e.sourceType === 'POS_SALE' || e.sourceType === 'POS_SALE_REVERSAL',
              );
              if (detailLoading) {
                return (
                  <DetailSection title="Orders">
                    <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
                  </DetailSection>
                );
              }
              if (sales.length === 0) return null;
              return (
                <DetailSection title={`Orders (${sales.length})`}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', paddingBottom: 4, borderBottom: '1px solid #f3f4f6' }}
                  >
                    <span style={{ flex: 2 }}>Order</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Sale</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Commission</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>You earn</span>
                  </div>
                  {sales.map((e) => (
                    <div
                      key={e.id}
                      style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#374151', padding: '4px 0', borderBottom: '1px solid #f9fafb' }}
                    >
                      <span style={{ flex: 2 }}>
                        {orderRefOf(e)}
                        <span style={{ color: '#9ca3af', fontSize: 11 }}>
                          {' '}
                          · {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                        </span>
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: 'monospace' }}>
                        {fmt(e.baseAmount)}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: 'monospace', color: '#9ca3af' }}>
                        − {fmt(e.computedAmount)}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        {fmt(e.franchiseEarning)}
                      </span>
                    </div>
                  ))}
                </DetailSection>
              );
            })()}

            <DetailSection title="Earnings">
              <DetailRow
                label={`Online orders (${detailTarget.totalOnlineOrders ?? 0})`}
                value={fmt(detailTarget.totalOnlineAmount)}
              />
              <DetailRow
                label="Platform commission (online)"
                value={fmt(detailTarget.totalOnlineCommission)}
              />
              {Number(detailTarget.totalPosSales ?? 0) > 0 && (
                <DetailRow
                  label={`POS sales (${detailTarget.totalPosSales})`}
                  value={fmt(detailTarget.totalPosAmount)}
                />
              )}
              {/* Procurement (franchise buying stock from the platform) carries
                  ₹0 franchise earning and is settled via the separate Procurement
                  flow, so it is NOT part of this sales payout. It was previously
                  listed here and read as if it affected the total — omitted to
                  avoid that confusion. */}
              <DetailRow
                label="Gross franchise earning"
                value={fmt(detailTarget.grossFranchiseEarning)}
              />
              {Number(detailTarget.reversalAmount ?? 0) !== 0 && (
                <DetailRow label="Return reversals" value={`− ${fmt(detailTarget.reversalAmount)}`} />
              )}
              {Number(detailTarget.adjustmentAmount ?? 0) !== 0 && (
                <DetailRow label="Adjustments" value={fmt(detailTarget.adjustmentAmount)} />
              )}
              {Number(detailTarget.discountFundedDeductionInPaise ?? 0) !== 0 && (
                <DetailRow
                  label="Discount funded"
                  value={`− ${fmtPaise(detailTarget.discountFundedDeductionInPaise)}`}
                />
              )}
            </DetailSection>

            <DetailSection title="Statutory (withheld at payout)">
              <DetailRow
                label={`Commission GST${
                  detailTarget.commissionGstRateBps
                    ? ` (${detailTarget.commissionGstRateBps / 100}%)`
                    : ''
                }`}
                value={fmtPaise(detailTarget.totalCommissionGstInPaise)}
              />
              <DetailRow label="TCS (§52)" value={fmtPaise(detailTarget.tcsDeductedInPaise)} />
              <DetailRow label="TDS (§194-O)" value={fmtPaise(detailTarget.tdsDeductedInPaise)} />
            </DetailSection>

            {(() => {
              const grossNet = Number(
                detailTarget.netPayableToFranchise ??
                  detailTarget.totalAmount ??
                  detailTarget.amount ??
                  0,
              );
              // The statutory taxes are WITHHELD from the wired payout (not from
              // the gross net). The actual amount the franchise receives =
              // net − (commission GST + TCS + TDS), clamped ≥ 0. Mirrors the
              // backend settlementNetFromRow() used at mark-paid.
              const withheld =
                (Number(detailTarget.totalCommissionGstInPaise ?? 0) +
                  Number(detailTarget.tcsDeductedInPaise ?? 0) +
                  Number(detailTarget.tdsDeductedInPaise ?? 0)) /
                100;
              const wired = Math.max(0, grossNet - withheld);
              return (
                <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 4, paddingTop: 8, marginBottom: 8 }}>
                  <DetailRow label="Payable before tax" value={fmt(grossNet)} />
                  {withheld > 0 && (
                    <DetailRow label="Less: statutory withheld" value={`− ${fmt(withheld)}`} />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 0 2px',
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                  >
                    <span>Net payable</span>
                    <span style={{ fontFamily: 'monospace' }}>{fmt(wired)}</span>
                  </div>
                </div>
              );
            })()}

            <DetailSection title="Audit">
              <DetailRow label="Approved at" value={fmtDateTime(detailTarget.approvedAt)} />
              {detailTarget.status === 'PAID' && (
                <>
                  <DetailRow label="Paid at" value={fmtDateTime(detailTarget.paidAt)} />
                  <DetailRow
                    label="Payout reference (UTR)"
                    value={detailTarget.paymentReference ?? '—'}
                  />
                  <DetailRow label="Method" value={detailTarget.paymentMethod ?? '—'} />
                  {detailTarget.paymentProofUrl && (
                    <DetailRow
                      label="Proof"
                      value={
                        <a
                          href={detailTarget.paymentProofUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#2563eb' }}
                        >
                          View
                        </a>
                      }
                    />
                  )}
                </>
              )}
            </DetailSection>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                onClick={() => setDetailTarget(null)}
                style={{ padding: '8px 14px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
