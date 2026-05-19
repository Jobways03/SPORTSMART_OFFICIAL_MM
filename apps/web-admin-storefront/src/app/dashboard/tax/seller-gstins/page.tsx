'use client';

// Phase 35 GST — Seller GSTIN verification admin panel.
//
// Lists every SellerGstin row and lets ops run it against the GSTN
// portal via the active GSTN_PROVIDER (stub today; sandbox once CBIC
// credentials are issued). The verifyAt / verifiedBy / verificationNotes
// columns are stamped on the row after a successful run.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  SellerGstinItem,
  GstnVerifyOutcome,
} from '@/services/admin-tax.service';

type Tab = 'ALL' | 'UNVERIFIED' | 'VERIFIED' | 'MISMATCH';

// ── Page ──────────────────────────────────────────────────────────

export default function SellerGstinsPage() {
  const [tab, setTab] = useState<Tab>('UNVERIFIED');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SellerGstinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastOutcomes, setLastOutcomes] = useState<Record<string, GstnVerifyOutcome>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listSellerGstins();
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const verify = async (id: string) => {
    setBusy(id);
    try {
      const res = await adminTaxService.verifySellerGstin(id);
      const outcome = res.data;
      if (outcome) {
        setLastOutcomes((prev) => ({ ...prev, [id]: outcome }));
        setMsg({
          kind: outcome.verified ? 'ok' : 'err',
          text: outcome.verified
            ? `Verified via GSTN — status ${outcome.status}.`
            : `Not verified — status ${outcome.status}${outcome.legalNameMismatch ? ' (legal-name mismatch)' : ''}.`,
        });
      }
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Verify failed' });
    } finally { setBusy(null); }
  };

  // ── Derivations ────────────────────────────────────────

  const counts = useMemo(() => {
    const verified = items.filter((g) => g.verifiedAt).length;
    const unverified = items.length - verified;
    const mismatch = items.filter((g) => lastOutcomes[g.id]?.legalNameMismatch).length;
    const primary = items.filter((g) => g.isPrimary).length;
    return { verified, unverified, mismatch, primary };
  }, [items, lastOutcomes]);

  const filtered = useMemo(() => {
    let out = items;
    if (tab === 'VERIFIED') out = out.filter((g) => Boolean(g.verifiedAt));
    if (tab === 'UNVERIFIED') out = out.filter((g) => !g.verifiedAt);
    if (tab === 'MISMATCH') out = out.filter((g) => lastOutcomes[g.id]?.legalNameMismatch);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((g) =>
        g.gstin.toLowerCase().includes(q)
        || g.legalName.toLowerCase().includes(q)
        || (g.seller?.sellerShopName ?? '').toLowerCase().includes(q)
        || (g.seller?.sellerName ?? '').toLowerCase().includes(q)
        || g.sellerId.toLowerCase().includes(q)
        || g.stateCode.toLowerCase().includes(q)
      );
    }
    // Sort: unverified first, then by createdAt desc
    out = [...out].sort((a, b) => {
      const av = a.verifiedAt ? 1 : 0;
      const bv = b.verifiedAt ? 1 : 0;
      if (av !== bv) return av - bv;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return out;
  }, [items, tab, search, lastOutcomes]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Seller GSTIN verification
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760, lineHeight: 1.5 }}>
          Run each seller's GSTIN against the GSTN portal before it appears on a Tax Invoice.
          Verification stamps the row with status, legal name match, and the admin who ran it.
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
            placeholder="Search GSTIN, legal name, seller, state…"
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
                <th style={th}>Seller</th>
                <th style={th}>GSTIN & legal name</th>
                <th style={th}>State</th>
                <th style={th}>Registration</th>
                <th style={th}>Verification</th>
                <th style={th}>Last note</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <Row
                  key={g.id}
                  item={g}
                  busy={busy === g.id}
                  outcome={lastOutcomes[g.id]}
                  onVerify={() => void verify(g.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {filtered.length} of {items.length} loaded · sorted unverified first
      </p>
    </div>
  );
}

// ── Provider banner ───────────────────────────────────────────────

