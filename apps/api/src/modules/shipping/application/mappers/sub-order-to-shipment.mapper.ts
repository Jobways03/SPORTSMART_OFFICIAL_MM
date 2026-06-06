// Phase 3 Delhivery wiring (2026-06-02) — INBOUND mapper.
//
// Builds the courier-neutral `CreateShipmentRequest` (see
// courier-gateway.port.ts) from a persisted SubOrder + its MasterOrder,
// line items, buyer address snapshot and fulfilment node. This is the
// half that was missing: the only pre-existing mapper was the OUTBOUND
// one inside delhivery-courier.adapter.ts (DomainShipment → facade wire
// shape). The auto-book handler loads the SubOrder with the includes
// below and feeds the result here.
//
// Unit conventions enforced by DomainShipment: amounts are RUPEE decimal
// STRINGS, weightKg is KG (not grams), dimensions are CM numbers,
// paymentMode is lowercase 'cod' | 'prepaid'.

import type { CreateShipmentRequest } from '../ports/outbound/courier-gateway.port';

/** Loosely-typed Prisma row shape the mapper consumes (see handler include). */
export interface SubOrderForShipment {
  id: string;
  subTotal: unknown; // Prisma.Decimal
  fulfillmentNodeType: 'SELLER' | 'FRANCHISE' | string;
  pickupAddressIdSnapshot?: string | null;
  returnAddressIdSnapshot?: string | null;
  items: Array<{
    productTitle?: string | null;
    sku?: string | null;
    masterSku?: string | null;
    quantity: number;
    unitPrice: unknown; // Prisma.Decimal
    product?: ProductDims | null;
    variant?: ProductDims | null;
  }>;
  masterOrder: {
    orderNumber: string;
    createdAt?: Date | string | null;
    paymentMethod?: string | null;
    // Wallet credit (paise) applied at checkout. Prorated across the master's
    // sub-orders by subtotal to compute the true cash-on-delivery amount, so a
    // wallet-paid order is never charged again at the door. Optional: callers
    // that never book COD may omit them (the COD amount then defaults to gross).
    walletAmountUsedInPaise?: bigint | number | null;
    subOrders?: Array<{
      id?: string | null;
      subTotal: unknown;
      acceptStatus?: string | null;
    }>;
    shippingAddressSnapshot?: any;
    customer?: { email?: string | null } | null;
  };
  seller?: {
    gstin?: string | null;
    isGstVerified?: boolean | null;
    sellerShopName?: string | null;
    legalBusinessName?: string | null;
    sellerName?: string | null;
    storeAddress?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  franchise?: {
    gstNumber?: string | null;
    verificationStatus?: string | null;
    businessName?: string | null;
    address?: string | null;
    locality?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  } | null;
}

interface ProductDims {
  weight?: unknown;
  length?: unknown;
  width?: unknown;
  height?: unknown;
  weightUnit?: string | null;
  dimensionUnit?: string | null;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number((v as any).toString ? (v as any).toString() : v);
  return Number.isFinite(n) ? n : 0;
}

function toRupeeString(v: unknown): string {
  const n = toNum(v);
  return (n < 0 ? 0 : n).toFixed(2);
}

/** Normalise a weight value to kilograms honouring the row's weightUnit. */
function toKg(weight: unknown, unit?: string | null): number {
  const n = toNum(weight);
  switch ((unit ?? 'kg').toLowerCase()) {
    case 'g':
    case 'gram':
    case 'grams':
      return n / 1000;
    case 'lb':
    case 'lbs':
      return n * 0.453592;
    default:
      return n; // kg (default)
  }
}

/** Join address parts into one line, dropping empties. Returns undefined when nothing usable. */
function joinAddress(parts: Array<string | null | undefined>): string | undefined {
  const joined = parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ');
  return joined || undefined;
}

/**
 * True when the value is a structurally-valid 15-char GSTIN
 * (2-digit state + 10-char PAN + entity + Z + checksum). We only print a GSTIN
 * on the label when it passes this so a blank / malformed value never reaches
 * the carrier label.
 */
function isValidGstin(g: string | null | undefined): boolean {
  if (!g) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(
    g.trim().toUpperCase(),
  );
}

/** Normalise a length value to centimetres honouring the row's dimensionUnit. */
function toCm(len: unknown, unit?: string | null): number {
  const n = toNum(len);
  switch ((unit ?? 'cm').toLowerCase()) {
    case 'mm':
      return n / 10;
    case 'm':
      return n * 100;
    case 'in':
    case 'inch':
      return n * 2.54;
    default:
      return n; // cm (default)
  }
}

/**
 * Build a CreateShipmentRequest from a loaded SubOrder. Defensive about
 * nullable weight/dimension columns: falls back to a 0.5 kg / 10×10×10 cm
 * parcel so a missing catalog measurement never blocks a booking.
 */
/**
 * Prorate the master-level wallet credit (stored only on MasterOrder) across
 * its active sub-orders by subtotal weight, with a largest-remainder pass so the
 * per-sub shares sum EXACTLY to the wallet total (no paise drift between courier
 * COD amounts and the order total). Returns this sub's share in paise. Falls
 * back to 0 (no reduction) when siblings/wallet aren't loaded — i.e. the courier
 * collects the gross subtotal, never more.
 */
function proratedWalletShareInPaise(
  master: SubOrderForShipment['masterOrder'],
  sub: SubOrderForShipment,
): number {
  const masterWallet = Number(master?.walletAmountUsedInPaise ?? 0);
  if (masterWallet <= 0) return 0;
  const siblings = (master?.subOrders ?? []).filter(
    (s) => s.acceptStatus !== 'REJECTED',
  );
  if (siblings.length === 0) return 0;
  const grossOf = (s: { subTotal: unknown }) =>
    Math.round(Number(s.subTotal) * 100);
  const sumSub = siblings.reduce((a, s) => a + grossOf(s), 0);
  if (sumSub <= 0) return 0;
  const entries = siblings.map((s) => {
    const exact = (masterWallet * grossOf(s)) / sumSub;
    const floor = Math.floor(exact);
    return { id: String(s.id ?? ''), floor, frac: exact - floor };
  });
  const residual = masterWallet - entries.reduce((a, e) => a + e.floor, 0);
  const ranked = [...entries].sort(
    (a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1),
  );
  const bump = new Set<string>();
  for (let i = 0; i < residual && i < ranked.length; i++) {
    const entry = ranked[i];
    if (entry) bump.add(entry.id);
  }
  const mine = entries.find((e) => e.id === String(sub.id));
  if (!mine) return 0;
  return mine.floor + (bump.has(String(sub.id)) ? 1 : 0);
}

export function buildCreateShipmentRequest(
  sub: SubOrderForShipment,
): CreateShipmentRequest {
  const master = sub.masterOrder;
  const snap = master.shippingAddressSnapshot ?? {};

  const shipping = {
    name: snap.fullName ?? snap.name ?? 'Customer',
    line1: snap.addressLine1 ?? snap.line1 ?? '',
    line2: snap.addressLine2 ?? snap.line2 ?? undefined,
    city: snap.city ?? '',
    state: snap.state ?? '',
    pincode: String(snap.postalCode ?? snap.pincode ?? ''),
    country: snap.country ?? 'IN',
    phone: String(snap.phone ?? ''),
    email: master.customer?.email ?? undefined,
  };

  const products = sub.items.map((it) => ({
    name: it.productTitle ?? 'Item',
    sku:
      (it.sku && it.sku.trim()) ||
      (it.masterSku && it.masterSku.trim()) ||
      (it.productTitle ?? 'ITEM').slice(0, 64),
    quantity: it.quantity,
    unitPrice: toRupeeString(it.unitPrice),
  }));

  // Aggregate package weight (sum of per-unit weight × qty) and take a
  // bounding box (max per axis) across line items. Both fall back to a
  // sane default when the catalog has no measurement.
  let weightKg = 0;
  let length = 0;
  let width = 0;
  let height = 0;
  for (const it of sub.items) {
    const v = it.variant ?? null;
    const p = it.product ?? null;
    if (!v && !p) continue;

    // Per-FIELD fallback: prefer the variant's value, else the product's.
    // A variant commonly overrides only weight and inherits the product's
    // box dimensions, so a whole-object `variant ?? product` would wrongly
    // drop the product dims. Each chosen value keeps its own source's unit.
    const has = (x: unknown) => x != null && toNum(x) > 0;
    const wSrc = v && has(v.weight) ? v : p;
    const lSrc = v && has(v.length) ? v : p;
    const wdSrc = v && has(v.width) ? v : p;
    const hSrc = v && has(v.height) ? v : p;

    weightKg += toKg(wSrc?.weight, wSrc?.weightUnit) * (it.quantity || 1);
    length = Math.max(length, toCm(lSrc?.length, lSrc?.dimensionUnit));
    width = Math.max(width, toCm(wdSrc?.width, wdSrc?.dimensionUnit));
    height = Math.max(height, toCm(hSrc?.height, hSrc?.dimensionUnit));
  }
  if (weightKg <= 0) weightKg = 0.5;
  if (length <= 0) length = 10;
  if (width <= 0) width = 10;
  if (height <= 0) height = 10;

  const subTotal = toRupeeString(sub.subTotal);
  // Cash to collect at the door = this sub's subtotal MINUS its prorated share
  // of any wallet credit already debited at checkout. A fully-wallet-covered
  // order ships PREPAID (codDue=0) so the courier never collects the money a
  // second time. Decimal subTotal; only walletAmountUsedInPaise is reliable.
  const codDuePaise = Math.max(
    0,
    Math.round(Number(sub.subTotal) * 100) -
      proratedWalletShareInPaise(master, sub),
  );
  const codAmount = (codDuePaise / 100).toFixed(2);
  const cod =
    (master.paymentMethod ?? '').toUpperCase() === 'COD' && codDuePaise > 0;

  const gstNumber =
    sub.fulfillmentNodeType === 'SELLER'
      ? sub.seller?.gstin ?? undefined
      : sub.franchise?.gstNumber ?? undefined;

  // Seller/merchant identity for the label's "Seller" box. Informational only —
  // returns still route to the pickup warehouse, not here. Prefer the shop/brand
  // name customers recognise; fall back to legal/contact name. (Seller covers
  // both D2C and RETAIL; only a FRANCHISE node reads the franchise entity.)
  const isFranchiseNode = sub.fulfillmentNodeType === 'FRANCHISE';
  const sellerName = isFranchiseNode
    ? sub.franchise?.businessName ?? undefined
    : sub.seller?.sellerShopName ??
      sub.seller?.legalBusinessName ??
      sub.seller?.sellerName ??
      undefined;
  const sellerAddress = isFranchiseNode
    ? joinAddress([
        sub.franchise?.address,
        sub.franchise?.locality,
        sub.franchise?.city,
        sub.franchise?.state,
        sub.franchise?.pincode,
      ])
    : joinAddress([
        sub.seller?.storeAddress,
        sub.seller?.city,
        sub.seller?.state,
      ]);

  // Seller GSTIN on the label — print whenever the node has a VALID-FORMAT
  // GSTIN. (Decision 2026-06-04: dropped the strict "GSTN-verified-only" gate,
  // which never printed because nothing in the system marks a GSTIN verified
  // — the verify flow sets SellerGstin.verifiedAt, not Seller.isGstVerified,
  // and no seller has a verified GSTIN yet. A malformed/empty GSTIN is still
  // left off so we never print garbage.)
  const rawGstin = isFranchiseNode
    ? sub.franchise?.gstNumber
    : sub.seller?.gstin;
  const sellerGstin = isValidGstin(rawGstin)
    ? rawGstin!.trim().toUpperCase()
    : undefined;

  // Delhivery books against the configured pickup warehouse, so these ids
  // are contract-shape only (the Delhivery adapter does not read them).
  const pickupAddressId = sub.pickupAddressIdSnapshot ?? `delhivery:${sub.id}`;
  const returnAddressId = sub.returnAddressIdSnapshot ?? pickupAddressId;

  return {
    subOrderId: sub.id,
    pickupAddressId,
    returnAddressId,
    direction: 'forward',
    shipment: {
      orderNumber: master.orderNumber,
      orderDate: master.createdAt ?? new Date(),
      totalAmount: subTotal,
      shipping,
      products,
      dimensions: { length, width, height },
      weightKg: Number(weightKg.toFixed(3)),
      paymentMode: cod ? 'cod' : 'prepaid',
      ...(cod ? { codAmount } : {}),
      ...(gstNumber ? { gstNumber } : {}),
      ...(sellerName ? { sellerName } : {}),
      ...(sellerAddress ? { sellerAddress } : {}),
      ...(sellerGstin ? { sellerGstin } : {}),
      pickupAddressId,
      returnAddressId,
    },
  };
}
