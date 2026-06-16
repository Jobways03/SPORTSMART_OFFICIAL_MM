'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminStorefrontContentService,
  StorefrontContentBlock,
  UpsertStorefrontContentInput,
} from '@/services/admin-storefront-content.service';
import { ApiError } from '@/lib/api-client';
// Reuses the flash-sales stylesheet — same table + drawer grammar
import '../flash-sales/flash-sales.css';

// Slot prefix convention shared with the mobile app. When the admin
// picks a block type, we auto-prefix the slot so the mobile
// consumers (testimonials filter `testimonial-*`, press filter
// `press-*`) pick the row up automatically.
type BlockType = 'testimonial' | 'press' | 'custom';

const TYPE_META: Record<
  BlockType,
  {
    label: string;
    prefix: string;
    description: string;
    fields: {
      eyebrow: { label: string; placeholder: string; show: boolean };
      headline: { label: string; placeholder: string; show: boolean };
      subhead: { label: string; placeholder: string; show: boolean };
      imageUrl: { label: string; placeholder: string };
      cta: boolean;
      price: boolean;
    };
  }
> = {
  testimonial: {
    label: 'Testimonial',
    prefix: 'testimonial-',
    description:
      'Quoted customer review on the "Loved by athletes" home rail.',
    fields: {
      eyebrow: {
        label: 'Reviewer name',
        placeholder: 'e.g. Arjun K.',
        show: true,
      },
      headline: {
        label: 'The quote',
        placeholder:
          'Got my cricket bat in 18 hours. Feels like a pro shop.',
        show: true,
      },
      subhead: {
        label: 'Location',
        placeholder: 'Bengaluru',
        show: true,
      },
      imageUrl: {
        label: 'Avatar URL (optional)',
        placeholder: 'https://cdn.example.com/avatars/arjun.jpg',
      },
      cta: false,
      price: false,
    },
  },
  press: {
    label: 'Press logo',
    prefix: 'press-',
    description:
      '"As featured in" press logo / wordmark on the home page.',
    fields: {
      eyebrow: {
        label: 'Publication name',
        placeholder: 'INDIA TODAY',
        show: true,
      },
      headline: { label: '', placeholder: '', show: false },
      subhead: { label: '', placeholder: '', show: false },
      imageUrl: {
        label: 'Logo URL (optional)',
        placeholder: 'https://cdn.example.com/press/india-today.svg',
      },
      cta: true,
      price: false,
    },
  },
  custom: {
    label: 'Custom block',
    prefix: '',
    description:
      'Any other CMS slot — hero tiles, banners, generic content.',
    fields: {
      eyebrow: {
        label: 'Eyebrow',
        placeholder: 'CATEGORY · TAG',
        show: true,
      },
      headline: {
        label: 'Headline',
        placeholder: 'Big bold title',
        show: true,
      },
      subhead: {
        label: 'Subhead',
        placeholder: 'Supporting copy below the headline',
        show: true,
      },
      imageUrl: {
        label: 'Image URL',
        placeholder: 'https://cdn.example.com/...',
      },
      cta: true,
      price: true,
    },
  },
};

function typeForSlot(slot: string): BlockType {
  if (slot.startsWith('testimonial-')) return 'testimonial';
  if (slot.startsWith('press-')) return 'press';
  return 'custom';
}

type DraftState = {
  slot: string;
  type: BlockType;
  active: boolean;
  imageUrl: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  ctaLabel: string;
  ctaHref: string;
  price: string;
  priceCaption: string;
};

function emptyDraft(): DraftState {
  return {
    slot: '',
    type: 'testimonial',
    active: true,
    imageUrl: '',
    eyebrow: '',
    headline: '',
    subhead: '',
    ctaLabel: '',
    ctaHref: '',
    price: '',
    priceCaption: '',
  };
}

function draftFromBlock(block: StorefrontContentBlock): DraftState {
  return {
    slot: block.slot,
    type: typeForSlot(block.slot),
    active: block.active,
    imageUrl: block.imageUrl ?? '',
    eyebrow: block.eyebrow ?? '',
    headline: block.headline ?? '',
    subhead: block.subhead ?? '',
    ctaLabel: block.ctaLabel ?? '',
    ctaHref: block.ctaHref ?? '',
    price: block.price ?? '',
    priceCaption: block.priceCaption ?? '',
  };
}