function ProviderBanner() {
  return (
    <div style={{
      marginBottom: 16, padding: '10px 14px', borderRadius: 12, fontSize: 12,
      border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e',
      display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1.5,
    }}>
      <InfoIcon size={16} />
      <span>
        <strong>Stub provider active.</strong> Verification derives from local Mod-36 checksum.
        Real GSTN sandbox adapter lands when CBIC credentials are issued — flip{' '}
        <code style={mono}>GSTN_PROVIDER=sandbox</code> to switch.
      </span>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  counts, loading,
}: {
  counts: { verified: number; unverified: number; mismatch: number; primary: number };
  loading: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Unverified"
        value={counts.unverified.toLocaleString('en-IN')}
        tone={counts.unverified > 0 ? 'danger' : 'success'}
        loading={loading}
        hint="Won't appear on Tax Invoices until verified." />
      <Kpi label="Verified"
        value={counts.verified.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Confirmed against the GSTN portal." />
      <Kpi label="Legal-name mismatches"
        value={counts.mismatch.toLocaleString('en-IN')}
        tone={counts.mismatch > 0 ? 'warning' : 'muted'}
        loading={loading}
        hint="Portal name differs from local — needs reconciliation." />
      <Kpi label="Primary GSTINs"
        value={counts.primary.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Default GSTIN used on invoices when seller has multiple." />
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
  counts: { verified: number; unverified: number; mismatch: number };
  total: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'UNVERIFIED', label: 'Unverified', count: counts.unverified },
    { key: 'VERIFIED',   label: 'Verified',   count: counts.verified },
    { key: 'MISMATCH',   label: 'Mismatch',   count: counts.mismatch },
    { key: 'ALL',        label: 'All',        count: total },
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
  item, busy, outcome, onVerify,
}: {
  item: SellerGstinItem;
  busy: boolean;
  outcome: GstnVerifyOutcome | undefined;
  onVerify: () => void;
}) {
  const verified = Boolean(item.verifiedAt);
  const mismatch = outcome?.legalNameMismatch === true;
  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1115' }}>
          {item.seller?.sellerShopName ?? item.seller?.sellerName ?? '—'}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {item.sellerId.slice(0, 8)}…
        </div>
        {item.isPrimary && (
          <div style={{
            marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, color: '#1d4ed8',
            padding: '2px 8px', borderRadius: 9999, background: '#dbeafe',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <StarIcon size={11} /> Primary
          </div>
        )}
      </td>

      <td style={td}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600, color: '#0F1115', letterSpacing: '0.02em' }}>
          {item.gstin}
        </div>
        <div style={{ fontSize: 12, color: '#525A65', marginTop: 2, maxWidth: 280 }}>
          {item.legalName}
        </div>
      </td>

      <td style={td}>
        <div style={{ fontSize: 13, color: '#0F1115', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {item.stateCode}
        </div>
        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          {STATE_NAMES[item.stateCode] ?? '—'}
        </div>
      </td>

      <td style={td}>
        <RegistrationPill reg={item.registrationType} />
      </td>

      <td style={td}>
        <VerificationCell item={item} mismatch={mismatch} />
      </td>

      <td style={{ ...td, maxWidth: 320, color: '#525A65', fontSize: 12, lineHeight: 1.45 }}>
        {outcome ? (
          <div>
            <div>{outcome.notes}</div>
            {outcome.legalNameMismatch && (
              <div style={{
                marginTop: 6, padding: '6px 8px',
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
                fontSize: 11, color: '#b91c1c', lineHeight: 1.45,
              }}>
                Portal name differs from local{outcome.legalName ? `: "${outcome.legalName}"` : ''}.
              </div>
            )}
          </div>
        ) : item.verificationNotes ? (
          <div>{item.verificationNotes}</div>
        ) : (
          <span style={{ color: '#7A828F' }}>—</span>
        )}
      </td>

      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button
          onClick={onVerify}
          disabled={busy}
          style={busy
            ? { ...(verified ? btnSecondary : btnPrimary), ...busyStyle }
            : (verified ? btnSecondary : btnPrimary)}
        >
          {busy ? (
            <>Verifying…</>
          ) : verified ? (
            <><RefreshIcon size={12} /> Re-verify</>
          ) : (
            <><ShieldCheckIcon size={12} /> Verify with GSTN</>
          )}
        </button>
      </td>
    </tr>
  );
}

function VerificationCell({
  item, mismatch,
}: { item: SellerGstinItem; mismatch: boolean }) {
  if (!item.verifiedAt) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 22, padding: '0 10px', borderRadius: 9999,
        background: '#fef3c7', color: '#b45309',
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#b45309' }} />
        Unverified
      </span>
    );
  }
  return (
    <div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 22, padding: '0 10px', borderRadius: 9999,
        background: mismatch ? '#fee2e2' : '#dcfce7',
        color: mismatch ? '#b91c1c' : '#15803d',
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: mismatch ? '#b91c1c' : '#15803d' }} />
        {mismatch ? 'Mismatch' : 'Verified'}
      </span>
      <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4 }}
           title={new Date(item.verifiedAt).toLocaleString('en-IN')}>
        {relTime(new Date(item.verifiedAt))}
      </div>
      {item.verifiedBy && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
          by {item.verifiedBy.slice(0, 8)}…
        </div>
      )}
    </div>
  );
}

function RegistrationPill({ reg }: { reg: string }) {
  const tone =
    reg === 'REGULAR'      ? { color: '#1d4ed8', chip: '#dbeafe' } :
    reg === 'COMPOSITION'  ? { color: '#b45309', chip: '#fef3c7' } :
    reg === 'CASUAL'       ? { color: '#7c3aed', chip: '#ede9fe' } :
    reg === 'NON_RESIDENT' ? { color: '#9a3412', chip: '#ffedd5' } :
                              { color: '#525A65', chip: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {reg.replace(/_/g, ' ')}
    </span>
  );
}

// ── Empty / skeleton / banner ─────────────────────────────────────

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  let text: string;
  if (hasSearch) text = 'No seller GSTINs match your search.';
  else if (tab === 'UNVERIFIED') text = 'Every seller GSTIN is verified. Nothing to chase.';
  else if (tab === 'VERIFIED') text = 'No verified GSTINs yet.';
  else if (tab === 'MISMATCH') text = 'No legal-name mismatches recorded in this session.';
  else text = 'No seller GSTINs on file yet.';

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <ShieldCheckIcon size={20} />
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
          <div style={{ width: 200, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 60, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ flex: 1, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 140, height: 32, background: '#F3F4F6', borderRadius: 9999 }} />
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

// ── Indian state codes ────────────────────────────────────────────

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

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
function ShieldCheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function StarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
         stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 2 3 7 7 .8-5 5 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.8 9 9z" />
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
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: 11,
  padding: '1px 4px', background: '#fef3c7', borderRadius: 4,
};
const btnPrimary: React.CSSProperties = {
  height: 32, padding: '0 14px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};
const btnSecondary: React.CSSProperties = {
  height: 32, padding: '0 14px',
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
