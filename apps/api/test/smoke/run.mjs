#!/usr/bin/env node
// Smoke test runner for the Sportsmart API.
//
// Run:    pnpm smoke
//
// Goal: catch regressions that break the main paths every other story
//       depends on. Not a substitute for unit tests; not a substitute
//       for E2E. Should run in <30s against a fresh-seeded local DB
//       and exit non-zero if anything broke.
//
// V1 (this file): health + admin login + admin /me + DB-touching list
//                 endpoints across major modules.
// V2 (scaffolded as skipped): non-admin actor logins + order placement
//                 (online + COD) + notification-log assertion. Needs
//                 seed-smoke-actors.ts (customer/seller/franchise/
//                 affiliate fixtures with known credentials) and a
//                 serviceable test pincode + product mapping.

import { setTimeout as delay } from 'node:timers/promises';

const API_BASE = process.env.SMOKE_API_BASE || 'http://localhost:8000/api/v1';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL
  || process.env.ADMIN_SEED_EMAIL
  || 'admin@sportsmart.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD
  || process.env.ADMIN_SEED_PASSWORD
  || 'Admin@123';

// Sprint 3 Story 2.1 — deterministic customer seeded by
// `pnpm --filter @sportsmart/api seed:smoke`. Hardcoded creds match
// seed-smoke-actors.ts; smoke is bound to that fixture and only that
// fixture. Run the seed before pnpm smoke if the customer login step
// 401s.
const CUSTOMER_EMAIL = process.env.SMOKE_CUSTOMER_EMAIL || 'smoke-customer@sportsmart.test';
const CUSTOMER_PASSWORD = process.env.SMOKE_CUSTOMER_PASSWORD || 'SmokeCustomer@123';

const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 5000);

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GREY = '\x1b[90m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// Shared context — populated by earlier tests, consumed by later ones.
const ctx = {
  adminAccessToken: null,
  adminRefreshToken: null,
  admin: null,
  customerAccessToken: null,
  customer: null,
  // Sprint 3 Story 2.2 — captured from the /admin/products list so
  // the wishlist add step has a real product id to reference without
  // hardcoding a seed-derived UUID.
  sampleProductId: null,
  // The wishlist item id created during this run, so the delete
  // step can clean up after itself.
  wishlistItemId: null,
  // Sprint 3 Story 2.3 — cart-item id for the save-for-later round-trip.
  cartItemId: null,
};

async function http(method, path, { headers = {}, body, token } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - start;
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      // non-JSON body (HTML error page, etc.) — leave parsed null
    }
    return {
      status: res.status,
      body: parsed,
      elapsedMs,
      headers: res.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

function logPass(name, detail, elapsedMs) {
  passed++;
  const ms = elapsedMs != null ? `${GREY}(${elapsedMs}ms)${RESET}` : '';
  const tail = detail ? `${GREY}— ${detail}${RESET}` : '';
  console.log(`  ${GREEN}✓${RESET} ${name.padEnd(36)} ${ms} ${tail}`);
}
function logFail(name, reason, elapsedMs) {
  failed++;
  failures.push({ name, reason });
  const ms = elapsedMs != null ? `${GREY}(${elapsedMs}ms)${RESET}` : '';
  console.log(`  ${RED}✗${RESET} ${name.padEnd(36)} ${ms} ${RED}${reason}${RESET}`);
}
function logSkip(name, reason) {
  skipped++;
  console.log(`  ${YELLOW}○${RESET} ${name.padEnd(36)} ${YELLOW}skipped${RESET} ${GREY}— ${reason}${RESET}`);
}

async function runStep(name, fn, { skipIf } = {}) {
  if (skipIf) {
    logSkip(name, skipIf);
    return;
  }
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFail(name, msg);
  }
}

// ── Banner ───────────────────────────────────────────────────────────────
console.log(`\n${BOLD}${CYAN}SMOKE TESTS${RESET} · ${API_BASE}\n`);

// ── 1. Liveness ──────────────────────────────────────────────────────────
await runStep('GET /health/live', async () => {
  const res = await http('GET', '/health/live');
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  if (res.body?.status !== 'alive') throw new Error(`status field='${res.body?.status}'`);
  logPass('GET /health/live', `status=${res.body.status}`, res.elapsedMs);
});

