import { test, expect, request, type APIRequestContext } from '@playwright/test';

/**
 * UI E2E — a customer buys a product through the storefront and places a COD
 * order, end to end, in a real browser. Mirrors the API-level smoke flow but
 * drives the actual UI (login form → product page → cart → checkout → order
 * confirmation).
 *
 * PRECONDITIONS (see e2e/README.md):
 *   1. Dev stack running: API on :8000, storefront on :4005 (`turbo run dev`).
 *   2. A purchasable product exists (variant ACTIVE + seller mapping + service
 *      area for PINCODE):
 *        pnpm --filter @sportsmart/api exec ts-node \
 *          prisma/seed/seed-purchasable-product.ts
 *   The smoke customer (seed-smoke-actors) + a serviceable address are ensured
 *   by beforeAll() below, so the spec is otherwise self-contained.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8000';
const EMAIL = process.env.E2E_EMAIL || 'smoke-customer@sportsmart.test';
const PASSWORD = process.env.E2E_PASSWORD || 'SmokeCustomer@123';
const PRODUCT_SLUG =
  process.env.E2E_PRODUCT_SLUG || 'nova-sm-elite-cricket-batting-gloves';
const PINCODE = process.env.E2E_PINCODE || '560001';

// Make sure the smoke customer has an address serviceable to PINCODE. Done over
// the API (idempotent) so the UI test starts from a known state instead of
// having to drive the multi-field address form on every run.
test.beforeAll(async () => {
  const ctx: APIRequestContext = await request.newContext({ baseURL: API });
  const login = await ctx.post('/api/v1/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(
    login.ok(),
    'smoke-customer login failed — is the API up and the customer seeded (seed-smoke-actors)?',
  ).toBeTruthy();

  const list = await ctx.get('/api/v1/customer/addresses');
  const addrs = (await list.json())?.data ?? [];
  const hasServiceable =
    Array.isArray(addrs) && addrs.some((a: any) => a.postalCode === PINCODE);
  if (!hasServiceable) {
    await ctx.post('/api/v1/customer/addresses', {
      data: {
        fullName: 'Smoke Customer',
        phone: '9876543210',
        addressLine1: '123 Test Street, Smoke Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        stateCode: '29',
        postalCode: PINCODE,
        addressType: 'HOME',
        isDefault: true,
      },
    });
  }
  await ctx.dispose();
});

test('customer places a COD order through the storefront UI', async ({ page }) => {
  // ── 1. Log in ───────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Login redirects away from /login on success.
  await page.waitForURL((u) => !u.pathname.includes('/login'), {
    timeout: 20_000,
  });

  // ── 2. Open the product and add it to the cart ──────────────────────────
  await page.goto(`/products/${PRODUCT_SLUG}`);
  const addToCart = page.getByRole('button', { name: 'Add to cart' });
  // Enabled only once the variant resolves + stock is confirmed.
  await expect(addToCart).toBeEnabled({ timeout: 15_000 });
  await addToCart.click();

  // ── 3. Go to the cart and start checkout ────────────────────────────────
  await page.goto('/cart');
  await page
    .getByRole('button', { name: /checkout/i })
    .or(page.getByRole('link', { name: /checkout/i }))
    .first()
    .click();
  await page.waitForURL(/\/checkout/, { timeout: 20_000 });

  // ── 4. Run the delivery check, then place the COD order ─────────────────
  // The checkout CTA is two-step: "Check delivery & continue" runs the
  // serviceability/allocation (populating the order summary), and only then
  // becomes "Place order (COD)". The address auto-selects and COD is the
  // default method, so no extra toggles are needed.
  const checkDelivery = page.getByRole('button', { name: /check delivery/i });
  await expect(checkDelivery).toBeEnabled({ timeout: 15_000 });
  await checkDelivery.click();

  const placeOrder = page.getByRole('button', { name: /place order/i });
  await expect(placeOrder).toBeEnabled({ timeout: 20_000 });
  await placeOrder.click();

  // ── 5. Land on the order-confirmation page ──────────────────────────────
  await page.waitForURL(/\/orders\/SM\d+/, { timeout: 25_000 });
  await expect(page).toHaveURL(/\/orders\/SM\d+/);

  const orderNumber = page.url().match(/orders\/(SM\d+)/)?.[1];
  expect(
    orderNumber,
    'expected an SM-prefixed order number in the confirmation URL',
  ).toBeTruthy();
  // The order-detail page should render the new order number.
  await expect(page.getByText(new RegExp(orderNumber!)).first()).toBeVisible({
    timeout: 12_000,
  });
});
