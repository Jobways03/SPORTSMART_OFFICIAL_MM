'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequirePermission } from '@/lib/permissions';
import {
  STOREFRONT_SECTIONS,
  type SlotDefinition,
  type SlotSection,
} from '@/lib/storefront-slots-registry';
import {
  adminStorefrontContentService,
  type StorefrontContentBlock,
} from '@/services/admin-storefront-content.service';
import {
  adminStorefrontSlotsService,
  type SlotDefinition as ApiSlotDefinition,
} from '@/services/admin-storefront-slots.service';
import { SlotCard } from './_components/SlotCard';
import { SlotEditDrawer } from './_components/SlotEditDrawer';
import { AddSlotDialog } from './_components/AddSlotDialog';
import { ConfirmModal } from './_components/ConfirmModal';

/**
 * Storefront Content admin page.
 *
 * Sections (Hero, Sport tiles strip, …) come from a fixed registry —
 * each section has its own layout/aspect in the storefront. Slots
 * within each section are admin-editable: they're fetched from
 * /admin/storefront-slots and rendered as cards. Click → edit drawer
 * (upload + copy + reset). Per-section "+ Add slot" creates a new
 * slot. Per-card "×" deletes a slot (and its content block).
 */
export default function StorefrontContentPage() {
  return (
    <RequirePermission
      anyOf={['content.write', 'content.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const [blocks, setBlocks] = useState<Record<string, StorefrontContentBlock>>({});
  const [slots, setSlots] = useState<ApiSlotDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ definition: SlotDefinition } | null>(null);
  const [adding, setAdding] = useState<SlotSection | null>(null);
  const [deleting, setDeleting] = useState<ApiSlotDefinition | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [blocksRes, slotsRes] = await Promise.all([
        adminStorefrontContentService.list(),
        adminStorefrontSlotsService.list(),
      ]);
      const blockMap: Record<string, StorefrontContentBlock> = {};
      for (const b of blocksRes.data?.items ?? []) blockMap[b.slot] = b;
      setBlocks(blockMap);
      setSlots(slotsRes.data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load content blocks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Group slots by section, preserving DB order (position asc).
  const slotsBySection = useMemo(() => {
    const map: Record<string, ApiSlotDefinition[]> = {};
    for (const s of slots) {
      if (!map[s.sectionKey]) map[s.sectionKey] = [];
      map[s.sectionKey].push(s);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.position - b.position);
    }
    return map;
  }, [slots]);

  const customised = Object.keys(blocks).length;
  const total = slots.length;

  async function performDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setErr(null);
    try {
      await adminStorefrontSlotsService.remove(deleting.id);
      setDeleting(null);
      void reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Storefront Content
        </h1>
        <p style={{ marginTop: 6, fontSize: 14, color: '#64748b' }}>
          Static pages, banners, and merchandising blocks shown on the customer storefront.
          Slots without an upload fall back to the curated placeholder.
        </p>
        <div style={{ marginTop: 12, fontSize: 13, color: '#475569' }}>
          <strong>{customised}</strong> / {total} slots customised
          {loading ? ' · loading…' : ''}
        </div>
      </header>

      {err && <div style={errBox}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {STOREFRONT_SECTIONS.map((section) => {
          const sectionSlots = slotsBySection[section.sectionKey] ?? [];
          return (
            <section key={section.sectionKey}>
              <div
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    {section.title}
                  </h2>
                  {section.description && (
                    <p style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                      {section.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAdding(section)}
                  style={addBtn}
                >
                  + Add slot
                </button>
              </div>
              {sectionSlots.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    border: '1px dashed #CBD5E1',
                    borderRadius: 12,
                    textAlign: 'center',
                    color: '#64748B',
                    fontSize: 13,
                  }}
                >
                  No slots in this section yet. Click <strong>+ Add slot</strong> to create one.
                </div>
              ) : (
                <div style={grid}>
                  {sectionSlots.map((s) => {
                    const definition: SlotDefinition = {
                      id: s.id,
                      slot: s.slotKey,
                      label: s.label,
                      aspect: section.aspect,
                      isSystem: s.isSystem,
                    };
                    return (
                      <SlotCard
                        key={s.id}
                        definition={definition}
                        block={blocks[s.slotKey] ?? null}
                        onEdit={() => setEditing({ definition })}
                        onDelete={() => setDeleting(s)}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <SlotEditDrawer
          definition={editing.definition}
          initial={blocks[editing.definition.slot] ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      {adding && (
        <AddSlotDialog
          sectionKey={adding.sectionKey}
          sectionTitle={adding.title}
          onClose={() => setAdding(null)}
          onCreated={() => {
            setAdding(null);
            void reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete "${deleting.label}"?`}
          confirmLabel="Delete slot"
          busy={deleteBusy}
          onCancel={() => (deleteBusy ? null : setDeleting(null))}
          onConfirm={performDelete}
          message={
            <>
              <p style={{ margin: 0 }}>
                This removes the <strong>{deleting.label}</strong> tile (
                <code style={codePill}>{deleting.slotKey}</code>) from the
                storefront.
              </p>
              {blocks[deleting.slotKey] && (
                <div style={warnCallout}>
                  <span style={warnDot} aria-hidden="true" />
                  <span>
                    Any uploaded image and copy for this slot will also be
                    removed.
                  </span>
                </div>
              )}
              {deleting.isSystem && (
                <p style={{ marginTop: 10, marginBottom: 0, color: '#64748B', fontSize: 12.5 }}>
                  This is a default slot — you can recreate it from
                  <strong> + Add slot</strong> if you change your mind.
                </p>
              )}
            </>
          }
        />
      )}
    </div>
  );
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 12,
};

const errBox: React.CSSProperties = {
  padding: 12,
  background: '#FEF2F2',
  border: '1px solid #FCA5A5',
  color: '#B91C1C',
  fontSize: 13,
  borderRadius: 8,
  marginBottom: 16,
};

const addBtn: React.CSSProperties = {
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  padding: '6px 14px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const codePill: React.CSSProperties = {
  fontSize: 11.5,
  background: '#F1F5F9',
  color: '#475569',
  padding: '1px 6px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const warnCallout: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  background: '#FFFBEB',
  border: '1px solid #FDE68A',
  borderRadius: 8,
  fontSize: 12.5,
  color: '#92400E',
  lineHeight: 1.5,
};

const warnDot: React.CSSProperties = {
  flexShrink: 0,
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#D97706',
  marginTop: 6,
};