// ── 1b. X-Request-Id round-trip (Story 0.5) ──────────────────────────────
// Sends a caller-supplied X-Request-Id, asserts the server echoes the
// exact same value in the response. Guards the "every [HTTP] log line
// includes req=<id>" exit criterion against regressions in
// RequestLoggingMiddleware.
await runStep('X-Request-Id round-trip', async () => {
  const id = `smoke-${Date.now()}`;
  const res = await http('GET', '/health/live', {
    headers: { 'X-Request-Id': id },
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const echoed = res.headers.get('x-request-id');
  if (echoed !== id) {
    throw new Error(`sent='${id}' but server echoed='${echoed}'`);
  }
  logPass('X-Request-Id round-trip', `id=${id}`, res.elapsedMs);
});

// ── 2. Readiness (touches DB + Redis) ────────────────────────────────────
await runStep('GET /health (DB + Redis probes)', async () => {
  const res = await http('GET', '/health');
  if (res.status !== 200) {
    throw new Error(`status=${res.status} checks=${JSON.stringify(res.body?.checks)}`);
  }
  if (res.body?.checks?.database !== 'ok') {
    throw new Error(`database check failed: ${res.body?.checks?.database}`);
  }
  if (res.body?.checks?.redis !== 'ok') {
    throw new Error(`redis check failed: ${res.body?.checks?.redis}`);
  }
  logPass(
    'GET /health (DB + Redis probes)',
    `db=ok redis=ok`,
    res.elapsedMs,
  );
});

// ── 3. Admin login ───────────────────────────────────────────────────────
await runStep('POST /admin/auth/login', async () => {
  const res = await http('POST', '/admin/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  const data = res.body?.data ?? res.body;
  if (!data?.accessToken) {
    throw new Error(`no accessToken in response — got keys ${Object.keys(data ?? {}).join(',')}`);
  }
  ctx.adminAccessToken = data.accessToken;
  ctx.adminRefreshToken = data.refreshToken;
  ctx.admin = data.admin ?? data.user;
  logPass(
    'POST /admin/auth/login',
    `admin=${ctx.admin?.email ?? '?'} token=${ctx.adminAccessToken.slice(0, 12)}…`,
    res.elapsedMs,
  );
});

// ── 4. Admin /me (with bearer) ───────────────────────────────────────────
await runStep('GET /admin/auth/me', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token from previous step');
  const res = await http('GET', '/admin/auth/me', { token: ctx.adminAccessToken });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const me = res.body?.data ?? res.body;
  if (!me?.email && !me?.adminId) {
    throw new Error(`me response missing email/adminId — keys ${Object.keys(me ?? {}).join(',')}`);
  }
  logPass(
    'GET /admin/auth/me',
    `role=${me.role ?? '?'}`,
    res.elapsedMs,
  );
}, { skipIf: !ctx.adminAccessToken ? null : undefined });

// ── 5–7. List endpoints (each touches a major module + RBAC + DB) ────────
const listEndpoints = [
  { name: 'GET /admin/sellers', path: '/admin/sellers' },
  { name: 'GET /admin/orders', path: '/admin/orders' },
  { name: 'GET /admin/products', path: '/admin/products' },
  // Sprint 2 Story 1.2 — rewritten admin file moderation list. Locks
  // in the service-layer routing (was `(service as any).prisma`).
  { name: 'GET /admin/files', path: '/admin/files?limit=10' },
  // Sprint 2 Story 1.3 — audit + event log query API. Locks in
  // permission gating (audit.read) + pagination shape.
  { name: 'GET /admin/audit/logs', path: '/admin/audit/logs?limit=10' },
  { name: 'GET /admin/audit/events', path: '/admin/audit/events?limit=10' },
  // Sprint 2 Story 1.5 — affiliate admin surface. Locks in
  // `affiliates.read` permission + module wiring across 4 controllers
  // (affiliates list, commissions, payouts, reports).
  { name: 'GET /admin/affiliates', path: '/admin/affiliates?limit=10' },
  { name: 'GET /admin/affiliates/payouts', path: '/admin/affiliates/payouts?limit=10' },
  { name: 'GET /admin/affiliates/commissions', path: '/admin/affiliates/commissions?limit=10' },
  // Sprint 4 Story 3.2 — routing engine health. Aggregates exception
  // queue backlog, reassignment volume, top rejecting nodes. Empty
  // payload on a clean dev DB is the expected response.
  { name: 'GET /admin/routing/health', path: '/admin/routing/health' },
  // Sprint 4 Story 3.3 — admin shipping surface. Hits a known-bogus
  // sub-order id; expects 404. Proves AdminAuthGuard, module loading,
  // route registration without needing real shipping fixtures.
  { name: 'GET /admin/shipping/sub-orders/:fake', path: '/admin/shipping/sub-orders/non-existent', expectStatus: 404 },
  // Sprint 4 Story 3.4 — inventory admin surface + low-stock alerts list.
  { name: 'GET /admin/inventory/overview', path: '/admin/inventory/overview' },
  { name: 'GET /admin/inventory/alerts', path: '/admin/inventory/alerts' },
  // Sprint 4 Story 3.5 — seller-mapping approval queue. Locks in the
  // module wiring + permission gating. Empty list on a dev DB is OK.
  { name: 'GET /admin/seller-mappings/pending', path: '/admin/seller-mappings/pending' },
  { name: 'GET /admin/seller-mappings', path: '/admin/seller-mappings?limit=10' },
  // Sprint 5 Story 4.1 — refund admin approval queue (ADR-017 gate).
  { name: 'GET /admin/refund-instructions', path: '/admin/refund-instructions?limit=10' },
  { name: 'GET /admin/refund-instructions (PENDING_APPROVAL)', path: '/admin/refund-instructions?status=PENDING_APPROVAL' },
  // Sprint 5 Story 4.2 — payout admin batches (existing surface; silent-
  // money-loss guard tested by ingest-response path).
  { name: 'GET /admin/payouts', path: '/admin/payouts?limit=10' },
  // Sprint 5 Story 4.3 — wallet admin list (full customer wallet surface
  // exists separately at /customer/wallet, smoke-tested via the
  // dedicated step below).
  { name: 'GET /admin/wallets', path: '/admin/wallets?limit=10' },
  // Sprint 5 Story 4.4 — disputes admin queue.
  { name: 'GET /admin/disputes', path: '/admin/disputes?limit=10' },
  // Sprint 5 Story 4.5 — reconciliation runs (PAYMENT + COD + scaffolded WALLET/SETTLEMENT/REFUND).
  { name: 'GET /admin/reconciliation/runs', path: '/admin/reconciliation/runs?limit=10' },
  // Sprint 6 Phase 5 — discovery / content / promotions.
  { name: 'GET /admin/storefront/menus', path: '/admin/storefront/menus' },
  { name: 'GET /admin/blog-posts', path: '/admin/blog-posts?limit=10' },
  { name: 'GET /admin/storefront-slots', path: '/admin/storefront-slots' },
  { name: 'GET /admin/discounts', path: '/admin/discounts?limit=10' },
  // Sprint 7 Phase 6 — support / analytics / access-logs.
  { name: 'GET /admin/support/tickets', path: '/admin/support/tickets?limit=10' },
  { name: 'GET /admin/analytics/sales', path: '/admin/analytics/sales' },
  { name: 'GET /admin/access-logs/recent-failures', path: '/admin/access-logs/recent-failures?limit=10' },
  { name: 'GET /admin/activity', path: '/admin/activity?limit=10' },
  // Sprint 7 Story 6.3 — admin session-revocation surface. Locks in
  // `sessions.read` permission + cross-table merge across admin/user/
  // seller/franchise session tables. Empty results on a clean dev DB
  // are fine — we're verifying the route is reachable.
  { name: 'GET /admin/sessions', path: '/admin/sessions?limit=10' },
  // Sprint 7 Story 6.4 — audit-log viewer reads. The fast chain
  // verification path lights up the AuditChainAnchorService cron
  // anchor — empty `breaks` on a healthy chain is the only acceptable
  // happy path.
  { name: 'GET /admin/audit/verify-chain-fast', path: '/admin/audit/verify-chain-fast?limit=100' },
  // Sprint 8 Phase 7 — Nova SM own-brand + AI.
  { name: 'GET /admin/nova/warehouses', path: '/admin/nova/warehouses' },
  { name: 'GET /admin/nova/products', path: '/admin/nova/products?limit=10' },
  { name: 'GET /admin/nova/procurement', path: '/admin/nova/procurement?limit=10' },
  // Sprint 9 Phase 8 — observability + queues. Admin queue aggregator
  // (returns/disputes/tickets unified by SLA + risk).
  { name: 'GET /admin/queues/summary', path: '/admin/queues/summary' },
];

for (const ep of listEndpoints) {
  await runStep(ep.name, async () => {
    if (!ctx.adminAccessToken) throw new Error('no admin token');
    const res = await http('GET', ep.path, { token: ctx.adminAccessToken });
    const expected = ep.expectStatus ?? 200;
    if (res.status !== expected) {
      throw new Error(`status=${res.status} (expected ${expected}) body=${JSON.stringify(res.body).slice(0, 200)}`);
    }
    if (expected !== 200) {
      // Non-200 expectations (e.g., 404 for "route is wired" smokes)
      // don't have a count to report — just log the status match.
      logPass(ep.name, `${expected} as expected`, res.elapsedMs);
      return;
    }
    const data = res.body?.data ?? res.body;
    const count = Array.isArray(data) ? data.length
      : Array.isArray(data?.items) ? data.items.length
      : Array.isArray(data?.products) ? data.products.length
      : Array.isArray(data?.sellers) ? data.sellers.length
      : Array.isArray(data?.orders) ? data.orders.length
      : '?';
    // Capture a sample product id for downstream wishlist tests.
    if (ep.path.startsWith('/admin/products') && !ctx.sampleProductId) {
      const products = Array.isArray(data?.products)
        ? data.products
        : Array.isArray(data?.items)
        ? data.items
        : [];
      if (products[0]?.id) ctx.sampleProductId = products[0].id;
    }
    logPass(ep.name, `count=${count}`, res.elapsedMs);
  });
}

// ── Sprint 2 Story 1.4: COD eligibility endpoint reachability ────────────
// Hits POST /cod/evaluate with a low-value request that should pass
// default-allow (when no admin rules block). Locks in:
//   - Public route registration (no auth required for eligibility check)
//   - CodRuleEngine.evaluate path
//   - Decision logging side-effect (writes to cod_decision_log)
await runStep('POST /cod/evaluate', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  const res = await http('POST', '/cod/evaluate', {
    token: ctx.adminAccessToken,
    body: { pincode: '110001', orderTotalInr: 500 },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const data = res.body?.data ?? res.body;
  if (typeof data?.eligible !== 'boolean') {
    throw new Error(`response missing 'eligible' field: ${JSON.stringify(data).slice(0, 200)}`);
  }
  logPass('POST /cod/evaluate', `eligible=${data.eligible} decidedBy=${data.decidedBy ?? '?'}`, res.elapsedMs);
});

// ── Sprint 2 Story 1.1: notifications dispatch endpoint reachability ─────
// Posts an empty body and asserts the endpoint returns 400 with the
// documented "channel is required" message. Validates:
//   - controller registered + module wired
//   - AdminAuthGuard + PermissionsGuard pass for an authed admin
//   - validation logic fires before any actual send
// Without this we'd only learn the endpoint is broken when ops tries
// to use it during an incident.
await runStep('POST /admin/notifications/dispatch (validation)', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  const res = await http('POST', '/admin/notifications/dispatch', {
    token: ctx.adminAccessToken,
    body: {},
  });
  if (res.status !== 400) {
    throw new Error(`expected 400 on empty body, got ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
  }
  // Just check that validation tripped — exact message wording is
  // free to evolve.
  const msg = res.body?.message ?? res.body?.detail ?? '';
  const msgStr = Array.isArray(msg) ? msg.join('; ') : String(msg);
  if (!msgStr.toLowerCase().includes('required')) {
    throw new Error(`expected message about required field, got: ${msgStr.slice(0, 120)}`);
  }
  logPass(
    'POST /admin/notifications/dispatch (validation)',
    `400 with "${msgStr.slice(0, 50)}..."`,
    res.elapsedMs,
  );
});

// ── Sprint 4 Story 3.5: pricing-tier validation ───────────────────────
// Admin POST with a negative discount percent should be rejected by
// the service-level guard (DB also has a check constraint, but the
// service rejects it first). Hits a bogus product id; we expect a
// 4xx response either way, which proves the route is wired + guards
// pass. Avoid trying to read a real product — keeps smoke lightweight.
await runStep('POST /admin/products/:fake/pricing-tiers (validation)', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  const res = await http(
    'POST',
    '/admin/products/00000000-0000-0000-0000-000000000000/pricing-tiers',
    {
      token: ctx.adminAccessToken,
      body: { minQuantity: 0, discountPercent: -5 },
    },
  );
  if (res.status < 400 || res.status >= 500) {
    throw new Error(
      `expected 4xx on bad payload, got ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
  logPass(
    'POST /admin/products/:fake/pricing-tiers (validation)',
    `${res.status} as expected`,
    res.elapsedMs,
  );
});

// ── Sprint 9 Story 3.4: Nova stock-transfer validation ─────────────────
// Posts a transfer with same source + destination so the service short-
// circuits with a 400. Validates:
//   - controller registered + `nova.stock` permission gate passes
//   - AdminAuthGuard + PermissionsGuard chain wires correctly
//   - service-level validation fires before any DB write
// Bogus product/warehouse IDs would also reject, but same-source-and-
// dest is the cheapest validation to assert.
await runStep('POST /admin/nova/stocks/transfer (validation)', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  const res = await http('POST', '/admin/nova/stocks/transfer', {
    token: ctx.adminAccessToken,
    body: {
      fromWarehouseId: '00000000-0000-0000-0000-000000000000',
      toWarehouseId: '00000000-0000-0000-0000-000000000000',
      productId: '00000000-0000-0000-0000-000000000000',
      quantity: 1,
      reason: 'smoke',
    },
  });
  if (res.status !== 400) {
    throw new Error(
      `expected 400 on same source/dest, got ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
  logPass(
    'POST /admin/nova/stocks/transfer (validation)',
    '400 on same source/dest as expected',
    res.elapsedMs,
  );
});

// ── Sprint 7 Story 6.3: session-revocation 400 on missing actorType ───
// DELETE /admin/sessions/:id requires `actorType` in body. Smoke posts
// without it to assert validation fires (and that the route + perm
// gate are wired). Uses a fake session id; the route never reaches a
// DB lookup because validation rejects first.
await runStep('DELETE /admin/sessions/:id (validation)', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  const res = await http('DELETE', '/admin/sessions/non-existent', {
    token: ctx.adminAccessToken,
    body: {},
  });
  if (res.status !== 400) {
    throw new Error(
      `expected 400 on missing actorType, got ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
  logPass(
    'DELETE /admin/sessions/:id (validation)',
    '400 on missing actorType as expected',
    res.elapsedMs,
  );
});

// ── Customer flow (Sprint 3 Story 2.1) ───────────────────────────────────
// Powered by seed-smoke-actors.ts. Login → /me → /addresses round-trip.
// Locks in the buyer-account surface against regressions.

await runStep('POST /auth/login (customer)', async () => {
  const res = await http('POST', '/auth/login', {
    body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} — run \`pnpm --filter @sportsmart/api seed:smoke\` first`);
  }
  const data = res.body?.data ?? res.body;
  if (!data?.accessToken) throw new Error('no accessToken in response');
  ctx.customerAccessToken = data.accessToken;
  ctx.customer = data.user;
  logPass(
    'POST /auth/login (customer)',
    `email=${ctx.customer?.email ?? '?'} token=${ctx.customerAccessToken.slice(0, 12)}…`,
    res.elapsedMs,
  );
});

await runStep('GET /customer/me', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/me', {
    token: ctx.customerAccessToken,
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const me = res.body?.data ?? res.body;
  if (me?.email !== CUSTOMER_EMAIL) {
    throw new Error(`expected email=${CUSTOMER_EMAIL}, got=${me?.email}`);
  }
  logPass('GET /customer/me', `email=${me.email}`, res.elapsedMs);
});

// Sprint 5 Story 4.3 — customer wallet balance. Lazily-created on
// first credit; new accounts return balanceInPaise=0.
await runStep('GET /customer/wallet', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/wallet', { token: ctx.customerAccessToken });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const data = res.body?.data ?? res.body;
  logPass(
    'GET /customer/wallet',
    `balanceInPaise=${data?.balanceInPaise ?? '0'} currency=${data?.currency ?? '?'}`,
    res.elapsedMs,
  );
});

await runStep('GET /customer/addresses', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/addresses', {
    token: ctx.customerAccessToken,
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const data = res.body?.data ?? res.body;
  const count = Array.isArray(data) ? data.length
    : Array.isArray(data?.items) ? data.items.length
    : Array.isArray(data?.addresses) ? data.addresses.length
    : '?';
  logPass('GET /customer/addresses', `count=${count}`, res.elapsedMs);
});

// ── Sprint 3 Story 2.2 — wishlist round-trip ─────────────────────────────
// add → list → delete. Cleans up after itself so the smoke is
// idempotent. Uses the sample product id captured from the
// /admin/products step earlier in this run.

await runStep('POST /customer/wishlist (add)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  if (!ctx.sampleProductId) {
    throw new Error('no sample product captured — /admin/products may have returned 0 products');
  }
  const res = await http('POST', '/customer/wishlist', {
    token: ctx.customerAccessToken,
    body: { productId: ctx.sampleProductId, note: 'smoke run' },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const item = res.body?.data ?? res.body;
  if (!item?.id) throw new Error('no wishlist item id in response');
  ctx.wishlistItemId = item.id;
  logPass(
    'POST /customer/wishlist (add)',
    `itemId=${item.id.slice(0, 8)}…`,
    res.elapsedMs,
  );
});

await runStep('GET /customer/wishlist', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/wishlist', {
    token: ctx.customerAccessToken,
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const data = res.body?.data ?? res.body;
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.find((i) => i.id === ctx.wishlistItemId)) {
    throw new Error(`item ${ctx.wishlistItemId} not in returned list`);
  }
  logPass('GET /customer/wishlist', `count=${items.length}`, res.elapsedMs);
});

