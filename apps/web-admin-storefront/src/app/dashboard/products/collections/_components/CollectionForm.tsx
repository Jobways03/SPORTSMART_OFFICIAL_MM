'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { RichTextEditor } from '@sportsmart/ui';

/* ── types ── */
interface CollectionProduct {
  product: {
    id: string;
    title: string;
    slug: string;
    status: string;
    basePrice: number | null;
    images: { url: string }[];
  };
}

interface CollectionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  products: CollectionProduct[];
  productCount: number;
}

interface BrowseProduct {
  id: string;
  title: string;
  imageUrl: string | null;
}

/* ── component ── */
export default function CollectionForm({ collectionId }: { collectionId?: string }) {
  const router = useRouter();
  const isEdit = !!collectionId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [products, setProducts] = useState<CollectionProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Image
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // SEO
  const [seoOpen, setSeoOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [urlHandle, setUrlHandle] = useState('');

  // Browse modal
  const [showBrowse, setShowBrowse] = useState(false);
  const [browseProducts, setBrowseProducts] = useState<BrowseProduct[]>([]);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSelected, setBrowseSelected] = useState<Set<string>>(new Set());
  const [browseLoading, setBrowseLoading] = useState(false);

  const computedSlug = urlHandle || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  useEffect(() => {
    if (!collectionId) return;
    apiClient<CollectionDetail>(`/admin/collections/${collectionId}`)
      .then((res) => {
        if (res.data) {
          setName(res.data.name);
          setDescription(res.data.description || '');
          setProducts(res.data.products);
          setImageUrl(res.data.imageUrl || null);
          setPageTitle(res.data.name);
          setUrlHandle(res.data.slug);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await apiClient(`/admin/collections/${collectionId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description, slug: urlHandle || undefined }),
        });
      } else {
        const res = await apiClient<{ id: string }>('/admin/collections', {
          method: 'POST',
          body: JSON.stringify({ name, description, slug: urlHandle || undefined }),
        });
        if (res.data?.id) {
          if (products.length > 0) {
            await apiClient(`/admin/collections/${res.data.id}/products`, {
              method: 'POST',
              body: JSON.stringify({ productIds: products.map((p) => p.product.id) }),
            });
          }
          router.push(`/dashboard/products/collections/${res.data.id}`);
          return;
        }
      }
      router.push('/dashboard/products/collections');
    } catch { /* */ } finally { setSaving(false); }
  };

  const fetchBrowseProducts = useCallback(() => {
    setBrowseLoading(true);
    const params = new URLSearchParams({ limit: '50', status: 'ACTIVE' });
    if (browseSearch.trim()) params.set('search', browseSearch.trim());
    apiClient<{ products: any[] }>(`/admin/products?${params}`)
      .then((res) => {
        const existing = new Set(products.map((p) => p.product.id));
        const mapped = (res.data?.products || []).map((p: any) => ({
          id: p.id, title: p.title, imageUrl: p.images?.[0]?.url || null,
        }));
        setBrowseProducts(mapped);
        setBrowseSelected(new Set(mapped.filter((m: BrowseProduct) => existing.has(m.id)).map((m: BrowseProduct) => m.id)));
      })
      .catch(() => {})
      .finally(() => setBrowseLoading(false));
  }, [browseSearch, products]);

  const openBrowse = () => { setShowBrowse(true); fetchBrowseProducts(); };

  const handleBrowseAdd = async () => {
    const newIds = [...browseSelected].filter((id) => !products.some((p) => p.product.id === id));
    if (newIds.length > 0 && isEdit) {
      await apiClient(`/admin/collections/${collectionId}/products`, {
        method: 'POST', body: JSON.stringify({ productIds: newIds }),
      });
      const res = await apiClient<CollectionDetail>(`/admin/collections/${collectionId}`);
      if (res.data) setProducts(res.data.products);
    } else if (newIds.length > 0) {
      const newProducts = browseProducts.filter((bp) => newIds.includes(bp.id)).map((bp) => ({
        product: { id: bp.id, title: bp.title, slug: '', status: 'ACTIVE', basePrice: null, images: bp.imageUrl ? [{ url: bp.imageUrl }] : [] },
      }));
      setProducts((prev) => [...prev, ...newProducts]);
    }
    setShowBrowse(false);
  };

  const handleRemoveProduct = async (productId: string) => {
    if (isEdit) await apiClient(`/admin/collections/${collectionId}/products/${productId}`, { method: 'DELETE' });
    setProducts((prev) => prev.filter((p) => p.product.id !== productId));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !collectionId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const json = await apiClient<{ imageUrl?: string }>(
        `/admin/collections/${collectionId}/image`,
        { method: 'POST', body: formData },
      );
      if (json.data?.imageUrl) setImageUrl(json.data.imageUrl);
    } catch { /* */ }
    finally { setUploading(false); }
    e.target.value = '';
  };

  const handleImageRemove = async () => {
    if (!collectionId) { setImageUrl(null); return; }
    await apiClient(`/admin/collections/${collectionId}/image`, { method: 'DELETE' });
    setImageUrl(null);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#9ca3af', fontSize: 14 }}>Loading collection...</div>;

  /* ────────── RENDER ────────── */
  return (
    <div style={{ maxWidth: 1060, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Link href="/dashboard/products/collections" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>
          &#8592;
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {isEdit ? name || 'Edit collection' : 'Add collection'}
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* ═══════ LEFT ═══════ */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>

          {/* ── Title & Description ── */}
          <section style={card}>
            <label style={label}>Title</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Summer collection, Under $100, Staff picks"
              style={input}
            />
            <label style={{ ...label, marginTop: 18 }}>Description</label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Describe this collection..."
              minHeight={160}
            />
          </section>

          {/* ── Collection type ── */}
          <section style={card}>
            <h3 style={cardTitle}>Collection type</h3>
            <label style={{ display: 'flex', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
              <input type="radio" name="type" checked readOnly style={{ accentColor: '#111', marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Manual</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Add products to this collection one by one.</div>
              </div>
            </label>
            <label style={{ display: 'flex', gap: 10, cursor: 'default', padding: '6px 0', opacity: 0.5 }}>
              <input type="radio" name="type" disabled style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Smart</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Existing and future products that match the conditions you set will be added automatically.</div>
              </div>
            </label>
          </section>

          {/* ── Products ── */}
          <section style={card}>
            <h3 style={cardTitle}>Products</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14, pointerEvents: 'none' }}>&#128269;</span>
                <input
                  type="text"
                  placeholder="Search products"
                  style={{ ...input, paddingLeft: 32 }}
                  onFocus={openBrowse}
                  readOnly
                />
              </div>
              <button onClick={openBrowse} style={outlineBtn}>Browse</button>
              <select style={{ ...input, width: 'auto', minWidth: 140, color: '#6b7280' }} disabled>
                <option>Sort: Best selling</option>
              </select>
            </div>

            {products.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 20px' }}>
                <div style={{ fontSize: 40, color: '#e5e7eb', marginBottom: 10 }}>&#127991;</div>
                <div style={{ fontSize: 14, color: '#6b7280', fontWeight: 500 }}>There are no products in this collection.</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>Search or browse to add products.</div>
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                {products.map((p, i) => (
                  <div
                    key={p.product.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', background: i % 2 === 0 ? '#fff' : '#fafbfc',
                      borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                    }}
                  >
                    <span style={{ color: '#c4c4c4', fontSize: 11, cursor: 'grab', userSelect: 'none' }}>&#8942;&#8942;</span>
                    <span style={{ fontSize: 13, color: '#9ca3af', width: 22, textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                    <Thumb url={p.product.images[0]?.url} />
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#111', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.product.title}
                    </div>
                    <StatusPill status={p.product.status} />
                    <button onClick={() => handleRemoveProduct(p.product.id)} style={removeBtn} title="Remove">&times;</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── SEO ── */}
          <section style={{ ...card, background: seoOpen ? '#fff' : '#fafbfc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ ...cardTitle, marginBottom: 0 }}>Search engine listing</h3>
              <button onClick={() => setSeoOpen(!seoOpen)} style={editPencilBtn} title="Edit SEO">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
            </div>

            {/* Preview */}
            {(name || pageTitle) ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a0dab' }}>{pageTitle || name}</div>
                <div style={{ fontSize: 12, color: '#006621', marginTop: 2 }}>
                  https://sportsmart.com &rsaquo; collections &rsaquo; {computedSlug}
                </div>
                {metaDescription && (
                  <div style={{ fontSize: 13, color: '#545454', marginTop: 4, lineHeight: 1.45 }}>{metaDescription}</div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#9ca3af', margin: '12px 0 0' }}>
                Add a title and description to see how this collection might appear in a search engine listing
              </p>
            )}

            {/* Editable SEO fields */}
            {seoOpen && (
              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 18, paddingTop: 18 }}>
                <div style={{ marginBottom: 18 }}>
                  <label style={label}>Page title</label>
                  <input type="text" value={pageTitle} onChange={(e) => setPageTitle(e.target.value.slice(0, 70))} placeholder={name || 'Page title'} style={input} />
                  <span style={charCount}>{pageTitle.length} of 70 characters used</span>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={label}>Meta description</label>
                  <textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value.slice(0, 160))} placeholder="Enter a meta description..." rows={3} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                  <span style={charCount}>{metaDescription.length} of 160 characters used</span>
                </div>
                <div>
                  <label style={label}>URL handle</label>
                  <div style={{ display: 'flex' }}>
                    <span style={slugPrefix}>collections/</span>
                    <input
                      type="text"
                      value={urlHandle}
                      onChange={(e) => setUrlHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'url-handle'}
                      style={{ ...input, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', flex: 1 }}
                    />
                  </div>
                  <span style={charCount}>https://sportsmart.com/collections/{computedSlug}</span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ═══════ RIGHT SIDEBAR ═══════ */}
        <div style={{ flex: '0 0 300px', minWidth: 260 }}>
          {/* Publishing */}
          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ ...cardTitle, marginBottom: 0 }}>Publishing</h3>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Sales channels</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', padding: '4px 0' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #9ca3af', display: 'inline-block' }} />
              Online Store
            </div>
          </section>

          {/* Image */}
          <section style={card}>
            <h3 style={{ ...cardTitle, marginBottom: 12 }}>Image</h3>
            {imageUrl ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={imageUrl}
                  alt="Collection"
                  style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', display: 'block' }}
                />
                <button
                  onClick={handleImageRemove}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    border: 'none', cursor: 'pointer', fontSize: 14,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  title="Remove image"
                >
                  &times;
                </button>
              </div>
            ) : (
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '28px 16px', border: '2px dashed #d1d5db', borderRadius: 10,
                cursor: isEdit ? 'pointer' : 'default', background: '#fafbfc',
                transition: 'border-color 0.2s',
              }}>
                {uploading ? (
                  <span style={{ fontSize: 13, color: '#6b7280' }}>Uploading...</span>
                ) : (
                  <>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    {isEdit ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Add image</span>
                        <span style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>or drop an image to upload</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>Save the collection first, then add an image</span>
                    )}
                  </>
                )}
                {isEdit && (
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                )}
              </label>
            )}
          </section>

          {/* Theme template */}
          <section style={card}>
            <h3 style={{ ...cardTitle, marginBottom: 8 }}>Theme template</h3>
            <select style={{ ...input, color: '#374151' }} disabled>
              <option>Default collection</option>
            </select>
          </section>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{
              width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 600,
              background: name.trim() ? '#303030' : '#e5e7eb',
              color: name.trim() ? '#fff' : '#9ca3af',
              border: 'none', borderRadius: 8,
              cursor: name.trim() ? 'pointer' : 'default',
              marginTop: 4,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ═══════ BROWSE MODAL ═══════ */}
      {showBrowse && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: 580, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Add products</h2>
              <button onClick={() => setShowBrowse(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>&times;</button>
            </div>

            {/* Search */}
            <div style={{ padding: '14px 22px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14, pointerEvents: 'none' }}>&#128269;</span>
                <input
                  type="text"
                  placeholder="Search products"
                  value={browseSearch}
                  onChange={(e) => setBrowseSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchBrowseProducts()}
                  style={{ ...input, paddingLeft: 32, borderColor: '#2563eb', boxShadow: '0 0 0 2px rgba(37,99,235,0.15)' }}
                  autoFocus
                />
              </div>
            </div>

            {/* Product list */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 420 }}>
              {browseLoading ? (
                <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af', fontSize: 14 }}>Loading products...</div>
              ) : browseProducts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af', fontSize: 14 }}>No products found</div>
              ) : (
                browseProducts.map((bp, i) => {
                  const checked = browseSelected.has(bp.id);
                  return (
                    <label
                      key={bp.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '11px 22px',
                        borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                        background: checked ? '#f0f7ff' : i % 2 === 0 ? '#fff' : '#fafbfc',
                        transition: 'background 0.1s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setBrowseSelected((prev) => {
                            const next = new Set(prev);
                            next.has(bp.id) ? next.delete(bp.id) : next.add(bp.id);
                            return next;
                          });
                        }}
                        style={{ width: 17, height: 17, accentColor: '#111', flexShrink: 0 }}
                      />
                      <Thumb url={bp.imageUrl} size={44} />
                      <span style={{ fontSize: 14, color: '#111', fontWeight: checked ? 600 : 400 }}>{bp.title}</span>
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '14px 22px', borderTop: '1px solid #e5e7eb', background: '#fafbfc', borderRadius: '0 0 14px 14px' }}>
              <span style={{ flex: 1, fontSize: 13, color: '#6b7280' }}>
                {browseSelected.size} selected
              </span>
              <button onClick={() => setShowBrowse(false)} style={outlineBtn}>Cancel</button>
              <button onClick={handleBrowseAdd} style={primaryBtn}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── Sub-components ────────── */
function Thumb({ url, size = 40 }: { url?: string | null; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, background: '#f3f4f6',
      border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isActive = status === 'ACTIVE';
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
      background: isActive ? '#dcfce7' : '#f3f4f6',
      color: isActive ? '#15803d' : '#6b7280',
      whiteSpace: 'nowrap',
    }}>
      {isActive ? 'Active' : status}
    </span>
  );
}

/* ────────── Styles ────────── */
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
  padding: '20px 22px', marginBottom: 14,
};
const cardTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: '#111', margin: '0 0 14px',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#303030', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 14, color: '#111',
  border: '1px solid #c9cccf', borderRadius: 8, background: '#fff',
  outline: 'none', boxSizing: 'border-box',
};
const charCount: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#9ca3af', marginTop: 5,
};
const slugPrefix: React.CSSProperties = {
  fontSize: 14, color: '#6b7280', padding: '9px 0 9px 12px',
  background: '#f6f6f7', border: '1px solid #c9cccf', borderRight: 'none',
  borderRadius: '8px 0 0 8px', whiteSpace: 'nowrap',
};
const outlineBtn: React.CSSProperties = {
  padding: '8px 18px', fontSize: 13, fontWeight: 600,
  border: '1px solid #c9cccf', borderRadius: 8, background: '#fff',
  color: '#303030', cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 22px', fontSize: 13, fontWeight: 600,
  border: 'none', borderRadius: 8, background: '#303030',
  color: '#fff', cursor: 'pointer',
};
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 18, color: '#b0b0b0', padding: '2px 6px', lineHeight: 1,
};
const editPencilBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center',
};
