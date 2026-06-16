'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, formatINR } from '../../../lib/api';
import { filterAmountInput, filterIntegerInput, validateAmount } from '../../../lib/validators';

interface Settings {
  defaultCommissionPercentage: number;
  minimumPayoutAmount: number;
  returnWindowDays: number;
  tdsRate: number;
  tdsThresholdPerFY: number;
  commissionReversalWindowDays: number;
  updatedAt?: string | null;
  updatedById?: string | null;
  editable: boolean;
}

interface FormState {
  defaultCommissionPercentage: string;
  minimumPayoutAmount: string;
  returnWindowDays: string;
  tdsRate: string;
  tdsThresholdPerFY: string;
  commissionReversalWindowDays: string;
}

const formFromSettings = (s: Settings): FormState => ({
  defaultCommissionPercentage: String(s.defaultCommissionPercentage),
  minimumPayoutAmount: String(s.minimumPayoutAmount),
  returnWindowDays: String(s.returnWindowDays),
  tdsRate: String(s.tdsRate),
  tdsThresholdPerFY: String(s.tdsThresholdPerFY),
  commissionReversalWindowDays: String(s.commissionReversalWindowDays),
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    apiFetch<Settings>('/admin/affiliates/reports/settings')
      .then((s) => {
        setSettings(s);
        setForm(formFromSettings(s));
      })
      .catch((e) => setLoadError(e?.message ?? 'Could not load settings.'));
  }, []);

  if (loadError) return <p style={{ color: '#b91c1c' }}>{loadError}</p>;
  if (!settings || !form) {
    return (
      <div style={{ maxWidth: 980, marginInline: 'auto' }}>
        <div style={{ height: 120, background: '#f1f5f9', borderRadius: 14, marginBottom: 16 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 200, background: '#f1f5f9', borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  const coerceForPatch = (): { ok: true; patch: Partial<Record<keyof FormState, number>> } | { ok: false; error: string } => {
    const patch: Partial<Record<keyof FormState, number>> = {};
    const fields: Array<{
      key: keyof FormState;
      label: string;
      kind: 'percent' | 'currency' | 'days';
    }> = [
      { key: 'defaultCommissionPercentage', label: 'Commission rate', kind: 'percent' },
      { key: 'minimumPayoutAmount', label: 'Minimum payout', kind: 'currency' },
      { key: 'returnWindowDays', label: 'Return window', kind: 'days' },
      { key: 'tdsRate', label: 'TDS rate', kind: 'percent' },
      { key: 'tdsThresholdPerFY', label: 'TDS threshold', kind: 'currency' },
      { key: 'commissionReversalWindowDays', label: 'Reversal window', kind: 'days' },
    ];
    for (const { key, label, kind } of fields) {
      const original = (settings as any)[key];
      const raw = form[key].trim();
      if (raw === '') return { ok: false, error: `${label} can't be empty.` };
      const num = Number(raw);
      if (!Number.isFinite(num)) return { ok: false, error: `${label} must be a number.` };
      if (num < 0) return { ok: false, error: `${label} can't be negative.` };
      if (kind === 'percent' && num > 100) return { ok: false, error: `${label} can't exceed 100%.` };
      if (kind === 'currency') {
        // Cap money-into-ledger floors/thresholds at a sane ledger maximum.
        const amountErr = validateAmount(raw, { min: 0, max: 10_000_000, decimals: 2, label });
        if (amountErr) return { ok: false, error: amountErr };
      }
      if (kind === 'days') {
        if (!Number.isInteger(num)) return { ok: false, error: `${label} must be a whole number of days.` };
        if (num > 365) return { ok: false, error: `${label} can't exceed 365 days.` };
      }
      if (num !== Number(original)) patch[key] = num;
    }
    return { ok: true, patch };
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError('');
    const result = coerceForPatch();
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<Settings>('/admin/affiliates/reports/settings', {
        method: 'PATCH',
        body: JSON.stringify(result.patch),
      });
      setSettings(updated);
      setForm(formFromSettings(updated));
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(formFromSettings(settings));
    setSaveError('');
    setEditing(false);
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(formFromSettings(settings));

  return (
    <div style={{ maxWidth: 980, marginInline: 'auto', paddingBottom: editing ? 100 : 0 }}>
      {/* ── Hero ────────────────────────────────────────────── */}
      <header
        style={{
          position: 'relative',
          padding: '26px 28px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #312e81 100%)',
          color: '#fff',
          borderRadius: 16,
          marginBottom: 22,
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: -50,
            top: -50,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6 }}>
              Affiliate Program
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Platform settings
            </h1>
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '8px 0 0', maxWidth: 540, lineHeight: 1.55 }}>
              {editing
                ? 'Changes apply instantly to every active affiliate. Per-affiliate overrides still win where set.'
                : 'Defaults applied when an individual affiliate has no override. Edit with care — these values are baked into commission calculations.'}
            </p>
            {!editing && settings.updatedAt && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(255,255,255,0.06)', borderRadius: 999 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                Last updated {formatDateTime(settings.updatedAt)}
                {settings.updatedById && ` · admin ${settings.updatedById.slice(0, 8)}…`}
              </div>
            )}
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)} style={btnHero}>
              Edit settings
            </button>
          )}
          {editing && (
            <span style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: '#fbbf24', color: '#451a03', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Editing
            </span>
          )}
        </div>
      </header>

      {savedFlash && !editing && (
        <div role="status" style={successBanner}>
          ✓ Settings saved.
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* ── Commission ─────────────────────────────────── */}
        <Group
          icon="💸"
          accent="#1d4ed8"
          accentSoft="#dbeafe"
          title="Commission"
          subtitle="The lever that drives everything. Affiliates earn this share of every order's post-discount subtotal."
        >
          <SettingTile
            label="Default rate"
            help="Used when an affiliate has no per-affiliate override on their Manage modal."
            unit="%"
            unitPosition="suffix"
            displayValue={`${settings.defaultCommissionPercentage}`}
            displaySuffix="%"
            editing={editing}
            value={form.defaultCommissionPercentage}
            onChange={(v) => setForm({ ...form, defaultCommissionPercentage: filterAmountInput(v, 2) })}
            inputType="number"
            step="0.5"
            min={0}
            max={100}
            tone="info"
          />
          <Aside>
            Per-affiliate overrides live on the affiliate&rsquo;s <strong>Manage</strong> modal and always win. The default below is the floor for everyone else.
          </Aside>
        </Group>

        {/* ── Return window ──────────────────────────────── */}
        <Group
          icon="⏳"
          accent="#b45309"
          accentSoft="#fef3c7"
          title="Return window"
          subtitle="How long after delivery a commission stays PENDING before auto-confirming."
        >
          <SettingTile
            label="Window after delivery"
            help="Refunds inside this window kill the commission. After it closes, the cron flips PENDING → CONFIRMED."
            unit="days"
            unitPosition="suffix"
            displayValue={`${settings.returnWindowDays}`}
            displaySuffix={`day${settings.returnWindowDays === 1 ? '' : 's'}`}
            editing={editing}
            value={form.returnWindowDays}
            onChange={(v) => setForm({ ...form, returnWindowDays: filterIntegerInput(v) })}
            inputType="number"
            step="1"
            min={0}
            max={365}
            tone="warning"
          />
          <Aside>
            Confirmation cron sweeps every <strong>60s</strong>. As soon as <code style={codeStyle}>returnWindowEndsAt &lt; now</code> and the commission is still PENDING, it flips to CONFIRMED.
          </Aside>
        </Group>

        {/* ── Payouts ─────────────────────────────────────── */}
        <Group
          icon="🏦"
          accent="#15803d"
          accentSoft="#dcfce7"
          title="Payouts"
          subtitle="Floors and grace windows that gate when affiliates can withdraw and how late refunds claw back."
        >
          <div style={tileGrid}>
            <SettingTile
              label="Minimum balance"
              help="Affiliates need at least this CONFIRMED balance to request a payout."
              unit="₹"
              unitPosition="prefix"
              displayValue={formatINR(settings.minimumPayoutAmount)}
              editing={editing}
              value={form.minimumPayoutAmount}
              onChange={(v) => setForm({ ...form, minimumPayoutAmount: filterAmountInput(v, 2) })}
              inputType="number"
              step="50"
              min={0}
              tone="success"
            />
            <SettingTile
              label="Reversal grace"
              help="Window after payout where a late refund still claws back, netted into the next payout."
              unit="days"
              unitPosition="suffix"
              displayValue={`${settings.commissionReversalWindowDays}`}
              displaySuffix={`day${settings.commissionReversalWindowDays === 1 ? '' : 's'}`}
              editing={editing}
              value={form.commissionReversalWindowDays}
              onChange={(v) => setForm({ ...form, commissionReversalWindowDays: filterIntegerInput(v) })}
              inputType="number"
              step="1"
              min={0}
              max={365}
              tone="success"
            />
          </div>
        </Group>

        {/* ── TDS (Regulatory) ────────────────────────────── */}
        <Group
          icon="📋"
          accent="#475569"
          accentSoft="#f1f5f9"
          title="TDS · Section 194H"
          subtitle="Indian tax — withhold on commission once the FY threshold is crossed. Change only if the law changes."
          regulatory
        >
          <div style={tileGrid}>
            <SettingTile
              label="TDS rate"
              help="Statutory §194H rate is 10% on the slice above the threshold."
              unit="%"
              unitPosition="suffix"
              displayValue={`${settings.tdsRate}`}
              displaySuffix="%"
              editing={editing}
              value={form.tdsRate}
              onChange={(v) => setForm({ ...form, tdsRate: filterAmountInput(v, 2) })}
              inputType="number"
              step="0.5"
              min={0}
              max={100}
              tone="muted"
            />
            <SettingTile
              label="FY threshold"
              help="Cumulative annual gross above which TDS kicks in. Statutory floor is ₹15,000."
              unit="₹"
              unitPosition="prefix"
              displayValue={formatINR(settings.tdsThresholdPerFY)}
              editing={editing}
              value={form.tdsThresholdPerFY}
              onChange={(v) => setForm({ ...form, tdsThresholdPerFY: filterAmountInput(v, 2) })}
              inputType="number"
              step="500"
              min={0}
              tone="muted"
            />
          </div>
          <Aside>
            Auto-deduction runs at <strong>payout-request time</strong>. In-flight payout requests count against the FY threshold so the same slice can&rsquo;t be claimed twice.
          </Aside>
        </Group>

        {/* ── Sticky save bar ────────────────────────────── */}
        {editing && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              left: 0,
              right: 0,
              background: '#fff',
              borderTop: '1px solid #e2e8f0',
              padding: '14px 18px',
              marginTop: 16,
              borderRadius: 12,
              boxShadow: '0 -8px 20px rgba(15, 23, 42, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 12, color: isDirty ? '#0f172a' : '#94a3b8' }}>
              {saveError ? (
                <span style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ {saveError}</span>
              ) : isDirty ? (
                <>You have unsaved changes.</>
              ) : (
                <>No changes yet.</>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={handleCancel} disabled={saving} style={btnGhost}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !isDirty}
                style={{
                  ...btnPrimary,
                  opacity: saving || !isDirty ? 0.5 : 1,
                  cursor: saving || !isDirty ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : isDirty ? 'Save changes' : 'No changes'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

/* ── Layout primitives ─────────────────────────────────── */

function Group({
  icon,
  accent,
  accentSoft,
  title,
  subtitle,
  regulatory,
  children,
}: {
  icon: string;
  accent: string;
  accentSoft: string;
  title: string;
  subtitle: string;
  regulatory?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: 22,
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: accent,
          opacity: regulatory ? 0.3 : 0.7,
        }}
      />
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: accentSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.01em', color: '#0f172a' }}>
            {title}
            {regulatory && (
              <span style={{ marginLeft: 8, padding: '2px 7px', fontSize: 9, fontWeight: 700, borderRadius: 4, background: '#f1f5f9', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', verticalAlign: 'middle' }}>
                Regulatory
              </span>
            )}
          </h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0', lineHeight: 1.5 }}>
            {subtitle}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}

function SettingTile({
  label,
  help,
  unit,
  unitPosition,
  displayValue,
  displaySuffix,
  editing,
  value,
  onChange,
  inputType,
  step,
  min,
  max,
  tone,
}: {
  label: string;
  help?: string;
  unit: string;
  unitPosition: 'prefix' | 'suffix';
  displayValue: string;
  displaySuffix?: string;
  editing: boolean;
  value: string;
  onChange: (next: string) => void;
  inputType: string;
  step?: string;
  min?: number;
  max?: number;
  tone: 'info' | 'warning' | 'success' | 'muted';
}) {
  const fg =
    tone === 'info' ? '#1d4ed8' :
    tone === 'warning' ? '#b45309' :
    tone === 'success' ? '#15803d' :
    '#475569';

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #f1f5f9',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      {editing ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {unitPosition === 'prefix' && <span style={unitChip}>{unit}</span>}
            <input
              type={inputType}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              step={step}
              min={min}
              max={max}
              required
              style={{
                flex: 1,
                padding: '9px 12px',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                fontSize: 18,
                fontWeight: 600,
                fontFamily: 'ui-monospace, Menlo, monospace',
                outline: 'none',
                color: fg,
                boxSizing: 'border-box',
                width: '100%',
              }}
            />
            {unitPosition === 'suffix' && <span style={unitChip}>{unit}</span>}
          </div>
          {help && <div style={helpText}>{help}</div>}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
              {displayValue}
            </span>
            {displaySuffix && (
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                {displaySuffix}
              </span>
            )}
          </div>
          {help && <div style={helpText}>{help}</div>}
        </>
      )}
    </div>
  );
}

function Aside({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        background: '#eff6ff',
        border: '1px solid #dbeafe',
        borderRadius: 8,
        fontSize: 12,
        color: '#1e3a8a',
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────── */

function formatDateTime(value: string): string {
  const d = new Date(value);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
}

const tileGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const helpText: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
  lineHeight: 1.55,
  marginTop: 2,
};

const codeStyle: React.CSSProperties = {
  background: '#dbeafe',
  padding: '0 5px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, Menlo, monospace',
};

const unitChip: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#64748b',
  padding: '0 4px',
  flexShrink: 0,
};

const btnHero: React.CSSProperties = {
  padding: '10px 20px',
  background: '#fff',
  color: '#0f172a',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '9px 16px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
  cursor: 'pointer',
};

const successBanner: React.CSSProperties = {
  padding: '10px 14px',
  marginBottom: 16,
  background: '#dcfce7',
  border: '1px solid #bbf7d0',
  borderRadius: 8,
  fontSize: 13,
  color: '#15803d',
  fontWeight: 600,
};