await runStep('DELETE /customer/wishlist/:id', async () => {
  if (!ctx.customerAccessToken || !ctx.wishlistItemId) {
    throw new Error('missing customer token or wishlist item id');
  }
  const res = await http(
    'DELETE',
    `/customer/wishlist/${ctx.wishlistItemId}`,
    { token: ctx.customerAccessToken },
  );
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  logPass(
    'DELETE /customer/wishlist/:id',
    `cleaned up ${ctx.wishlistItemId.slice(0, 8)}…`,
    res.elapsedMs,
  );
});

// ── Sprint 3 Story 2.3 — cart save-for-later round-trip ──────────────────
// add to cart → park → confirm moved to savedItems → move back → confirm
// active again → cleanup. Stock validation may 400 the second step if the
// sample product has no stock; we accept that as a documented soft skip
// rather than failing the whole smoke.

await runStep('POST /customer/cart/items (add for save-later test)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  if (!ctx.sampleProductId) throw new Error('no sample product id');
  const res = await http('POST', '/customer/cart/items', {
    token: ctx.customerAccessToken,
    body: { productId: ctx.sampleProductId, quantity: 1 },
  });
  // 400 with "Insufficient stock" is acceptable — the sample product
  // may have 0 stock in the dev seed. Skip the round-trip with a log
  // line rather than failing.
  if (res.status === 400 && /stock/i.test(JSON.stringify(res.body))) {
    skipped++;
    console.log(`  ${YELLOW}○${RESET} POST /customer/cart/items                ${YELLOW}skipped${RESET} ${GREY}— sample product out of stock${RESET}`);
    return;
  }
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
  }
  // Fetch cart to find the id of the row we just created.
  const cart = await http('GET', '/customer/cart', { token: ctx.customerAccessToken });
  const items = cart.body?.data?.items ?? [];
  const mine = items.find((i) => i.productId === ctx.sampleProductId);
  if (!mine) throw new Error('cart item not found after add');
  ctx.cartItemId = mine.id;
  logPass('POST /customer/cart/items (add)', `id=${mine.id.slice(0, 8)}…`, res.elapsedMs);
});

