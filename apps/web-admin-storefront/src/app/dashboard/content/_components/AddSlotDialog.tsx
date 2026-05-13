'use client';

import { useEffect, useState } from 'react';
import { adminStorefrontSlotsService } from '@/services/admin-storefront-slots.service';
import { adminStorefrontContentService } from '@/services/admin-storefront-content.service';

interface Props {
  sectionKey: string;
  sectionTitle: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Modal for adding a new slot to a section. Slot key is optional —
 * if omitted, the API derives one from the section prefix + label
 * (`sport-tiles-strip` + "Hiking" → `sport-hiking`).
 */
export function AddSlotDialog({ sectionKey, sectionTitle, onClose, onCreated }: Props) {
  const [label, setLabel] = useState('');
  const [slotKey, setSlotKey] = useState('');
  const [defaultHref, setDefaultHref] = useState('');
  const [price, setPrice] = useState('');
  const [priceCaption, setPriceCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    setErr(null);
    if (!label.trim()) {
      setErr('Label is required.');
      return;
    }
    setSaving(true);
    try {
      const created = await adminStorefrontSlotsService.create({
        sectionKey,
        label: label.trim(),
        slotKey: slotKey.trim() || undefined,
        defaultHref: defaultHref.trim() || null,
      });

      // If the admin entered a price treatment, seed the content block
      // for the new slot so the tile renders the overlay immediately.
      // Uses the API-resolved slotKey (which may have a -2 suffix when
      // it collided) rather than the typed one so we write to the right
      // block.
      const trimmedPrice = price.trim();
      const trimmedCaption = priceCaption.trim();
      const createdSlotKey = created.data?.slotKey;
      if (createdSlotKey && (trimmedPrice || trimmedCaption)) {
        await adminStorefrontContentService.upsert(createdSlotKey, {
          price: trimmedPrice || null,
          priceCaption: trimmedCaption || null,
        });
      }

      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create slot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <header style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
                Add slot
              </h2>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                Section: <strong>{sectionTitle}</strong>
              </div>
            </div>
            <button onClick={onClose} style={closeBtn} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {err && <div style={errBox}>{err}</div>}

          <div>
            <label style={lbl}>Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Hiking"
              autoFocus
              style={input}
            />
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              The display name shown on the admin grid.
            </p>
          </div>

          <div>
            <label style={lbl}>Slot key (optional)</label>
            <input
              type="text"
              value={slotKey}
              onChange={(e) => setSlotKey(e.target.value)}
              placeholder="auto-generated from label"
              style={input}
            />
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              Unique identifier (lowercase, dashes). Leave blank to auto-derive.
            </p>
          </div>

          <div>
            <label style={lbl}>Default link (optional)</label>
            <input
              type="text"
              value={defaultHref}
              onChange={(e) => setDefaultHref(e.target.value)}
              placeholder="/products?sport=hiking"
              style={input}
            />
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              Where the tile links when clicked. Overridden by the slot's CTA href if set later.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbl}>Price (optional)</label>
              <input
                type="text"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="₹999"
                style={input}
              />
              <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                Overlay shown on the tile. Leave blank to hide.
              </p>
            </div>
            <div>
              <label style={lbl}>Price caption (optional)</label>
              <input
                type="text"
                value={priceCaption}
                onChange={(e) => setPriceCaption(e.target.value)}
                placeholder="Onwards"
                style={input}
              />
            </div>
          </div>
        </div>

        <footer style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtn} disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} style={primaryBtn} disabled={saving}>
            {saving ? 'Creating…' : 'Create slot'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 17, 21, 0.4)',
  zIndex: 60,
  display: 'grid',
  placeItems: 'center',
};
const dialog: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 10px 30px rgba(15, 17, 21, 0.2)',
  overflow: 'hidden',
};
const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 24,
  lineHeight: 1,
  color: '#64748B',
  cursor: 'pointer',
};
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#525A65',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: 'inherit',
};
const errBox: React.CSSProperties = {
  padding: 10,
  background: '#FEF2F2',
  border: '1px solid #FCA5A5',
  color: '#B91C1C',
  fontSize: 12,
  borderRadius: 8,
};
const primaryBtn: React.CSSProperties = {
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  background: '#fff',
  color: '#0F1115',
  border: '1px solid #D2D6DC',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
