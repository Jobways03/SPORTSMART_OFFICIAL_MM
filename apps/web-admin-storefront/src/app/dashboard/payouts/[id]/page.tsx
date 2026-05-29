'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';
import {
  adminPayoutsService,
  PayoutBatchDetail,
  PayoutItem,
  IngestRow,
  PAYOUT_STATUS_COLOR,
} from '@/services/admin-payouts.service';

export default function PayoutBatchDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = usePermissions();
  const canExport = hasPermission('payouts.export');
  const canIngest = hasPermission('payouts.ingestResponse');
  const canCancel = hasPermission('payouts.cancel');

  const [batch, setBatch] = useState<PayoutBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showIngest, setShowIngest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Story 4.2 — mismatch-only filter. When on, the table only shows
  // FAILED rows whose failureReason starts with `BANK_AMOUNT_MISMATCH:`
  // so finance ops can triage rows that need a re-upload separately
  // from genuine bank failures.
  const [mismatchOnly, setMismatchOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminPayoutsService.getBatch(id);
      if (res.data) setBatch(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batch');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Phase 151 — abort a DRAFT/EXPORTED batch created in error; the backend
  // releases the settlements' payout lock back to APPROVED.
  const handleCancel = async () => {
    if (!batch) return;
    const reason = window.prompt(
      'Cancel this batch? Its settlements are released back to APPROVED (re-batchable). Enter a reason:',
    );
    if (!reason || reason.trim().length < 3) return;
    setCancelling(true);
    try {
      await adminPayoutsService.cancelBatch(batch.id, reason.trim());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const handleExport = async () => {
    if (!batch) return;
    setExporting(true);
    try {
      await adminPayoutsService.downloadExportCsv(batch.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, color: '#64748b' }}>Loading payout batch…</div>
    );
  }

  if (error || !batch) {
    return (
      <div style={{ padding: 32 }}>
        <Link
          href="/dashboard/payouts"
          style={{ fontSize: 13, color: '#475569', textDecoration: 'none' }}
        >
          ← Back to payouts
        </Link>
        <div style={{ ...errorBox, marginTop: 16 }}>
          {error ?? 'Batch not found'}
        </div>
      </div>
    );
  }

  const total = batch.payouts.reduce((sum, p) => sum + Number(p.amount), 0);
  const paidCount = batch.payouts.filter((p) => p.status === 'COMPLETED').length;
  const failedCount = batch.payouts.filter((p) => p.status === 'FAILED').length;
  // Bank-amount-mismatch rows are a subset of FAILED. The service writes
  // `BANK_AMOUNT_MISMATCH:expected=<bigint paise> actual=<bigint paise>`
  // into failureReason when the bank's PAID amount differs from the
  // settlement total by more than 1 paise. Operators need to triage
  // these separately from genuine bank rejections, so we parse the
  // reason here and surface a filter + count banner.
  const mismatchRows = batch.payouts
    .map((p) => ({ payout: p, parsed: parseMismatch(p.failureReason) }))
    .filter((r) => r.parsed !== null);
  const mismatchCount = mismatchRows.length;
  const visiblePayouts = mismatchOnly
    ? mismatchRows.map((r) => r.payout)
    : batch.payouts;

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link
        href="/dashboard/payouts"
        style={{
          fontSize: 13,
          color: '#475569',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 12,
        }}
      >
        ← Back to payouts
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
            Payout batch
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{batch.id}</h1>
            <StatusBadge status={batch.status} />
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
            Created {new Date(batch.createdAt).toLocaleString('en-IN')}
            {batch.exportedAt && <> · Exported {new Date(batch.exportedAt).toLocaleString('en-IN')}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canExport && (batch.status === 'DRAFT' || batch.status === 'EXPORTED') && (
            <button
              onClick={handleExport}
              disabled={exporting}
              style={batch.status === 'EXPORTED' ? btnGhost : btnPrimary}
            >
              {exporting
                ? 'Generating…'
                : batch.status === 'DRAFT'
                  ? 'Export CSV'
                  : 'Re-download CSV'}
            </button>
          )}
          {canIngest && (batch.status === 'EXPORTED' || batch.status === 'PARTIALLY_PAID') && (
            <button onClick={() => setShowIngest(true)} style={btnPrimary}>
              Upload bank response
            </button>
          )}
          {canCancel && (batch.status === 'DRAFT' || batch.status === 'EXPORTED') && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{ ...btnGhost, borderColor: '#b91c1c', color: '#b91c1c' }}
            >
              {cancelling ? 'Cancelling…' : 'Cancel batch'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        <SummaryStat label="Payouts" value={String(batch.payouts.length)} />
        <SummaryStat label="Total amount" value={'₹' + total.toLocaleString('en-IN', { minimumFractionDigits: 2 })} />
        <SummaryStat label="Paid" value={String(paidCount)} accent="#16a34a" />
        <SummaryStat label="Failed" value={String(failedCount)} accent={failedCount > 0 ? '#dc2626' : undefined} />
        <SummaryStat label="Mismatches" value={String(mismatchCount)} accent={mismatchCount > 0 ? '#b45309' : undefined} />
      </div>

      {mismatchCount > 0 && (
        <div style={mismatchBanner}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#92400e' }}>
              <strong>{mismatchCount}</strong> payout row{mismatchCount === 1 ? '' : 's'} flagged because the bank-reported
              amount differed from the settlement total by more than 1 paise.
              The underlying settlement was left <code style={inlineCode}>APPROVED</code> so you can re-ingest after correction.
            </div>
            <button
              type="button"
              onClick={() => setMismatchOnly((v) => !v)}
              style={mismatchToggleBtn(mismatchOnly)}
            >
              {mismatchOnly ? 'Show all rows' : 'Show only mismatches'}
            </button>
          </div>
        </div>
      )}

      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Settlement</th>
              <th style={th}>Seller</th>
              <th style={th}>Amount</th>
              <th style={th}>Status</th>
              <th style={th}>UTR / failure reason</th>
              <th style={th}>Paid at</th>
            </tr>
          </thead>
          <tbody>
            {visiblePayouts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '24px 10px' }}>
                  {mismatchOnly ? 'No mismatched rows in this batch.' : 'No payouts.'}
                </td>
              </tr>
            ) : (
              visiblePayouts.map((p) => {
                const mismatch = parseMismatch(p.failureReason);
                return (
                  <tr key={p.id} style={mismatch ? { ...tr, background: '#fffbeb' } : tr}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{p.settlementId}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{p.sellerId}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      ₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      {mismatch && (
                        <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600, marginTop: 2 }}>
                          Bank: ₹{(Number(mismatch.actualPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          {' '}
                          <span style={{ color: '#92400e', fontWeight: 700 }}>
                            (Δ {mismatch.driftSign}₹
                            {(Math.abs(Number(mismatch.driftPaise)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <StatusBadge status={p.status} />
                      {mismatch && (
                        <div style={mismatchBadge}>BANK_AMOUNT_MISMATCH</div>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#475569' }}>
                      {p.utrReference ??
                        (mismatch
                          ? `Expected ${(Number(mismatch.expectedPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}, bank sent ${(Number(mismatch.actualPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : (p.failureReason ?? '—'))}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#64748b' }}>
                      {p.paidAt ? new Date(p.paidAt).toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                );
              })
            )}
            {batch.payouts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                  No payouts in this batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showIngest && (
        <IngestResponseModal
          batch={batch}
          onClose={() => setShowIngest(false)}
          onSaved={async () => {
            setShowIngest(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PayoutBatchDetail['status'] }) {
  const { bg, fg } = PAYOUT_STATUS_COLOR[status];
  return (
    <span style={{ ...badge, background: bg, color: fg }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: accent ?? '#0f172a' }}>{value}</div>
    </div>
  );
}

function IngestResponseModal({
  batch,
  onClose,
  onSaved,
}: {
  batch: PayoutBatchDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pending = batch.payouts.filter(
    (p) => p.status !== 'COMPLETED' && p.status !== 'FAILED',
  );

  type Row = {
    payout: PayoutItem;
    status: 'PAID' | 'FAILED';
    utrReference: string;
    failureReason: string;
  };

  const [rows, setRows] = useState<Row[]>(
    pending.map((p) => ({
      payout: p,
      status: 'PAID',
      utrReference: '',
      failureReason: '',
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [err, setErr] = useState('');

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    setErr('');
    for (const r of rows) {
      if (r.status === 'PAID' && !r.utrReference.trim()) {
        setErr(`UTR is required for paid payout ${r.payout.settlementId.slice(0, 8)}…`);
        return;
      }
      if (r.status === 'FAILED' && !r.failureReason.trim()) {
        setErr(`Failure reason is required for failed payout ${r.payout.settlementId.slice(0, 8)}…`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const ingestRows: IngestRow[] = rows.map((r) =>
        r.status === 'PAID'
          ? {
              settlementId: r.payout.settlementId,
              status: 'PAID',
              utrReference: r.utrReference.trim(),
              // Phase 152 — the operator is confirming the bank paid this exact
              // amount. Without it the server auto-demotes the row to FAILED
              // (BANK_AMOUNT_MISMATCH/MISSING) — the headline bug this fixes.
              paidAmountInPaise: r.payout.amountInPaise,
            }
          : { settlementId: r.payout.settlementId, status: 'FAILED', failureReason: r.failureReason.trim() },
      );
      const res = await adminPayoutsService.ingestResponse(batch.id, ingestRows);
      // Surface auto-demotions / skips so a silent demotion can't masquerade as
      // success (the modal previously closed even when every row FAILED).
      const data: any = res?.data;
      const mismatchN = data?.mismatches?.length ?? 0;
      const skipN = data?.skipped?.length ?? 0;
      if (mismatchN > 0 || skipN > 0) {
        setErr(
          `Ingest completed with ${mismatchN} amount mismatch(es) and ${skipN} skipped row(s). ` +
            'Those rows were NOT marked paid — review and re-submit.',
        );
        // Keep the modal open so the operator sees the warning; refresh parent.
        onSaved();
        return;
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to ingest response');
    } finally {
      setSubmitting(false);
    }
  };

  // Phase 152 — upload the bank's annotated CSV (parsed + amount-checked
  // server-side via the same hardened ingest path as manual entry).
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a fix
    if (!f) return;
    setErr('');
    setFileBusy(true);
    try {
      const res = await adminPayoutsService.ingestResponseFile(batch.id, f);
      const data: any = res?.data;
      const mm = data?.mismatches?.length ?? 0;
      const sk = data?.skipped?.length ?? 0;
      if (mm > 0 || sk > 0) {
        setErr(
          `File ingested: ${mm} amount mismatch(es), ${sk} skipped — those rows were NOT marked paid. Review and re-upload a corrected file.`,
        );
        onSaved();
        return;
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'File upload failed');
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalBody, maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Confirm bank response</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginBottom: 14, background: '#f8fafc' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Upload bank response CSV</div>
            <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 8px' }}>
              The exported payout CSV, annotated by the bank with <code>status</code> /{' '}
              <code>paid_amount_in_paise</code> (or <code>amount</code>) / <code>utr</code> columns.
              Parsed + amount-checked server-side; the same file can&apos;t be ingested twice.
            </p>
            <input type="file" accept=".csv,text/csv" disabled={fileBusy} onChange={onFile} />
            {fileBusy && (
              <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>Uploading…</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            — or confirm manually — mark each pending payout PAID (with UTR) or FAILED (with reason).
            Already-completed payouts are not shown.
          </p>
          <div style={{ ...tableWrap, maxHeight: 460, overflowY: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={trHead}>
                  <th style={th}>Settlement</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th}>UTR / failure reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.payout.id} style={tr}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                      {r.payout.settlementId.slice(0, 12)}…
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      ₹{Number(r.payout.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={td}>
                      <select
                        value={r.status}
                        onChange={(e) => updateRow(i, { status: e.target.value as 'PAID' | 'FAILED' })}
                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                      >
                        <option value="PAID">PAID</option>
                        <option value="FAILED">FAILED</option>
                      </select>
                    </td>
                    <td style={td}>
                      {r.status === 'PAID' ? (
                        <input
                          value={r.utrReference}
                          onChange={(e) => updateRow(i, { utrReference: e.target.value })}
                          placeholder="UTR reference"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                        />
                      ) : (
                        <input
                          value={r.failureReason}
                          onChange={(e) => updateRow(i, { failureReason: e.target.value })}
                          placeholder="Reason"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 20 }}>
                      No pending payouts to update.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {err && <div style={errorBox}>{err}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || rows.length === 0}
            style={{ ...btnPrimary, opacity: submitting || rows.length === 0 ? 0.6 : 1 }}
          >
            {submitting ? 'Saving…' : 'Submit response'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none',
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', background: '#fff', color: '#475569',
  border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
};
const btnClose: React.CSSProperties = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1,
};
const tableWrap: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const trHead: React.CSSProperties = { background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };
const tr: React.CSSProperties = { borderBottom: '1px solid #f1f5f9' };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#1e293b' };
const badge: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 12,
  fontSize: 11, fontWeight: 600,
};
const errorBox: React.CSSProperties = {
  marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 6, color: '#991b1b', fontSize: 12,
};

// Story 4.2 — mismatch banner + badge styling. Amber instead of red so
// operators can tell at a glance these are "fixable on re-upload"
// rather than "the bank rejected us."
const mismatchBanner: React.CSSProperties = {
  marginBottom: 16,
  padding: '12px 14px',
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 8,
};
const mismatchBadge: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 700,
  background: '#fef3c7',
  color: '#92400e',
  borderRadius: 4,
  letterSpacing: 0.3,
};
const inlineCode: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  background: '#fef3c7',
  color: '#92400e',
  padding: '0 4px',
  borderRadius: 3,
};
function mismatchToggleBtn(active: boolean): React.CSSProperties {
  return {
    height: 30,
    padding: '0 14px',
    background: active ? '#92400e' : '#fff',
    color: active ? '#fff' : '#92400e',
    border: '1px solid #92400e',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/**
 * Parse a `BANK_AMOUNT_MISMATCH:expected=<paise> actual=<paise>`
 * failureReason string. Returns null for any other reason so the
 * caller can fall back to the raw text. Paise are bigints in the
 * source string but stay as strings here — the UI only needs them
 * for display and the drift is bounded by sane settlement totals.
 */
function parseMismatch(reason: string | null | undefined): {
  expectedPaise: string;
  actualPaise: string;
  driftPaise: string;
  driftSign: '+' | '-' | '';
} | null {
  if (!reason || !reason.startsWith('BANK_AMOUNT_MISMATCH:')) return null;
  const m = /expected=(\d+)\s+actual=(\d+)/.exec(reason);
  if (!m) return null;
  // Settlement totals comfortably fit in Number (max ~₹90T in paise is
  // way under 2^53), so the parse here doesn't need BigInt literals.
  // String → Number is safe for display and arithmetic at this scale.
  const expected = Number(m[1]);
  const actual = Number(m[2]);
  const drift = actual - expected;
  return {
    expectedPaise: String(expected),
    actualPaise: String(actual),
    driftPaise: String(drift),
    driftSign: drift > 0 ? '+' : drift < 0 ? '-' : '',
  };
}
const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBody: React.CSSProperties = {
  background: '#fff', borderRadius: 12, width: '92%', maxWidth: 720,
  boxShadow: '0 20px 60px rgba(0,0,0,0.20)',
};
const modalHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 20px', borderBottom: '1px solid #e2e8f0',
};
const modalFooter: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 20px', borderTop: '1px solid #e2e8f0',
};