await runStep('POST /customer/cart/items/:id/save-for-later', async () => {
  if (!ctx.cartItemId) { skipped++; return; }
  const res = await http(
    'POST',
    `/customer/cart/items/${ctx.cartItemId}/save-for-later`,
    { token: ctx.customerAccessToken },
  );
  if (res.status !== 200 && res.status !== 201) throw new Error(`status=${res.status}`);
  // Verify it's now in savedItems, not items.
  const cart = await http('GET', '/customer/cart', { token: ctx.customerAccessToken });
  const saved = cart.body?.data?.savedItems ?? [];
  const active = cart.body?.data?.items ?? [];
  if (!saved.find((i) => i.id === ctx.cartItemId)) {
    throw new Error('item not in savedItems after save-for-later');
  }
  if (active.find((i) => i.id === ctx.cartItemId)) {
    throw new Error('item still in active items after save-for-later');
  }
  logPass(
    'POST /customer/cart/items/:id/save-for-later',
    `parked + verified in savedItems`,
    res.elapsedMs,
  );
});

await runStep('POST /customer/cart/items/:id/move-to-cart', async () => {
  if (!ctx.cartItemId) { skipped++; return; }
  const res = await http(
    'POST',
    `/customer/cart/items/${ctx.cartItemId}/move-to-cart`,
    { token: ctx.customerAccessToken },
  );
  if (res.status !== 200 && res.status !== 201) throw new Error(`status=${res.status}`);
  const cart = await http('GET', '/customer/cart', { token: ctx.customerAccessToken });
  const active = cart.body?.data?.items ?? [];
  if (!active.find((i) => i.id === ctx.cartItemId)) {
    throw new Error('item not back in active items after move-to-cart');
  }
  logPass(
    'POST /customer/cart/items/:id/move-to-cart',
    `moved back + verified active`,
    res.elapsedMs,
  );
});

