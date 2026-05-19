'use client';

// Phase 13 GST — Wallet adjustment approvals.
//
// Lists goodwill credits, Section-34 time-barred refunds, and manual
// debits awaiting approval. High-value rows require dual approval —
// two distinct admins must sign off (neither can be the requester)
// before money moves.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  WalletAdjustmentItem,
} from '@/services/admin-tax.service';

type Tab = 'PENDING' | 'FIRST_APPROVED' | 'APPROVED' | 'REJECTED' | 'REVERSED' | 'ALL';

// ── Page ──────────────────────────────────────────────────────────

export default function WalletAdjustmentsPage() {
  const { confirmDialog } = useModal();
  const [tab, setTab] = useState<Tab>('PENDING');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<WalletAdjustmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [rejectModal, setRejectModal] = useState<{
    id: string; amountInPaise: string; kind: string;
  } | null>(null);
  const [expandedGst, setExpandedGst] = useState<Set<string>>(new Set());

  // Load all rows once and filter client-side so KPIs and counts are
  // stable across tab switches.
  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listWalletAdjustments();
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Actions ────────────────────────────────────────────

  const approve = async (a: WalletAdjustmentItem) => {
    const isSecondStep = a.status === 'FIRST_APPROVED';
    const isFirstOfDual = a.status === 'PENDING_APPROVAL' && a.requiresDualApproval;
    const messageBody = isSecondStep
      ? 'This is the SECOND approval. Money will move immediately once you confirm.'
      : isFirstOfDual
      ? 'This is the FIRST of two approvals. A second distinct admin must also approve before money moves.'
      : 'Approve this wallet adjustment? Money will move immediately.';
    const ok = await confirmDialog({
      title: isSecondStep ? 'Provide second approval?' : isFirstOfDual ? 'Provide first approval?' : 'Approve wallet adjustment?',
      message: messageBody,
      confirmText: 'Approve',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(a.id);
    try {
      const res = await adminTaxService.approveWalletAdjustment(a.id);
      const text = res.data?.status === 'FIRST_APPROVED'
        ? 'First approval recorded — awaiting second approver.'
        : `Approved — wallet transaction ${res.data?.walletTransactionId?.slice(0, 8) ?? ''}…`;
      setMsg({ kind: 'ok', text });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Approval failed' });
    } finally { setBusy(null); }
  };

  const reject = async (id: string, reason: string) => {
    if (!reason.trim()) return;
    setBusy(id);
    try {
      await adminTaxService.rejectWalletAdjustment(id, reason);
      setMsg({ kind: 'ok', text: 'Adjustment rejected.' });
      setRejectModal(null);
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Rejection failed' });
    } finally { setBusy(null); }
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    const pending  = items.filter((a) => a.status === 'PENDING_APPROVAL').length;
    const firstApp = items.filter((a) => a.status === 'FIRST_APPROVED').length;
    const approved = items.filter((a) => a.status === 'APPROVED').length;
    const rejected = items.filter((a) => a.status === 'REJECTED').length;
    const reversed = items.filter((a) => a.status === 'REVERSED').length;

    const pendingValue = items
      .filter((a) => a.status === 'PENDING_APPROVAL' || a.status === 'FIRST_APPROVED')
      .reduce((acc, a) => acc + abs(BigInt(a.amountInPaise || '0')), BigInt(0));
    const absorbedGst = items
      .filter((a) => a.status === 'APPROVED' && hasGstSnapshot(a))
      .reduce((acc, a) => acc + BigInt(a.wouldHaveBeenTaxableInPaise || '0'), BigInt(0));

    return {
      pending, firstApp, approved, rejected, reversed,
      pendingValue: pendingValue.toString(),
      absorbedGst: absorbedGst.toString(),
    };
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (tab === 'PENDING')         out = out.filter((a) => a.status === 'PENDING_APPROVAL');
    if (tab === 'FIRST_APPROVED')  out = out.filter((a) => a.status === 'FIRST_APPROVED');
    if (tab === 'APPROVED')        out = out.filter((a) => a.status === 'APPROVED');
    if (tab === 'REJECTED')        out = out.filter((a) => a.status === 'REJECTED');
    if (tab === 'REVERSED')        out = out.filter((a) => a.status === 'REVERSED');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((a) =>
        a.reason.toLowerCase().includes(q)
        || a.customerId.toLowerCase().includes(q)
        || (a.returnId ?? '').toLowerCase().includes(q)
        || a.kind.toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, tab, search]);

  // ── Render ─────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Wallet adjustments
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Goodwill credits, Section-34 time-barred refunds, and manual debits. High-value rows
          require <strong>dual approval</strong> — two distinct admins must sign off (neither can be
          the requester) before money moves. Approved rows post a wallet transaction immediately.
        </p>
      </div>

      <KpiStrip counts={counts} loading={loading && items.length === 0} />

      {/* Tabs */}
      <div style={{
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <Tabs current={tab} counts={counts} total={items.length} onChange={setTab} />
      </div>

      {/* Search + refresh */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reason, customer ID, return ID, kind…"
            style={{ ...input, width: '100%', paddingLeft: 36 }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#7A828F', display: 'inline-flex',
          }}>
            <SearchIcon />
          </span>
        </div>
        <button onClick={() => void load()} style={btnGhost} disabled={loading}>
          <RefreshIcon /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {msg && <Banner msg={msg} onClose={() => setMsg(null)} />}

      {/* Table */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && items.length === 0 ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} hasSearch={Boolean(search.trim())} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>Kind</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                <th style={{ ...th, textAlign: 'right' }}>Absorbed GST</th>
                <th style={th}>Reason</th>
                <th style={th}>Requested</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <Row
                  key={a.id}
                  item={a}
                  busy={busy === a.id}
                  expanded={expandedGst.has(a.id)}
                  onToggleGst={() => {
                    const next = new Set(expandedGst);
                    if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                    setExpandedGst(next);
                  }}
                  onApprove={() => void approve(a)}
                  onReject={() => setRejectModal({
                    id: a.id, amountInPaise: a.amountInPaise, kind: a.kind,
                  })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {items.length} loaded · client-filtered
      </p>

      {rejectModal && (
        <RejectModal
          payload={rejectModal}
          busy={busy === rejectModal.id}
          onCancel={() => setRejectModal(null)}
          onConfirm={(reason) => void reject(rejectModal.id, reason)}
        />
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: {
    pending: number; firstApp: number; approved: number;
    rejected: number; reversed: number;
    pendingValue: string; absorbedGst: string;
  };
  loading: boolean;
}) {
  const awaiting2nd = counts.firstApp;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi
        label="Pending approval"
        value={counts.pending.toLocaleString('en-IN')}
        tone={counts.pending > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="Awaiting first sign-off."
      />
      <Kpi
        label="Awaiting 2nd approver"
        value={awaiting2nd.toLocaleString('en-IN')}
        tone={awaiting2nd > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="First approval recorded — needs a distinct second admin."
      />
      <Kpi
        label="Pending value"
        value={`₹${paiseToRupees(counts.pendingValue)}`}
        tone="neutral"
        loading={loading}
        hint="Total ₹ across pending + first-approved."
      />
      <Kpi
        label="GST absorbed"
        value={`₹${paiseToRupees(counts.absorbedGst)}`}
        tone={counts.absorbedGst !== '0' ? 'danger' : 'muted'}
        loading={loading}
        hint="Tax-portion the platform ate on approved rows."
      />
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
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: KPI_TONE[tone], fontVariantNumeric: 'tabular-nums' }}>
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

// ── Tabs ──────────────────────────────────────────────────────────

function Tabs({
  current, counts, total, onChange,
}: {
  current: Tab;
  counts: {
    pending: number; firstApp: number; approved: number;
    rejected: number; reversed: number;
  };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'PENDING',         label: 'Pending',          count: counts.pending  },
    { key: 'FIRST_APPROVED',  label: 'First approved',   count: counts.firstApp },
    { key: 'APPROVED',        label: 'Approved',         count: counts.approved },
    { key: 'REJECTED',        label: 'Rejected',         count: counts.rejected },
    { key: 'REVERSED',        label: 'Reversed',         count: counts.reversed },
    { key: 'ALL',             label: 'All',              count: total           },
  ];
  return (
    <>
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key} type="button" onClick={() => onChange(t.key)}
            style={active ? tabActive : tabIdle}
          >
            {t.label}
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600,
              padding: '1px 7px', borderRadius: 9999,
              background: active ? '#0F1115' : '#F3F4F6',
              color: active ? '#fff' : '#525A65',
              fontVariantNumeric: 'tabular-nums',
            }}>{t.count}</span>
          </button>
        );
      })}
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function Row({
  item, busy, expanded, onToggleGst, onApprove, onReject,
}: {
  item: WalletAdjustmentItem;
  busy: boolean;
  expanded: boolean;
  onToggleGst: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isDebit = BigInt(item.amountInPaise || '0') < BigInt(0);
  const canAct = item.status === 'PENDING_APPROVAL' || item.status === 'FIRST_APPROVED';

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <KindPill kind={item.kind} />
        {item.requiresDualApproval && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 6, fontSize: 10, fontWeight: 600,
            color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <ShieldIcon size={11} /> Dual approval
          </div>
        )}
      </td>

      <td style={td}>
        <StatusPill status={item.status} />
        {item.status === 'FIRST_APPROVED' && item.firstApprovedByAdminId && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}
               title={item.firstApprovedAt ? new Date(item.firstApprovedAt).toLocaleString('en-IN') : ''}>
            1st: {item.firstApprovedByAdminId.slice(0, 8)}…
          </div>
        )}
        {item.status === 'APPROVED' && item.approvedByAdminId && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}
               title={item.approvedAt ? new Date(item.approvedAt).toLocaleString('en-IN') : ''}>
            by {item.approvedByAdminId.slice(0, 8)}…
          </div>
        )}
        {item.status === 'REJECTED' && item.rejectionReason && (
          <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4, lineHeight: 1.4, maxWidth: 220 }}>
            {item.rejectionReason}
          </div>
        )}
      </td>

      <td style={{ ...td, textAlign: 'right' }}>
        <div style={{
          fontWeight: 700, fontSize: 14,
          color: isDebit ? '#b91c1c' : '#15803d',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {isDebit ? '−' : '+'}₹{paiseToRupees(item.amountInPaise.replace(/^-/, ''))}
        </div>
        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {isDebit ? 'Debit' : 'Credit'}
        </div>
      </td>

      <td style={{ ...td, textAlign: 'right' }}>
        <GstSummary item={item} expanded={expanded} onToggle={onToggleGst} />
      </td>

      <td style={{ ...td, maxWidth: 320, color: '#525A65', lineHeight: 1.45 }}>
        <ReasonCell text={item.reason} />
        {item.returnId && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#7A828F', fontFamily: 'ui-monospace, monospace' }}>
            Return {item.returnId.slice(0, 8)}…
          </div>
        )}
      </td>

      <td style={{ ...td, fontSize: 12 }}>
        <div style={{ color: '#0F1115' }} title={new Date(item.requestedAt).toLocaleString('en-IN')}>
          {relTime(new Date(item.requestedAt))}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          cust {item.customerId.slice(0, 8)}…
        </div>
        {item.requestedByAdminId && (
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
            by {item.requestedByAdminId.slice(0, 8)}…
          </div>
        )}
      </td>

      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {canAct ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onApprove}
              disabled={busy}
              style={busy ? { ...btnApprove, ...busyStyle } : btnApprove}
              title={approveTooltip(item)}
            >
              <CheckIcon size={12} /> {busy ? 'Working…' : approveLabel(item)}
            </button>
            <button
              onClick={onReject}
              disabled={busy}
              style={busy ? { ...btnReject, ...busyStyle } : btnReject}
            >
              <XIcon size={12} /> Reject
            </button>
          </div>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>
    </tr>
  );
}

