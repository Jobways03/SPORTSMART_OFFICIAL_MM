'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient, ApiError } from '@/lib/api-client';
import { STATUS } from '../status';

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

// India Standard Time is a fixed +05:30 with no DST.
const IST_OFFSET_MINUTES = 330;

// Phase 243 (#tz) — the date/time inputs are labelled "(IST)" but the old code
// did `new Date(`${date}T${time}`).toISOString()`, which parses the string in
// the *browser's* local zone. An admin in any non-IST zone (or a CI/Vercel box
// running UTC) would therefore persist the wrong instant. Interpret the entered
// wall-clock as Asia/Kolkata explicitly: build the epoch as if the components
// were UTC, then subtract the +05:30 offset to get the true UTC instant.
// Returns null when the date is missing.
function istWallClockToUtcIso(date: string, time: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

// Inverse of istWallClockToUtcIso, used when hydrating the form for edit so the
// inputs show the same IST wall-clock that was entered (independent of the
// browser zone). Returns { date: 'YYYY-MM-DD', time: 'HH:MM' } in IST.
function utcIsoToIstWallClock(iso: string): { date: string; time: string } {
  const istMs = new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs); // read via UTC getters → IST wall-clock parts
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`,
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
  };
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
  // Prefill "now" as IST wall-clock so the create-form default matches the
  // "(IST)" labels (and what istWallClockToUtcIso will convert back).
  const [startDate, setStartDate] = useState(() => utcIsoToIstWallClock(new Date().toISOString()).date);
  const [startTime, setStartTime] = useState(() => utcIsoToIstWallClock(new Date().toISOString()).time);
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

  // Phase E (P1.3) — Eligibility rules state. Each toggle either
  // adds or removes a row in discount_eligibility_rules. The form
  // doesn't expose every rule type — only the most common ones.
  // Power-user rules (CITY_IN, PINCODE_IN, segments) can be set
  // via direct API for now.
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [newCustomerOnly, setNewCustomerOnly] = useState(false);
  const [newCustomerMaxAgeDays, setNewCustomerMaxAgeDays] = useState('30');
  const [maxRedemptionsPerCustomer, setMaxRedemptionsPerCustomer] = useState('');
  const [minDaysBetweenRedemptions, setMinDaysBetweenRedemptions] = useState('');
  const [paymentMethodIn, setPaymentMethodIn] = useState<string[]>([]);

  // Phase B (P0.5) — Funding & Settlement state. Defaults preserve
  // current behavior (PLATFORM-funded / GROSS commission) for any
  // discount created without explicitly choosing.
  const [fundingType, setFundingType] = useState<
    'PLATFORM' | 'SELLER' | 'BRAND' | 'FRANCHISE' | 'SHARED'
  >('PLATFORM');
  const [platformFundingPercent, setPlatformFundingPercent] = useState('100');
  const [sellerFundingPercent, setSellerFundingPercent] = useState('0');
  const [brandFundingPercent, setBrandFundingPercent] = useState('0');
  // FRANCHISE/BRAND funding — the franchise share in a SHARED split, which
  // franchise bears a FRANCHISE-funded discount (blank = the fulfilling
  // franchise pays), and which brand funds a BRAND/SHARED-brand discount.
  const [franchiseFundingPercent, setFranchiseFundingPercent] = useState('0');
  const [franchiseId, setFranchiseId] = useState('');
  const [brandId, setBrandId] = useState('');
  // Selector option lists. Best-effort: if the endpoint is unavailable the
  // dropdown is empty and the admin can still type the id manually.
  const [franchises, setFranchises] = useState<Array<{ id: string; franchiseCode?: string; businessName?: string }>>([]);
  const [brands, setBrands] = useState<Array<{ id: string; name?: string }>>([]);
  const [commissionBasis, setCommissionBasis] = useState<
    'GROSS' | 'NET_AFTER_DISCOUNT' | 'SELLER_FUNDED_NET'
  >('GROSS');
  const [fundingNotes, setFundingNotes] = useState('');

  // Phase F (P2.3) — affiliate attribution. When affiliateId is set,
  // every redemption of this discount also records a ReferralAttribution
  // + the affiliate-side commission. Optional commission override.
  const [affiliateId, setAffiliateId] = useState('');
  const [affiliateCommissionPercent, setAffiliateCommissionPercent] = useState('');
  const [affiliates, setAffiliates] = useState<Array<{ id: string; firstName?: string; lastName?: string; email?: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [status, setStatus] = useState('ACTIVE');
  // #8 / OCC — the version we loaded for an existing discount. Echoed back on
  // PUT as `expectedVersion` so the server can reject a stale two-admin write.
  const [version, setVersion] = useState<number | null>(null);
  // #2 — top-of-form error banner. handleSave must surface 400/409/network
  // failures here instead of silently swallowing them (the old `catch {}`
  // made a rejected save look successful).
  const [formError, setFormError] = useState<string | null>(null);

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
        if (typeof d.version === 'number') setVersion(d.version);
        // Phase B (P0.5) — funding fields. Default to PLATFORM if
        // unset (legacy rows that haven't been edited since the
        // schema migration land here).
        if (d.fundingType) setFundingType(d.fundingType);
        if (d.platformFundingPercent !== undefined && d.platformFundingPercent !== null)
          setPlatformFundingPercent(String(Number(d.platformFundingPercent)));
        if (d.sellerFundingPercent !== undefined && d.sellerFundingPercent !== null)
          setSellerFundingPercent(String(Number(d.sellerFundingPercent)));
        if (d.brandFundingPercent !== undefined && d.brandFundingPercent !== null)
          setBrandFundingPercent(String(Number(d.brandFundingPercent)));
        if (d.franchiseFundingPercent !== undefined && d.franchiseFundingPercent !== null)
          setFranchiseFundingPercent(String(Number(d.franchiseFundingPercent)));
        if (d.franchiseId) setFranchiseId(d.franchiseId);
        if (d.brandId) setBrandId(d.brandId);
        if (d.commissionBasis) setCommissionBasis(d.commissionBasis);
        if (d.fundingNotes) setFundingNotes(d.fundingNotes);
        if (d.affiliateId) setAffiliateId(d.affiliateId);
        if (
          d.affiliateCommissionPercent !== undefined &&
          d.affiliateCommissionPercent !== null
        ) {
          setAffiliateCommissionPercent(String(Number(d.affiliateCommissionPercent)));
        }
        // Display the stored UTC instants as IST wall-clock so the "(IST)"
        // inputs round-trip correctly regardless of the browser's zone.
        if (d.startsAt) {
          const s = utcIsoToIstWallClock(d.startsAt);
          setStartDate(s.date);
          setStartTime(s.time);
        }
        if (d.endsAt) {
          setHasEnd(true);
          const e = utcIsoToIstWallClock(d.endsAt);
          setEndDate(e.date);
          setEndTime(e.time);
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
        // Phase E (P1.3) — hydrate eligibility-rule UI state from
        // the persisted rule set. Unknown rule types are ignored so
        // the form stays forward-compatible with rules added via API.
        if (Array.isArray(d.eligibilityRules)) {
          for (const r of d.eligibilityRules) {
            const v = (r.valueJson ?? {}) as any;
            switch (r.ruleType) {
              case 'FIRST_ORDER_ONLY':
                setFirstOrderOnly(true);
                break;
              case 'NEW_CUSTOMER_ONLY':
                setNewCustomerOnly(true);
                if (v.maxAccountAgeDays !== undefined && v.maxAccountAgeDays !== null) {
                  setNewCustomerMaxAgeDays(String(v.maxAccountAgeDays));
                }
                break;
              case 'MAX_REDEMPTIONS_PER_CUSTOMER':
                if (v.max !== undefined && v.max !== null) {
                  setMaxRedemptionsPerCustomer(String(v.max));
                }
                break;
              case 'MIN_DAYS_BETWEEN_REDEMPTIONS':
                if (v.minDays !== undefined && v.minDays !== null) {
                  setMinDaysBetweenRedemptions(String(v.minDays));
                }
                break;
              case 'PAYMENT_METHOD_IN':
                if (Array.isArray(v.methods)) setPaymentMethodIn(v.methods);
                break;
            }
          }
        }
      })
      .catch((err) => console.warn(err))
      .finally(() => setLoading(false));
  }, [discountId]);

  // Phase F (P2.3) — load affiliate list once for the selector dropdown.
  // Best-effort: if the endpoint is unavailable the field stays empty
  // and the admin can still paste an affiliateId manually.
  useEffect(() => {
    apiClient<{ affiliates: any[] }>('/admin/affiliates?limit=200')
      .then((r) => {
        if (Array.isArray(r.data?.affiliates)) {
          setAffiliates(
            r.data.affiliates.map((a: any) => ({
              id: a.id,
              firstName: a.firstName,
              lastName: a.lastName,
              email: a.email,
            })),
          );
        }
      })
      .catch((err) => console.warn(err));
  }, []);

  // FRANCHISE/BRAND funding — load the franchise + brand option lists once for
  // the selector dropdowns (GET /admin/franchises, GET /admin/brands). Same
  // best-effort posture as the affiliate loader: a failed/missing endpoint
  // leaves the list empty and the admin can still paste the id manually.
  useEffect(() => {
    apiClient<{ franchises: any[] }>('/admin/franchises?limit=200')
      .then((r) => {
        if (Array.isArray(r.data?.franchises)) {
          setFranchises(
            r.data.franchises.map((f: any) => ({
              id: f.id,
              franchiseCode: f.franchiseCode,
              businessName: f.businessName,
            })),
          );
        }
      })
      .catch((err) => console.warn(err));
    apiClient<{ brands: any[] }>('/admin/brands?limit=200')
      .then((r) => {
        if (Array.isArray(r.data?.brands)) {
          setBrands(
            r.data.brands.map((b: any) => ({ id: b.id, name: b.name })),
          );
        }
      })
      .catch((err) => console.warn(err));
  }, []);

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
        .catch((err) => console.warn(err))
        .finally(() => setBrowseLoading(false));
    } else if (browseMode === 'collections') {
      apiClient<any>(`/admin/collections?limit=100${browseSearch ? `&search=${browseSearch}` : ''}`)
        .then((r) => {
          setBrowseItems((r.data?.collections || []).map((c: any) => ({
            id: c.id, name: c.name, productCount: c.productCount, imageUrl: c.imageUrl || null,
          })));
        })
        .catch((err) => console.warn(err))
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
        .catch((err) => console.warn(err))
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

  // asDraft only applies on CREATE — the update DTO forbids `status`, so a
  // saved-as-draft existing discount would 400. The primary Save button passes
  // asDraft=false and lets the server derive status from the date window.
  const handleSave = async (asDraft = false) => {
    setFormError(null);

    // ── Client-side validation (#3) — block the POST and surface the banner
    // before we hit the now-strict server DTO. ──────────────────────────────
    const isFreeShip = type === 'FREE_SHIPPING';
    const isBxgy = type === 'BUY_X_GET_Y';
    const numValue = parseFloat(value);

    if (!isFreeShip && !isBxgy) {
      if (!(numValue > 0)) {
        setFormError('Discount value must be greater than 0.');
        return;
      }
      if (valueType === 'PERCENTAGE' && numValue > 100) {
        setFormError('Percentage discount cannot exceed 100%.');
        return;
      }
    }

    if (isBxgy) {
      const numBuy = parseFloat(buyValue);
      const numGetQty = parseInt(getQuantity, 10);
      if (!(numBuy > 0)) {
        setFormError('Buy quantity/amount must be greater than 0.');
        return;
      }
      if (!(numGetQty > 0)) {
        setFormError('Get quantity must be greater than 0.');
        return;
      }
      if (numGetQty > 50) {
        setFormError('Get quantity cannot exceed 50.');
        return;
      }
      if (selectedBuyProducts.length === 0) {
        setFormError('Select at least one product customers must buy.');
        return;
      }
      if (selectedGetProducts.length === 0) {
        setFormError('Select at least one product customers get.');
        return;
      }
    }

    setSaving(true);
    if (asDraft) setSavingDraft(true);
    try {
      // Phase 243 (#tz) — entered wall-clock is IST; convert to UTC explicitly.
      const startsAt = istWallClockToUtcIso(startDate, startTime || '00:00');
      const endsAt = hasEnd && endDate ? istWallClockToUtcIso(endDate, endTime || '23:59') : null;

      // Phase B (P0.5) — funding fields. UI validates that the
      // selected fundingType lines up with the percent inputs
      // (PLATFORM = 100/0/0, SELLER = 0/100/0, etc.).
      // Phase E (P1.3) — flatten the eligibility UI state into the
      // domain rule shape. Empty values produce no rule (i.e. "no
      // restriction") so the form behaves backwards-compatibly when
      // every toggle is off.
      const eligibilityRules: Array<{ ruleType: string; valueJson: Record<string, unknown> }> = [];
      if (firstOrderOnly) {
        eligibilityRules.push({ ruleType: 'FIRST_ORDER_ONLY', valueJson: {} });
      }
      if (newCustomerOnly) {
        const days = parseInt(newCustomerMaxAgeDays, 10);
        eligibilityRules.push({
          ruleType: 'NEW_CUSTOMER_ONLY',
          valueJson: Number.isFinite(days) && days > 0 ? { maxAccountAgeDays: days } : {},
        });
      }
      if (maxRedemptionsPerCustomer.trim()) {
        const max = parseInt(maxRedemptionsPerCustomer, 10);
        if (Number.isFinite(max) && max > 0) {
          eligibilityRules.push({
            ruleType: 'MAX_REDEMPTIONS_PER_CUSTOMER',
            valueJson: { max },
          });
        }
      }
      if (minDaysBetweenRedemptions.trim()) {
        const minDays = parseInt(minDaysBetweenRedemptions, 10);
        if (Number.isFinite(minDays) && minDays > 0) {
          eligibilityRules.push({
            ruleType: 'MIN_DAYS_BETWEEN_REDEMPTIONS',
            valueJson: { minDays },
          });
        }
      }
      if (paymentMethodIn.length > 0) {
        eligibilityRules.push({
          ruleType: 'PAYMENT_METHOD_IN',
          valueJson: { methods: paymentMethodIn },
        });
      }

      const platformPct = parseFloat(platformFundingPercent) || 0;
      const sellerPct = parseFloat(sellerFundingPercent) || 0;
      const brandPct = parseFloat(brandFundingPercent) || 0;
      const franchisePct = parseFloat(franchiseFundingPercent) || 0;
      // SHARED must split across all four payers (platform/seller/brand/
      // franchise) summing to 100%. The server re-validates.
      const fundingSum = platformPct + sellerPct + brandPct + franchisePct;
      if (fundingType === 'SHARED' && Math.abs(fundingSum - 100) > 0.01) {
        throw new Error(
          `Funding percentages must sum to 100% for SHARED funding (currently ${fundingSum}%)`,
        );
      }

      // brandId is REQUIRED whenever a brand bears any of the cost — i.e.
      // fundingType=BRAND or a SHARED split with a brand share > 0.
      const brandRequired =
        fundingType === 'BRAND' || (fundingType === 'SHARED' && brandPct > 0);
      if (brandRequired && !brandId.trim()) {
        throw new Error('Select the brand that funds this discount');
      }

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
        // Phase 243 (#1) — `customerIds` (silently dropped server-side, now
        // 400s under forbidNonWhitelisted) and the legacy scalar `eligibility`
        // are intentionally NOT sent. The "Specific customers" picker that
        // drove them is hidden, so this form only ever means ALL_CUSTOMERS;
        // omitting `eligibility` also avoids clobbering an API-set value on
        // update. Per-customer targeting will be rebuilt as an
        // eligibilityRules CUSTOMER_SEGMENT_IN rule.
        productIds: appliesTo === 'SPECIFIC_PRODUCTS' ? selectedProducts.map((p) => p.id) : [],
        collectionIds: appliesTo === 'SPECIFIC_COLLECTIONS' ? selectedCollections.map((c) => c.id) : [],
        // Phase B (P0.5) funding & settlement
        fundingType,
        platformFundingPercent: platformPct,
        sellerFundingPercent: sellerPct,
        brandFundingPercent: brandPct,
        franchiseFundingPercent: franchisePct,
        commissionBasis,
        fundingNotes: fundingNotes.trim() || null,
        // Phase E (P1.3) — always send the array (incl. []) so update
        // semantics are explicit: no field = no change, [] = clear all.
        eligibilityRules,
        // Phase F (P2.3) — affiliate attribution. Empty = clear link.
        affiliateId: affiliateId || null,
        affiliateCommissionPercent: affiliateCommissionPercent.trim()
          ? parseFloat(affiliateCommissionPercent)
          : null,
      };

      // FRANCHISE/BRAND funding — only attach the FK fields when a franchise
      // or brand is actually involved, so a platform/seller-funded discount
      // never carries a stray relation. On update, send null to detach when
      // the field is relevant but left blank (franchiseId blank = "the
      // fulfilling franchise pays"). Irrelevant fields are omitted entirely.
      const franchiseRelevant =
        fundingType === 'FRANCHISE' ||
        (fundingType === 'SHARED' && franchisePct > 0);
      if (franchiseRelevant) {
        payload.franchiseId = franchiseId.trim() || null;
      }
      if (brandRequired) {
        payload.brandId = brandId.trim();
      }

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
        // #8 / OCC — echo the loaded version so the server can reject a stale
        // two-admin write. `status` is forbidden on update (FSM endpoint only).
        if (version !== null) payload.expectedVersion = version;
        await apiClient(`/admin/discounts/${discountId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        // #18 — "Save as draft" is the only create that pins a status; the
        // primary Save omits it so the server derives it from the date window.
        // DRAFT is the only status the create DTO accepts.
        if (asDraft) payload.status = 'DRAFT';
        await apiClient('/admin/discounts', { method: 'POST', body: JSON.stringify(payload) });
      }
      router.push('/dashboard/discounts');
    } catch (e) {
      // #2 — never swallow the failure. Surface 400 (validation), 409 (stale
      // OCC), or network errors in the banner so the admin knows the save
      // didn't land instead of seeing a phantom success.
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setFormError('Another admin updated this discount. Reload the page and reapply your changes.');
        } else {
          setFormError(e.message || `Save failed (HTTP ${e.status}).`);
        }
      } else {
        setFormError(e instanceof Error ? e.message : 'Save failed. Please try again.');
      }
    } finally {
      setSaving(false);
      setSavingDraft(false);
    }
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
                  <input
                    type="number"
                    min={0}
                    max={valueType === 'PERCENTAGE' ? 100 : undefined}
                    step={0.01}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    style={{ ...input, paddingRight: 30 }}
                    placeholder="0"
                  />
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
                <div><label style={label}>Quantity</label><input type="number" min={1} value={buyValue} onChange={(e) => setBuyValue(e.target.value)} style={{ ...input, width: 100 }} /></div>
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
                <div><label style={label}>Quantity</label><input type="number" min={1} max={50} value={getQuantity} onChange={(e) => setGetQuantity(e.target.value)} style={{ ...input, width: 100 }} /></div>
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
            {/* Phase 243: hidden — not persisted server-side; rebuild as eligibilityRules CUSTOMER_SEGMENT_IN */}
            {/*
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
            */}
          </section>

          {/* Eligibility rules (Phase E P1.3) — fraud / velocity / payment / customer */}
          <section style={card}>
            <h3 style={cardTitle}>Eligibility rules</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Restrict who can redeem this discount. Rules are evaluated at
              checkout — a customer who fails any rule sees a friendly error.
            </p>

            <CheckboxOption
              checked={firstOrderOnly}
              onChange={setFirstOrderOnly}
              label="First-order customers only"
            />
            <CheckboxOption
              checked={newCustomerOnly}
              onChange={setNewCustomerOnly}
              label="New customers only (account age limit)"
            />
            {newCustomerOnly && (
              <div style={{ marginLeft: 26, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#374151' }}>Account younger than</span>
                <input
                  type="number"
                  min={1}
                  value={newCustomerMaxAgeDays}
                  onChange={(e) => setNewCustomerMaxAgeDays(e.target.value)}
                  style={{ ...input, width: 90 }}
                />
                <span style={{ fontSize: 13, color: '#374151' }}>days</span>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <label style={label}>Max redemptions per customer</label>
              <input
                type="number"
                min={0}
                placeholder="No limit"
                value={maxRedemptionsPerCustomer}
                onChange={(e) => setMaxRedemptionsPerCustomer(e.target.value)}
                style={{ ...input, width: 200 }}
              />
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Caps total redemptions per customer over the life of this discount.
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={label}>Minimum days between redemptions</label>
              <input
                type="number"
                min={0}
                placeholder="No cooldown"
                value={minDaysBetweenRedemptions}
                onChange={(e) => setMinDaysBetweenRedemptions(e.target.value)}
                style={{ ...input, width: 200 }}
              />
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Prevents same-day repeat redemptions for serial coupon abuse.
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={label}>Allowed payment methods</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(['COD', 'ONLINE', 'WALLET', 'UPI'] as const).map((pm) => {
                  const on = paymentMethodIn.includes(pm);
                  return (
                    <button
                      key={pm}
                      type="button"
                      onClick={() =>
                        setPaymentMethodIn((prev) =>
                          prev.includes(pm) ? prev.filter((x) => x !== pm) : [...prev, pm],
                        )
                      }
                      style={{
                        padding: '6px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        border: `1px solid ${on ? '#303030' : '#c9cccf'}`,
                        background: on ? '#303030' : '#fff',
                        color: on ? '#fff' : '#303030',
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                    >
                      {pm}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                Leave empty to allow all payment methods. Common pattern: exclude COD on prepaid-only promos.
              </div>
            </div>
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

          {/* Funding & Settlement (Phase B P0.5) */}
          <section style={card}>
            <h3 style={cardTitle}>Funding &amp; Settlement</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Determines who absorbs the cost of this discount and how seller
              commission is computed. Transactional discounts reduce taxable
              value before GST is calculated.
            </p>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
              Funding type
            </label>
            <select
              value={fundingType}
              onChange={(e) => {
                const v = e.target.value as
                  | 'PLATFORM'
                  | 'SELLER'
                  | 'BRAND'
                  | 'FRANCHISE'
                  | 'SHARED';
                setFundingType(v);
                // Auto-fill the percent fields to match the chosen type.
                if (v === 'PLATFORM') {
                  setPlatformFundingPercent('100');
                  setSellerFundingPercent('0');
                  setBrandFundingPercent('0');
                  setFranchiseFundingPercent('0');
                  setCommissionBasis('GROSS');
                } else if (v === 'SELLER') {
                  setPlatformFundingPercent('0');
                  setSellerFundingPercent('100');
                  setBrandFundingPercent('0');
                  setFranchiseFundingPercent('0');
                  setCommissionBasis('NET_AFTER_DISCOUNT');
                } else if (v === 'BRAND') {
                  setPlatformFundingPercent('0');
                  setSellerFundingPercent('0');
                  setBrandFundingPercent('100');
                  setFranchiseFundingPercent('0');
                  setCommissionBasis('GROSS');
                } else if (v === 'FRANCHISE') {
                  setPlatformFundingPercent('0');
                  setSellerFundingPercent('0');
                  setBrandFundingPercent('0');
                  setFranchiseFundingPercent('100');
                  setCommissionBasis('GROSS');
                } else {
                  // SHARED — leave as user-entered; default to 50/50 if empty
                  if (
                    parseFloat(platformFundingPercent) +
                      parseFloat(sellerFundingPercent) +
                      parseFloat(brandFundingPercent) +
                      parseFloat(franchiseFundingPercent) ===
                    0
                  ) {
                    setPlatformFundingPercent('50');
                    setSellerFundingPercent('50');
                  }
                  setCommissionBasis('SELLER_FUNDED_NET');
                }
              }}
              style={{ ...input, marginBottom: 12 }}
            >
              <option value="PLATFORM">Platform funded (marketing expense)</option>
              <option value="SELLER">Seller funded</option>
              <option value="BRAND">Brand funded</option>
              <option value="FRANCHISE">Franchise funded</option>
              <option value="SHARED">Shared (split percentages)</option>
            </select>

            {fundingType === 'SHARED' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Platform %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={platformFundingPercent}
                    onChange={(e) => setPlatformFundingPercent(e.target.value)}
                    style={input}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Seller %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={sellerFundingPercent}
                    onChange={(e) => setSellerFundingPercent(e.target.value)}
                    style={input}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Brand %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={brandFundingPercent}
                    onChange={(e) => setBrandFundingPercent(e.target.value)}
                    style={input}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Franchise %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={franchiseFundingPercent}
                    onChange={(e) => setFranchiseFundingPercent(e.target.value)}
                    style={input}
                  />
                </div>
              </div>
            )}

            {/* Franchise picker — shown for FRANCHISE funding or a SHARED split
                with a franchise share. franchiseId is optional (blank = the
                fulfilling franchise pays). */}
            {(fundingType === 'FRANCHISE' ||
              (fundingType === 'SHARED' && (parseFloat(franchiseFundingPercent) || 0) > 0)) && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
                  Funding franchise
                </label>
                {franchises.length > 0 ? (
                  <select
                    value={franchiseId}
                    onChange={(e) => setFranchiseId(e.target.value)}
                    style={input}
                  >
                    <option value="">The fulfilling franchise pays</option>
                    {franchises.map((f) => (
                      <option key={f.id} value={f.id}>
                        {[f.franchiseCode, f.businessName].filter(Boolean).join(' — ') || f.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={franchiseId}
                    onChange={(e) => setFranchiseId(e.target.value)}
                    placeholder="Franchise ID (optional)"
                    style={input}
                  />
                )}
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Leave blank = the fulfilling franchise pays.
                </div>
              </div>
            )}

            {/* Brand picker — shown (and REQUIRED) for BRAND funding or a SHARED
                split with a brand share. */}
            {(fundingType === 'BRAND' ||
              (fundingType === 'SHARED' && (parseFloat(brandFundingPercent) || 0) > 0)) && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
                  Funding brand <span style={{ color: '#dc2626' }}>*</span>
                </label>
                {brands.length > 0 ? (
                  <select
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    style={input}
                  >
                    <option value="">Select a brand…</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    placeholder="Brand ID (required)"
                    style={input}
                  />
                )}
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Required — the brand whose co-funding budget absorbs this discount.
                </div>
              </div>
            )}

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
              Commission basis
            </label>
            <select
              value={commissionBasis}
              onChange={(e) =>
                setCommissionBasis(
                  e.target.value as 'GROSS' | 'NET_AFTER_DISCOUNT' | 'SELLER_FUNDED_NET',
                )
              }
              style={{ ...input, marginBottom: 12 }}
            >
              <option value="GROSS">Gross — commission on pre-discount price</option>
              <option value="NET_AFTER_DISCOUNT">Net after discount</option>
              <option value="SELLER_FUNDED_NET">Net of seller-funded share only</option>
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
              Internal notes (not shown to customer)
            </label>
            <textarea
              value={fundingNotes}
              onChange={(e) => setFundingNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Q1 marketing spend, co-funded with Adidas brand, etc."
              style={{ ...input, fontFamily: 'inherit', resize: 'vertical' }}
            />

            <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
              <div>
                <strong>Platform-funded:</strong> seller is paid as if customer paid full price; platform absorbs the discount.
              </div>
              <div>
                <strong>Seller-funded:</strong> seller settlement reduced by the discount amount.
              </div>
              <div>
                <strong>Franchise-funded:</strong> the franchise bears the discount cost; deducted from its settlement (blank franchise = the fulfilling franchise pays).
              </div>
            </div>
          </section>

          {/* Affiliate attribution (Phase F P2.3) */}
          <section style={card}>
            <h3 style={cardTitle}>Affiliate attribution</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Optionally tie this discount to an affiliate. Every redemption
              writes a ReferralAttribution + an AffiliateCommission, so a
              single discount drives both the customer-facing reduction and
              the affiliate payout flow.
            </p>

            <label style={label}>Attribute redemptions to</label>
            <select
              value={affiliateId}
              onChange={(e) => setAffiliateId(e.target.value)}
              style={{ ...input, marginBottom: 12 }}
            >
              <option value="">None — regular discount</option>
              {affiliates.map((a) => {
                const name = [a.firstName, a.lastName].filter(Boolean).join(' ');
                return (
                  <option key={a.id} value={a.id}>
                    {name || a.email || a.id}
                  </option>
                );
              })}
            </select>

            {affiliateId && (
              <>
                <label style={label}>Commission % override (optional)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="Leave empty to use affiliate's default rate"
                  value={affiliateCommissionPercent}
                  onChange={(e) => setAffiliateCommissionPercent(e.target.value)}
                  style={{ ...input, width: 280 }}
                />
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  When empty, the affiliate's account-level commission rate is used.
                </div>
              </>
            )}
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
            {isEdit && (() => {
              // Phase 243 — use the shared status→color map (was hardcoded
              // green, so a PAUSED/ARCHIVED/EXPIRED discount looked active).
              const s = STATUS[status] || STATUS.DRAFT;
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: s.bg, color: s.fg,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                  {status}
                </span>
              );
            })()}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 12, marginBottom: 6 }}>Type</div>
            <div style={{ fontSize: 13, color: '#374151' }}>{TYPE_LABELS[type]}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{TYPE_ICONS[type]}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 12, marginBottom: 6 }}>Details</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              {details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </section>

          {/* Phase 243: hidden — not persisted server-side; rebuild as eligibilityRules CUSTOMER_SEGMENT_IN */}
          {/*
          <section style={card}>
            <h3 style={{ ...cardTitle, marginBottom: 8 }}>Sales channel access</h3>
            <CheckboxOption checked={false} onChange={() => {}} label="Allow discount to be featured on selected channels" disabled />
          </section>
          */}

          {/* #2 — surface save failures (400 validation / 409 stale OCC / network)
              instead of swallowing them. */}
          {formError && (
            <div style={{
              padding: '10px 12px', marginBottom: 10, fontSize: 13, lineHeight: 1.4,
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b',
            }}>
              {formError}
            </div>
          )}

          <button onClick={() => handleSave(false)} disabled={saving} style={{
            width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 600,
            background: '#303030', color: '#fff', border: 'none', borderRadius: 8,
            cursor: saving ? 'default' : 'pointer', marginTop: 4, opacity: saving ? 0.7 : 1,
          }}>
            {saving && !savingDraft ? 'Saving...' : 'Save'}
          </button>

          {/* #18 — "Save as draft" creates the discount in DRAFT (create only;
              the update DTO forbids `status`). */}
          {!isEdit && (
            <button onClick={() => handleSave(true)} disabled={saving} style={{
              width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 600,
              background: '#fff', color: '#303030', border: '1px solid #c9cccf', borderRadius: 8,
              cursor: saving ? 'default' : 'pointer', marginTop: 8, opacity: saving ? 0.7 : 1,
            }}>
              {savingDraft ? 'Saving draft...' : 'Save as draft'}
            </button>
          )}
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
