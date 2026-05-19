'use client';

// Phase 12 GST — Time-bar review queue.
//
// Returns where the Phase-12 daily cron flagged Section-34 eligibility
// as REQUIRES_FINANCE_REVIEW (within 7 days of cutoff or unusual
// source-invoice state) or TIME_BARRED (past cutoff — must route via
// wallet adjustment, credit-note path will throw).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  TimebarReviewItem,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'REQUIRES_FINANCE_REVIEW' | 'TIME_BARRED' | 'REVIEWED';

// ── Page ──────────────────────────────────────────────────────────

export default function TimebarReviewPage() {
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<TimebarReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Modal state for reason capture
  const [reasonModal, setReasonModal] = useState<{
    id: string;
    returnNumber: string;
    op: 'wallet' | 'credit';
    refundInPaise: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      // Server filter only knows REQUIRES_FINANCE_REVIEW / TIME_BARRED;
      // REVIEWED is a client-side derivation.
      const serverFilter =
        tab === 'REQUIRES_FINANCE_REVIEW' || tab === 'TIME_BARRED' ? tab : undefined;
      const res = await adminTaxService.listTimebarReview(serverFilter);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed to load queue' });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const action = async (id: string, op: 'wallet' | 'credit', reason: string) => {
    setBusy(id);
    setMsg(null);
    try {
      if (op === 'wallet') {
        const res = await adminTaxService.routeReturnToWallet(id, reason || undefined);
        setMsg({
          kind: 'ok',
          text: `Routed to wallet adjustment ${res.data?.adjustmentId?.slice(0, 8)}… (${res.data?.status}).`,
        });
      } else {
        const res = await adminTaxService.issueCreditNoteOverride(id, reason || undefined);
        setMsg({
          kind: 'ok',
          text: `Credit note ${res.data?.documentNumber} issued for ₹${paiseToRupees(res.data?.totalInPaise ?? '0')}.`,
        });
      }
      setReasonModal(null);
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Action failed' });
    } finally {
      setBusy(null);
    }
  };

  // Counts for KPI strip (computed across the currently loaded set).
  const counts = useMemo(() => {
    const requires = items.filter((r) => r.creditNoteEligibilityStatus === 'REQUIRES_FINANCE_REVIEW').length;
    const barred = items.filter((r) => r.creditNoteEligibilityStatus === 'TIME_BARRED').length;
    const reviewed = items.filter((r) => Boolean(r.financeReviewedAt)).length;
    const pendingRefundPaise = items
      .filter((r) => !r.financeReviewedAt)
      .reduce((acc, r) => acc + BigInt(r.refundAmountInPaise || '0'), BigInt(0));
    return { requires, barred, reviewed, pendingRefundPaise: pendingRefundPaise.toString() };
  }, [items]);

  // Apply tab + search filter on top of server-loaded data.
  const filtered = useMemo(() => {
    let out = items;
    if (tab === 'REVIEWED') out = out.filter((r) => Boolean(r.financeReviewedAt));
    if (tab === 'ALL') out = out;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (r) =>
          r.returnNumber.toLowerCase().includes(q) ||
          r.subOrderId.toLowerCase().includes(q) ||
          (r.creditNoteTimeBarReason ?? '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, tab, search]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Section 34 — Time-bar review
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Returns flagged by the Phase-12 daily cron. <strong>Requires finance review</strong> means
          within 7 days of the credit-note cutoff or has an unusual source-invoice state — pick a
          path manually. <strong>Time-barred</strong> means past Section-34 cutoff — credit-note
          path will throw, route via wallet adjustment only.
        </p>
      </div>

      {/* ── KPI strip ─────────────────────────────────────── */}
      <KpiStrip counts={counts} total={items.length} loading={loading && items.length === 0} />

      {/* ── Tabs + search ─────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          borderBottom: '1px solid #E5E7EB',
          display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 12,
        }}>
          <Tabs current={tab} counts={counts} total={items.length} onChange={setTab} />
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search return #, sub-order ID, or reason…"
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
      </div>

      {msg && <Banner msg={msg} onClose={() => setMsg(null)} />}

      {/* ── Table ─────────────────────────────────────────── */}
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
                <th style={th}>Return</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Refund</th>
                <th style={th}>Reason</th>
                <th style={th}>Reviewed</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Row
                  key={r.id}
                  item={r}
                  busy={busy === r.id}
                  onAct={(op) => setReasonModal({
                    id: r.id,
                    returnNumber: r.returnNumber,
                    op,
                    refundInPaise: r.refundAmountInPaise,
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

      {/* ── Reason modal ──────────────────────────────────── */}
      {reasonModal && (
        <ReasonModal
          payload={reasonModal}
          busy={busy === reasonModal.id}
          onCancel={() => setReasonModal(null)}
          onConfirm={(reason) => void action(reasonModal.id, reasonModal.op, reason)}
        />
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, total, loading,
}: {
  counts: { requires: number; barred: number; reviewed: number; pendingRefundPaise: string };
  total: number;
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total in queue" value={total.toLocaleString('en-IN')} tone="neutral" loading={loading}
           hint="All returns the cron flagged." />
      <Kpi label="Requires review" value={counts.requires.toLocaleString('en-IN')}
           tone={counts.requires > 0 ? 'warning' : 'muted'} loading={loading}
           hint="Close to the 7-day cutoff — pick a path." />
      <Kpi label="Time-barred" value={counts.barred.toLocaleString('en-IN')}
           tone={counts.barred > 0 ? 'danger' : 'muted'} loading={loading}
           hint="Past cutoff — wallet-only path." />
      <Kpi label="Pending refund" value={`₹${paiseToRupees(counts.pendingRefundPaise)}`}
           tone="neutral" loading={loading}
           hint="Sum of refunds awaiting resolution." />
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
  counts: { requires: number; barred: number; reviewed: number };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',                     label: 'All',              count: total },
    { key: 'REQUIRES_FINANCE_REVIEW', label: 'Requires review',  count: counts.requires },
    { key: 'TIME_BARRED',             label: 'Time-barred',      count: counts.barred },
    { key: 'REVIEWED',                label: 'Reviewed',         count: counts.reviewed },
  ];
  return (
    <>
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
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
  item, busy, onAct,
}: {
  item: TimebarReviewItem;
  busy: boolean;
  onAct: (op: 'wallet' | 'credit') => void;
}) {
  const reviewed = Boolean(item.financeReviewedAt);
  const timeBarred = item.creditNoteEligibilityStatus === 'TIME_BARRED';
  const reason = item.creditNoteTimeBarReason ?? null;

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {item.returnNumber}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {item.subOrderId.slice(0, 8)}…
        </div>
      </td>
      <td style={td}>
        <StatusPill status={item.creditNoteEligibilityStatus} reviewed={reviewed} />
      </td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        ₹{paiseToRupees(item.refundAmountInPaise)}
      </td>
      <td style={{ ...td, maxWidth: 360, color: '#525A65', lineHeight: 1.45 }}>
        {reason ? <ReasonCell text={reason} /> : <span style={{ color: '#7A828F' }}>—</span>}
      </td>
      <td style={{ ...td, fontSize: 12 }}>
        {item.financeReviewedBy ? (
          <>
            <div style={{ fontFamily: 'ui-monospace, monospace', color: '#0F1115' }}>
              {item.financeReviewedBy.slice(0, 8)}…
            </div>
            {item.financeReviewedAt && (
              <div
                style={{ color: '#7A828F', fontSize: 11, marginTop: 2 }}
                title={new Date(item.financeReviewedAt).toLocaleString('en-IN')}
              >
                {relTime(new Date(item.financeReviewedAt))}
              </div>
            )}
          </>
        ) : <span style={{ color: '#7A828F' }}>—</span>}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {reviewed ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#15803d', fontSize: 12, fontWeight: 600,
          }}>
            <CheckIcon /> Resolved
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onAct('wallet')}
              disabled={busy}
              style={busy ? { ...btnPrimary, ...busyStyle } : btnPrimary}
              title="Create a wallet adjustment for this return"
            >
              {busy ? 'Working…' : 'Route to wallet'}
            </button>
            <button
              onClick={() => onAct('credit')}
              disabled={busy || timeBarred}
              style={busy || timeBarred ? btnDisabled : btnSecondary}
              title={timeBarred
                ? 'Past Section-34 cutoff — credit-note path will throw'
                : 'Issue credit note via override permission'}
            >
              Issue credit note
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function ReasonCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 180;
  const display = expanded || !long ? text : text.slice(0, 180).trim() + '…';
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

// ── Status pill ───────────────────────────────────────────────────

function StatusPill({
  status, reviewed,
}: {
  status: 'ELIGIBLE' | 'TIME_BARRED' | 'REQUIRES_FINANCE_REVIEW' | null;
  reviewed: boolean;
}) {
  const tone =
    status === 'TIME_BARRED'             ? { color: '#b91c1c', chip: '#fee2e2', label: 'Time-barred' } :
    status === 'REQUIRES_FINANCE_REVIEW' ? { color: '#b45309', chip: '#fef3c7', label: 'Requires review' } :
    status === 'ELIGIBLE'                ? { color: '#15803d', chip: '#dcfce7', label: 'Eligible' } :
                                           { color: '#525A65', chip: '#F3F4F6', label: '—' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 22, padding: '0 10px', borderRadius: 9999,
        background: tone.chip, color: tone.color,
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        alignSelf: 'flex-start',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone.color }} />
        {tone.label}
      </span>
      {reviewed && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, color: '#15803d',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          alignSelf: 'flex-start',
        }}>
          <CheckIcon size={11} /> Reviewed
        </span>
      )}
    </div>
  );
}

// ── Reason modal ──────────────────────────────────────────────────

function ReasonModal({
  payload, busy, onCancel, onConfirm,
}: {
  payload: { id: string; returnNumber: string; op: 'wallet' | 'credit'; refundInPaise: string };
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isWallet = payload.op === 'wallet';
  const title = isWallet ? 'Route to wallet adjustment' : 'Issue credit-note override';
  const desc = isWallet
    ? 'Creates a wallet credit equal to the refund amount instead of a tax credit note. Recommended for time-barred returns.'
    : 'Issues a credit note even though the cron raised a flag. Requires CN_OVERRIDE permission; logged for audit.';
  const confirmLabel = isWallet ? 'Route to wallet' : 'Issue credit note';

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
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>{title}</h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>{desc}</p>

        <div style={{
          marginTop: 14, padding: 12, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div>
            <div style={kpiLabel}>Return</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
              {payload.returnNumber}
            </div>
          </div>
          <div>
            <div style={{ ...kpiLabel, textAlign: 'right' }}>Refund</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>
              ₹{paiseToRupees(payload.refundInPaise)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={kpiLabel}>Reason (optional but recommended)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isWallet
              ? 'e.g. Past Section-34 cutoff — routing to wallet per finance policy.'
              : 'e.g. Source invoice located manually; override approved by finance.'}
            rows={4}
            disabled={busy}
            style={{
              marginTop: 6, width: '100%', padding: '10px 12px',
              border: '1px solid #D2D6DC', borderRadius: 10,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
              outline: 'none', minHeight: 90, boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost} disabled={busy}>Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            style={isWallet ? btnPrimary : { ...btnPrimary, background: '#7c3aed', borderColor: '#7c3aed' }}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner ─────────────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No returns match your search.';
  else if (tab === 'REVIEWED') text = 'Nothing has been resolved yet in the loaded set.';
  else if (tab === 'TIME_BARRED') text = 'No time-barred returns — cutoff hasn\'t lapsed for anything in the queue.';
  else if (tab === 'REQUIRES_FINANCE_REVIEW') text = 'No returns flagged for review right now.';
  else text = 'Queue empty — no returns awaiting time-bar review.';

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
          <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 200, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
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

// ── Icons (inline, no external lib) ───────────────────────────────

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
      <path d="M21 21v-5h-5" />
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

// ── Helpers ───────────────────────────────────────────────────────

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
  background: 'transparent',
  border: 'none',
  padding: '10px 14px',
  marginBottom: -1,
  fontSize: 13,
  fontWeight: 600,
  color: '#525A65',
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  display: 'inline-flex',
  alignItems: 'center',
};

const tabActive: React.CSSProperties = {
  ...tabIdle,
  color: '#0F1115',
  borderBottom: '2px solid #0F1115',
};

const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

const btnSecondary: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#fff', color: '#0F1115',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const btnDisabled: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#F3F4F6', color: '#9CA3AF',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'not-allowed',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
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
