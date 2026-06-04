'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  adminAccountsService,
  formatINR,
  PlatformOverview,
  SellerOverview,
  FranchiseOverview,
  OutstandingPayables,
  TopPerformers,
} from '@/services/admin-accounts.service';

type Tab = 'platform' | 'sellers' | 'franchises';

function monthStartISO(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AccountsOverviewPage() {
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [tab, setTab] = useState<Tab>('platform');
  const [topPage, setTopPage] = useState(1);

  const [platform, setPlatform] = useState<PlatformOverview | null>(null);
  const [sellers, setSellers] = useState<SellerOverview | null>(null);
  const [franchises, setFranchises] = useState<FranchiseOverview | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingPayables | null>(null);
  const [top, setTop] = useState<TopPerformers | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [p, s, f, o, t] = await Promise.all([
        adminAccountsService.getOverview(fromDate, toDate),
        adminAccountsService.getSellers(fromDate, toDate),
        adminAccountsService.getFranchises(fromDate, toDate),
        adminAccountsService.getOutstanding(),
        adminAccountsService.getTopPerformers({ limit: 10, page: topPage, fromDate, toDate }),
      ]);
      if (p.data) setPlatform(p.data);
      if (s.data) setSellers(s.data);
      if (f.data) setFranchises(f.data);
      if (o.data) setOutstanding(o.data);
      if (t.data) setTop(t.data);
      if (!p.success) setErr(p.message || 'Failed to load overview');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load accounts overview');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, topPage]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Accounts overview</h1>
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 14, color: '#525A65' }}>
            Platform-wide revenue, commissions, payables and settlement health.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Field label="From">
            <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="To">
            <input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </div>

      {err && <div style={{ marginTop: 16, color: '#dc2626', fontSize: 13 }}>{err}</div>}

      {/* Outstanding (point-in-time) */}
      {outstanding && (
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi label="Total outstanding (now)" value={formatINR(outstanding.totalOutstanding)} tone="bad" />
          <Kpi label="Seller outstanding" value={formatINR(outstanding.sellerOutstanding.amount)} sub={`${outstanding.sellerOutstanding.count} pending`} />
          <Kpi label="Franchise outstanding" value={formatINR(outstanding.franchiseOutstanding.amount)} sub={`${outstanding.franchiseOutstanding.count} pending`} />
          <Kpi label="Oldest unpaid" value={outstanding.oldestUnpaidDate ? new Date(outstanding.oldestUnpaidDate).toLocaleDateString('en-IN') : '—'} />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, margin: '24px 0 16px' }}>
        {(['platform', 'sellers', 'franchises'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t === 'platform' ? 'Platform' : t === 'sellers' ? 'Sellers' : 'Franchises'}
          </button>
        ))}
      </div>

      {loading && !platform ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : (
        <>
          {tab === 'platform' && platform && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <Kpi label="Gross commission revenue" value={formatINR(platform.totalPlatformRevenue)} />
                <Kpi label="Net revenue (less refunds)" value={formatINR(platform.netPlatformRevenue)} tone="good" sub={`refunds ${formatINR(platform.totalRefundedFromCommission)}`} />
                <Kpi label="Platform commissions" value={formatINR(platform.totalPlatformCommissions)} sub="seller + franchise + procurement" />
                <Kpi label="Tax on commission" value={formatINR(platform.totalTaxOnCommission)} sub="GST/VAT — not revenue" />
                <Kpi label="Seller payables (pending)" value={formatINR(platform.totalSellerPayables)} sub={`${platform.pendingSellerSettlements} settlements`} />
                <Kpi label="Franchise payables (pending)" value={formatINR(platform.totalFranchisePayables)} sub={`${platform.pendingFranchiseSettlements} settlements`} />
                <Kpi label="Settled to sellers (period)" value={formatINR(platform.totalSettledToSellers)} />
                <Kpi label="Settled to franchises (period)" value={formatINR(platform.totalSettledToFranchises)} />
                <Kpi label="Affiliate commission paid" value={formatINR(platform.totalAffiliateCommissionPaid)} />
                <Kpi label="Chargeback exposure" value={formatINR(platform.chargebackExposure)} tone="bad" sub="OPEN + LOST" />
              </div>
              {/* Drill-downs (#14) */}
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <DrillLink href={platform.linkSources.sellerSettlementsUrl}>Seller settlements →</DrillLink>
                <DrillLink href={platform.linkSources.franchiseSettlementsUrl}>Franchise settlements →</DrillLink>
                <DrillLink href={platform.linkSources.commissionRecordsUrl}>Commission records →</DrillLink>
                <DrillLink href={platform.linkSources.refundApprovalsUrl}>Refund approvals →</DrillLink>
              </div>
            </>
          )}

          {tab === 'sellers' && sellers && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <Kpi label="Sellers" value={`${sellers.activeSellers} / ${sellers.totalSellers}`} sub="active / total" />
                <Kpi label="Commission records" value={sellers.totalCommissionRecords.toLocaleString('en-IN')} />
                <Kpi label="Platform amount" value={formatINR(sellers.totalPlatformAmount)} />
                <Kpi label="Platform margin" value={formatINR(sellers.totalPlatformMargin)} tone="good" />
                <Kpi label="Refunded from commission" value={formatINR(sellers.totalRefundedFromCommission)} tone="bad" />
                <Kpi label="Pending settlement" value={formatINR(sellers.pendingSettlementAmount)} />
                <Kpi label="Settled (period)" value={formatINR(sellers.settledAmount)} />
              </div>
              <TopTable
                title="Top sellers"
                rows={(top?.topSellers ?? []).map((s) => ({
                  id: s.sellerId,
                  name: s.sellerName,
                  cols: [s.totalOrders.toLocaleString('en-IN'), formatINR(s.totalRevenue), formatINR(s.platformMargin), `${s.marginPercentage}%`],
                }))}
                headers={['Orders', 'Revenue', 'Margin', 'Margin %']}
                page={top?.page ?? 1}
                onPage={setTopPage}
              />
            </>
          )}

          {tab === 'franchises' && franchises && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <Kpi label="Franchises" value={`${franchises.activeFranchises} / ${franchises.totalFranchises}`} sub="active / total" />
                <Kpi label="Ledger entries" value={franchises.totalLedgerEntries.toLocaleString('en-IN')} />
                <Kpi label="Online-order commission" value={formatINR(franchises.totalOnlineOrderCommission)} />
                <Kpi label="Procurement fees" value={formatINR(franchises.totalProcurementFees)} />
                <Kpi label="Franchise earnings" value={formatINR(franchises.totalFranchiseEarnings)} />
                <Kpi label="Pending settlement" value={formatINR(franchises.pendingSettlementAmount)} />
                <Kpi label="Settled (period)" value={formatINR(franchises.settledAmount)} />
              </div>
              <TopTable
                title="Top franchises"
                rows={(top?.topFranchises ?? []).map((f) => ({
                  id: f.franchiseId,
                  name: f.franchiseName,
                  cols: [f.totalOnlineOrders.toLocaleString('en-IN'), f.totalProcurements.toLocaleString('en-IN'), formatINR(f.totalRevenue), formatINR(f.platformEarning)],
                }))}
                headers={['Online', 'Procurements', 'Revenue', 'Platform earning']}
                page={top?.page ?? 1}
                onPage={setTopPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function TopTable({
  title, rows, headers, page, onPage,
}: {
  title: string;
  rows: Array<{ id: string; name: string; cols: string[] }>;
  headers: string[];
  page: number;
  onPage: (p: number) => void;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F1115', margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
          <span style={{ fontSize: 13, color: '#525A65' }}>Page {page}</span>
          <button onClick={() => onPage(page + 1)} disabled={rows.length < 10} style={pageBtn}>Next →</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>No data for this period.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>Name</th>
                {headers.map((h) => <th key={h} style={{ ...th, textAlign: 'right' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}>{r.name}</td>
                  {r.cols.map((c, i) => <td key={i} style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function DrillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 14px', textDecoration: 'none', background: '#fff' }}>
      {children}
    </Link>
  );
}

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#0F1115' };
const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? '#0F1115' : '#fff',
  color: active ? '#fff' : '#525A65',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  padding: '8px 18px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
});
