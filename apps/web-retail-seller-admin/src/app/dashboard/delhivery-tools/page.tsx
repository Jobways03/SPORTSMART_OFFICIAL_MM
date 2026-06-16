'use client';

import React, { useState } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — Delhivery operations console.
 * Live tools against Delhivery via /admin/delhivery/*: serviceability,
 * shipping cost, expected TAT, fetch waybills, raise pickup, e-waybill
 * update, shipment edit. Self-contained so it clones across the 4 admin
 * apps unchanged (they all use the same `@/lib/api-client` + admin JWT).
 */

interface ToolField {
  name: string;
  label: string;
  required?: boolean;
  wide?: boolean;
  /** Optional input filter applied as the operator types/pastes. */
  filter?: (value: string) => string;
}

// Per-semantic input filters for the operations fields.
const digits = (max: number) => (v: string) => v.replace(/\D/g, '').slice(0, max);
const pincodeFilter = digits(6);
const mobileFilter = digits(10);
const intFilter = (v: string) => v.replace(/\D/g, '');

function ToolCard({
  title,
  desc,
  fields,
  actionLabel,
  run,
}: {
  title: string;
  desc: string;
  fields: ToolField[];
  actionLabel: string;
  run: (values: Record<string, string>) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setResult(null);
    const missing = fields.filter((f) => f.required && !values[f.name]?.trim());
    if (missing.length) {
      setError(`Required: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    setLoading(true);
    try {
      setResult(await run(values));
    } catch (e: any) {
      setError(e?.body?.message || e?.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={card}>
      <h3 style={cardTitle}>{title}</h3>
      <p style={cardDesc}>{desc}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {fields.map((f) => (
          <input
            key={f.name}
            placeholder={f.label + (f.required ? ' *' : '')}
            value={values[f.name] ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const next = f.filter ? f.filter(raw) : raw;
              setValues((v) => ({ ...v, [f.name]: next }));
            }}
            style={{ ...input, minWidth: f.wide ? 280 : 150 }}
          />
        ))}
        <button onClick={submit} disabled={loading} style={btn(loading)}>
          {loading ? 'Working…' : actionLabel}
        </button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {result != null && (
        <pre style={resBox}>
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

const get = async (path: string) =>
  (await apiClient<any>(path)).data;
const post = async (path: string, body: unknown) =>
  (await apiClient<any>(path, { method: 'POST', body: JSON.stringify(body) }))
    .data;

export default function DelhiveryToolsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: '#111827' }}>
        Delhivery Tools
      </h1>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
        Live operations against Delhivery. Lookups are read-only; pickup /
        e-waybill / edit mutate the carrier shipment.
      </p>

      <ToolCard
        title="Pincode serviceability"
        desc="Is a destination pincode deliverable, and does it support COD / prepaid?"
        actionLabel="Check"
        fields={[{ name: 'pincode', label: 'Pincode', required: true, filter: pincodeFilter }]}
        run={(v) => get(`/admin/delhivery/serviceability/${encodeURIComponent(v.pincode.trim())}`)}
      />

      <ToolCard
        title="Shipping cost"
        desc="Live cost quote between two pincodes. Mode S = Surface, E = Express."
        actionLabel="Calculate"
        fields={[
          { name: 'origin', label: 'Origin pincode', required: true, filter: pincodeFilter },
          { name: 'destination', label: 'Destination pincode', required: true, filter: pincodeFilter },
          { name: 'weightGrams', label: 'Weight (g)', required: true, filter: intFilter },
          { name: 'mode', label: 'Mode (S/E)' },
          { name: 'paymentType', label: 'Pre-paid / COD' },
        ]}
        run={(v) => {
          const qs = new URLSearchParams({
            origin: v.origin.trim(),
            destination: v.destination.trim(),
            weightGrams: v.weightGrams.trim(),
          });
          if (v.mode?.trim()) qs.set('mode', v.mode.trim());
          if (v.paymentType?.trim()) qs.set('paymentType', v.paymentType.trim());
          return get(`/admin/delhivery/cost?${qs.toString()}`);
        }}
      />

      <ToolCard
        title="Expected TAT"
        desc="Estimated delivery days between two pincodes. mot S = Surface, E = Express."
        actionLabel="Check"
        fields={[
          { name: 'origin', label: 'Origin pincode', required: true, filter: pincodeFilter },
          { name: 'destination', label: 'Destination pincode', required: true, filter: pincodeFilter },
          { name: 'mot', label: 'Mode (S/E)' },
        ]}
        run={(v) => {
          const qs = new URLSearchParams({
            origin: v.origin.trim(),
            destination: v.destination.trim(),
          });
          if (v.mot?.trim()) qs.set('mot', v.mot.trim());
          return get(`/admin/delhivery/tat?${qs.toString()}`);
        }}
      />

      <ToolCard
        title="Fetch waybills"
        desc="Reserve bulk AWB numbers from Delhivery (normally done automatically at booking)."
        actionLabel="Fetch"
        fields={[{ name: 'count', label: 'Count', filter: intFilter }]}
        run={(v) => get(`/admin/delhivery/waybill?count=${Number(v.count) || 1}`)}
      />

      <ToolCard
        title="Raise pickup request"
        desc="Schedule a Delhivery pickup for a registered warehouse on a date/time."
        actionLabel="Raise pickup"
        fields={[
          { name: 'warehouseName', label: 'Warehouse name', required: true, wide: true },
          { name: 'date', label: 'Date (YYYY-MM-DD)', required: true },
          { name: 'time', label: 'Time (HH:MM:SS)', required: true },
          { name: 'expectedPackageCount', label: 'Package count', required: true, filter: intFilter },
        ]}
        run={(v) =>
          post('/admin/delhivery/pickup', {
            warehouseName: v.warehouseName.trim(),
            date: v.date.trim(),
            time: v.time.trim(),
            expectedPackageCount: Number(v.expectedPackageCount) || 1,
          })
        }
      />

      <ToolCard
        title="Update e-waybill"
        desc="Attach/update the GST e-way bill on an AWB (required for value > ₹50,000)."
        actionLabel="Update"
        fields={[
          { name: 'awb', label: 'AWB', required: true },
          { name: 'dcn', label: 'Invoice no (DCN)', required: true },
          { name: 'ewbn', label: 'E-waybill no', required: true },
        ]}
        run={(v) =>
          post(
            `/admin/delhivery/shipments/${encodeURIComponent(v.awb.trim())}/ewaybill`,
            { dcn: v.dcn.trim(), ewbn: v.ewbn.trim() },
          )
        }
      />

      <ToolCard
        title="Edit shipment"
        desc="Edit a booked shipment's consignee / weight (pre-pickup). Leave a field blank to keep it."
        actionLabel="Update"
        fields={[
          { name: 'awb', label: 'AWB', required: true },
          { name: 'consigneeName', label: 'Consignee name', filter: (v) => v.replace(/[^A-Za-z .'-]/g, '').slice(0, 100) },
          { name: 'consigneePhone', label: 'Consignee phone', filter: mobileFilter },
          { name: 'consigneeAddress', label: 'Consignee address', wide: true },
          { name: 'weightGrams', label: 'Weight (g)', filter: intFilter },
        ]}
        run={(v) => {
          const changes: Record<string, unknown> = {};
          if (v.consigneeName?.trim()) changes.consigneeName = v.consigneeName.trim();
          if (v.consigneePhone?.trim()) changes.consigneePhone = v.consigneePhone.trim();
          if (v.consigneeAddress?.trim())
            changes.consigneeAddress = v.consigneeAddress.trim();
          if (v.weightGrams?.trim()) changes.weightGrams = Number(v.weightGrams);
          return post(
            `/admin/delhivery/shipments/${encodeURIComponent(v.awb.trim())}/edit`,
            changes,
          );
        }}
      />
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const cardTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 2px',
};
const cardDesc: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '0 0 10px',
};
const input: React.CSSProperties = {
  height: 36,
  padding: '0 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 8,
  background: '#fff',
};
function btn(disabled: boolean): React.CSSProperties {
  return {
    height: 36,
    padding: '0 18px',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    background: disabled ? '#93c5fd' : '#2563eb',
    color: '#fff',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
const errBox: React.CSSProperties = {
  marginTop: 10,
  padding: '6px 10px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 12,
  color: '#991b1b',
};
const resBox: React.CSSProperties = {
  marginTop: 10,
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 12,
  borderRadius: 8,
  fontSize: 12,
  maxHeight: 280,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
