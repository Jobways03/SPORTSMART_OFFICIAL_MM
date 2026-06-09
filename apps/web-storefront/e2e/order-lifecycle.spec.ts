import { test, expect, request, type APIRequestContext } from '@playwright/test';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

/**
 * E2E — the post-placement order lifecycle, across all three actors:
 *
 *   customer  places a COD order
 *   admin     verifies it (completing a real MFA challenge) → routes to seller
 *   seller    accepts, uploads 4 dispatch photos, packs, and ships
 *   admin     marks delivered, then (after an MFA step-up) collects the COD cash
 *
 * Driven over the API (the admin verification queue + seller fulfillment UIs are
 * separate apps; this exercises the same endpoints they call). Complements the
 * UI purchase test (order.spec.ts), which covers the customer browser flow.
 *
 * PRECONDITIONS (see e2e/README.md):
 *   1. Dev stack up (API :8000).
 *   2. Purchasable product + known seller password:
 *        pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-purchasable-product.ts
 *   3. Known admin TOTP secret (so the MFA challenge can be completed):
 *        pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-admin-mfa-e2e.ts
 *
 * The order's delivery method is DELHIVERY, which requires ≥4 DISTINCT shipment-
 * evidence photos before PACK (a per-sub-order hash-dedupe counts only unique
 * images); SHIP needs a tracking number + courier. COD mark-paid is a CRITICAL
 * action gated behind an MFA step-up. The order ends DELIVERED + PAID.
 *
 * NOT covered — settlement (seller payout): it needs eligible commission_records,
 * which are not generated for these orders in this dev environment (the seller
 * has 0 commission rows — generation is a separate job/event that doesn't fire
 * here), so a settlement cycle would be empty.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8000';
const CUSTOMER = {
  email: process.env.E2E_EMAIL || 'smoke-customer@sportsmart.test',
  password: process.env.E2E_PASSWORD || 'SmokeCustomer@123',
};
const ADMIN = {
  email: process.env.ADMIN_SEED_EMAIL || 'admin@sportsmart.com',
  password: process.env.ADMIN_SEED_PASSWORD || 'Admin@123',
  totpSecret: process.env.E2E_ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};
const SELLER = {
  identifier: process.env.E2E_SELLER_EMAIL || 'corpgroup.sd001@gmail.com',
  password: process.env.E2E_SELLER_PASSWORD || 'SellerE2E@123',
};
const PRODUCT_ID = process.env.E2E_PRODUCT_ID || 'ef629968-35e1-467b-b33a-0375e0913c49';
const VARIANT_ID = process.env.E2E_VARIANT_ID || '81cfc307-86f5-4e17-b47f-838146e816d4';
const PINCODE = process.env.E2E_PINCODE || '560001';

// RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) — matches admin-mfa/domain.
function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(c);
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secretBase32: string): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin =
    ((h[o]! & 0x7f) << 24) | ((h[o + 1]! & 0xff) << 16) | ((h[o + 2]! & 0xff) << 8) | (h[o + 3]! & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// Minimal valid 1×1 RGB PNG. Four distinct colours → four distinct file hashes,
// so the shipment-evidence per-sub-order dedupe counts them as 4 separate photos.
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makePng(r: number, g: number, b: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const idat = zlib.deflateSync(Buffer.from([0x00, r, g, b])); // filter byte + RGB pixel
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const EVIDENCE_COLORS: Array<[number, number, number]> = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [120, 120, 120],
];

// Auth endpoints are rate-limited; rapid repeated runs can 429. Retry a few
// times with backoff so the lifecycle isn't flaky under load.
async function postOk(
  ctx: APIRequestContext,
  path: string,
  opts: { data?: any; headers?: Record<string, string> } = {},
  attempts = 5,
) {
  let res = await ctx.post(path, opts);
  for (let i = 1; i < attempts && !res.ok(); i++) {
    await new Promise((r) => setTimeout(r, 1500 * i));
    res = await ctx.post(path, opts);
  }
  return res;
}

// CRITICAL admin actions (COD mark-paid) require an MFA step-up with a code from
// a LATER 30s window than the login's verify (TOTP replay protection). Wait for
// the next window boundary before stepping up.
async function waitForNextTotpWindow() {
  const ms = 30_000 - (Date.now() % 30_000) + 1_000;
  await new Promise((r) => setTimeout(r, ms));
}

test('order lifecycle: place → verify → accept → pack → ship → deliver → COD-collected', async () => {
  test.setTimeout(160_000); // the COD step-up waits up to ~30s for a fresh TOTP window
  // ── 1. Customer places a COD order ──────────────────────────────────────
  const cust: APIRequestContext = await request.newContext({ baseURL: API });
  expect(
    (await postOk(cust, '/api/v1/auth/login', { data: CUSTOMER })).ok(),
    'customer login failed — seed-smoke-actors?',
  ).toBeTruthy();

  let addrs = (await (await cust.get('/api/v1/customer/addresses')).json())?.data ?? [];
  if (!addrs.some((a: any) => a.postalCode === PINCODE)) {
    await cust.post('/api/v1/customer/addresses', {
      data: {
        fullName: 'Smoke Customer', phone: '9876543210',
        addressLine1: '123 Test Street, Smoke Block', city: 'Bengaluru',
        state: 'Karnataka', stateCode: '29', postalCode: PINCODE,
        addressType: 'HOME', isDefault: true,
      },
    });
    addrs = (await (await cust.get('/api/v1/customer/addresses')).json()).data;
  }
  const addressId = addrs.find((a: any) => a.postalCode === PINCODE).id;

  await cust.post('/api/v1/customer/cart/items', {
    data: { productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 },
  });
  const init = await cust.post('/api/v1/customer/checkout/initiate', { data: { addressId } });
  expect(
    (await init.json()).data.allServiceable,
    'product not serviceable — run seed-purchasable-product',
  ).toBeTruthy();

  const placed = await cust.post('/api/v1/customer/checkout/place-order', {
    headers: { 'Idempotency-Key': 'e2e-' + crypto.randomUUID() },
    data: { paymentMethod: 'COD' },
  });
  expect(placed.ok(), `place-order failed: ${await placed.text()}`).toBeTruthy();
  const orderNumber: string = (await placed.json()).data.orderNumber;
  expect(orderNumber).toMatch(/^SM\d+/);

  const detail = (await (await cust.get(`/api/v1/customer/orders/${orderNumber}`)).json()).data;
  const masterId: string = detail.id;
  const subId: string = detail.subOrders[0].id;
  expect(detail.orderStatus).toBe('PLACED');

  // ── 2. Admin verifies (real MFA challenge) → routes to the seller ────────
  const admin = await request.newContext({ baseURL: API });
  // Resilient admin login + MFA verify: re-login on throttle (429), regenerate
  // the TOTP each attempt (handles rate-limits + 30s-window crossings). The
  // seeded admin requires MFA, so a challengeToken is always returned first.
  let adminToken = '';
  for (let attempt = 0; attempt < 6 && !adminToken; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt));
    const lr = await admin.post('/api/v1/admin/auth/login', {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    if (!lr.ok()) continue;
    const login = (await lr.json()).data;
    if (!login?.challengeToken) continue;
    const mr = await admin.post('/api/v1/admin/auth/mfa-verify', {
      data: { challengeToken: login.challengeToken, code: totp(ADMIN.totpSecret) },
    });
    if (mr.ok()) adminToken = (await mr.json()).data.accessToken;
  }
  expect(adminToken, 'admin login/MFA failed — likely an auth rate-limit; space out runs or retry').toBeTruthy();

  const verify = await admin.post(`/api/v1/admin/orders/${masterId}/verify`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { remarks: 'E2E lifecycle verify' },
  });
  expect(verify.ok(), `verify failed: ${await verify.text()}`).toBeTruthy();
  expect((await verify.json()).message).toMatch(/routed to sellers/i);

  const routed = (await (await cust.get(`/api/v1/customer/orders/${orderNumber}`)).json()).data;
  expect(routed.orderStatus).toBe('ROUTED_TO_SELLER');

  // ── 3. Seller accepts the routed sub-order ──────────────────────────────
  const seller = await request.newContext({ baseURL: API });
  const sellerToken: string = (await (await postOk(seller, '/api/v1/seller/auth/login', {
    data: SELLER,
  })).json()).data.accessToken;
  expect(sellerToken, 'seller login failed — run seed-purchasable-product for the password').toBeTruthy();

  const accept = await seller.patch(`/api/v1/seller/orders/${subId}/accept`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
    data: {},
  });
  expect(accept.ok(), `accept failed: ${await accept.text()}`).toBeTruthy();
  expect((await accept.json()).message).toMatch(/accepted/i);

  const accepted = (await (await cust.get(`/api/v1/customer/orders/${orderNumber}`)).json()).data;
  expect(accepted.subOrders[0].acceptStatus).toBe('ACCEPTED');

  // ── 4. Seller uploads 4 dispatch photos, packs, then ships ──────────────
  for (let i = 0; i < EVIDENCE_COLORS.length; i++) {
    const [r, g, b] = EVIDENCE_COLORS[i]!;
    const up = await seller.post(`/api/v1/seller/sub-orders/${subId}/shipment-evidence`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      multipart: {
        image: { name: `dispatch-${i}.png`, mimeType: 'image/png', buffer: makePng(r, g, b) },
        caption: `E2E dispatch ${i + 1}`,
      },
    });
    expect(up.ok(), `evidence upload ${i} failed: ${await up.text()}`).toBeTruthy();
  }

  // AWB / tracking numbers are globally unique — generate a fresh one per run.
  const tracking = 'E2E' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const pack = await seller.patch(`/api/v1/seller/orders/${subId}/status`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
    data: { status: 'PACKED', trackingNumber: tracking },
  });
  expect(pack.ok(), `pack failed: ${await pack.text()}`).toBeTruthy();

  const ship = await seller.patch(`/api/v1/seller/orders/${subId}/status`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
    data: { status: 'SHIPPED', trackingNumber: tracking, courierName: 'DELHIVERY' },
  });
  expect(ship.ok(), `ship failed: ${await ship.text()}`).toBeTruthy();

  const shipped = (await (await cust.get(`/api/v1/customer/orders/${orderNumber}`)).json()).data;
  expect(shipped.subOrders[0].fulfillmentStatus).toBe('SHIPPED');
  expect(shipped.orderStatus).toBe('DISPATCHED');

  // ── 5. Admin marks delivered, then collects the COD cash ────────────────
  // mark-delivered is a normal admin action; COD mark-paid is CRITICAL and
  // needs a fresh-window MFA step-up (the verify above consumed the current
  // TOTP window, and codes can't be replayed). The step-up unlocks destructive
  // admin actions for ~5 minutes.
  const deliver = await admin.post(`/api/v1/admin/orders/sub-orders/${subId}/mark-delivered`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {},
  });
  expect(deliver.ok(), `deliver failed: ${await deliver.text()}`).toBeTruthy();

  await waitForNextTotpWindow();
  const stepup = await admin.post('/api/v1/admin/mfa/step-up', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { code: totp(ADMIN.totpSecret) },
  });
  expect(stepup.ok(), `MFA step-up failed: ${await stepup.text()}`).toBeTruthy();

  const codPaid = await admin.patch(`/api/v1/admin/orders/${masterId}/mark-paid`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { collectionReference: 'E2E-COD-' + crypto.randomBytes(3).toString('hex').toUpperCase() },
  });
  expect(codPaid.ok(), `COD mark-paid failed: ${await codPaid.text()}`).toBeTruthy();

  const finalState = (await (await cust.get(`/api/v1/customer/orders/${orderNumber}`)).json()).data;
  expect(finalState.subOrders[0].fulfillmentStatus).toBe('DELIVERED');
  expect(finalState.paymentStatus).toBe('PAID');

  await cust.dispose();
  await admin.dispose();
  await seller.dispose();
});
