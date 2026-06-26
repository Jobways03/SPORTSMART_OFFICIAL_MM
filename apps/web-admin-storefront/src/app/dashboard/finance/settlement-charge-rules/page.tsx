'use client';

// Settlement Charges — super-admin editor for the three statutory settlement
// taxes (commission-GST, §52 TCS, §194-O TDS). Each has an editable RATE (%) and
// — for GST and TDS — a BASE ("levied on": Commission or Price of Goods Sold).
//
// Phase 252 — these settings live in tax_config and are read by the statutory
// engine, so editing them flows to BOTH the seller/franchise payout AND the
// GSTR-8 / Form-26Q / GSTR-1 filings. A CA's "TDS is on commission, not product"
// becomes a dropdown change here — no code release. The deep compliance logic
// (GST CGST/SGST↔IGST split; TDS PAN 1%/5% + ₹5L threshold) stays in code; only
// the rate and base are knobs.
//
// TCS (§52) is statutorily on the taxable value of supplies, so only its rate is
// tunable — its base is shown for transparency, not changed here.

import { useCallback, useEffect, useState } from 'react';
import {
  adminSettlementTaxService as svc,
  type SettlementTaxConfig,
  type TaxBaseType,
} from '@/services/admin-settlement-tax.service';

const BASE_LABEL: Record<TaxBaseType, string> = {
  COMMISSION: 'Commission',
  PRICE_OF_GOODS_SOLD: 'Price of Goods Sold',
  GST: 'GST (commission GST amount) — legacy',
  TAXABLE_SUPPLY: 'Taxable supply (net of GST) — §52 base',
};

// Editable draft: rate as a % string (for the input), base as the enum.
interface Draft {
  gstRatePct: string;
  gstBase: TaxBaseType;
  gstEnabled: boolean;
  tcsRatePct: string;
  tcsBase: TaxBaseType;
  tcsEnabled: boolean;
  tdsRatePct: string;
  tdsBase: TaxBaseType;
  tdsEnabled: boolean;
}

const bpsToPct = (bps: number) => String(bps / 100);
const pctToBps = (pct: string) => Math.round(Number(pct) * 100);