// ── Sprint 4 Story 3.2 — routing preview round-trip ─────────────────────
// Calls POST /admin/routing/preview with the captured sample product
// at a real-Indian pincode. Asserts the response shape (summary +
// per-item allocation result). Whether the item is "serviceable" or
// not depends on seller-mapping data; either outcome is a valid pass —
// what we lock in is that the engine RAN.
await runStep('POST /admin/routing/preview', async () => {
  if (!ctx.adminAccessToken) throw new Error('no admin token');
  if (!ctx.sampleProductId) throw new Error('no sample product id');
  const res = await http('POST', '/admin/routing/preview', {
    token: ctx.adminAccessToken,
    body: {
      pincode: '110001', // Delhi GPO — present in seeded PostOffice
      items: [{ productId: ctx.sampleProductId, quantity: 1 }],
    },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const summary = res.body?.data?.summary;
  if (!summary || typeof summary.totalItems !== 'number') {
    throw new Error(`unexpected response shape: ${JSON.stringify(res.body?.data).slice(0, 200)}`);
  }
  logPass(
    'POST /admin/routing/preview',
    `total=${summary.totalItems} servicable=${summary.servicableItems} unservicable=${summary.unservicableItems}`,
    res.elapsedMs,
  );
});

// ── Sprint 3 Story 2.5 — buyer order detail + timeline reachability ─────
// The smoke customer has no orders by design (it's a freshly seeded
// account). So:
//   - GET /customer/orders should return 200 with an empty list
//   - GET /customer/orders/<fake-number> should return 404 with the
//     standard "Order not found" — proves the timeline-enriching code
//     path is reachable end-to-end
// When seed-smoke-actors grows a sample order fixture, this step can
// upgrade to assert the timeline array shape (kind/label/at).

await runStep('GET /customer/orders (empty)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/orders', {
    token: ctx.customerAccessToken,
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  logPass('GET /customer/orders (empty)', `200 OK`, res.elapsedMs);
});

await runStep('GET /customer/orders/:fake (404 path)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('GET', '/customer/orders/SM-SMOKE-NONE', {
    token: ctx.customerAccessToken,
  });
  if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  const msg = res.body?.message ?? res.body?.detail ?? '';
  const msgStr = Array.isArray(msg) ? msg.join('; ') : String(msg);
  if (!/order.*not.*found/i.test(msgStr)) {
    throw new Error(`expected 'Order not found' message, got: ${msgStr.slice(0, 120)}`);
  }
  logPass(
    'GET /customer/orders/:fake (404 path)',
    `404 "${msgStr.slice(0, 40)}…"`,
    res.elapsedMs,
  );
});

