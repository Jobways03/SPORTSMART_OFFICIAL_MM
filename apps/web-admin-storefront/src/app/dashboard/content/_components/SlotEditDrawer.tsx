'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotDefinition } from '@/lib/storefront-slots-registry';
import {
  adminStorefrontContentService,
  type StorefrontContentBlock,
} from '@/services/admin-storefront-content.service';
import {
  adminCollectionsService,
  type CollectionListItem,
} from '@/services/admin-collections.service';
import {
  adminBrandsService,
  type BrandListItem,
} from '@/services/admin-brands.service';
import { ConfirmModal } from './ConfirmModal';

type CtaLinkType = 'link' | 'collection' | 'brand';

const COLLECTION_PREFIX = '/collections/';
const BRAND_PREFIX = '/products?brand=';

function detectCtaType(href: string | null | undefined): CtaLinkType {
  if (!href) return 'link';
  if (href.startsWith(COLLECTION_PREFIX)) return 'collection';
  if (href.startsWith(BRAND_PREFIX)) return 'brand';
  return 'link';
}

function extractSlug(href: string, prefix: string): string {
  if (!href.startsWith(prefix)) return '';
  return href.slice(prefix.length).split(/[?#&]/)[0] ?? '';
}

interface Props {
  definition: SlotDefinition;
  initial: StorefrontContentBlock | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Right-anchored edit drawer for one slot.
 *
 * Three independent operations exposed:
 *   1. Upload image — multipart POST, returns the row with the new
 *      Cloudinary URL. Saving fields below is a separate PUT.
 *   2. Save text fields (eyebrow / headline / subhead / CTA) — PUT
 *      with omitted imageUrl so the upload above isn't disturbed.
 *   3. Reset to fallback — DELETE the row.
 *
 * Splitting the upload + text saves keeps the upload progress UX
 * clean and lets text edits land instantly without re-sending a file.
 */
export function SlotEditDrawer({ definition, initial, onClose, onSaved }: Props) {
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [eyebrow, setEyebrow] = useState(initial?.eyebrow ?? '');
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [subhead, setSubhead] = useState(initial?.subhead ?? '');
  const [ctaLabel, setCtaLabel] = useState(initial?.ctaLabel ?? '');
  const [price, setPrice] = useState(initial?.price ?? '');
  const [priceCaption, setPriceCaption] = useState(initial?.priceCaption ?? '');
  const initialHref = initial?.ctaHref ?? '';
  const initialType = detectCtaType(initialHref);
  const [ctaType, setCtaType] = useState<CtaLinkType>(initialType);
  const [ctaLinkHref, setCtaLinkHref] = useState(
    initialType === 'link' ? initialHref : '',
  );
  const [ctaCollectionSlug, setCtaCollectionSlug] = useState(
    initialType === 'collection' ? extractSlug(initialHref, COLLECTION_PREFIX) : '',
  );
  const [ctaBrandSlug, setCtaBrandSlug] = useState(
    initialType === 'brand' ? extractSlug(initialHref, BRAND_PREFIX) : '',
  );

  const [collections, setCollections] = useState<CollectionListItem[]>([]);
  const [brands, setBrands] = useState<BrandListItem[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const composedCtaHref = useMemo(() => {
    if (ctaType === 'link') return ctaLinkHref.trim();
    if (ctaType === 'collection') {
      return ctaCollectionSlug ? `${COLLECTION_PREFIX}${ctaCollectionSlug}` : '';
    }
    if (ctaType === 'brand') {
      return ctaBrandSlug ? `${BRAND_PREFIX}${ctaBrandSlug}` : '';
    }
    return '';
  }, [ctaType, ctaLinkHref, ctaCollectionSlug, ctaBrandSlug]);

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([adminCollectionsService.list(), adminBrandsService.list()])
      .then(([c, b]) => {
        if (cancelled) return;
        setCollections(c.data?.collections ?? []);
        setBrands(b.data?.brands ?? []);
      })
      .catch(() => {
        // Non-fatal — the link-type fallback still works.
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Escape — small affordance that matches the rest of the
  // admin app's drawer/modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const res = await adminStorefrontContentService.uploadImage(definition.slot, file);
      if (res.data?.imageUrl) setImageUrl(res.data.imageUrl);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSaveText() {
    setSaving(true);
    setErr(null);
    try {
      await adminStorefrontContentService.upsert(definition.slot, {
        // Image is owned by the upload flow above; we deliberately
        // omit imageUrl so a text save can't accidentally clear it.
        eyebrow: eyebrow || null,
        headline: headline || null,
        subhead: subhead || null,
        ctaLabel: ctaLabel || null,
        ctaHref: composedCtaHref || null,
        price: price.trim() || null,
        priceCaption: priceCaption.trim() || null,
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function performReset() {
    setResetting(true);
    setErr(null);
    try {
      await adminStorefrontContentService.reset(definition.slot);
      setResetConfirmOpen(false);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Reset failed');
      setResetConfirmOpen(false);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <aside style={drawer} onClick={(e) => e.stopPropagation()}>
        <header style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
                {definition.label}
              </h2>
              <code style={{ fontSize: 11, color: '#64748B' }}>{definition.slot}</code>
            </div>
            <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
          </div>
        </header>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {err && <div style={errBox}>{err}</div>}

          <section style={{ marginBottom: 24 }}>
            <label style={lbl}>Image</label>
            <div
              style={{
                aspectRatio: definition.aspect,
                background: imageUrl
                  ? `#0F1115 url(${imageUrl}) center/cover no-repeat`
                  : 'repeating-linear-gradient(45deg, #F3F4F6 0 8px, #E5E7EB 8px 16px)',
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                marginBottom: 8,
                position: 'relative',
                display: 'grid',
                placeItems: 'center',
                color: '#64748B',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {!imageUrl && 'no image — fallback in effect'}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleUpload}
              disabled={uploading}
              style={{ fontSize: 12 }}
            />
            {uploading && (
              <div style={{ fontSize: 12, color: '#2563EB', marginTop: 4 }}>Uploading…</div>
            )}
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              JPEG / PNG / WebP, ≤ 5 MB. Stored on Cloudinary.
            </p>
          </section>

          <section>
            <label style={lbl}>Eyebrow (small label above headline)</label>
            <input
              type="text"
              value={eyebrow}
              onChange={(e) => setEyebrow(e.target.value)}
              placeholder="e.g. New arrival"
              style={input}
            />

            <label style={lbl}>Headline</label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. Run further. Train smarter."
              style={input}
            />

            <label style={lbl}>Subhead</label>
            <textarea
              value={subhead}
              onChange={(e) => setSubhead(e.target.value)}
              placeholder="One-line description"
              rows={2}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>Price (overlay on tile)</label>
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="₹999"
                  style={input}
                />
                <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                  Leave blank to hide the price overlay.
                </p>
              </div>
              <div>
                <label style={lbl}>Price caption</label>
                <input
                  type="text"
                  value={priceCaption}
                  onChange={(e) => setPriceCaption(e.target.value)}
                  placeholder="Onwards"
                  style={input}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>CTA label</label>
                <input
                  type="text"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="Shop now"
                  style={input}
                />
              </div>
              <div>
                <label style={lbl}>CTA link type</label>
                <select
                  value={ctaType}
                  onChange={(e) => setCtaType(e.target.value as CtaLinkType)}
                  style={input}
                >
                  <option value="link">Link</option>
                  <option value="collection">Collection</option>
                  <option value="brand">Brand</option>
                </select>
              </div>
            </div>

            {ctaType === 'link' && (
              <>
                <label style={lbl}>CTA href</label>
                <input
                  type="text"
                  value={ctaLinkHref}
                  onChange={(e) => setCtaLinkHref(e.target.value)}
                  placeholder="/products?sport=running"
                  style={input}
                />
              </>
            )}

            {ctaType === 'collection' && (
              <>
                <label style={lbl}>Collection</label>
                <select
                  value={ctaCollectionSlug}
                  onChange={(e) => setCtaCollectionSlug(e.target.value)}
                  style={input}
                  disabled={loadingOptions}
                >
                  <option value="">
                    {loadingOptions ? 'Loading collections…' : 'Select a collection'}
                  </option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {composedCtaHref && (
                  <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                    Links to <code>{composedCtaHref}</code>
                  </p>
                )}
              </>
            )}

            {ctaType === 'brand' && (
              <>
                <label style={lbl}>Brand</label>
                <select
                  value={ctaBrandSlug}
                  onChange={(e) => setCtaBrandSlug(e.target.value)}
                  style={input}
                  disabled={loadingOptions}
                >
                  <option value="">
                    {loadingOptions ? 'Loading brands…' : 'Select a brand'}
                  </option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.slug}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {composedCtaHref && (
                  <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                    Links to <code>{composedCtaHref}</code>
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <footer style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 8 }}>
          <button
            onClick={() => setResetConfirmOpen(true)}
            disabled={resetting}
            style={dangerBtn}
          >
            {resetting ? 'Resetting…' : 'Reset to fallback'}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={handleSaveText} disabled={saving || uploading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </aside>

      {resetConfirmOpen && (
        <ConfirmModal
          title={`Reset "${definition.label}" to fallback?`}
          confirmLabel="Reset slot"
          busy={resetting}
          onCancel={() => (resetting ? null : setResetConfirmOpen(false))}
          onConfirm={performReset}
          message={
            <>
              <p style={{ margin: 0 }}>
                This removes the uploaded image and all copy for this slot.
                The storefront will fall back to the curated placeholder.
              </p>
              <p style={{ marginTop: 10, marginBottom: 0, color: '#475569' }}>
                You can re-customise the slot any time after.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 17, 21, 0.4)',
  // Above the dashboard navbar (z-index 200) + sidebar (z-index 100) in
  // dashboard.css — otherwise this right slide-over's header clips behind the
  // fixed navbar and the panel looks half-cut.
  zIndex: 1000,
  display: 'flex',
  justifyContent: 'flex-end',
};
const drawer: React.CSSProperties = {
  width: '100%',
  maxWidth: 540,
  background: '#fff',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-8px 0 24px rgba(15, 17, 21, 0.15)',
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
  marginBottom: 4,
  marginTop: 12,
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
  marginBottom: 12,
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
const dangerBtn: React.CSSProperties = {
  background: '#fff',
  color: '#B91C1C',
  border: '1px solid #FCA5A5',
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
