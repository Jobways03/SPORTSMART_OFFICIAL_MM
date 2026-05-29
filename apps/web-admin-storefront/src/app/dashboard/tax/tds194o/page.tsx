'use client';

// Phase 27 GST — Section 194-O Income-Tax TDS admin panel.
//
// Lifecycle:
//   COMPUTED → WITHHELD (auto, when settlement marked PAID)
//            → DEPOSITED (admin marks after challan upload)
//            → CERTIFICATE_ISSUED (admin marks after Form 16A
//                                  issued to seller)
//   REVERSED (terminal — refund/reversal cycle)
//
// Quarterly filing period in YYYY-Qn format aligned to Indian FY:
//   Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  Tds194OLedgerItem,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'TO_DEPOSIT' | 'DEPOSITED' | 'CERTIFICATE_ISSUED' | 'REVERSED';

// ── Page ──────────────────────────────────────────────────────────

export default function Tds194OPage() {
  const [filingPeriod, setFilingPeriod] = useState(currentQuarterIst());
  const [tab, setTab] = useState<Tab>('TO_DEPOSIT');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Tds194OLedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkModal, setBulkModal] = useState<'deposit' | 'certificate' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listTds194O(filingPeriod);
      setItems(res.data?.items ?? []);
      setSelected({});
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filingPeriod]);

  useEffect(() => { void load(); }, [load]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  // ── Counts ─────────────────────────────────────────────

  const counts = useMemo(() => {
    const by = (s: Tds194OLedgerItem['status']) =>
      items.filter((x) => x.status === s).length;
    const toDeposit = items.filter((x) => x.status === 'COMPUTED' || x.status === 'WITHHELD').length;
    const totalTdsPaise = items
      .filter((x) => x.status !== 'REVERSED')
      .reduce((acc, x) => acc + BigInt(x.tdsInPaise || '0'), BigInt(0));
    const undepositedPaise = items
      .filter((x) => x.status === 'COMPUTED' || x.status === 'WITHHELD')
      .reduce((acc, x) => acc + BigInt(x.tdsInPaise || '0'), BigInt(0));
    const highRate = items.filter((x) => x.tdsRateBps >= 500).length;
    return {
      computed: by('COMPUTED'),
      withheld: by('WITHHELD'),
      deposited: by('DEPOSITED'),
      certIssued: by('CERTIFICATE_ISSUED'),
      reversed: by('REVERSED'),
      toDeposit,
      highRate,
      totalTdsPaise: totalTdsPaise.toString(),
      undepositedPaise: undepositedPaise.toString(),
    };
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (tab === 'TO_DEPOSIT')         out = out.filter((x) => x.status === 'COMPUTED' || x.status === 'WITHHELD');
    if (tab === 'DEPOSITED')          out = out.filter((x) => x.status === 'DEPOSITED');
    if (tab === 'CERTIFICATE_ISSUED') out = out.filter((x) => x.status === 'CERTIFICATE_ISSUED');
    if (tab === 'REVERSED')           out = out.filter((x) => x.status === 'REVERSED');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((x) =>
        (x.sellerLegalName ?? '').toLowerCase().includes(q)
        || x.sellerId.toLowerCase().includes(q)
        || (x.sellerPanLast4 ?? '').toLowerCase().includes(q)
        || (x.challanReference ?? '').toLowerCase().includes(q)
        || (x.certificateNumber ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, tab, search]);

  const selectableInView = filtered.filter((x) =>
    x.status !== 'REVERSED' && x.status !== 'CERTIFICATE_ISSUED'
  );
  const allChecked = selectableInView.length > 0 && selectableInView.every((x) => selected[x.id]);
  const someChecked = selectableInView.some((x) => selected[x.id]) && !allChecked;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Section 194-O TDS
          <span style={{ fontSize: 14, fontWeight: 500, color: '#7A828F', marginLeft: 8 }}>
            Form 26Q quarterly
          </span>
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Marketplace deducts <strong>1% income tax</strong> (or <strong>5%</strong> when seller has
          no verified PAN) on gross sale value <em>including GST</em>. Filing is quarterly via Form
          26Q; Form 16A is issued to the seller within 15 days of filing.
        </p>
      </div>

      <QuarterControl
        period={filingPeriod}
        onChange={setFilingPeriod}
        onReload={load}
        loading={loading}
      />

      <KpiStrip counts={counts} loading={loading && items.length === 0} />

      {/* Tabs */}
      <div style={{
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <Tabs current={tab} counts={counts} total={items.length} onChange={setTab} />
      </div>

      {/* Search + bulk bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search seller, PAN last 4, challan, certificate…"
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
          <RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}
        </button>
        <a
          href={adminTaxService.form26qCsvUrl(filingPeriod)}
          target="_blank"
          rel="noopener"
          style={btnGhost}
          title="Download Form 26Q CSV — import into NSDL RPU"
        >
          <DownloadIcon /> Form 26Q CSV
        </a>
      </div>

      {selectedIds.length > 0 && (
        <SelectionBar
          count={selectedIds.length}
          onClear={() => setSelected({})}
          onDeposit={() => setBulkModal('deposit')}
          onCertificate={() => setBulkModal('certificate')}
        />
      )}

      {msg && <Banner msg={msg} onClose={() => setMsg(null)} />}

      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && items.length === 0 ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} period={filingPeriod} hasSearch={Boolean(search.trim())} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ ...th, width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={(e) => {
                      const next: Record<string, boolean> = { ...selected };
                      if (e.target.checked) {
                        for (const x of selectableInView) next[x.id] = true;
                      } else {
                        for (const x of selectableInView) delete next[x.id];
                      }
                      setSelected(next);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={th}>Seller</th>
                <th style={th}>Status</th>
                <th style={th}>PAN</th>
                <th style={{ ...th, textAlign: 'right' }}>Sale & rate</th>
                <th style={{ ...th, textAlign: 'right' }}>TDS</th>
                <th style={th}>Challan</th>
                <th style={th}>Form 16A</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <Row
                  key={t.id}
                  item={t}
                  checked={Boolean(selected[t.id])}
                  selectable={t.status !== 'REVERSED' && t.status !== 'CERTIFICATE_ISSUED'}
                  onToggle={(checked) => setSelected((prev) => ({ ...prev, [t.id]: checked }))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {items.length} loaded · filing period {filingPeriod}
      </p>

      {bulkModal === 'deposit' && (
        <BulkInputModal
          title="Mark as DEPOSITED"
          desc={`Logs the NSDL/TIN-Protean challan reference against ${selectedIds.length} TDS row${selectedIds.length === 1 ? '' : 's'} and moves them to DEPOSITED.`}
          label="Challan reference"
          placeholder="e.g. 0001234567 (NSDL / TIN-Protean)"
          confirmLabel="Mark DEPOSITED"
          confirmTone="primary"
          onClose={() => setBulkModal(null)}
          onSubmit={async (ref) => {
            try {
              const res = await adminTaxService.markTdsDeposited(selectedIds, ref);
              setMsg({ kind: 'ok', text: `${res.data?.flipped ?? 0} of ${res.data?.requested ?? 0} row(s) marked DEPOSITED.` });
              setBulkModal(null);
              await load();
            } catch (err: any) {
              setMsg({ kind: 'err', text: err?.message ?? 'Failed' });
            }
          }}
        />
      )}

      {bulkModal === 'certificate' && (
        <BulkInputModal
          title="Mark CERTIFICATE_ISSUED"
          desc={`Records the Form 16A certificate number against ${selectedIds.length} row${selectedIds.length === 1 ? '' : 's'} and moves them to CERTIFICATE_ISSUED. Sellers must receive their Form 16A within 15 days of filing.`}
          label="Form 16A certificate number"
          placeholder="e.g. ABCD1234"
          confirmLabel="Mark CERTIFICATE_ISSUED"
          confirmTone="success"
          onClose={() => setBulkModal(null)}
          onSubmit={async (num) => {
            try {
              const res = await adminTaxService.markTdsCertificateIssued(selectedIds, num);
              setMsg({ kind: 'ok', text: `${res.data?.flipped ?? 0} of ${res.data?.requested ?? 0} row(s) marked CERTIFICATE_ISSUED.` });
              setBulkModal(null);
              await load();
            } catch (err: any) {
              setMsg({ kind: 'err', text: err?.message ?? 'Failed' });
            }
          }}
        />
      )}
    </div>
  );
}

// ── Quarter control ───────────────────────────────────────────────

function QuarterControl({
  period, onChange, onReload, loading,
}: {
  period: string;
  onChange: (p: string) => void;
  onReload: () => Promise<void>;
  loading: boolean;
}) {
  const options = recentQuarters(8);
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, marginBottom: 16,
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={kpiLabel}>Filing period</div>
        <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: '#0F1115' }}>
          {period} <span style={{ fontWeight: 500, color: '#525A65', fontSize: 13 }}>· {periodHumanLabel(period)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={options.includes(period) ? period : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          style={{ ...input, height: 36, minWidth: 140 }}
        >
          <option value="">Pick a quarter…</option>
          {options.map((q) => (
            <option key={q} value={q}>{q} · {periodHumanLabel(q)}</option>
          ))}
        </select>
        <input
          value={period}
          onChange={(e) => onChange(e.target.value)}
          placeholder="2026-Q3"
          style={{ ...input, height: 36, width: 110 }}
        />
        <button onClick={() => void onReload()} style={btnPrimary} disabled={loading || !period}>
          {loading ? 'Loading…' : 'Load quarter'}
        </button>
      </div>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: {
    toDeposit: number; deposited: number; certIssued: number;
    highRate: number; totalTdsPaise: string; undepositedPaise: string;
  };
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="To deposit"
        value={counts.toDeposit.toLocaleString('en-IN')}
        tone={counts.toDeposit > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint={`₹${paiseToRupees(counts.undepositedPaise)} pending challan.`} />
      <Kpi label="Deposited"
        value={counts.deposited.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Challan filed — Form 16A pending." />
      <Kpi label="Form 16A issued"
        value={counts.certIssued.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Certificate sent to the seller." />
      <Kpi label="High-rate sellers"
        value={counts.highRate.toLocaleString('en-IN')}
        tone={counts.highRate > 0 ? 'danger' : 'muted'}
        loading={loading}
        hint="5% rate (no verified PAN) — chase for PAN to drop to 1%." />
      <Kpi label="Quarter TDS"
        value={`₹${paiseToRupees(counts.totalTdsPaise)}`}
        tone="neutral" loading={loading}
        hint="Total TDS across active rows (excludes reversed)." />
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
    toDeposit: number; deposited: number; certIssued: number; reversed: number;
  };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',                label: 'All',                count: total },
    { key: 'TO_DEPOSIT',         label: 'To deposit',         count: counts.toDeposit },
    { key: 'DEPOSITED',          label: 'Deposited',          count: counts.deposited },
    { key: 'CERTIFICATE_ISSUED', label: 'Form 16A issued',    count: counts.certIssued },
    { key: 'REVERSED',           label: 'Reversed',           count: counts.reversed },
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

// ── Selection bar ─────────────────────────────────────────────────

function SelectionBar({
  count, onClear, onDeposit, onCertificate,
}: {
  count: number; onClear: () => void; onDeposit: () => void; onCertificate: () => void;
}) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px', borderRadius: 12,
      background: '#0F1115', color: '#fff',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        {count} row{count === 1 ? '' : 's'} selected
      </span>
      <button onClick={onClear} style={{
        height: 30, padding: '0 12px', background: 'transparent',
        border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
        borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      }}>Clear</button>
      <div style={{ flex: 1 }} />
      <button onClick={onDeposit} style={{
        height: 32, padding: '0 14px',
        background: '#fff', color: '#0F1115',
        border: 'none', borderRadius: 9999,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <FileCheckIcon size={12} /> Mark DEPOSITED
      </button>
      <button onClick={onCertificate} style={{
        height: 32, padding: '0 14px',
        background: '#15803d', color: '#fff',
        border: 'none', borderRadius: 9999,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <CertificateIcon size={12} /> Mark CERTIFICATE_ISSUED
      </button>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function Row({
  item, checked, selectable, onToggle,
}: {
  item: Tds194OLedgerItem;
  checked: boolean;
  selectable: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const highRate = item.tdsRateBps >= 500;
  const ratePct = (item.tdsRateBps / 100).toFixed(item.tdsRateBps % 100 === 0 ? 0 : 1);

  return (
    <tr style={{
      borderTop: '1px solid #F3F4F6',
      background: checked ? '#FAFAFA' : '#fff',
    }}>
      <td style={td}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={!selectable}
          style={{ cursor: selectable ? 'pointer' : 'not-allowed' }}
        />
      </td>

      <td style={td}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {item.sellerLegalName ?? <span style={{ color: '#7A828F' }}>—</span>}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {item.sellerId.slice(0, 8)}…
        </div>
      </td>

      <td style={td}>
        <StatusPill status={item.status} />
      </td>

      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
          {item.sellerPanLast4 ? `••••${item.sellerPanLast4}` : <span style={{ color: '#7A828F', fontFamily: 'inherit' }}>—</span>}
        </div>
        {item.hadVerifiedPan ? (
          <div style={{
            marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, color: '#15803d',
            padding: '2px 7px', borderRadius: 9999, background: '#dcfce7',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <CheckIcon size={10} /> Verified
          </div>
        ) : (
          <div style={{
            marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, color: '#b91c1c',
            padding: '2px 7px', borderRadius: 9999, background: '#fee2e2',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Unverified
          </div>
        )}
      </td>

      <td style={{ ...td, textAlign: 'right' }}>
        <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13, color: '#0F1115' }}>
          ₹{paiseToRupees(item.grossSaleInPaise)}
        </div>
        {item.refundReversalInPaise && BigInt(item.refundReversalInPaise) > BigInt(0) && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            −₹{paiseToRupees(item.refundReversalInPaise)} reversed
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 10, fontWeight: 700,
            padding: '2px 7px', borderRadius: 9999,
            background: highRate ? '#fee2e2' : '#dcfce7',
            color: highRate ? '#b91c1c' : '#15803d',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {ratePct}% rate
          </span>
        </div>
      </td>

      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0F1115' }}>
        ₹{paiseToRupees(item.tdsInPaise)}
      </td>

      <td style={td}>
        {item.challanReference ? (
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
              {item.challanReference}
            </div>
            {item.depositedAt && (
              <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}
                   title={new Date(item.depositedAt).toLocaleString('en-IN')}>
                {relTime(new Date(item.depositedAt))}
              </div>
            )}
            {item.depositedBy && (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
                by {item.depositedBy.slice(0, 8)}…
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
        )}
      </td>

      <td style={td}>
        {item.certificateNumber ? (
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
              {item.certificateNumber}
            </div>
            {item.certificateIssuedAt && (
              <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}
                   title={new Date(item.certificateIssuedAt).toLocaleString('en-IN')}>
                {relTime(new Date(item.certificateIssuedAt))}
              </div>
            )}
            <a
              href={adminTaxService.form16aHtmlUrl(item.id)}
              target="_blank"
              rel="noopener"
              style={{
                marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 600, color: '#0F1115',
                textDecoration: 'none',
                padding: '4px 10px', border: '1px solid #D2D6DC', borderRadius: 9999,
              }}
            >
              <ExternalIcon size={11} /> Open 16A
            </a>
          </div>
        ) : (
          <a
            href={adminTaxService.form16aHtmlUrl(item.id)}
            target="_blank"
            rel="noopener"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600, color: '#525A65',
              textDecoration: 'none',
              padding: '4px 10px', border: '1px solid #E5E7EB', borderRadius: 9999,
            }}
            title="Preview certificate before issuance"
          >
            <ExternalIcon size={11} /> Preview draft
          </a>
        )}
      </td>
    </tr>
  );
}

// ── Status pill ───────────────────────────────────────────────────

function StatusPill({ status }: { status: Tds194OLedgerItem['status'] }) {
  const tone =
    status === 'CERTIFICATE_ISSUED' ? { color: '#15803d', chip: '#dcfce7', label: '16A issued' } :
    status === 'DEPOSITED'          ? { color: '#1d4ed8', chip: '#dbeafe', label: 'Deposited' } :
    status === 'WITHHELD'           ? { color: '#7c3aed', chip: '#ede9fe', label: 'Withheld' } :
    status === 'COMPUTED'           ? { color: '#b45309', chip: '#fef3c7', label: 'Computed' } :
    status === 'REVERSED'           ? { color: '#525A65', chip: '#F3F4F6', label: 'Reversed' } :
                                       { color: '#525A65', chip: '#F3F4F6', label: status };
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

// ── Bulk input modal ──────────────────────────────────────────────

function BulkInputModal({
  title, desc, label, placeholder, confirmLabel, confirmTone,
  onClose, onSubmit,
}: {
  title: string;
  desc: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  confirmTone: 'primary' | 'success';
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    try { await onSubmit(value.trim()); }
    finally { setSubmitting(false); }
  };

  const confirmStyle = confirmTone === 'success' ? {
    background: '#15803d', borderColor: '#15803d',
  } : {
    background: '#0F1115', borderColor: '#0F1115',
  };

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
          maxWidth: 520, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>{title}</h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>{desc}</p>

        <div style={{ marginTop: 16 }}>
          <label style={kpiLabel}>{label} *</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={submitting}
            autoFocus
            style={{ ...input, marginTop: 6 }}
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={submitting} style={btnGhost}>Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !value.trim()}
            style={{
              ...btnPrimaryLarge,
              ...confirmStyle,
              ...(submitting || !value.trim() ? busyStyle : {}),
            }}
          >
            {submitting ? 'Submitting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner ─────────────────────────────────────

function EmptyState({
  tab, period, hasSearch,
}: { tab: Tab; period: string; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No TDS rows match your search.';
  else if (tab === 'TO_DEPOSIT') text = 'Nothing pending deposit for this quarter.';
  else if (tab === 'DEPOSITED') text = 'No rows currently in DEPOSITED state.';
  else if (tab === 'CERTIFICATE_ISSUED') text = 'No Form 16A certificates issued yet.';
  else if (tab === 'REVERSED') text = 'No reversed rows.';
  else text = `No TDS rows for ${period}. Try another quarter or run a settlement cycle approval to compute new rows.`;

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
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 460, margin: '4px auto 0' }}>
        {text}
      </div>
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
          <div style={{ width: 24, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 160, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 90, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
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
function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v13" /><path d="m6 11 6 6 6-6" /><path d="M5 21h14" />
    </svg>
  );
}
function FileCheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" /><path d="m9 14 2 2 4-4" />
    </svg>
  );
}
function CertificateIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="9" r="5" /><path d="m9 13-1 7 4-2 4 2-1-7" />
    </svg>
  );
}
function ExternalIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6" /><path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  let n: bigint;
  try { n = BigInt(p); } catch { return '0.00'; }
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const whole = (abs / HUNDRED).toString();
  const cents = (abs % HUNDRED).toString().padStart(2, '0');
  return (neg ? '-' : '') + formatIndianGrouping(whole) + '.' + cents;
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

// "now" → "YYYY-Qn" (Indian FY quarters): Q1=Apr-Jun, Q2=Jul-Sep,
// Q3=Oct-Dec, Q4=Jan-Mar (of previous FY year).
function currentQuarterIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth();
  const y = ist.getUTCFullYear();
  if (m >= 3 && m <= 5)  return `${y}-Q1`;
  if (m >= 6 && m <= 8)  return `${y}-Q2`;
  if (m >= 9 && m <= 11) return `${y}-Q3`;
  return `${y - 1}-Q4`;
}

// List the N most-recent quarters including the current one.
function recentQuarters(n: number): string[] {
  const out: string[] = [];
  let curr = currentQuarterIst();
  for (let i = 0; i < n; i++) {
    out.push(curr);
    curr = prevQuarter(curr);
  }
  return out;
}
function prevQuarter(q: string): string {
  const [yStr, qStr] = q.split('-');
  const y = parseInt(yStr, 10);
  const qn = parseInt(qStr.replace('Q', ''), 10);
  if (qn === 1) return `${y - 1}-Q4`;
  return `${y}-Q${qn - 1}`;
}

function periodHumanLabel(q: string): string {
  const [yStr, qStr] = q.split('-');
  const y = parseInt(yStr, 10);
  const qn = parseInt(qStr.replace('Q', ''), 10);
  if (qn === 1) return `Apr–Jun ${y}`;
  if (qn === 2) return `Jul–Sep ${y}`;
  if (qn === 3) return `Oct–Dec ${y}`;
  if (qn === 4) return `Jan–Mar ${y + 1}`;
  return q;
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
  outline: 'none', background: '#fff', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnPrimaryLarge: React.CSSProperties = {
  height: 36, padding: '0 16px',
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
  textDecoration: 'none',
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
