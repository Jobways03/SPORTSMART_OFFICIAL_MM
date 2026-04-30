'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, formatINR } from '../../../lib/api';

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
      <div style={{ maxWidth: 760 }}>
        <div style={{ height: 36, width: 200, background: '#f1f5f9', borderRadius: 8, marginBottom: 8 }} />
        <div style={{ height: 14, width: 480, background: '#f1f5f9', borderRadius: 6, marginBottom: 24 }} />
        <div style={{ height: 280, background: '#f1f5f9', borderRadius: 12 }} />
      </div>
    );
  }

  // Validate + coerce. Rejects on impossible values (negative, NaN,
  // > 100% rates) before the round-trip so the admin gets immediate
  // feedback instead of a server-side 400.
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
    <div style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            Settings
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            {editing
              ? 'Changes apply immediately to every active affiliate. Per-affiliate overrides still win where set.'
              : 'Platform-wide defaults that apply when an individual affiliate has no override.'}
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={btnPrimary}>
            Edit settings
          </button>
        )}
      </header>

      {savedFlash && !editing && (
        <div role="status" style={successBanner}>
          ✓ Settings saved.
        </div>
      )}

      {!editing && settings.updatedAt && (
        <div style={metaLine}>
          Last updated {formatDateTime(settings.updatedAt)}
          {settings.updatedById && ` · by admin ${settings.updatedById.slice(0, 8)}…`}
        </div>
      )}

      <form onSubmit={handleSave}>
        <Section title="Commission">
          <RowEditable
            label="Default commission rate"
            help="Applies to affiliates without a per-affiliate override."
            editing={editing}
            unit="% of post-discount subtotal"
            value={form.defaultCommissionPercentage}
            onChange={(v) => setForm({ ...form, defaultCommissionPercentage: v })}
            display={`${settings.defaultCommissionPercentage}% of post-discount subtotal`}
            inputType="number"
            step="0.5"
            min={0}
            max={100}
          />
          <RowReadOnly
            label="Per-affiliate override"
            value="Set on the affiliate's Manage modal — overrides this default for that affiliate only."
            subtle
            last
          />
        </Section>

        <Section title="Return window (PENDING → CONFIRMED)">
          <RowEditable
            label="Default window"
            help="Time after delivery before a commission auto-confirms (refunds inside this window kill the commission)."
            editing={editing}
            unit="days after delivery"
            value={form.returnWindowDays}
            onChange={(v) => setForm({ ...form, returnWindowDays: v })}
            display={`${settings.returnWindowDays} day${settings.returnWindowDays === 1 ? '' : 's'} after delivery`}
            inputType="number"
            step="1"
            min={0}
            max={365}
          />
          <RowReadOnly
            label="Confirmation cron"
            value="Sweeps every 60s — flips eligible PENDING commissions to CONFIRMED automatically."
            subtle
            last
          />
        </Section>

        <Section title="Payouts">
          <RowEditable
            label="Minimum payout balance"
            help="Affiliates must have at least this CONFIRMED balance to request a payout."
            editing={editing}
            unit="₹"
            unitPosition="prefix"
            value={form.minimumPayoutAmount}
            onChange={(v) => setForm({ ...form, minimumPayoutAmount: v })}
            display={formatINR(settings.minimumPayoutAmount)}
            inputType="number"
            step="50"
            min={0}
          />
          <RowEditable
            label="Reversal-balance grace"
            help="Window after payout where a refund still claws back commission, netted into the next payout."
            editing={editing}
            unit="days"
            value={form.commissionReversalWindowDays}
            onChange={(v) => setForm({ ...form, commissionReversalWindowDays: v })}
            display={`${settings.commissionReversalWindowDays} day${settings.commissionReversalWindowDays === 1 ? '' : 's'}`}
            inputType="number"
            step="1"
            min={0}
            max={365}
            last
          />
        </Section>

        <Section title="TDS (Section 194H)">
          <RowEditable
            label="TDS rate"
            help="Standard §194H rate is 10%. Change only if the law changes."
            editing={editing}
            unit="% on the slice above the FY threshold"
            value={form.tdsRate}
            onChange={(v) => setForm({ ...form, tdsRate: v })}
            display={`${settings.tdsRate}% on the slice above the FY threshold`}
            inputType="number"
            step="0.5"
            min={0}
            max={100}
          />
          <RowEditable
            label="FY threshold"
            help="Cumulative annual gross above which TDS kicks in. Statutory floor is ₹15,000 / FY."
            editing={editing}
            unit="₹"
            unitPosition="prefix"
            value={form.tdsThresholdPerFY}
            onChange={(v) => setForm({ ...form, tdsThresholdPerFY: v })}
            display={formatINR(settings.tdsThresholdPerFY)}
            inputType="number"
            step="500"
            min={0}
          />
          <RowReadOnly
            label="Auto-deduction"
            value="Applied at payout-request time; in-flight requests counted against threshold to prevent double-claim."
            subtle
            last
          />
        </Section>

        {editing && (
          <>
            {saveError && (
              <div role="alert" style={errorBanner}>
                {saveError}
              </div>
            )}
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                background: '#fff',
                borderTop: '1px solid #e2e8f0',
                padding: '14px 0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 12,
              }}
            >
              <button type="button" onClick={handleCancel} disabled={saving} style={btnGhost}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !isDirty}
                style={{ ...btnPrimary, opacity: saving || !isDirty ? 0.5 : 1, cursor: saving || !isDirty ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : isDirty ? 'Save changes' : 'No changes'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <header style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
          {title}
        </h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function RowEditable({
  label,
  help,
  editing,
  unit,
  unitPosition = 'suffix',
  value,
  onChange,
  display,
  inputType,
  step,
  min,
  max,
  last,
}: {
  label: string;
  help?: string;
  editing: boolean;
  unit: string;
  unitPosition?: 'prefix' | 'suffix';
  value: string;
  onChange: (next: string) => void;
  display: string;
  inputType: string;
  step?: string;
  min?: number;
  max?: number;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 16,
        padding: '12px 18px',
        borderBottom: last ? 'none' : '1px solid #f1f5f9',
        fontSize: 13,
        alignItems: editing ? 'flex-start' : 'center',
      }}
    >
      <div style={{ color: '#64748b', fontWeight: 500 }}>
        {label}
        {editing && help && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: 400, lineHeight: 1.5 }}>
            {help}
          </div>
        )}
      </div>
      <div style={{ color: '#0f172a' }}>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {unitPosition === 'prefix' && <span style={unitText}>{unit}</span>}
            <input
              type={inputType}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              step={step}
              min={min}
              max={max}
              required
              style={{
                ...inputStyle,
                width: 140,
                fontFamily: 'ui-monospace, Menlo, monospace',
                textAlign: 'right',
              }}
            />
            {unitPosition === 'suffix' && <span style={unitText}>{unit}</span>}
          </div>
        ) : (
          display
        )}
      </div>
    </div>
  );
}

function RowReadOnly({ label, value, subtle, last }: { label: string; value: string; subtle?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 16,
        padding: '12px 18px',
        borderBottom: last ? 'none' : '1px solid #f1f5f9',
        fontSize: 13,
      }}
    >
      <div style={{ color: '#64748b', fontWeight: 500 }}>{label}</div>
      <div style={{ color: subtle ? '#64748b' : '#0f172a', fontWeight: subtle ? 400 : 500, lineHeight: 1.55 }}>
        {value}
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const unitText: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
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

const errorBanner: React.CSSProperties = {
  padding: '10px 14px',
  marginTop: 12,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 13,
  color: '#991b1b',
};

const metaLine: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
  marginBottom: 12,
};
