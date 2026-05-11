import type {
  IThinkAddOrderProduct,
  IThinkAddOrderShipment,
} from '../dtos/add-order.dto';
import type {
  IThinkForwardLogistics,
  IThinkPaymentMode,
  IThinkReverseLogistics,
} from '../ithink.constants';

/**
 * Marketplace-side shipment payload — the shape every caller has to
 * gather before invoking the iThink integration. Kept deliberately
 * neutral (no Prisma types, no PaiseBigInt) so it can be assembled
 * from either the orders module or the returns module without
 * importing each other.
 *
 * Amounts here are in **rupees** (string-encoded floats) because
 * iThink expects rupees on the wire. Conversion from our paise BigInt
 * to rupee strings happens at the call site, not in the mapper, so
 * unit-test data stays readable.
 */

export interface DomainProduct {
  name: string;
  sku?: string;
  quantity: number;
  /** Rupees as decimal string (e.g., "199.00"). */
  pricePerUnit: string;
  taxRatePercent?: string;
  hsnCode?: string;
  /** Rupees as decimal string. */
  discount?: string;
  imageUrl?: string;
}

export interface DomainAddress {
  name: string;
  companyName?: string;
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  phone: string;
  altPhone?: string;
  email?: string;
}

export interface DomainShipment {
  /** Our order number (master order). */
  orderNumber: string;
  /** Optional sub-order discriminator (one master order may fan out). */
  subOrderNumber?: string;
  /** ISO date or 'dd-mm-yyyy' formatted; mapper rewrites. */
  orderDate: Date | string;
  /** Rupees as decimal string. */
  totalAmount: string;
  shipping: DomainAddress;
  /** If absent, shipping is reused. */
  billing?: DomainAddress;
  products: DomainProduct[];
  /** cm. */
  dimensions: { length: number; width: number; height: number };
  /** kg (decimal, not grams). */
  weightKg: number;
  paymentMode: IThinkPaymentMode;
  /** Required when paymentMode is 'cod'. Rupees as decimal string. */
  codAmount?: string;
  /** Rupees as decimal string. */
  shippingCharges?: string;
  /** Rupees as decimal string. */
  totalDiscount?: string;
  gstNumber?: string;
  ewayBillNumber?: string;
  /** Forward by default; pass 'reverse' for return-pickup. */
  direction?: 'forward' | 'reverse';
  /** Carrier preference. Reverse limited to ITHINK_REVERSE_LOGISTICS. */
  logistics?: IThinkForwardLogistics | IThinkReverseLogistics;
  /** Required carrier-conditional service tier. */
  serviceType?: 'air' | 'surface' | 'standard' | 'priority' | 'ground';
  /** iThink's warehouse_id for the pickup origin (seller / franchise). */
  pickupAddressId: string;
  /** iThink's warehouse_id for the return destination. */
  returnAddressId: string;
}

/**
 * Format a Date in iThink's preferred 'dd-mm-yyyy HH:mm:ss'. iThink
 * does not accept ISO 8601 — we've seen 400-level failures with `T`
 * separators on Add Order.
 */
function formatIThinkDate(value: Date | string): string {
  if (typeof value === 'string') return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}` +
    ` ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function toProduct(p: DomainProduct): IThinkAddOrderProduct {
  return {
    product_name: p.name,
    product_sku: p.sku,
    product_quantity: String(p.quantity),
    product_price: p.pricePerUnit,
    product_tax_rate: p.taxRatePercent,
    product_hsn_code: p.hsnCode,
    product_discount: p.discount,
    product_img_url: p.imageUrl,
  };
}

/**
 * Domain → iThink shipment. Centralised so the field-name quirks
 * (`add`, `pin`, `first_attemp_discount`) live in exactly one place.
 *
 * Returns the per-shipment row; the caller wraps an array of these
 * in an Add Order or Sync Order request envelope.
 */
export function mapDomainShipmentToIThink(
  shipment: DomainShipment,
): IThinkAddOrderShipment {
  const billing = shipment.billing ?? shipment.shipping;
  const sameBilling = !shipment.billing;

  return {
    order: shipment.orderNumber,
    sub_order: shipment.subOrderNumber,
    order_date: formatIThinkDate(shipment.orderDate),
    total_amount: shipment.totalAmount,
    name: shipment.shipping.name,
    company_name: shipment.shipping.companyName,
    add: shipment.shipping.line1,
    add2: shipment.shipping.line2,
    add3: shipment.shipping.line3,
    pin: shipment.shipping.pincode,
    city: shipment.shipping.city,
    state: shipment.shipping.state,
    country: shipment.shipping.country ?? 'India',
    phone: shipment.shipping.phone,
    alt_phone: shipment.shipping.altPhone,
    email: shipment.shipping.email,
    is_billing_same_as_shipping: sameBilling ? 'yes' : 'no',
    billing_name: billing.name,
    billing_company_name: billing.companyName,
    billing_add: billing.line1,
    billing_add2: billing.line2,
    billing_add3: billing.line3,
    billing_pin: billing.pincode,
    billing_city: billing.city,
    billing_state: billing.state,
    billing_country: billing.country ?? 'India',
    billing_phone: billing.phone,
    billing_alt_phone: billing.altPhone,
    billing_email: billing.email,
    products: shipment.products.map(toProduct),
    shipment_length: String(shipment.dimensions.length),
    shipment_width: String(shipment.dimensions.width),
    shipment_height: String(shipment.dimensions.height),
    weight: shipment.weightKg.toFixed(3),
    shipping_charges: shipment.shippingCharges ?? '0',
    giftwrap_charges: '0',
    transaction_charges: '0',
    total_discount: shipment.totalDiscount ?? '0',
    first_attemp_discount: '0',
    cod_charges: '0',
    advance_amount: '0',
    cod_amount: shipment.paymentMode === 'cod' ? shipment.codAmount ?? '0' : '0',
    payment_mode: shipment.paymentMode,
    eway_bill_number: shipment.ewayBillNumber,
    gst_number: shipment.gstNumber,
    return_address_id: shipment.returnAddressId,
  };
}
