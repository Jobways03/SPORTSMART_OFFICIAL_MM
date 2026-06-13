'use client';

/**
 * Phase 39 (2026-05-21) — category metafield form section. Renders
 * the active metafield definitions for the product's category and
 * surfaces the seller's values as a typed map keyed by definition id.
 *
 * Lifts state to the parent (controlled component) so the parent's
 * payload builder can include `metafields[]` in the create/update
 * payload without re-deriving the value list. Parent owns:
 *   - the categoryId (selection lives upstream)
 *   - the metafield value map { [definitionId]: { value, namespace, key } }
 *   - the change handler
 *
 * Definitions are fetched from the new public endpoint
 *   GET /catalog/categories/:categoryId/metafield-definitions
 * which the controller backs with a 60s Redis cache.
 */

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export interface MetafieldChoice {
  value: string;
  label: string;
  colorHex?: string | null;
}

export interface MetafieldValidations {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
}

export interface MetafieldDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  description?: string | null;
  type: string;
  isRequired: boolean;
  isActive: boolean;
  pinned?: boolean;
  sortOrder?: number;
  choices?: MetafieldChoice[] | null;
  validations?: MetafieldValidations | null;
}

export type MetafieldValue = string | number | boolean | string[] | null;

export interface MetafieldValueEntry {
  definitionId: string;
  namespace: string;
  key: string;
  value: MetafieldValue;
}

interface Props {
  categoryId: string | null | undefined;
  values: Record<string, MetafieldValueEntry>;
  onChange: (next: Record<string, MetafieldValueEntry>) => void;
}

export function CategoryMetafieldFormSection({ categoryId, values, onChange }: Props) {
  const [definitions, setDefinitions] = useState<MetafieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId) {
      setDefinitions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    apiClient<MetafieldDefinition[]>(`/catalog/categories/${categoryId}/metafield-definitions`)
      .then((res) => {
        if (cancelled) return;
        const defs = (res.data ?? []).slice().sort((a, b) => {
          // Required first, then sortOrder, then alpha by name.
          if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1;
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          if (so !== 0) return so;
          return a.name.localeCompare(b.name);
        });
        setDefinitions(defs);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message || 'Failed to load category fields');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  if (!categoryId) {
    return (
      <div className="form-card">
        <div className="form-card-title">Category fields</div>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          Select a category to see the fields required for this product type.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="form-card">
        <div className="form-card-title">Category fields</div>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Loading category fields…</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="form-card">
        <div className="form-card-title">Category fields</div>
        <p style={{ color: '#b91c1c', fontSize: 13 }}>{err}</p>
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className="form-card">
        <div className="form-card-title">Category fields</div>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          This category does not define any product fields.
        </p>
      </div>
    );
  }

  function setValue(def: MetafieldDefinition, value: MetafieldValue) {
    const next = { ...values };
    next[def.id] = { definitionId: def.id, namespace: def.namespace, key: def.key, value };
    onChange(next);
  }

  return (
    <div className="form-card">
      <div className="form-card-title">Category fields</div>
      <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 16 }}>
        These fields are defined by the catalog admin for this category.
        Fields marked <span style={{ color: '#b91c1c' }}>*</span> are required for submission.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {definitions.map((def) => {
          const current = values[def.id]?.value;
          const requiredMark = def.isRequired ? <span style={{ color: '#b91c1c' }}> *</span> : null;
          return (
            <div key={def.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                {def.name}
                {requiredMark}
              </label>
              {def.description ? (
                <span style={{ fontSize: 11, color: '#6b7280' }}>{def.description}</span>
              ) : null}
              {renderInput(def, current, (v) => setValue(def, v))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderInput(
  def: MetafieldDefinition,
  value: MetafieldValue | undefined,
  onChange: (v: MetafieldValue) => void,
) {
  const baseInputStyle: React.CSSProperties = {
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
  };

  switch (def.type) {
    case 'SINGLE_LINE_TEXT':
    case 'URL':
    case 'COLOR':
    case 'FILE_REFERENCE':
      return (
        <input
          type={def.type === 'COLOR' ? 'text' : def.type === 'URL' ? 'url' : 'text'}
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={def.validations?.maxLength}
          placeholder={def.type === 'COLOR' ? '#RRGGBB' : undefined}
          style={baseInputStyle}
        />
      );
    case 'MULTI_LINE_TEXT':
      return (
        <textarea
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={def.validations?.maxLength}
          rows={3}
          style={baseInputStyle}
        />
      );
    case 'NUMBER_INTEGER':
    case 'NUMBER_DECIMAL':
    case 'RATING':
      return (
        <input
          type="number"
          value={value == null ? '' : String(value)}
          step={def.type === 'NUMBER_INTEGER' ? 1 : 'any'}
          min={def.validations?.min}
          max={def.validations?.max}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          style={baseInputStyle}
        />
      );
    case 'BOOLEAN':
      return (
        <select
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
          style={baseInputStyle}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'DATE':
      return (
        <input
          type="date"
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={baseInputStyle}
        />
      );
    case 'SINGLE_SELECT': {
      const choices = def.choices ?? [];
      return (
        <select
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          style={baseInputStyle}
        >
          <option value="">Select…</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }
    case 'MULTI_SELECT': {
      const choices = def.choices ?? [];
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {choices.map((c) => {
            const isChecked = selected.includes(c.value);
            return (
              <label
                key={c.value}
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  alignItems: 'center',
                  padding: '4px 8px',
                  background: isChecked ? '#dbeafe' : '#f3f4f6',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, c.value]
                      : selected.filter((s) => s !== c.value);
                    onChange(next);
                  }}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      );
    }
    default:
      // DIMENSION / WEIGHT / VOLUME / JSON — fallback to JSON textarea.
      return (
        <textarea
          value={value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...baseInputStyle, fontFamily: 'monospace' }}
          placeholder='{"key":"value"}'
        />
      );
  }
}

/**
 * Phase 39 — helper to map the value map into the payload `metafields[]`
 * shape the backend accepts. Filters entries with no value so empty
 * fields don't leak as null upserts.
 */
export function metafieldValuesToPayload(
  values: Record<string, MetafieldValueEntry>,
): Array<{ definitionId: string; namespace: string; key: string; value: MetafieldValue }> {
  return Object.values(values)
    .filter((e) => {
      if (e.value === null || e.value === undefined) return false;
      if (typeof e.value === 'string' && e.value.trim() === '') return false;
      if (Array.isArray(e.value) && e.value.length === 0) return false;
      return true;
    })
    .map((e) => ({
      definitionId: e.definitionId,
      namespace: e.namespace,
      key: e.key,
      value: e.value,
    }));
}
