'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminStorefrontSlotsService,
  ALLOWED_SECTIONS,
  CreateSlotInput,
  SlotDefinition,
} from '@/services/admin-storefront-slots.service';
import { ApiError } from '@/lib/api-client';
// Reuses the flash-sales stylesheet — same drawer + button grammar
import '../flash-sales/flash-sales.css';

// Slot UI organises slots by their parent section. Sections are
// hard-coded in `ALLOWED_SECTIONS` because adding one requires a
// storefront code deploy — admins only add/remove slots within
// existing sections.

type DraftState = {
  sectionKey: string;
  label: string;
  slotKey: string;
  defaultHref: string;
};

function emptyDraft(sectionKey: string): DraftState {
  return { sectionKey, label: '', slotKey: '', defaultHref: '' };
}

export default function StorefrontSlotsPage() {
  const [slots, setSlots] = useState<SlotDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(
    emptyDraft(ALLOWED_SECTIONS[0].key),
  );
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminStorefrontSlotsService.list();
      setSlots(res.data?.items ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[storefront-slots] list failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Group slots by section so each section card renders its own list
  // in position-ascending order (the API already sorts by position
  // but we re-bucket here so missing sections show empty state).
  const bySection = useMemo(() => {
    const map = new Map<string, SlotDefinition[]>();
    for (const s of ALLOWED_SECTIONS) map.set(s.key, []);
    for (const slot of slots) {
      if (!map.has(slot.sectionKey)) map.set(slot.sectionKey, []);
      map.get(slot.sectionKey)!.push(slot);
    }
    // Sort each section's slots by position; the backend already does
    // this but a defensive client-side sort keeps the UI deterministic
    // if anyone hand-edits the DB.
    for (const arr of map.values()) {
      arr.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [slots]);

  const openAddFor = (sectionKey: string) => {
    setDraft(emptyDraft(sectionKey));
    setError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
  };

  const onSubmit = async () => {
    setError(null);
    if (!draft.label.trim()) {
      setError('Label is required.');
      return;
    }
    const payload: CreateSlotInput = {
      sectionKey: draft.sectionKey,
      label: draft.label.trim(),
      slotKey: draft.slotKey.trim() || undefined,
      defaultHref: draft.defaultHref.trim() || undefined,
    };
    setSubmitting(true);
    try {
      await adminStorefrontSlotsService.create(payload);
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

  const onDelete = async (slot: SlotDefinition) => {
    // System slots are protected on the backend; the UI button is
    // already disabled but we double-check here for safety.
    if (slot.isSystem) return;
    // eslint-disable-next-line no-alert
    if (
      !confirm(
        `Delete slot "${slot.label}" (${slot.slotKey})?\n\nIts paired content block (if any) is also deleted. The storefront falls back to its hardcoded baseline for this slot until you add it back.`,
      )
    ) {
      return;
    }
    setActing(slot.id);
    try {
      await adminStorefrontSlotsService.remove(slot.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActing(null);
    }
  };

  const draftSectionMeta = ALLOWED_SECTIONS.find(
    s => s.key === draft.sectionKey,
  );

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Storefront slots</h1>
          <p className="sub">
            Named placeholders within the storefront homepage's fixed
            sections. Each slot pairs with a content block (under{' '}
            <strong>Storefront content</strong>) by matching{' '}
            <code style={{ fontSize: 12 }}>slotKey</code>. Sections
            themselves are code-defined and not editable here.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="fs-table-wrap">
          <div className="fs-empty">Loading…</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {ALLOWED_SECTIONS.map(section => {
            const sectionSlots = bySection.get(section.key) ?? [];
            return (
              <div
                key={section.key}
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}>
                {/* Section header */}
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                      <h2
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          color: '#111827',
                          margin: 0,
                          letterSpacing: -0.2,
                        }}>
                        {section.label}
                      </h2>
                      <code
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          background: '#f3f4f6',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}>
                        {section.key}
                      </code>
                      <span
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          marginLeft: 4,
                        }}>
                        {sectionSlots.length}{' '}
                        {sectionSlots.length === 1 ? 'slot' : 'slots'}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12,
                        color: '#6b7280',
                        margin: '4px 0 0',
                        lineHeight: 1.4,
                      }}>
                      {section.description}
                    </p>
                  </div>
                  <button
                    className="fs-new-btn"
                    onClick={() => openAddFor(section.key)}
                    style={{ flexShrink: 0 }}>
                    + Add slot
                  </button>
                </div>

                {/* Slot rows */}
                {sectionSlots.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 20px',
                      textAlign: 'center',
                      color: '#9ca3af',
                      fontSize: 13,
                    }}>
                    No slots in this section yet.
                  </div>
                ) : (
                  <table className="fs-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>Label</th>
                        <th>Slot key</th>
                        <th>Default link</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionSlots.map(slot => {
                        const isActing = acting === slot.id;
                        return (
                          <tr key={slot.id}>
                            <td
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#6b7280',
                              }}>
                              {slot.position}
                            </td>
                            <td>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: '#111827',
                                  }}>
                                  {slot.label}
                                </span>
                                {slot.isSystem ? (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 700,
                                      letterSpacing: 0.5,
                                      color: '#5b21b6',
                                      background: '#ede9fe',
                                      padding: '2px 6px',
                                      borderRadius: 8,
                                    }}>
                                    SYSTEM
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <code
                                style={{
                                  fontSize: 12,
                                  color: '#374151',
                                  fontFamily: 'ui-monospace, monospace',
                                }}>
                                {slot.slotKey}
                              </code>
                            </td>
                            <td
                              style={{
                                fontSize: 12,
                                color: '#6b7280',
                                maxWidth: 240,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                              {slot.defaultHref || '—'}
                            </td>
                            <td>
                              <div className="fs-row-actions">
                                <button
                                  className="fs-icon-btn danger"
                                  disabled={slot.isSystem || isActing}
                                  onClick={() => onDelete(slot)}
                                  title={
                                    slot.isSystem
                                      ? 'System slots are seeded by the storefront — cannot be deleted here.'
                                      : undefined
                                  }
                                  style={
                                    slot.isSystem
                                      ? {
                                          opacity: 0.4,
                                          cursor: 'not-allowed',
                                        }
                                      : undefined
                                  }>
                                  Delete
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
            );
          })}
        </div>
      )}

      {/* Create slot drawer */}
      {drawerOpen ? (
        <>
          <div className="fs-drawer-backdrop" onClick={closeDrawer} />
          <aside className="fs-drawer" role="dialog" aria-label="New slot">
            <div className="fs-drawer-header">
              <h2>
                New slot{' '}
                {draftSectionMeta ? `· ${draftSectionMeta.label}` : ''}
              </h2>
              <button className="fs-drawer-close" onClick={closeDrawer}>
                ×
              </button>
            </div>
            <div className="fs-drawer-body">
              {error ? <div className="fs-error">{error}</div> : null}

              <div className="fs-field">
                <label>Section</label>
                <select
                  value={draft.sectionKey}
                  onChange={e =>
                    setDraft(d => ({ ...d, sectionKey: e.target.value }))
                  }
                  style={{
                    width: '100%',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    padding: '9px 12px',
                    fontSize: 13,
                    color: '#111827',
                    background: '#fff',
                  }}>
                  {ALLOWED_SECTIONS.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({s.key})
                    </option>
                  ))}
                </select>
                {draftSectionMeta ? (
                  <div className="hint">{draftSectionMeta.description}</div>
                ) : null}
              </div>

              <div className="fs-field">
                <label>Label</label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={e =>
                    setDraft(d => ({ ...d, label: e.target.value }))
                  }
                  placeholder="e.g. Featured drop · September"
                  maxLength={120}
                />
                <div className="hint">
                  Human-readable name shown in the slots list and the
                  storefront-content admin.
                </div>
              </div>

              <div className="fs-field">
                <label>Slot key (optional)</label>
                <input
                  type="text"
                  value={draft.slotKey}
                  onChange={e =>
                    setDraft(d => ({ ...d, slotKey: e.target.value }))
                  }
                  placeholder="Auto-derived from label if blank"
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                  }}
                />
                <div className="hint">
                  Lowercase, hyphenated, ASCII. Used to pair with a
                  content block of the same slot key.
                </div>
              </div>

              <div className="fs-field">
                <label>Default link (optional)</label>
                <input
                  type="text"
                  value={draft.defaultHref}
                  onChange={e =>
                    setDraft(d => ({ ...d, defaultHref: e.target.value }))
                  }
                  placeholder="https://… or /collections/cricket"
                />
                <div className="hint">
                  Fallback href used by the storefront when the content
                  block for this slot doesn't override it.
                </div>
              </div>
            </div>
            <div className="fs-drawer-footer">
              <button className="fs-cancel" onClick={closeDrawer}>
                Cancel
              </button>
              <button
                className="fs-submit"
                onClick={onSubmit}
                disabled={submitting}>
                {submitting ? 'Creating…' : 'Create slot'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