// Slot slug sanitiser — lowercase, hyphenated, ascii. Keeps slot keys
// URL-safe and predictable.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const FILTER_TYPES: Array<{ key: BlockType | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'testimonial', label: 'Testimonials' },
  { key: 'press', label: 'Press' },
  { key: 'custom', label: 'Custom' },
];

export default function StorefrontContentPage() {
  const [rows, setRows] = useState<StorefrontContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BlockType | 'all'>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // editingSlot === null → "create new" mode; otherwise edit that slot.
  // The slot key is immutable once a block exists (backend keys by it),
  // so the slot field is read-only in edit mode.
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminStorefrontContentService.list();
      // Sort newest-first so the marketing team's latest edits surface.
      const items = (res.data?.items ?? []).sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setRows(items);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[storefront-content] list failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter(r => typeForSlot(r.slot) === filter);
  }, [rows, filter]);

  const openNew = () => {
    setEditingSlot(null);
    setDraft(emptyDraft());
    setError(null);
    setDrawerOpen(true);
  };

  const openEdit = (row: StorefrontContentBlock) => {
    setEditingSlot(row.slot);
    setDraft(draftFromBlock(row));
    setError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
  };

  const onTypeChange = (newType: BlockType) => {
    setDraft(d => {
      // When creating new, swap the slot prefix as the user changes
      // type. When editing, leave the slot alone — it's read-only.
      if (editingSlot) return { ...d, type: newType };
      const oldMeta = TYPE_META[d.type];
      const newMeta = TYPE_META[newType];
      // Strip the old prefix if present, then re-prefix
      let slot = d.slot;
      if (oldMeta.prefix && slot.startsWith(oldMeta.prefix)) {
        slot = slot.slice(oldMeta.prefix.length);
      }
      slot = newMeta.prefix + slot;
      return { ...d, type: newType, slot };
    });
  };

  const onSubmit = async () => {
    setError(null);
    const meta = TYPE_META[draft.type];

    // Slot validation
    let slot = editingSlot ?? draft.slot.trim();
    if (!editingSlot) {
      // Strip prefix, slugify the rest, re-add the prefix. Safer than
      // slugifying the whole string (which would mangle the hyphen
      // between `testimonial` and `arjun`).
      const stem = slugify(slot.replace(meta.prefix, ''));
      if (!stem) {
        setError('Slot key is required.');
        return;
      }
      slot = meta.prefix + stem;
    }

    if (meta.fields.eyebrow.show && !draft.eyebrow.trim()) {
      setError(`${meta.fields.eyebrow.label} is required.`);
      return;
    }
    if (
      meta.fields.headline.show &&
      meta.label === 'Testimonial' &&
      !draft.headline.trim()
    ) {
      setError('The quote is required for a testimonial.');
      return;
    }

    // null-out empty strings so the API doesn't store "" as a value.
    const blank = (s: string) => (s.trim() ? s.trim() : null);

    const payload: UpsertStorefrontContentInput = {
      active: draft.active,
      imageUrl: blank(draft.imageUrl),
      eyebrow: blank(draft.eyebrow),
      headline: blank(draft.headline),
      subhead: blank(draft.subhead),
      ctaLabel: meta.fields.cta ? blank(draft.ctaLabel) : null,
      ctaHref: meta.fields.cta ? blank(draft.ctaHref) : null,
      price: meta.fields.price ? blank(draft.price) : null,
      priceCaption: meta.fields.price ? blank(draft.priceCaption) : null,
    };

    setSubmitting(true);
    try {
      await adminStorefrontContentService.upsert(slot, payload);
      setDrawerOpen(false);
      await reload();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Save failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onReset = async (row: StorefrontContentBlock) => {
    // eslint-disable-next-line no-alert
    if (
      !confirm(
        `Reset "${row.slot}" to fallback? The mobile section using this slot will hide (or show its hardcoded fallback) until you create the block again.`,
      )
    ) {
      return;
    }
    try {
      await adminStorefrontContentService.reset(row.slot);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error ? err.message : 'Reset failed — try again.',
      );
    }
  };

  const drawerTitle = editingSlot
    ? `Edit ${editingSlot}`
    : `New ${TYPE_META[draft.type].label.toLowerCase()}`;

  const formMeta = TYPE_META[draft.type];

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Storefront content</h1>
          <p className="sub">
            CMS-managed blocks that power the storefront homepage —
            testimonials, press logos, and custom hero / banner tiles.
            Slot keys are how the storefront finds each row.
          </p>
        </div>
        <button className="fs-new-btn" onClick={openNew}>
          + New block
        </button>
      </div>

      {/* Filter pills */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}>
        {FILTER_TYPES.map(ft => {
          const isActive = filter === ft.key;
          const count =
            ft.key === 'all'
              ? rows.length
              : rows.filter(r => typeForSlot(r.slot) === ft.key).length;
          return (
            <button
              key={ft.key}
              onClick={() => setFilter(ft.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 16,
                border: '1px solid',
                borderColor: isActive ? '#111827' : '#e5e7eb',
                background: isActive ? '#111827' : '#fff',
                color: isActive ? '#fff' : '#374151',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}>
              {ft.label}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 6px',
                  borderRadius: 9,
                  background: isActive
                    ? 'rgba(255,255,255,0.18)'
                    : '#f3f4f6',
                  color: isActive ? '#fff' : '#6b7280',
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="fs-table-wrap">
        {loading ? (
          <div className="fs-empty">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="fs-empty">
            {rows.length === 0 ? (
              <>
                No content blocks yet. Click{' '}
                <strong>+ New block</strong> to add one.
              </>
            ) : (
              <>No blocks match the {filter} filter.</>
            )}
          </div>
        ) : (
          <table className="fs-table">
            <thead>
              <tr>
                <th>Slot / Preview</th>
                <th>Type</th>
                <th>Status</th>
                <th>Updated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const t = typeForSlot(row.slot);
                const typeMeta = TYPE_META[t];
                return (
                  <tr key={row.slot}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: '#f3f4f6',
                            backgroundImage: row.imageUrl
                              ? `url(${row.imageUrl})`
                              : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            border: '1px solid #e5e7eb',
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: '#111827',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 12,
                            }}>
                            {row.slot}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: '#6b7280',
                              marginTop: 2,
                              maxWidth: 360,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                            {row.headline ||
                              row.eyebrow ||
                              row.subhead ||
                              '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color:
                            t === 'testimonial'
                              ? '#5b7d6b'
                              : t === 'press'
                                ? '#a8855a'
                                : '#5b21b6',
                          letterSpacing: 0.4,
                        }}>
                        {typeMeta.label.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`fs-badge ${
                          row.active ? 'active' : 'inactive'
                        }`}>
                        {row.active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td style={{ color: '#374151', fontSize: 12 }}>
                      {new Date(row.updatedAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      <div className="fs-row-actions">
                        <button
                          className="fs-icon-btn"
                          onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <button
                          className="fs-icon-btn danger"
                          onClick={() => onReset(row)}>
                          Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen ? (
        <>
          <div className="fs-drawer-backdrop" onClick={closeDrawer} />
          <aside className="fs-drawer" role="dialog" aria-label={drawerTitle}>
            <div className="fs-drawer-header">
              <h2>{drawerTitle}</h2>
              <button
                className="fs-drawer-close"
                onClick={closeDrawer}
                aria-label="Close">
                ×
              </button>
            </div>

            <div className="fs-drawer-body">
              {error ? <div className="fs-error">{error}</div> : null}

              {/* Block type selector — only on create */}
              {!editingSlot ? (
                <div className="fs-field">
                  <label>Block type</label>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}>
                    {(Object.keys(TYPE_META) as BlockType[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onTypeChange(t)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          border: '1px solid',
                          borderColor:
                            draft.type === t ? '#111827' : '#d1d5db',
                          background:
                            draft.type === t ? '#111827' : '#fff',
                          color: draft.type === t ? '#fff' : '#374151',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}>
                        {TYPE_META[t].label}
                      </button>
                    ))}
                  </div>
                  <div className="hint">{formMeta.description}</div>
                </div>
              ) : null}

              <div className="fs-field">
                <label>Slot key</label>
                <input
                  type="text"
                  value={draft.slot}
                  onChange={e =>
                    setDraft(d => ({ ...d, slot: e.target.value }))
                  }
                  placeholder={`${formMeta.prefix}name-here`}
                  disabled={!!editingSlot}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    background: editingSlot ? '#f9fafb' : undefined,
                  }}
                />
                <div className="hint">
                  {editingSlot
                    ? 'Slot keys are immutable after creation.'
                    : `Mobile filters this prefix automatically. The key will be slugified on save (lowercase, hyphenated).`}
                </div>
              </div>

              {formMeta.fields.eyebrow.show ? (
                <div className="fs-field">
                  <label>{formMeta.fields.eyebrow.label}</label>
                  <input
                    type="text"
                    value={draft.eyebrow}
                    onChange={e =>
                      setDraft(d => ({ ...d, eyebrow: e.target.value }))
                    }
                    placeholder={formMeta.fields.eyebrow.placeholder}
                  />
                </div>
              ) : null}

              {formMeta.fields.headline.show ? (
                <div className="fs-field">
                  <label>{formMeta.fields.headline.label}</label>
                  <textarea
                    value={draft.headline}
                    onChange={e =>
                      setDraft(d => ({ ...d, headline: e.target.value }))
                    }
                    placeholder={formMeta.fields.headline.placeholder}
                    maxLength={500}
                  />
                </div>
              ) : null}

              {formMeta.fields.subhead.show ? (
                <div className="fs-field">
                  <label>{formMeta.fields.subhead.label}</label>
                  <input
                    type="text"
                    value={draft.subhead}
                    onChange={e =>
                      setDraft(d => ({ ...d, subhead: e.target.value }))
                    }
                    placeholder={formMeta.fields.subhead.placeholder}
                  />
                </div>
              ) : null}

              <div className="fs-field">
                <label>{formMeta.fields.imageUrl.label}</label>
                <input
                  type="text"
                  value={draft.imageUrl}
                  onChange={e =>
                    setDraft(d => ({ ...d, imageUrl: e.target.value }))
                  }
                  placeholder={formMeta.fields.imageUrl.placeholder}
                />
                {draft.imageUrl ? (
                  <div
                    style={{
                      marginTop: 8,
                      width: 80,
                      height: 80,
                      borderRadius: 8,
                      background: `#f3f4f6 url(${draft.imageUrl}) center/cover`,
                      border: '1px solid #e5e7eb',
                    }}
                  />
                ) : null}
              </div>

              {formMeta.fields.cta ? (
                <div className="fs-row-2">
                  <div className="fs-field">
                    <label>CTA label (optional)</label>
                    <input
                      type="text"
                      value={draft.ctaLabel}
                      onChange={e =>
                        setDraft(d => ({ ...d, ctaLabel: e.target.value }))
                      }
                      placeholder="Shop now"
                    />
                  </div>
                  <div className="fs-field">
                    <label>CTA URL (optional)</label>
                    <input
                      type="text"
                      value={draft.ctaHref}
                      onChange={e =>
                        setDraft(d => ({ ...d, ctaHref: e.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </div>
                </div>
              ) : null}

              {formMeta.fields.price ? (
                <div className="fs-row-2">
                  <div className="fs-field">
                    <label>Price (optional)</label>
                    <input
                      type="text"
                      value={draft.price}
                      onChange={e =>
                        setDraft(d => ({ ...d, price: e.target.value }))
                      }
                      placeholder="₹999"
                    />
                  </div>
                  <div className="fs-field">
                    <label>Price caption (optional)</label>
                    <input
                      type="text"
                      value={draft.priceCaption}
                      onChange={e =>
                        setDraft(d => ({
                          ...d,
                          priceCaption: e.target.value,
                        }))
                      }
                      placeholder="Onwards"
                    />
                  </div>
                </div>
              ) : null}

              <label className={`fs-checkbox${draft.active ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={e =>
                    setDraft(d => ({ ...d, active: e.target.checked }))
                  }
                />
                Active — uncheck to hide from the storefront without
                deleting the row
              </label>
            </div>

            <div className="fs-drawer-footer">
              <button className="fs-cancel" onClick={closeDrawer}>
                Cancel
              </button>
              <button
                className="fs-submit"
                onClick={onSubmit}
                disabled={submitting}>
                {submitting
                  ? 'Saving…'
                  : editingSlot
                    ? 'Save changes'
                    : 'Create block'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