export default function SettlementChargesPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const fromConfig = (c: SettlementTaxConfig): Draft => ({
    gstRatePct: bpsToPct(c.gst.rateBps),
    gstBase: c.gst.baseType,
    gstEnabled: c.gst.enabled,
    tcsRatePct: bpsToPct(c.tcs.rateBps),
    tcsBase: c.tcs.baseType,
    tcsEnabled: c.tcs.enabled,
    tdsRatePct: bpsToPct(c.tds.rateBps),
    tdsBase: c.tds.baseType,
    tdsEnabled: c.tds.enabled,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await svc.get();
      if (res.data) setDraft(fromConfig(res.data));
    } catch (e: any) {
      setLoadErr(e?.body?.message || e?.message || 'Failed to load tax config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSavedAt(null);
  };

  const validPct = (s: string) => s.trim() !== '' && Number(s) >= 0 && Number(s) <= 100;
  const canSave =
    !!draft &&
    !saving &&
    validPct(draft.gstRatePct) &&
    validPct(draft.tcsRatePct) &&
    validPct(draft.tdsRatePct);

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await svc.save({
        gst: { rateBps: pctToBps(draft.gstRatePct), baseType: draft.gstBase, enabled: draft.gstEnabled },
        tcs: { rateBps: pctToBps(draft.tcsRatePct), baseType: draft.tcsBase, enabled: draft.tcsEnabled },
        tds: { rateBps: pctToBps(draft.tdsRatePct), baseType: draft.tdsBase, enabled: draft.tdsEnabled },
      });
      if (res.data) setDraft(fromConfig(res.data));
      setSavedAt(Date.now());
    } catch (e: any) {
      setSaveErr(e?.body?.message || e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: 32, maxWidth: 920 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F1115', margin: 0 }}>
        Settlement Charges
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
        The three taxes deducted during seller / franchise settlement. Editing a
        rate or base applies to <strong>new</strong> settlement cycles and flows
        to both the payout and the GST / TDS filings. Past settlements keep the
        figures they were settled with.
      </p>

      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : loadErr ? (
        <div style={errStyle}>{loadErr}</div>
      ) : draft ? (
        <>
          {/* Commission GST */}
          <TaxCard
            title="Commission GST"
            subtitle="GST the marketplace charges on its commission (SAC 9985). CGST/SGST vs IGST is split automatically by place of supply."
            enabled={draft.gstEnabled}
            onToggle={(v) => set({ gstEnabled: v })}
          >
            <RateField
              value={draft.gstRatePct}
              onChange={(v) => set({ gstRatePct: v })}
            />
            <BaseField
              value={draft.gstBase}
              onChange={(v) => set({ gstBase: v })}
            />
          </TaxCard>

          {/* TCS */}
          <TaxCard
            title="TCS (Section 52)"
            subtitle="Tax Collected at Source, remitted in GSTR-8. Levied on the chosen base — default is the GST amount (“TCS on GST”). Note: §52 statutorily applies to the taxable value of supplies; other bases are a deliberate platform choice."
            enabled={draft.tcsEnabled}
            onToggle={(v) => set({ tcsEnabled: v })}
          >
            <RateField
              value={draft.tcsRatePct}
              onChange={(v) => set({ tcsRatePct: v })}
            />
            <BaseField
              value={draft.tcsBase}
              onChange={(v) => set({ tcsBase: v })}
              includeTaxableSupply
              includeGst
            />
          </TaxCard>

          {/* TDS */}
          <TaxCard
            title="TDS (Section 194-O)"
            subtitle="Tax Deducted at Source, filed in Form 26Q. PAN-based 1% / 5% (§206AA) and the ₹5L threshold are applied automatically; set the standard rate and what it's levied on."
            enabled={draft.tdsEnabled}
            onToggle={(v) => set({ tdsEnabled: v })}
          >
            <RateField
              value={draft.tdsRatePct}
              onChange={(v) => set({ tdsRatePct: v })}
            />
            <BaseField
              value={draft.tdsBase}
              onChange={(v) => set({ tdsBase: v })}
            />
          </TaxCard>

          {saveErr && <div style={{ ...errStyle, marginTop: 16 }}>{saveErr}</div>}

          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              style={{ ...saveBtnStyle, opacity: canSave ? 1 : 0.5 }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {savedAt && (
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>
                Saved — applies to the next settlement cycle.
              </span>
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}

function TaxCard({
  title,
  subtitle,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1115' }}>{title}</div>
          <p style={{ margin: '6px 0 14px', fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: enabled ? '#15803d' : '#9ca3af' }}>
            {enabled ? 'On' : 'Off'}
          </span>
          <Toggle on={enabled} onChange={onToggle} label={title} />
        </div>
      </div>
      {/* When off, the rate/base are preserved but greyed + non-interactive. */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          opacity: enabled ? 1 : 0.4,
          pointerEvents: enabled ? 'auto' : 'none',
        }}
        aria-disabled={!enabled}
      >
        {children}
      </div>
      {!enabled && (
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: '#92400e' }}>
          Off — this tax is not deducted in new settlements and won&apos;t appear in
          payouts or GST / TDS filings. The rate &amp; base are kept for when you turn it back on.
        </div>
      )}
    </section>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${label}`}
      onClick={() => onChange(!on)}
      style={{
        position: 'relative',
        width: 46,
        height: 26,
        flexShrink: 0,
        borderRadius: 999,
        border: 0,
        cursor: 'pointer',
        padding: 0,
        background: on ? '#16a34a' : '#cbd5e1',
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

function RateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label style={fieldStyle}>
      Rate (%)
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

function BaseField({
  value,
  onChange,
  includeGst = false,
  includeTaxableSupply = false,
}: {
  value: TaxBaseType;
  onChange: (v: TaxBaseType) => void;
  includeGst?: boolean;
  // Phase 253 — the §52 TCS base (taxable supply ex-GST); shown for TCS.
  includeTaxableSupply?: boolean;
}) {
  return (
    <label style={fieldStyle}>
      Levied on
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TaxBaseType)}
        style={inputStyle}
      >
        <option value="COMMISSION">{BASE_LABEL.COMMISSION}</option>
        <option value="PRICE_OF_GOODS_SOLD">{BASE_LABEL.PRICE_OF_GOODS_SOLD}</option>
        {includeTaxableSupply && (
          <option value="TAXABLE_SUPPLY">{BASE_LABEL.TAXABLE_SUPPLY}</option>
        )}
        {includeGst && <option value="GST">{BASE_LABEL.GST}</option>}
      </select>
    </label>
  );
}

const sectionStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '16px 20px',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  minWidth: 200,
};
const inputStyle: React.CSSProperties = {
  height: 36,
  padding: '0 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
};
const saveBtnStyle: React.CSSProperties = {
  height: 38,
  padding: '0 18px',
  background: '#0F1115',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  border: 0,
  borderRadius: 8,
  cursor: 'pointer',
};
const emptyStyle: React.CSSProperties = {
  marginTop: 20,
  padding: 24,
  textAlign: 'center',
  background: '#f9fafb',
  border: '1px dashed #d1d5db',
  borderRadius: 8,
  color: '#6b7280',
  fontSize: 13,
};
const errStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '10px 14px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 13,
  color: '#991b1b',
};
