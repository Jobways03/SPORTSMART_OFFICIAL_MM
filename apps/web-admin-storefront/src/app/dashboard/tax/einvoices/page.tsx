'use client';

// Phase 22 GST — E-invoice / IRN admin panel (CBIC Rule 48(4)).
//
// IRN management: mint an IRN for a pending B2B document, retry on
// failure, or cancel an IRN within the 24-hour CBIC window. Past that
// window the only correction path is a Credit Note.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  EInvoiceItem,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'PENDING' | 'GENERATED' | 'FAILED' | 'NOT_APPLICABLE';

const CBIC_CANCEL_CODES = [
  { value: 1, label: 'Duplicate' },
  { value: 2, label: 'Data entry mistake' },
  { value: 3, label: 'Order cancelled' },
  { value: 4, label: 'Other' },
];

// ── Page ──────────────────────────────────────────────────────────

export default function EinvoicesPage() {
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<EInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<EInvoiceItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listEinvoices();
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = async (documentId: string) => {
    setBusy(documentId);
    try {
      const res = await adminTaxService.generateEinvoice(documentId);
      setMsg({
        kind: 'ok',
        text: `IRN minted: ${res.data?.irn?.slice(0, 12)}… (ack ${res.data?.ackNo}).`,
      });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Generate failed' });
    } finally { setBusy(null); }
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    const by = (s: EInvoiceItem['einvoiceStatus']) =>
      items.filter((x) => x.einvoiceStatus === s).length;

    const now = Date.now();
    const cancellable = items.filter((x) => {
      if (x.einvoiceStatus !== 'GENERATED' || !x.ackDate) return false;
      const diff = now - new Date(x.ackDate).getTime();
      return diff < 24 * 3600 * 1000;
    }).length;

    const totalGeneratedPaise = items
      .filter((x) => x.einvoiceStatus === 'GENERATED')
      .reduce((acc, x) => acc + BigInt(x.documentTotalInPaise || '0'), BigInt(0));

    return {
      pending: by('PENDING'),
      generated: by('GENERATED'),
      failed: by('FAILED'),
      notApplicable: by('NOT_APPLICABLE'),
      cancellable,
      totalGeneratedPaise: totalGeneratedPaise.toString(),
    };
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (tab !== 'ALL') out = out.filter((x) => x.einvoiceStatus === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((x) =>
        x.documentNumber.toLowerCase().includes(q)
        || (x.irn ?? '').toLowerCase().includes(q)
        || (x.ackNo ?? '').toLowerCase().includes(q)
        || (x.buyerGstin ?? '').toLowerCase().includes(q)
        || (x.supplierGstin ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, tab, search]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          E-invoices <span style={{ fontSize: 14, fontWeight: 500, color: '#7A828F', marginLeft: 8 }}>CBIC Rule 48(4)</span>
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Mint an IRN for each B2B tax document, retry failed attempts, and cancel within the
          24-hour CBIC window. Past 24h the only correction is a Credit Note.
        </p>
      </div>

      <ProviderBanner />

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
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 460 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search document #, IRN, ack #, GSTIN…"
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
                <th style={th}>Document</th>
                <th style={th}>Status</th>
                <th style={th}>IRN</th>
                <th style={th}>Parties</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <Row
                  key={d.id}
                  item={d}
                  busy={busy === d.id}
                  onGenerate={() => void generate(d.id)}
                  onCancel={() => setCancelFor(d)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {items.length} loaded · client-filtered
      </p>

      {cancelFor && (
        <CancelModal
          row={cancelFor}
          busy={busy === cancelFor.id}
          onClose={() => setCancelFor(null)}
          onConfirm={async (code, reason) => {
            setBusy(cancelFor.id);
            try {
              await adminTaxService.cancelEinvoice(cancelFor.id, code, reason);
              setMsg({ kind: 'ok', text: 'IRN cancelled.' });
              setCancelFor(null);
              await load();
            } catch (err: any) {
              setMsg({ kind: 'err', text: err?.message ?? 'Cancel failed' });
            } finally { setBusy(null); }
          }}
        />
      )}
    </div>
  );
}

// ── Provider banner (stub notice) ─────────────────────────────────

function ProviderBanner() {
  return (
    <div style={{
      marginBottom: 16, padding: '10px 14px', borderRadius: 12, fontSize: 12,
      border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
      display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1.5,
    }}>
      <InfoIcon size={16} />
      <span>
        <strong>Stub provider active.</strong> IRNs are deterministic 64-char hex per
        (supplier, document, date). Real NIC IRP integration is gated by{' '}
        <code style={mono}>EINVOICE_PROVIDER=nic</code> plus an adapter implementation.
      </span>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: {
    pending: number; generated: number; failed: number; notApplicable: number;
    cancellable: number; totalGeneratedPaise: string;
  };
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Awaiting IRN"
        value={counts.pending.toLocaleString('en-IN')}
        tone={counts.pending > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="Documents pending IRN generation." />
      <Kpi label="Failed"
        value={counts.failed.toLocaleString('en-IN')}
        tone={counts.failed > 0 ? 'danger' : 'muted'}
        loading={loading}
        hint="Past retry cap — needs admin retry or investigation." />
      <Kpi label="Active IRNs"
        value={counts.generated.toLocaleString('en-IN')}
        tone="success"
        loading={loading}
        hint="Documents with a valid IRN." />
      <Kpi label="Cancellable now"
        value={counts.cancellable.toLocaleString('en-IN')}
        tone={counts.cancellable > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="Within the 24-hour CBIC cancellation window." />
      <Kpi label="Active value"
        value={`₹${paiseToRupees(counts.totalGeneratedPaise)}`}
        tone="neutral"
        loading={loading}
        hint="Total document value under valid IRNs." />
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
    pending: number; generated: number; failed: number; notApplicable: number;
  };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',            label: 'All',            count: total },
    { key: 'PENDING',        label: 'Pending',        count: counts.pending },
    { key: 'GENERATED',      label: 'Generated',      count: counts.generated },
    { key: 'FAILED',         label: 'Failed',         count: counts.failed },
    { key: 'NOT_APPLICABLE', label: 'Not applicable', count: counts.notApplicable },
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
  item, busy, onGenerate, onCancel,
}: {
  item: EInvoiceItem;
  busy: boolean;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const canGenerate = item.einvoiceStatus === 'PENDING' || item.einvoiceStatus === 'FAILED';
  const within24h = item.einvoiceStatus === 'GENERATED' && item.ackDate
    ? (Date.now() - new Date(item.ackDate).getTime()) < 24 * 3600 * 1000
    : false;

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: '#0F1115' }}>
          {item.documentNumber}
        </div>
        <div style={{
          marginTop: 4, display: 'inline-block',
          fontSize: 11, fontWeight: 600,
          padding: '2px 8px', borderRadius: 9999,
          background: '#F3F4F6', color: '#525A65',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {item.documentType.replace(/_/g, ' ')}
        </div>
      </td>

      <td style={td}>
        <StatusPill status={item.einvoiceStatus} />
        {item.einvoiceRetryCount > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#7A828F' }}>
            {item.einvoiceRetryCount} retr{item.einvoiceRetryCount === 1 ? 'y' : 'ies'}
          </div>
        )}
        {item.einvoiceLastAttemptedAt && item.einvoiceStatus !== 'GENERATED' && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}
               title={new Date(item.einvoiceLastAttemptedAt).toLocaleString('en-IN')}>
            last try {relTime(new Date(item.einvoiceLastAttemptedAt))}
          </div>
        )}
        {item.einvoiceFailureReason && (
          <div style={{
            marginTop: 6, fontSize: 11, color: '#b91c1c', lineHeight: 1.4, maxWidth: 280,
          }}>
            {item.einvoiceFailureReason}
          </div>
        )}
      </td>

      <td style={td}>
        {item.irn ? (
          <div>
            <div
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#0F1115' }}
              title={item.irn}
            >
              {item.irn.slice(0, 12)}…{item.irn.slice(-4)}
            </div>
            {item.ackNo && (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
                ack {item.ackNo}
              </div>
            )}
            {item.ackDate && (
              <CancelWindow ackDate={item.ackDate} />
            )}
          </div>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>

      <td style={{ ...td, fontSize: 12 }}>
        <div>
          <div style={kpiLabel}>Buyer</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#0F1115' }}>
            {item.buyerGstin ?? <span style={{ color: '#7A828F', fontFamily: 'inherit', fontSize: 12 }}>B2C</span>}
          </div>
        </div>
        {item.supplierGstin && (
          <div style={{ marginTop: 6 }}>
            <div style={kpiLabel}>Supplier</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#525A65' }}>
              {item.supplierGstin}
            </div>
          </div>
        )}
      </td>

      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        ₹{paiseToRupees(item.documentTotalInPaise)}
      </td>

      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {canGenerate && (
          <button
            onClick={onGenerate}
            disabled={busy}
            style={busy ? { ...btnPrimary, ...busyStyle } : btnPrimary}
            title={item.einvoiceStatus === 'FAILED' ? 'Retry generation' : 'Mint IRN with the provider'}
          >
            <SparkIcon size={12} /> {busy ? 'Generating…' : (item.einvoiceStatus === 'FAILED' ? 'Retry IRN' : 'Generate IRN')}
          </button>
        )}
        {item.einvoiceStatus === 'GENERATED' && (
          within24h ? (
            <button
              onClick={onCancel}
              disabled={busy}
              style={busy ? { ...btnDanger, ...busyStyle } : btnDanger}
              title="CBIC permits IRN cancellation within 24h of ackDate."
            >
              <XIcon size={12} /> Cancel
            </button>
          ) : (
            <span style={{ fontSize: 12, color: '#7A828F' }}
                  title="Past 24h — issue a Credit Note instead.">
              Past 24h
            </span>
          )
        )}
        {item.einvoiceStatus === 'NOT_APPLICABLE' && (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>
    </tr>
  );
}

function CancelWindow({ ackDate }: { ackDate: string }) {
  const ack = new Date(ackDate);
  const cutoff = new Date(ack.getTime() + 24 * 3600 * 1000);
  const diff = cutoff.getTime() - Date.now();
  const open = diff > 0;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: '#7A828F' }} title={ack.toLocaleString('en-IN')}>
        ack {ack.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
      </div>
      <div style={{
        marginTop: 2, fontSize: 11, fontWeight: 600,
        color: open ? '#15803d' : '#7A828F',
      }}>
        {open ? `Cancel window: ${relFuture(cutoff)}` : 'Cancel window closed'}
      </div>
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────

function StatusPill({ status }: { status: EInvoiceItem['einvoiceStatus'] }) {
  const tone =
    status === 'GENERATED'      ? { color: '#15803d', chip: '#dcfce7', label: 'Generated' } :
    status === 'FAILED'         ? { color: '#b91c1c', chip: '#fee2e2', label: 'Failed' } :
    status === 'PENDING'        ? { color: '#b45309', chip: '#fef3c7', label: 'Pending' } :
                                  { color: '#525A65', chip: '#F3F4F6', label: 'Not applicable' };
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

// ── Cancel modal ──────────────────────────────────────────────────

function CancelModal({
  row, busy, onClose, onConfirm,
}: {
  row: EInvoiceItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: (code: number, reason: string) => void;
}) {
  const [code, setCode] = useState(4);
  const [reason, setReason] = useState('');

  const ack = row.ackDate ? new Date(row.ackDate) : null;
  const cutoff = ack ? new Date(ack.getTime() + 24 * 3600 * 1000) : null;
  const within24h = cutoff ? cutoff.getTime() > Date.now() : false;

  return (
    <div
      onClick={onClose}
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
          maxWidth: 560, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Cancel IRN?
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          CBIC permits IRN cancellation only within <strong>24 hours of ackDate</strong>.
          Past that window, the correction path is a Credit Note instead.
        </p>

        <div style={{
          marginTop: 14, padding: 12, background: '#FAFAFA',
          border: '1px solid #E5E7EB', borderRadius: 10,
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
        }}>
          <div>
            <div style={kpiLabel}>Document</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
              {row.documentNumber}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={kpiLabel}>Total</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>
              ₹{paiseToRupees(row.documentTotalInPaise)}
            </div>
          </div>
          <div>
            <div style={kpiLabel}>IRN</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#0F1115' }}
                 title={row.irn ?? undefined}>
              {row.irn ? `${row.irn.slice(0, 12)}…${row.irn.slice(-4)}` : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={kpiLabel}>Cancel window</div>
            <div style={{
              fontWeight: 600, fontSize: 13,
              color: within24h ? '#15803d' : '#b91c1c',
            }}>
              {cutoff ? (within24h ? relFuture(cutoff) : 'Closed') : '—'}
            </div>
          </div>
        </div>

        {!within24h && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 12,
            border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
            display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4,
          }}>
            <WarningIcon size={14} />
            <span>
              CBIC 24-hour window is closed. The provider will likely reject this — issue a Credit
              Note from the order to correct.
            </span>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <Field label="Cancellation code">
            <select
              value={code}
              onChange={(e) => setCode(parseInt(e.target.value))}
              style={input}
            >
              {CBIC_CANCEL_CODES.map((c) => (
                <option key={c.value} value={c.value}>{c.value} — {c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Reason *">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate IRN minted for the same document — original ack BHV202610001234."
              rows={4}
              disabled={busy}
              autoFocus
              style={{
                ...input, padding: '10px 12px',
                fontFamily: 'inherit', resize: 'vertical', height: 'auto',
                minHeight: 90,
              }}
            />
          </Field>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnGhost} disabled={busy}>Back</button>
          <button
            onClick={() => onConfirm(code, reason)}
            disabled={busy || !reason.trim()}
            style={busy || !reason.trim() ? { ...btnDangerLarge, ...busyStyle } : btnDangerLarge}
          >
            {busy ? 'Cancelling…' : 'Cancel IRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner / field ─────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No documents match your search.';
  else if (tab === 'PENDING') text = 'Nothing waiting on IRN generation.';
  else if (tab === 'FAILED') text = 'No failed generation attempts.';
  else if (tab === 'GENERATED') text = 'No documents with an active IRN yet.';
  else if (tab === 'NOT_APPLICABLE') text = 'No documents marked NOT_APPLICABLE.';
  else text = 'No tax documents in scope yet.';

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
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 200, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 130, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={kpiLabel}>{label}</span>
      {children}
    </label>
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
function SparkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" />
    </svg>
  );
}
function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2 21h20L12 3z" /><path d="M12 9v5M12 17v.01" />
    </svg>
  );
}
function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 8v.01M11 12h1v5h1" />
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
function relFuture(d: Date): string {
  const diff = Math.max(0, d.getTime() - Date.now());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'closing';
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h left`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d left`;
  const mo = Math.floor(days / 30);
  return `${mo}mo left`;
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
  outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
};
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: 11,
  padding: '1px 4px', background: '#fef3c7', borderRadius: 4,
};
const btnPrimary: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnDanger: React.CSSProperties = {
  height: 32, padding: '0 12px',
  background: '#fff', color: '#b91c1c',
  border: '1px solid #fca5a5', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnDangerLarge: React.CSSProperties = {
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
