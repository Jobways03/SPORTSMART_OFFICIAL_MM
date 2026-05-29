'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient, API_BASE } from '@/lib/api-client';
import { usePermissions } from '@/lib/permissions';

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  sellerName: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  commissionType: string;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  productEarning: number;
  refundedAdminEarning: number;
  // Phase 138 — adjust needs the platform-side total (the cap on a new earning)
  // and a flag for the "adjusted" indicator. Money fields arrive as Decimal
  // strings over JSON; Number() coerces them at the call sites.
  totalPlatformAmount: number;
  platformMargin: number;
  isAdjusted: boolean;
  status: string;
  settlementId: string | null;
  holdReason: string | null;
  createdAt: string;
}

interface HistoryEvent {
  type: string;
  at: string;
  adminEarning?: number;
  platformMargin?: number;
  note?: string | null;
  returnNumber?: string | null;
  reversedQty?: number;
  refundedAdminEarning?: number;
  actorType?: string;
  adminId?: string | null;
  previousAdminEarning?: number | null;
  newAdminEarning?: number;
  reason?: string | null;
  action?: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  settlementId?: string;
  utrReference?: string | null;
  settlementStatus?: string;
}

interface CommissionResponse {
  records: CommissionRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ── Page ──────────────────────────────────────────────────────────

export default function StorefrontCommissionPage() {
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { hasPermission } = usePermissions();
  const canHold = hasPermission('settlements.hold');
  const canAdjust = hasPermission('settlements.adjustRecord');
  const canViewHistory = hasPermission('settlements.history.read');

  // Hold / resume / adjust modal
  const [modal, setModal] = useState<{
    record: CommissionRecord;
    action: 'hold' | 'resume' | 'adjust';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [newEarning, setNewEarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // History viewer (read-only timeline)
  const [historyFor, setHistoryFor] = useState<CommissionRecord | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyGeneratedAt, setHistoryGeneratedAt] = useState<string | null>(null);

  // CSV export
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (statusFilter) params.set('status', statusFilter);

    apiClient<CommissionResponse>(`/admin/commission?${params}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch((err) => console.warn(err))
      .finally(() => setLoading(false));
  }, [search, dateFrom, dateTo, statusFilter]);

  useEffect(() => { fetchData(page); }, [page, fetchData]);

  const handleApply = () => { setPage(1); fetchData(1); };
  const handleClear = () => {
    setSearch(''); setDateFrom(''); setDateTo(''); setStatusFilter(''); setPage(1);
  };

  const openModal = (
    record: CommissionRecord,
    action: 'hold' | 'resume' | 'adjust',
  ) => {
    setModal({ record, action });
    setReason('');
    // Pre-fill the adjust input with the current platform earning.
    setNewEarning(action === 'adjust' ? String(Number(record.adminEarning)) : '');
    setActionError('');
  };

  const openHistory = (record: CommissionRecord) => {
    setHistoryFor(record);
    setHistory(null);
    setHistoryGeneratedAt(null);
    setHistoryLoading(true);
    apiClient<{ timeline: HistoryEvent[]; generatedAt?: string }>(
      `/admin/commission/${record.id}/history`,
    )
      .then((res) => {
        setHistory(res.data?.timeline ?? []);
        setHistoryGeneratedAt(res.data?.generatedAt ?? null);
      })
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };

  const submitAction = async () => {
    if (!modal) return;
    setActionError('');

    let body: Record<string, unknown>;
    if (modal.action === 'hold') {
      if (reason.trim().length < 5) {
        setActionError('A reason (min 5 chars) is required to hold a commission.');
        return;
      }
      body = { holdReason: reason.trim() };
    } else if (modal.action === 'adjust') {
      const value = Number(newEarning);
      const cap = Number(modal.record.totalPlatformAmount);
      if (!Number.isFinite(value) || value < 0) {
        setActionError('Enter a valid non-negative platform earning.');
        return;
      }
      if (value > cap) {
        setActionError(
          `Platform earning can't exceed the order's platform amount (${inr(cap)}).`,
        );
        return;
      }
      if (reason.trim().length < 3) {
        setActionError('A reason (min 3 chars) is required for an adjustment.');
        return;
      }
      body = { newAdminEarning: value, reason: reason.trim() };
    } else {
      body = { resumeReason: reason.trim() || undefined };
    }

    setBusy(true);
    try {
      await apiClient(`/admin/commission/${modal.record.id}/${modal.action}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setModal(null);
      setReason('');
      setNewEarning('');
      fetchData(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  // CSV export — the endpoint is bearer-token-gated so a bare <a download>
  // can't carry the Authorization header; fetch + blob + programmatic download.
  // Reads X-Export-Truncated/Total to warn before handing over a capped file.
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (statusFilter) params.set('status', statusFilter);
      const token =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem('adminAccessToken')
          : null;
      const res = await fetch(
        `${API_BASE}/api/v1/admin/commission/export?${params.toString()}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message)
            msg = Array.isArray(j.message) ? j.message.join(', ') : String(j.message);
        } catch {
          /* not JSON */
        }
        throw new Error(msg);
      }
      const truncated = res.headers.get('X-Export-Truncated') === 'true';
      const total = res.headers.get('X-Export-Total');
      if (
        truncated &&
        !window.confirm(
          `This export is capped at 50,000 rows but the filter matches ${total} total. ` +
            'Download the first 50,000? Narrow the date range to get the rest.',
        )
      ) {
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^"]+)"?/i.exec(disposition);
      const filename = match?.[1] ?? 'commission_export.csv';
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const hasFilters = Boolean(search || dateFrom || dateTo || statusFilter);

  const totals = useMemo(() => {
    const records = data?.records ?? [];
    return {
      totalCommission: records.reduce((a, r) => a + Number(r.totalCommission), 0),
      totalSellerEarning: records.reduce((a, r) => a + Number(r.productEarning), 0),
      totalRefunded: records.reduce((a, r) => a + Number(r.refundedAdminEarning), 0),
    };
  }, [data]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Commission
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 720, lineHeight: 1.5 }}>
          Commissions earned from delivered orders. Records are processed after the
          return/exchange window expires.
        </p>
      </div>

      <KpiStrip
        loading={loading && !data}
        totalRecords={data?.pagination.total ?? 0}
        page={totals}
      />

      {/* Filter bar */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
        padding: 16, marginBottom: 16,
        display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <Field label="Search" style={{ flex: '1 1 240px' }}>
          <input
            type="text"
            placeholder="Order #, product, seller…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            style={input}
          />
        </Field>
        <Field label="Confirmed from" style={{ flex: '0 1 160px' }}>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={input} />
        </Field>
        <Field label="Confirmed to" style={{ flex: '0 1 160px' }}>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={input} />
        </Field>
        <Field label="Status" style={{ flex: '0 1 150px' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={input}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="ON_HOLD">On hold</option>
            <option value="SETTLED">Settled</option>
            <option value="REFUNDED">Refunded</option>
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleApply} style={btnPrimary}>Apply</button>
          {hasFilters && (
            <button onClick={handleClear} style={btnGhost}>Clear</button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            style={exporting ? { ...btnGhost, opacity: 0.6, cursor: 'wait' } : btnGhost}
            title="Download the current view as CSV (capped at 50,000 rows)"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Table / states */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && !data ? (
          <Skeleton />
        ) : !data || data.records.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onClear={handleClear} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={th}>Order #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Seller</th>
                  <th style={th}>Product</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Unit price</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total price</th>
                  <th style={{ ...th, textAlign: 'right' }}>Commission</th>
                  <th style={{ ...th, textAlign: 'right' }}>Seller earning</th>
                  <th style={{ ...th, textAlign: 'right' }}>Refunded</th>
                  <th style={th}>Status</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <Row
                    key={r.id}
                    record={r}
                    canHold={canHold}
                    canAdjust={canAdjust}
                    canViewHistory={canViewHistory}
                    onHold={() => openModal(r, 'hold')}
                    onResume={() => openModal(r, 'resume')}
                    onAdjust={() => openModal(r, 'adjust')}
                    onHistory={() => openHistory(r)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, padding: '0 4px', flexWrap: 'wrap', gap: 12,
        }}>
          <span style={{ fontSize: 12, color: '#525A65' }}>
            Page <strong style={{ color: '#0F1115' }}>{page}</strong> of{' '}
            <strong style={{ color: '#0F1115' }}>{data.pagination.totalPages}</strong>
            {' · '}<strong style={{ color: '#0F1115' }}>{data.pagination.total.toLocaleString('en-IN')}</strong> total
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              style={page <= 1 ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
            >Previous</button>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
              style={page >= data.pagination.totalPages ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
            >Next</button>
          </div>
        </div>
      )}

      {modal && (
        <div
          onClick={() => !busy && setModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: 440, maxWidth: '100%' }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
              {modal.action === 'hold'
                ? 'Hold commission'
                : modal.action === 'adjust'
                  ? 'Adjust commission'
                  : 'Resume commission'}
            </h3>
            <p style={{ fontSize: 13, color: '#525A65', marginTop: 8, lineHeight: 1.5 }}>
              {modal.action === 'hold'
                ? 'Excludes this record from settlement until it is resumed. A reason (min 5 chars) is required.'
                : modal.action === 'adjust'
                  ? "Override the platform's earning for this record (dispute resolution). The seller's settlement absorbs the difference. A reason (min 3 chars) is required."
                  : 'Restores the record to PENDING so it becomes eligible for settlement again.'}
            </p>
            {modal.action === 'resume' && modal.record.holdReason && (
              <p style={{
                fontSize: 12, color: '#92400e', background: '#fffbeb',
                border: '1px solid #fcd34d', borderRadius: 8, padding: 8,
              }}>
                Current hold reason: {modal.record.holdReason}
              </p>
            )}
            {modal.action === 'adjust' && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#525A65' }}>
                  New platform earning (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  max={Number(modal.record.totalPlatformAmount)}
                  step="0.01"
                  value={newEarning}
                  onChange={(e) => setNewEarning(e.target.value)}
                  style={{ ...input, marginTop: 4 }}
                />
                {/* Before / after — mirrors the server recompute so there are no
                    surprises: platform's loss = seller's gain. */}
                <div style={{
                  fontSize: 12, color: '#525A65', marginTop: 8, lineHeight: 1.7,
                  background: '#F9FAFB', border: '1px solid #F3F4F6',
                  borderRadius: 8, padding: '8px 10px',
                }}>
                  <div>Current platform earning: <strong style={{ color: '#0F1115' }}>{inr(Number(modal.record.adminEarning))}</strong></div>
                  <div>Order platform amount (max): <strong style={{ color: '#0F1115' }}>{inr(Number(modal.record.totalPlatformAmount))}</strong></div>
                  {newEarning !== '' && Number.isFinite(Number(newEarning)) && (
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #E5E7EB' }}>
                      Seller earning becomes:{' '}
                      <strong style={{ color: '#0F1115' }}>
                        {inr(Math.max(0, Number(modal.record.totalPlatformAmount) - Number(newEarning)))}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            )}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                modal.action === 'hold'
                  ? 'Reason (min 5 chars)…'
                  : modal.action === 'adjust'
                    ? 'Reason (min 3 chars)…'
                    : 'Reason (optional)…'
              }
              rows={3}
              style={{ ...input, height: 'auto', padding: 10, resize: 'vertical', marginTop: 8 }}
            />
            {actionError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{actionError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setModal(null)} disabled={busy} style={btnGhost}>Cancel</button>
              <button onClick={submitAction} disabled={busy} style={btnPrimary}>
                {busy
                  ? 'Working…'
                  : modal.action === 'hold'
                    ? 'Hold'
                    : modal.action === 'adjust'
                      ? 'Adjust'
                      : 'Resume'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <div
          onClick={() => setHistoryFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14, padding: 24,
              width: 560, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
                Commission history · {historyFor.orderNumber}
              </h3>
              <button onClick={() => setHistoryFor(null)} style={btnGhost}>Close</button>
            </div>
            <p style={{ fontSize: 12, color: '#525A65', marginTop: 4 }}>
              {historyFor.sellerName} · {historyFor.productTitle}
            </p>

            {historyLoading && (
              <div style={{ fontSize: 13, color: '#7A828F', padding: '24px 0' }}>Loading…</div>
            )}
            {!historyLoading && history && history.length === 0 && (
              <div style={{ fontSize: 13, color: '#7A828F', padding: '24px 0' }}>
                No history events.
              </div>
            )}
            {!historyLoading && history && history.length > 0 && (
              <ol style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
                {history.map((ev, i) => (
                  <li
                    key={i}
                    style={{
                      borderLeft: '2px solid #E5E7EB', paddingLeft: 12,
                      paddingBottom: 14, marginLeft: 4, position: 'relative',
                    }}
                  >
                    <span style={{
                      position: 'absolute', left: -5, top: 4, width: 8, height: 8,
                      borderRadius: 4, background: HISTORY_DOT[ev.type] ?? '#9CA3AF',
                    }} />
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0F1115' }}>
                      {HISTORY_LABEL[ev.type] ?? ev.type}
                      {ev.action ? ` · ${ev.action}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#7A828F' }}>
                      {new Date(ev.at).toLocaleString('en-IN')}
                      {ev.actorType ? ` · ${ev.actorType}` : ''}
                      {ev.adminId ? ` · ${ev.adminId}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#525A65', marginTop: 2, lineHeight: 1.5 }}>
                      {ev.type === 'COMMISSION_LOCKED' && (
                        <>Platform earning {inr(Number(ev.adminEarning ?? 0))} · {ev.note}</>
                      )}
                      {ev.type === 'REVERSAL' && (
                        <>
                          Reversed {ev.reversedQty} unit(s){ev.returnNumber ? ` · ${ev.returnNumber}` : ''} ·
                          refunded platform earning {inr(Number(ev.refundedAdminEarning ?? 0))}
                          {ev.note ? ` · ${ev.note}` : ''}
                        </>
                      )}
                      {ev.type === 'MANUAL_ADJUSTMENT' && (
                        <>
                          Platform earning{' '}
                          {ev.previousAdminEarning != null ? inr(Number(ev.previousAdminEarning)) : '—'}
                          {' → '}
                          <strong style={{ color: '#0F1115' }}>{inr(Number(ev.newAdminEarning ?? 0))}</strong>
                          {ev.reason ? ` · ${ev.reason}` : ''}
                        </>
                      )}
                      {ev.type === 'HOLD_EVENT' && (
                        <>{ev.reason ?? '—'}</>
                      )}
                      {ev.type === 'SETTLED' && (
                        <>
                          Paid out{ev.settlementStatus ? ` (${ev.settlementStatus})` : ''}
                          {ev.utrReference ? ` · UTR ${ev.utrReference}` : ''}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {!historyLoading && historyGeneratedAt && (
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 16 }}>
                Snapshot at {new Date(historyGeneratedAt).toLocaleString('en-IN')} ·
                assembled at read time, so a very recent change may take one refresh to appear.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  COMMISSION_LOCKED: 'Locked',
  REVERSAL: 'Reversal',
  MANUAL_ADJUSTMENT: 'Manual adjustment',
  HOLD_EVENT: 'Hold / freeze',
  SETTLED: 'Settled',
};
const HISTORY_DOT: Record<string, string> = {
  COMMISSION_LOCKED: '#1e40af',
  REVERSAL: '#b91c1c',
  MANUAL_ADJUSTMENT: '#7c3aed',
  HOLD_EVENT: '#92400e',
  SETTLED: '#15803d',
};

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  loading, totalRecords, page,
}: {
  loading: boolean;
  totalRecords: number;
  page: { totalCommission: number; totalSellerEarning: number; totalRefunded: number };
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total records"
        value={totalRecords.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Across all loaded pages." />
      <Kpi label="Commission (this page)"
        value={inr(page.totalCommission)}
        tone="success" loading={loading}
        hint="Platform earnings on visible rows." />
      <Kpi label="Seller earning (this page)"
        value={inr(page.totalSellerEarning)}
        tone="neutral" loading={loading}
        hint="Net to sellers on visible rows." />
      <Kpi label="Refunded (this page)"
        value={inr(page.totalRefunded)}
        tone={page.totalRefunded > 0 ? 'danger' : 'muted'} loading={loading}
        hint="Admin earning clawed back on returns." />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: KPI_TONE[tone],
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function Row({
  record: r,
  canHold,
  canAdjust,
  canViewHistory,
  onHold,
  onResume,
  onAdjust,
  onHistory,
}: {
  record: CommissionRecord;
  canHold: boolean;
  canAdjust: boolean;
  canViewHistory: boolean;
  onHold: () => void;
  onResume: () => void;
  onAdjust: () => void;
  onHistory: () => void;
}) {
  const refunded = Number(r.refundedAdminEarning);
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {r.orderNumber}
        </span>
      </td>
      <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
        {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      <td style={td}>
        <span style={{ fontWeight: 500, color: '#0F1115' }}>{r.sellerName}</span>
      </td>
      <td style={td}>
        <span style={{ color: '#0F1115' }} title={r.productTitle}>
          {r.productTitle.length > 28 ? r.productTitle.slice(0, 28) + '…' : r.productTitle}
        </span>
      </td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {r.quantity}
      </td>
      <td style={tdNum}>{inr(Number(r.unitPrice))}</td>
      <td style={tdNum}>{inr(Number(r.totalPrice))}</td>
      <td style={{ ...tdNum, fontWeight: 700, color: '#0F1115' }}>{inr(Number(r.totalCommission))}</td>
      <td style={{ ...tdNum, color: '#525A65' }}>{inr(Number(r.productEarning))}</td>
      <td style={{
        ...tdNum,
        color: refunded > 0 ? '#b91c1c' : '#7A828F',
        fontWeight: refunded > 0 ? 700 : 400,
      }}>
        {inr(refunded)}
      </td>
      <td style={td}>
        <StatusBadge status={r.status} />
        {r.isAdjusted && (
          <span
            title="This record's platform earning was manually adjusted"
            style={{
              marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#7c3aed',
              background: '#f5f3ff', border: '1px solid #ddd6fe',
              borderRadius: 6, padding: '1px 5px',
            }}
          >
            ✎ adj
          </span>
        )}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canViewHistory && (
            <button onClick={onHistory} style={btnGhost}>History</button>
          )}
          {canAdjust && r.status === 'PENDING' && !r.settlementId && (
            <button onClick={onAdjust} style={btnGhost}>Adjust</button>
          )}
          {canHold && r.status === 'PENDING' && !r.settlementId && (
            <button onClick={onHold} style={btnGhost}>Hold</button>
          )}
          {canHold && r.status === 'ON_HOLD' && (
            <button
              onClick={onResume}
              style={btnGhost}
              title={r.holdReason ?? undefined}
            >
              Resume
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: '#eff6ff', fg: '#1e40af', label: 'Pending' },
  ON_HOLD: { bg: '#fffbeb', fg: '#92400e', label: 'On hold' },
  SETTLED: { bg: '#f0fdf4', fg: '#15803d', label: 'Settled' },
  REFUNDED: { bg: '#fef2f2', fg: '#b91c1c', label: 'Refunded' },
};
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { bg: '#F3F4F6', fg: '#525A65', label: status };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999,
      background: s.bg, color: s.fg, textTransform: 'uppercase',
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

// ── Empty / skeleton ──────────────────────────────────────────────

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <PercentIcon />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>
        No commission records {hasFilters ? 'match your filters' : 'yet'}
      </div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 460, margin: '4px auto 0' }}>
        {hasFilters
          ? 'Try adjusting your filters or clearing them.'
          : 'Records appear after orders are delivered and the return window expires.'}
      </div>
      {hasFilters && (
        <button onClick={onClear} style={{ ...btnGhost, marginTop: 16 }}>Clear filters</button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function Field({
  label, children, style,
}: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <span style={kpiLabel}>{label}</span>
      {children}
    </label>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function PercentIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M19 5 5 19" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Shared styles ─────────────────────────────────────────────────

const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 18px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'middle',
};
const tdNum: React.CSSProperties = {
  ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12,
  textAlign: 'right', whiteSpace: 'nowrap',
};
const pageBtn: React.CSSProperties = {
  height: 32, padding: '0 14px',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  background: '#fff', cursor: 'pointer',
  fontSize: 12, fontWeight: 600, color: '#0F1115',
};
const pageBtnDisabled: React.CSSProperties = {
  color: '#CBD5E1', cursor: 'not-allowed', background: '#FAFAFA',
};
