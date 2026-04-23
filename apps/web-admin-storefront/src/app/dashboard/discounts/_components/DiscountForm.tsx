'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface SelectedProduct { id: string; title: string; imageUrl: string | null; }
interface SelectedCollection { id: string; name: string; productCount: number; imageUrl: string | null; }
interface SelectedCustomer { id: string; firstName: string; lastName: string; email: string; }

const TYPE_LABELS: Record<string, string> = {
  AMOUNT_OFF_PRODUCTS: 'Amount off products',
  AMOUNT_OFF_ORDER: 'Amount off order',
  BUY_X_GET_Y: 'Buy X get Y',
  FREE_SHIPPING: 'Free shipping',
};

const TYPE_ICONS: Record<string, string> = {
  AMOUNT_OFF_PRODUCTS: 'Product discount',
  AMOUNT_OFF_ORDER: 'Order discount',
  BUY_X_GET_Y: 'Product discount',
  FREE_SHIPPING: 'Shipping discount',
};

function randomCode() {
  return Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}

export default function DiscountForm({ discountId, discountType }: { discountId?: string; discountType?: string }) {
  const router = useRouter();
  const isEdit = !!discountId;

  const [type, setType] = useState(discountType || 'AMOUNT_OFF_ORDER');
  const [method, setMethod] = useState<'CODE' | 'AUTOMATIC'>('CODE');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [valueType, setValueType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [appliesTo, setAppliesTo] = useState('ALL_PRODUCTS');
  const [minReq, setMinReq] = useState('NONE');
  const [minReqValue, setMinReqValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [limitTotal, setLimitTotal] = useState(false);
  const [onePerCustomer, setOnePerCustomer] = useState(false);
  const [combProd, setCombProd] = useState(false);
  const [combOrder, setCombOrder] = useState(false);
  const [combShip, setCombShip] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5));
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  // BXGY
  const [buyType, setBuyType] = useState('MIN_QUANTITY');
  const [buyValue, setBuyValue] = useState('');
  const [getQuantity, setGetQuantity] = useState('');
  const [getDiscountType, setGetDiscountType] = useState<'PERCENTAGE' | 'AMOUNT_OFF' | 'FREE'>('PERCENTAGE');
  const [getDiscountValue, setGetDiscountValue] = useState('');

  // Eligibility
  const [eligibility, setEligibility] = useState<'ALL_CUSTOMERS' | 'SPECIFIC_CUSTOMERS'>('ALL_CUSTOMERS');
  const [selectedCustomers, setSelectedCustomers] = useState<SelectedCustomer[]>([]);

  // Selected products/collections for "Applies to"
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<SelectedCollection[]>([]);

  // Buy X Get Y — product pickers
  const [selectedBuyProducts, setSelectedBuyProducts] = useState<SelectedProduct[]>([]);
  const [selectedGetProducts, setSelectedGetProducts] = useState<SelectedProduct[]>([]);

  // Browse modals
  const [browseMode, setBrowseMode] = useState<'products' | 'collections' | 'customers' | 'buy-products' | 'get-products' | null>(null);
  const [browseItems, setBrowseItems] = useState<any[]>([]);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSelected, setBrowseSelected] = useState<Set<string>>(new Set());
  const [browseLoading, setBrowseLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [status, setStatus] = useState('ACTIVE');

  // Load existing
  useEffect(() => {
    if (!discountId) return;
    apiClient<any>(`/admin/discounts/${discountId}`)
      .then((r) => {
        const d = r.data;
        if (!d) return;
        setType(d.type);
        setMethod(d.method);
        setCode(d.code || '');
        setTitle(d.title || '');
        setValueType(d.valueType);
        setValue(String(Number(d.value)));
        setAppliesTo(d.appliesTo);
        setMinReq(d.minRequirement);
        setMinReqValue(d.minRequirementValue ? String(Number(d.minRequirementValue)) : '');
        setMaxUses(d.maxUses ? String(d.maxUses) : '');
        setLimitTotal(!!d.maxUses);
        setOnePerCustomer(d.onePerCustomer);
        setCombProd(d.combineProduct);
        setCombOrder(d.combineOrder);
        setCombShip(d.combineShipping);
        setStatus(d.status);
        const sd = new Date(d.startsAt);
        setStartDate(sd.toISOString().slice(0, 10));
        setStartTime(sd.toTimeString().slice(0, 5));
        if (d.endsAt) {
          setHasEnd(true);
          const ed = new Date(d.endsAt);
          setEndDate(ed.toISOString().slice(0, 10));
          setEndTime(ed.toTimeString().slice(0, 5));
        }
        if (d.buyType) setBuyType(d.buyType);
        if (d.buyValue) setBuyValue(String(Number(d.buyValue)));
        if (d.getQuantity) setGetQuantity(String(d.getQuantity));
        if (d.getDiscountType) setGetDiscountType(d.getDiscountType);
        if (d.getDiscountValue) setGetDiscountValue(String(Number(d.getDiscountValue)));
        if (Array.isArray(d.products)) {
          const toSel = (row: any) => ({
            id: row.product?.id ?? row.productId,
            title: row.product?.title ?? '',
            imageUrl: row.product?.images?.[0]?.url ?? null,
          });
          setSelectedBuyProducts(d.products.filter((r: any) => r.scope === 'BUY').map(toSel));
          setSelectedGetProducts(d.products.filter((r: any) => r.scope === 'GET').map(toSel));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [discountId]);

  // Browse products/collections
  const fetchBrowseItems = useCallback(() => {
    setBrowseLoading(true);
    if (browseMode === 'products' || browseMode === 'buy-products' || browseMode === 'get-products') {
      const p = new URLSearchParams({ limit: '50', status: 'ACTIVE' });
      if (browseSearch.trim()) p.set('search', browseSearch.trim());
      apiClient<{ products: any[] }>(`/admin/products?${p}`)
        .then((r) => {
          setBrowseItems((r.data?.products || []).map((pr: any) => ({
            id: pr.id, title: pr.title, imageUrl: pr.images?.[0]?.url || null,
            stock: pr.variants?.[0]?.stock ?? pr.baseStock ?? 0,
            price: pr.variants?.[0]?.price ?? pr.basePrice ?? 0,
          })));
        })
        .catch(() => {})
        .finally(() => setBrowseLoading(false));
    } else if (browseMode === 'collections') {
      apiClient<any>(`/admin/collections?limit=100${browseSearch ? `&search=${browseSearch}` : ''}`)
        .then((r) => {
          setBrowseItems((r.data?.collections || []).map((c: any) => ({
            id: c.id, name: c.name, productCount: c.productCount, imageUrl: c.imageUrl || null,
          })));
        })
        .catch(() => {})
        .finally(() => setBrowseLoading(false));
    } else if (browseMode === 'customers') {
      const p = new URLSearchParams({ limit: '50' });
      if (browseSearch.trim()) p.set('search', browseSearch.trim());
      apiClient<any>(`/admin/customers?${p}`)
        .then((r) => {
          setBrowseItems((r.data?.customers || []).map((c: any) => ({
            id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email,
          })));
        })
        .catch(() => {})
        .finally(() => setBrowseLoading(false));
    }
  }, [browseMode, browseSearch]);

  const openBrowse = (mode: 'products' | 'collections' | 'customers' | 'buy-products' | 'get-products') => {
    setBrowseMode(mode);
    setBrowseSearch('');
    const existing =
      mode === 'products' ? selectedProducts.map((p) => p.id)
      : mode === 'buy-products' ? selectedBuyProducts.map((p) => p.id)
      : mode === 'get-products' ? selectedGetProducts.map((p) => p.id)
      : mode === 'collections' ? selectedCollections.map((c) => c.id)
      : selectedCustomers.map((c) => c.id);
    setBrowseSelected(new Set(existing));
    setTimeout(() => fetchBrowseItems(), 0);
  };

  useEffect(() => { if (browseMode) fetchBrowseItems(); }, [browseMode, fetchBrowseItems]);

  const handleBrowseAdd = () => {
    if (browseMode === 'products' || browseMode === 'buy-products' || browseMode === 'get-products') {
      const target =
        browseMode === 'buy-products' ? selectedBuyProducts
        : browseMode === 'get-products' ? selectedGetProducts
        : selectedProducts;
      const newProds = browseItems
        .filter((i) => browseSelected.has(i.id) && !target.some((p) => p.id === i.id))
        .map((i) => ({ id: i.id, title: i.title, imageUrl: i.imageUrl }));
      if (browseMode === 'buy-products') setSelectedBuyProducts((prev) => [...prev, ...newProds]);
      else if (browseMode === 'get-products') setSelectedGetProducts((prev) => [...prev, ...newProds]);
      else setSelectedProducts((prev) => [...prev, ...newProds]);
    } else if (browseMode === 'collections') {
      const newColls = browseItems
        .filter((i) => browseSelected.has(i.id) && !selectedCollections.some((c) => c.id === i.id))
        .map((i) => ({ id: i.id, name: i.name, productCount: i.productCount, imageUrl: i.imageUrl }));
      setSelectedCollections((prev) => [...prev, ...newColls]);
    } else if (browseMode === 'customers') {
      const newCusts = browseItems
        .filter((i) => browseSelected.has(i.id) && !selectedCustomers.some((c) => c.id === i.id))
        .map((i) => ({ id: i.id, firstName: i.firstName, lastName: i.lastName, email: i.email }));
      setSelectedCustomers((prev) => [...prev, ...newCusts]);
    }
    setBrowseMode(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const startsAt = new Date(`${startDate}T${startTime || '00:00'}`).toISOString();
      const endsAt = hasEnd && endDate ? new Date(`${endDate}T${endTime || '23:59'}`).toISOString() : null;

      const payload: any = {
        type, method, valueType,
        value: parseFloat(value) || 0,
        appliesTo,
        minRequirement: minReq,
        minRequirementValue: minReq !== 'NONE' ? parseFloat(minReqValue) || 0 : null,
        maxUses: limitTotal ? parseInt(maxUses) || null : null,
        onePerCustomer,
        combineProduct: combProd,
        combineOrder: combOrder,
        combineShipping: combShip,
        startsAt, endsAt,
        eligibility,
        customerIds: eligibility === 'SPECIFIC_CUSTOMERS' ? selectedCustomers.map((c) => c.id) : [],
        productIds: appliesTo === 'SPECIFIC_PRODUCTS' ? selectedProducts.map((p) => p.id) : [],
        collectionIds: appliesTo === 'SPECIFIC_COLLECTIONS' ? selectedCollections.map((c) => c.id) : [],
      };

      if (method === 'CODE') { payload.code = code; payload.title = null; }
      else { payload.title = title; payload.code = null; }

      if (type === 'BUY_X_GET_Y') {
        payload.buyType = buyType;
        payload.buyValue = parseFloat(buyValue) || 0;
        payload.buyItemsFrom = 'SPECIFIC_PRODUCTS';
        payload.getQuantity = parseInt(getQuantity) || 1;
        payload.getItemsFrom = 'SPECIFIC_PRODUCTS';
        payload.getDiscountType = getDiscountType;
        payload.getDiscountValue = getDiscountType !== 'FREE' ? parseFloat(getDiscountValue) || 0 : 0;
        payload.buyProductIds = selectedBuyProducts.map((p) => p.id);
        payload.getProductIds = selectedGetProducts.map((p) => p.id);
      }

      if (isEdit) {
        await apiClient(`/admin/discounts/${discountId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiClient('/admin/discounts', { method: 'POST', body: JSON.stringify(payload) });
      }
      router.push('/dashboard/discounts');
    } catch { /* */ }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#9ca3af' }}>Loading...</div>;

  const displayName = method === 'CODE' ? (code || 'No discount code yet') : (title || 'No title yet');
  const isFreeShipping = type === 'FREE_SHIPPING';
  const isBXGY = type === 'BUY_X_GET_Y';
  const isProduct = type === 'AMOUNT_OFF_PRODUCTS';

  // Summary details
  const details: string[] = [eligibility === 'SPECIFIC_CUSTOMERS' && selectedCustomers.length > 0 ? `${selectedCustomers.length} specific customer${selectedCustomers.length > 1 ? 's' : ''}` : 'All customers', 'For Online Store'];
  if (!isFreeShipping && !isBXGY) {
    const v = valueType === 'PERCENTAGE' ? `${value || 0}%` : `\u20B9${value || 0}`;
    details.push(`${v} off ${type === 'AMOUNT_OFF_ORDER' ? 'entire order' : 'products'}`);
  }
  if (minReq === 'NONE') details.push('No minimum purchase requirement');
  else if (minReq === 'MIN_PURCHASE_AMOUNT') details.push(`Min. purchase: \u20B9${minReqValue || 0}`);
  else details.push(`Min. quantity: ${minReqValue || 0}`);
  if (!limitTotal) details.push('No usage limits');
  if (!combProd && !combOrder && !combShip) details.push("Can't combine with other discounts");
  details.push(`Active from ${startDate}`);

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Link href="/dashboard/discounts" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>&#8592;</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{isEdit ? displayName : 'Create discount'}</h1>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* LEFT */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>

          {/* Type + Method + Code/Title */}
          <section style={card}>
            <h3 style={cardTitle}>{TYPE_LABELS[type] || type}</h3>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Method</div>
            <div style={{ display: 'inline-flex', border: '1px solid #c9cccf', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
              <button onClick={() => setMethod('CODE')} style={{ ...toggleBtn, ...(method === 'CODE' ? toggleActive : {}) }}>Discount code</button>
              <button onClick={() => setMethod('AUTOMATIC')} style={{ ...toggleBtn, ...(method === 'AUTOMATIC' ? toggleActive : {}) }}>Automatic discount</button>
            </div>

            {method === 'CODE' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={label}>Discount code</label>
                  <button onClick={() => setCode(randomCode())} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Generate random code</button>
                </div>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={input} />
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Customers must enter this code at checkout.</div>
              </div>
            ) : (
              <div>
                <label style={label}>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Customers will see this in their cart and at checkout.</div>
              </div>
            )}
          </section>

          {/* Discount value (not for free shipping) */}
          {!isFreeShipping && !isBXGY && (
            <section style={card}>
              <h3 style={cardTitle}>Discount value</h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <select value={valueType} onChange={(e) => setValueType(e.target.value as any)} style={{ ...input, flex: '0 0 180px' }}>
                  <option value="PERCENTAGE">Percentage</option>
                  <option value="FIXED_AMOUNT">Fixed amount</option>
                </select>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={{ ...input, paddingRight: 30 }} placeholder="0" />
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 14 }}>
                    {valueType === 'PERCENTAGE' ? '%' : '\u20B9'}
                  </span>
                </div>
              </div>
              {isProduct && (
                <div style={{ marginTop: 16 }}>
                  <label style={label}>Applies to</label>
                  <select value={appliesTo} onChange={(e) => { setAppliesTo(e.target.value); setSelectedProducts([]); setSelectedCollections([]); }} style={input}>
                    <option value="ALL_PRODUCTS">All products</option>
                    <option value="SPECIFIC_COLLECTIONS">Specific collections</option>
                    <option value="SPECIFIC_PRODUCTS">Specific products</option>
                  </select>

                  {appliesTo === 'SPECIFIC_PRODUCTS' && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                          <input placeholder="Search products" style={{ ...input, paddingLeft: 32 }} onFocus={() => openBrowse('products')} readOnly />
                        </div>
                        <button onClick={() => openBrowse('products')} style={outBtn}>Browse</button>
                      </div>
                      {selectedProducts.map((p) => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#d1d5db', fontSize: 14 }}>&#128722;</span>}
                          </div>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.title}</span>
                          <button onClick={() => setSelectedProducts((prev) => prev.filter((x) => x.id !== p.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>&times;</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {appliesTo === 'SPECIFIC_COLLECTIONS' && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                          <input placeholder="Search collections" style={{ ...input, paddingLeft: 32 }} onFocus={() => openBrowse('collections')} readOnly />
                        </div>
                        <button onClick={() => openBrowse('collections')} style={outBtn}>Browse</button>
                      </div>
                      {selectedCollections.map((c) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {c.imageUrl ? <img src={c.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b0b0b0" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>{c.productCount} products</div>
                          </div>
                          <button onClick={() => setSelectedCollections((prev) => prev.filter((x) => x.id !== c.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* BXGY */}
          {isBXGY && (
            <section style={card}>
              <h3 style={cardTitle}>Customer buys</h3>
              <div style={{ marginBottom: 12 }}>
                <RadioOption name="buyType" value="MIN_QUANTITY" checked={buyType === 'MIN_QUANTITY'} onChange={() => setBuyType('MIN_QUANTITY')} label="Minimum quantity of items" />
                <RadioOption name="buyType" value="MIN_AMOUNT" checked={buyType === 'MIN_AMOUNT'} onChange={() => setBuyType('MIN_AMOUNT')} label="Minimum purchase amount" />
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div><label style={label}>Quantity</label><input type="number" value={buyValue} onChange={(e) => setBuyValue(e.target.value)} style={{ ...input, width: 100 }} /></div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Any items from</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                      <input placeholder="Search products" style={{ ...input, paddingLeft: 32 }} onFocus={() => openBrowse('buy-products')} readOnly />
                    </div>
                    <button onClick={() => openBrowse('buy-products')} style={outBtn}>Browse</button>
                  </div>
                </div>
              </div>
              {selectedBuyProducts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {selectedBuyProducts.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#d1d5db', fontSize: 14 }}>&#128722;</span>}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.title}</span>
                      <button onClick={() => setSelectedBuyProducts((prev) => prev.filter((x) => x.id !== p.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>&times;</button>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ ...cardTitle, marginTop: 20 }}>Customer gets</h3>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>Customers must add the quantity of items specified below to their cart.</p>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div><label style={label}>Quantity</label><input type="number" value={getQuantity} onChange={(e) => setGetQuantity(e.target.value)} style={{ ...input, width: 100 }} /></div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Any items from</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                      <input placeholder="Search products" style={{ ...input, paddingLeft: 32 }} onFocus={() => openBrowse('get-products')} readOnly />
                    </div>
                    <button onClick={() => openBrowse('get-products')} style={outBtn}>Browse</button>
                  </div>
                </div>
              </div>
              {selectedGetProducts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {selectedGetProducts.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#d1d5db', fontSize: 14 }}>&#128722;</span>}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.title}</span>
                      <button onClick={() => setSelectedGetProducts((prev) => prev.filter((x) => x.id !== p.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>&times;</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>At a discounted value</div>
              <RadioOption name="getType" value="PERCENTAGE" checked={getDiscountType === 'PERCENTAGE'} onChange={() => setGetDiscountType('PERCENTAGE')} label="Percentage" />
              {getDiscountType === 'PERCENTAGE' && (
                <div style={{ marginLeft: 26, marginBottom: 8 }}>
                  <div style={{ position: 'relative', width: 120 }}>
                    <input type="number" value={getDiscountValue} onChange={(e) => setGetDiscountValue(e.target.value)} style={{ ...input, paddingRight: 26 }} />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }}>%</span>
                  </div>
                </div>
              )}
              <RadioOption name="getType" value="AMOUNT_OFF" checked={getDiscountType === 'AMOUNT_OFF'} onChange={() => setGetDiscountType('AMOUNT_OFF')} label="Amount off each" />
              <RadioOption name="getType" value="FREE" checked={getDiscountType === 'FREE'} onChange={() => setGetDiscountType('FREE')} label="Free" />
            </section>
          )}

          {/* Eligibility */}
          <section style={card}>
            <h3 style={cardTitle}>Eligibility</h3>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Available on all sales channels</div>
            <RadioOption name="elig" value="ALL_CUSTOMERS" checked={eligibility === 'ALL_CUSTOMERS'} onChange={() => { setEligibility('ALL_CUSTOMERS'); setSelectedCustomers([]); }} label="All customers" />
            <RadioOption name="elig" value="SPECIFIC_CUSTOMERS" checked={eligibility === 'SPECIFIC_CUSTOMERS'} onChange={() => setEligibility('SPECIFIC_CUSTOMERS')} label="Specific customers" />

            {eligibility === 'SPECIFIC_CUSTOMERS' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                    <input placeholder="Search customers" style={{ ...input, paddingLeft: 32 }} onFocus={() => openBrowse('customers')} readOnly />
                  </div>
                  <button onClick={() => openBrowse('customers')} style={outBtn}>Browse</button>
                </div>
                {selectedCustomers.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#6b7280', flexShrink: 0 }}>
                      {c.firstName?.[0]?.toUpperCase() || c.email[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{c.email}</div>
                    </div>
                    <button onClick={() => setSelectedCustomers((prev) => prev.filter((x) => x.id !== c.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Min purchase */}
          {!isBXGY && (
            <section style={card}>
              <h3 style={cardTitle}>Minimum purchase requirements</h3>
              <RadioOption name="minReq" value="NONE" checked={minReq === 'NONE'} onChange={() => setMinReq('NONE')} label="No minimum requirements" />
              <RadioOption name="minReq" value="MIN_PURCHASE_AMOUNT" checked={minReq === 'MIN_PURCHASE_AMOUNT'} onChange={() => setMinReq('MIN_PURCHASE_AMOUNT')} label="Minimum purchase amount (\u20B9)" />
              {minReq === 'MIN_PURCHASE_AMOUNT' && (
                <div style={{ marginLeft: 26, marginBottom: 8 }}><input type="number" value={minReqValue} onChange={(e) => setMinReqValue(e.target.value)} style={{ ...input, width: 160 }} placeholder="0.00" /></div>
              )}
              <RadioOption name="minReq" value="MIN_QUANTITY" checked={minReq === 'MIN_QUANTITY'} onChange={() => setMinReq('MIN_QUANTITY')} label="Minimum quantity of items" />
              {minReq === 'MIN_QUANTITY' && (
                <div style={{ marginLeft: 26, marginBottom: 8 }}><input type="number" value={minReqValue} onChange={(e) => setMinReqValue(e.target.value)} style={{ ...input, width: 120 }} placeholder="0" /></div>
              )}
            </section>
          )}

          {/* Max uses */}
          <section style={card}>
            <h3 style={cardTitle}>Maximum discount uses</h3>
            <CheckboxOption checked={limitTotal} onChange={setLimitTotal} label="Limit number of times this discount can be used in total" />
            {limitTotal && (
              <div style={{ marginLeft: 26, marginBottom: 8 }}><input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} style={{ ...input, width: 120 }} /></div>
            )}
            <CheckboxOption checked={onePerCustomer} onChange={setOnePerCustomer} label="Limit to one use per customer" />
          </section>

          {/* Combinations */}
          <section style={card}>
            <h3 style={cardTitle}>Combinations</h3>
            <CheckboxOption checked={combProd} onChange={setCombProd} label="Product discounts" />
            <CheckboxOption checked={combOrder} onChange={setCombOrder} label="Order discounts" />
            <CheckboxOption checked={combShip} onChange={setCombShip} label="Shipping discounts" />
          </section>

          {/* Active dates */}
          <section style={card}>
            <h3 style={cardTitle}>Active dates</h3>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}><label style={label}>Start date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={input} /></div>
              <div style={{ flex: 1 }}><label style={label}>Start time (IST)</label><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={input} /></div>
            </div>
            <CheckboxOption checked={hasEnd} onChange={setHasEnd} label="Set end date" />
            {hasEnd && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <div style={{ flex: 1 }}><label style={label}>End date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={input} /></div>
                <div style={{ flex: 1 }}><label style={label}>End time (IST)</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={input} /></div>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={{ flex: '0 0 300px', minWidth: 260 }}>
          {/* Summary */}
          <section style={card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{displayName}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>{method === 'CODE' ? 'Code' : 'Automatic'}</div>
            {isEdit && (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#15803d' }}>{status}</span>
            )}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 12, marginBottom: 6 }}>Type</div>
            <div style={{ fontSize: 13, color: '#374151' }}>{TYPE_LABELS[type]}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{TYPE_ICONS[type]}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 12, marginBottom: 6 }}>Details</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              {details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </section>

          {/* Sales channel */}
          <section style={card}>
            <h3 style={{ ...cardTitle, marginBottom: 8 }}>Sales channel access</h3>
            <CheckboxOption checked={false} onChange={() => {}} label="Allow discount to be featured on selected channels" disabled />
          </section>

          <button onClick={handleSave} disabled={saving} style={{
            width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 600,
            background: '#303030', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', marginTop: 4,
          }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ═══ BROWSE MODAL ═══ */}
      {browseMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: 600, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                {browseMode === 'buy-products'
                  ? 'Add products customers buy'
                  : browseMode === 'get-products'
                  ? 'Add products customers get'
                  : `Add ${browseMode}`}
              </h2>
              <button onClick={() => setBrowseMode(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>&times;</button>
            </div>
            <div style={{ padding: '14px 22px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>&#128269;</span>
                <input
                  type="text" placeholder={`Search ${browseMode === 'buy-products' || browseMode === 'get-products' ? 'products' : browseMode}`}
                  value={browseSearch} onChange={(e) => setBrowseSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchBrowseItems()}
                  style={{ ...input, paddingLeft: 32, borderColor: '#2563eb', boxShadow: '0 0 0 2px rgba(37,99,235,0.15)' }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 420 }}>
              {browseLoading ? (
                <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af' }}>Loading...</div>
              ) : browseItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af' }}>No {browseMode === 'buy-products' || browseMode === 'get-products' ? 'products' : browseMode} found</div>
              ) : (browseMode === 'products' || browseMode === 'buy-products' || browseMode === 'get-products') ? (
                <>
                  <div style={{ display: 'flex', padding: '8px 22px', borderBottom: '1px solid #e5e7eb', background: '#fafbfc' }}>
                    <span style={{ width: 32 }} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Product</span>
                    <span style={{ width: 80, fontSize: 12, fontWeight: 600, color: '#6b7280', textAlign: 'center' }}>Available</span>
                    <span style={{ width: 90, fontSize: 12, fontWeight: 600, color: '#6b7280', textAlign: 'right' }}>Price</span>
                  </div>
                  {browseItems.map((item, i) => {
                    const checked = browseSelected.has(item.id);
                    return (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 22px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: checked ? '#f0f7ff' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                        <input type="checkbox" checked={checked} onChange={() => setBrowseSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })} style={{ width: 16, height: 16, marginRight: 12, accentColor: '#111' }} />
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, marginRight: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#d1d5db', fontSize: 14 }}>&#128722;</span>}
                        </div>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: checked ? 600 : 400, color: '#111' }}>{item.title}</span>
                        <span style={{ width: 80, textAlign: 'center', fontSize: 13, color: '#374151' }}>{item.stock}</span>
                        <span style={{ width: 90, textAlign: 'right', fontSize: 13, color: '#374151' }}>{`\u20B9${Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</span>
                      </label>
                    );
                  })}
                </>
              ) : browseMode === 'collections' ? (
                browseItems.map((item, i) => {
                  const checked = browseSelected.has(item.id);
                  return (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: checked ? '#f0f7ff' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                      <input type="checkbox" checked={checked} onChange={() => setBrowseSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })} style={{ width: 16, height: 16, accentColor: '#111' }} />
                      <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b0b0b0" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: checked ? 600 : 400, color: '#111' }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{item.productCount} products</div>
                      </div>
                    </label>
                  );
                })
              ) : (
                browseItems.map((item, i) => {
                  const checked = browseSelected.has(item.id);
                  return (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: checked ? '#f0f7ff' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                      <input type="checkbox" checked={checked} onChange={() => setBrowseSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })} style={{ width: 16, height: 16, accentColor: '#111' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: checked ? 600 : 400, color: '#111' }}>{item.email}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{item.firstName} {item.lastName}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px', borderTop: '1px solid #e5e7eb', background: '#fafbfc', borderRadius: '0 0 14px 14px' }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {browseSelected.size} {browseMode === 'buy-products' || browseMode === 'get-products' ? 'products' : browseMode} selected
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setBrowseMode(null)} style={outBtn}>Cancel</button>
                <button onClick={handleBrowseAdd} style={priBtn}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */
function RadioOption({ name, value, checked, onChange, label, disabled }: { name: string; value: string; checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled}
        style={{ width: 18, height: 18, accentColor: '#303030', margin: 0 }} />
      <span style={{ fontSize: 14, color: '#303030', fontWeight: checked ? 500 : 400 }}>{label}</span>
    </label>
  );
}

function CheckboxOption({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled}
        style={{ width: 18, height: 18, accentColor: '#303030', margin: 0, borderRadius: 4 }} />
      <span style={{ fontSize: 14, color: '#303030', fontWeight: checked ? 500 : 400 }}>{label}</span>
    </label>
  );
}

/* ── Design tokens ── */
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e4e7', borderRadius: 12,
  padding: '22px 24px', marginBottom: 16,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};
const cardTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: '#303030',
  margin: '0 0 16px', letterSpacing: '-0.01em',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600,
  color: '#303030', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 14, color: '#303030',
  border: '1px solid #c9cccf', borderRadius: 8, background: '#fff',
  outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};
const toggleBtn: React.CSSProperties = {
  padding: '8px 18px', fontSize: 13, fontWeight: 600,
  border: 'none', background: '#fff', cursor: 'pointer', color: '#616161',
  transition: 'all 0.15s',
};
const toggleActive: React.CSSProperties = {
  background: '#303030', color: '#fff',
};
const outBtn: React.CSSProperties = {
  padding: '9px 20px', fontSize: 13, fontWeight: 600,
  border: '1px solid #c9cccf', borderRadius: 8, background: '#fff',
  cursor: 'pointer', color: '#303030', transition: 'background 0.15s',
};
const priBtn: React.CSSProperties = {
  padding: '9px 22px', fontSize: 13, fontWeight: 600,
  border: 'none', borderRadius: 8, background: '#303030',
  color: '#fff', cursor: 'pointer', transition: 'background 0.15s',
};
