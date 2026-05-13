'use client';

import type { SlotDefinition } from '@/lib/storefront-slots-registry';
import type { StorefrontContentBlock } from '@/services/admin-storefront-content.service';

interface Props {
  definition: SlotDefinition;
  block: StorefrontContentBlock | null;
  onEdit: () => void;
  /** When provided, shows a small "×" in the card corner to remove the slot. */
  onDelete?: () => void;
}

/**
 * Single slot tile in the admin grid. Shows the current admin-uploaded
 * image if any; otherwise an empty-state preview that makes the
 * fallback explicit. Click → opens the edit drawer. The delete button
 * floats over the top-left corner and stops click propagation so it
 * doesn't also open the edit drawer.
 */
export function SlotCard({ definition, block, onEdit, onDelete }: Props) {
  const hasImage = Boolean(block?.imageUrl);
  const hasCopy = Boolean(block?.headline || block?.eyebrow || block?.subhead);
  const customised = hasImage || hasCopy;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      style={{
        textAlign: 'left',
        background: '#fff',
        border: customised ? '1px solid #2563EB' : '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 0,
        cursor: 'pointer',
        fontFamily: 'inherit',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete slot ${definition.label}`}
          title={
            definition.isSystem
              ? 'Delete this default slot (also removes any uploaded content)'
              : 'Delete this slot'
          }
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            width: 24,
            height: 24,
            borderRadius: 999,
            border: 'none',
            background: 'rgba(15,17,21,0.72)',
            color: '#fff',
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          ×
        </button>
      )}

      <div
        style={{
          aspectRatio: definition.aspect,
          background: hasImage
            ? `#0F1115 url(${block!.imageUrl!}) center/cover no-repeat`
            : 'repeating-linear-gradient(45deg, #F3F4F6 0 8px, #E5E7EB 8px 16px)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: customised ? '#2563EB' : '#94A3B8',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {customised ? 'CUSTOM' : 'FALLBACK'}
        </div>
        {!hasImage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#64748B',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            no upload
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1115' }}>
          {definition.label}
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            color: '#64748B',
            marginTop: 2,
          }}
        >
          {definition.slot}
        </div>
        {block?.headline && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: '#0F1115',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={block.headline}
          >
            {block.headline}
          </div>
        )}
      </div>
    </div>
  );
}