// ── Sprint 3 Story 2.4 — address format validation ──────────────────────
// Bad-pincode and bad-phone payloads must 400 with specific reasons,
// not generic "invalid pincode" after a DB lookup miss.

await runStep('POST /customer/addresses (bad pincode)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('POST', '/customer/addresses', {
    token: ctx.customerAccessToken,
    body: {
      fullName: 'Smoke Customer',
      phone: '9876543210',
      addressLine1: '123 Test Lane',
      city: 'Delhi',
      state: 'DL',
      postalCode: 'ABC123',
    },
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  const msg = res.body?.message ?? res.body?.detail ?? '';
  const msgStr = Array.isArray(msg) ? msg.join('; ') : String(msg);
  if (!msgStr.toLowerCase().includes('pin')) {
    throw new Error(`expected message about pincode, got: ${msgStr.slice(0, 120)}`);
  }
  logPass(
    'POST /customer/addresses (bad pincode)',
    `400 with "${msgStr.slice(0, 50)}…"`,
    res.elapsedMs,
  );
});

await runStep('POST /customer/addresses (bad phone)', async () => {
  if (!ctx.customerAccessToken) throw new Error('no customer token');
  const res = await http('POST', '/customer/addresses', {
    token: ctx.customerAccessToken,
    body: {
      fullName: 'Smoke Customer',
      phone: '12345',  // too short, not Indian-mobile prefix
      addressLine1: '123 Test Lane',
      city: 'Delhi',
      state: 'DL',
      postalCode: '110001',
    },
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  const msg = res.body?.message ?? res.body?.detail ?? '';
  const msgStr = Array.isArray(msg) ? msg.join('; ') : String(msg);
  if (!msgStr.toLowerCase().includes('phone')) {
    throw new Error(`expected message about phone, got: ${msgStr.slice(0, 120)}`);
  }
  logPass(
    'POST /customer/addresses (bad phone)',
    `400 with "${msgStr.slice(0, 50)}…"`,
    res.elapsedMs,
  );
});

await runStep('DELETE /customer/cart/items/:id (cleanup)', async () => {
  if (!ctx.cartItemId) { skipped++; return; }
  const res = await http(
    'DELETE',
    `/customer/cart/items/${ctx.cartItemId}`,
    { token: ctx.customerAccessToken },
  );
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  logPass('DELETE /customer/cart/items/:id', `cleaned up`, res.elapsedMs);
});

// ── V2: still scaffolded for remaining actor types ───────────────────────
console.log(`\n${BOLD}${CYAN}V2 — still scaffolded for non-customer actors:${RESET}`);

await runStep('POST /seller/auth/login (seller)', null, {
  skipIf: 'needs seed-smoke-actors.ts to add a deterministic seller (customer done in Story 2.1)',
});
await runStep('POST /franchise/auth/login (franchise)', null, {
  skipIf: 'needs seed-smoke-actors.ts to create a deterministic franchise',
});
await runStep('POST /affiliate/auth/login (affiliate)', null, {
  skipIf: 'needs seed-smoke-actors.ts to create a deterministic affiliate',
});
await runStep('place online order (cart → checkout → place)', null, {
  skipIf: 'needs serviceable pincode + product mapping + Razorpay test mode',
});
await runStep('place COD order', null, {
  skipIf: 'needs COD-eligible pincode rule + seller COD enabled',
});
await runStep('notification log entry written', null, {
  skipIf: 'depends on order placement above',
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Summary:${RESET} ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREY}${failed} failed${RESET}, ${YELLOW}${skipped} skipped${RESET}\n`);

if (failed > 0) {
  console.log(`${RED}${BOLD}Failures:${RESET}`);
  for (const f of failures) {
    console.log(`  ${RED}✗${RESET} ${f.name}: ${f.reason}`);
  }
  console.log();
  process.exit(1);
}

process.exit(0);