function approveLabel(a: WalletAdjustmentItem): string {
  if (a.status === 'FIRST_APPROVED') return 'Approve (2/2)';
  if (a.requiresDualApproval) return 'Approve (1/2)';
  return 'Approve';
}
function approveTooltip(a: WalletAdjustmentItem): string {
  if (a.status === 'FIRST_APPROVED') return 'Second approver — wallet posts on confirm.';
  if (a.requiresDualApproval) return 'First of two approvers — a second admin must also sign off.';
  return 'Approve and post wallet transaction.';
}

// ── GST summary ───────────────────────────────────────────────────

function GstSummary({
  item, expanded, onToggle,
}: {
  item: WalletAdjustmentItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!hasGstSnapshot(item)) {
    return <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>;
  }
  const taxable = item.wouldHaveBeenTaxableInPaise ?? '0';
  const cgst = item.wouldHaveBeenCgstInPaise ?? '0';
  const sgst = item.wouldHaveBeenSgstInPaise ?? '0';
  const igst = item.wouldHaveBeenIgstInPaise ?? '0';
  const isInter = BigInt(igst) > BigInt(0);

  return (
    <div>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13, color: '#0F1115' }}>
        ₹{paiseToRupees(taxable)}
      </div>
      <button
        onClick={onToggle}
        style={{
          marginTop: 2, padding: 0, border: 'none', background: 'transparent',
          color: '#525A65', fontSize: 11, cursor: 'pointer',
          textDecoration: 'underline',
        }}
        title={isInter ? 'Inter-state' : 'Intra-state'}
      >
        {expanded ? 'hide split' : 'show split'}
      </button>
      {expanded && (
        <div style={{
          marginTop: 6, padding: 8, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 8,
          textAlign: 'left', fontSize: 11, lineHeight: 1.6,
        }}>
          {isInter ? (
            <Pair label="IGST" value={igst} />
          ) : (
            <>
              <Pair label="CGST" value={cgst} />
              <Pair label="SGST" value={sgst} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#525A65', fontWeight: 600 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F1115' }}>
        ₹{paiseToRupees(value)}
      </span>
    </div>
  );
}

function hasGstSnapshot(a: WalletAdjustmentItem): boolean {
  const has = (s: string | null | undefined) => Boolean(s) && BigInt(s || '0') > BigInt(0);
  return has(a.wouldHaveBeenTaxableInPaise) || has(a.wouldHaveBeenCgstInPaise)
      || has(a.wouldHaveBeenSgstInPaise)   || has(a.wouldHaveBeenIgstInPaise);
}

// ── Reason cell ───────────────────────────────────────────────────

function ReasonCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 140;
  const display = expanded || !long ? text : text.slice(0, 140).trim() + '…';
  return (
    <div>
      <span style={{ fontSize: 12 }}>{display}</span>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginLeft: 6, padding: 0, border: 'none', background: 'transparent',
            color: '#0F1115', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

// ── Status / kind pills ───────────────────────────────────────────

function StatusPill({ status }: { status: WalletAdjustmentItem['status'] }) {
  const tone =
    status === 'APPROVED'         ? { color: '#15803d', chip: '#dcfce7', label: 'Approved' } :
    status === 'REJECTED'         ? { color: '#b91c1c', chip: '#fee2e2', label: 'Rejected' } :
    status === 'REVERSED'         ? { color: '#525A65', chip: '#F3F4F6', label: 'Reversed' } :
    status === 'FIRST_APPROVED'   ? { color: '#1d4ed8', chip: '#dbeafe', label: 'First approved' } :
                                    { color: '#b45309', chip: '#fef3c7', label: 'Pending' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone.color }} />
      {tone.label}
    </span>
  );
}

function KindPill({ kind }: { kind: WalletAdjustmentItem['kind'] }) {
  const meta =
    kind === 'TIME_BARRED_CREDIT_NOTE' ? { color: '#b91c1c', chip: '#fee2e2', label: 'Time-barred CN' } :
    kind === 'GOODWILL'                ? { color: '#15803d', chip: '#dcfce7', label: 'Goodwill' } :
    kind === 'MANUAL_DEBIT'            ? { color: '#9a3412', chip: '#ffedd5', label: 'Manual debit' } :
                                          { color: '#525A65', chip: '#F3F4F6', label: 'Manual' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: meta.chip, color: meta.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {meta.label}
    </span>
  );
}

// ── Reject modal ──────────────────────────────────────────────────

function RejectModal({
  payload, busy, onCancel, onConfirm,
}: {
  payload: { id: string; amountInPaise: string; kind: string };
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isDebit = BigInt(payload.amountInPaise || '0') < BigInt(0);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 17, 21, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 24,
          maxWidth: 520, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Reject wallet adjustment?
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          The requester will see the reason. Rejected rows can't be re-opened — the request must be
          submitted again if it's later valid.
        </p>

        <div style={{
          marginTop: 14, padding: 12, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div>
            <div style={kpiLabel}>Kind</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
              {payload.kind.replace(/_/g, ' ')}
            </div>
          </div>
          <div>
            <div style={{ ...kpiLabel, textAlign: 'right' }}>Amount</div>
            <div style={{
              fontWeight: 700, fontSize: 16,
              color: isDebit ? '#b91c1c' : '#15803d',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {isDebit ? '−' : '+'}₹{paiseToRupees(payload.amountInPaise.replace(/^-/, ''))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={kpiLabel}>Rejection reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate request — already issued under WA-2026-000123."
            rows={4}
            disabled={busy}
            style={{
              marginTop: 6, width: '100%', padding: '10px 12px',
              border: '1px solid #D2D6DC', borderRadius: 10,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
              outline: 'none', minHeight: 90, boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost} disabled={busy}>Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            style={busy || !reason.trim() ? { ...btnRejectLarge, ...busyStyle } : btnRejectLarge}
            disabled={busy || !reason.trim()}
          >
            {busy ? 'Rejecting…' : 'Reject adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner ─────────────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No adjustments match your search.';
  else if (tab === 'PENDING') text = 'Nothing waiting for first approval. Great.';
  else if (tab === 'FIRST_APPROVED') text = 'No rows waiting on a second approver.';
  else if (tab === 'APPROVED') text = 'No approved rows in this set.';
  else if (tab === 'REJECTED') text = 'No rejected rows in this set.';
  else if (tab === 'REVERSED') text = 'No reversed rows in this set.';
  else text = 'No wallet adjustments yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <CheckIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>All clear</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>{text}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 180, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

function Banner({
  msg, onClose,
}: { msg: { kind: 'ok' | 'err'; text: string }; onClose: () => void }) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px', borderRadius: 12, fontSize: 13,
      border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fca5a5'}`,
      background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
      color: msg.kind === 'ok' ? '#15803d' : '#b91c1c',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    }}>
      <span>{msg.text}</span>
      <button
        onClick={onClose}
        style={{
          padding: 4, border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'inherit', opacity: 0.6, lineHeight: 1, fontSize: 16,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" /><path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" /><path d="M21 21v-5h-5" />
    </svg>
  );
}
function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}
function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function ShieldIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function abs(b: bigint): bigint {
  return b < BigInt(0) ? -b : b;
}

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const negative = p.startsWith('-');
  const abs = negative ? p.slice(1) : p;
  const whole = abs.length > 2 ? abs.slice(0, -2) : '0';
  const cents = abs.length > 2 ? abs.slice(-2) : abs.padStart(2, '0');
  const grouped = formatIndianGrouping(whole);
  return (negative ? '-' : '') + grouped + '.' + cents;
}
function formatIndianGrouping(n: string): string {
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3);
  const groups: string[] = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  return `${groups.join(',')},${last3}`;
}
function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// ── Shared styles ─────────────────────────────────────────────────

const crumb: React.CSSProperties = {
  fontSize: 13, color: '#525A65', textDecoration: 'none',
  marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
};
const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const tabIdle: React.CSSProperties = {
  background: 'transparent', border: 'none',
  padding: '10px 14px', marginBottom: -1,
  fontSize: 13, fontWeight: 600, color: '#525A65',
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  display: 'inline-flex', alignItems: 'center',
};
const tabActive: React.CSSProperties = {
  ...tabIdle, color: '#0F1115', borderBottom: '2px solid #0F1115',
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff',
};
const btnApprove: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnReject: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#fff', color: '#b91c1c',
  border: '1px solid #fca5a5', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnRejectLarge: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#b91c1c', color: '#fff',
  border: '1px solid #b91c1c', borderRadius: 9999,
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
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'top',
};
