/**
 * Phase 13 — first WORKING end-to-end integration test for the return
 * QC → liability ledger → refund instruction flow.
 *
 * Strategy:
 *   - Hit the already-running dev API via HTTP (assumes `pnpm dev`).
 *   - Use a separate Prisma client to seed fixtures + assert outcomes.
 *   - Each test seeds its own data (random suffixes) so multiple runs
 *     don't collide.
 *   - Cleanup runs in afterEach — rolls back what the test created so
 *     the dev DB stays tidy.
 *
 * Why hit the running API instead of building a Nest TestingModule:
 *   - The full ReturnsModule transitive closure pulls 20+ global
 *     modules (cron, outbox poller, redis, ...). A real harness
 *     means a multi-batch infra investment.
 *   - The running dev API already has those wired correctly. The
 *     only test-only concern is "this case ran end-to-end through
 *     the actual code path"; that's exactly what HTTP gives us.
 *
 * Skipped automatically if API_TEST_BASE_URL isn't reachable, so the
 * suite passes silently in CI environments that don't run the API.
 */
import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const API_BASE = process.env.API_TEST_BASE_URL ?? 'http://localhost:8000/api/v1';
const ADMIN_JWT_SECRET =
  process.env.JWT_ADMIN_SECRET ?? 'dev-admin-secret-change-in-production-min32chars';
const CUSTOMER_JWT_SECRET =
  process.env.JWT_CUSTOMER_SECRET ??
  'dev-customer-secret-change-in-production-32chars';

interface MintedToken {
  token: string;
  adminId: string;
  sessionId: string;
}

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health/live`);
    return res.ok;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[return-qc-flow E2E] API unreachable at ${API_BASE}/health/live: ${(err as Error).message}`,
    );
    return false;
  }
}

async function mintAdminToken(prisma: PrismaClient): Promise<MintedToken | null> {
  // Use the seeded super_admin.
  const admin = await prisma.admin.findFirst({
    where: { email: 'admin@sportsmart.com', status: 'ACTIVE' as any },
    select: { id: true, role: true, email: true },
  });
  if (!admin) return null;

  // Create a fresh session row so AdminAuthGuard's session lookup passes.
  const session = await prisma.adminSession.create({
    data: {
      adminId: admin.id,
      refreshToken: `test-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const token = jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      sessionId: session.id,
    },
    ADMIN_JWT_SECRET,
    { expiresIn: '1h' },
  );
  return { token, adminId: admin.id, sessionId: session.id };
}

interface CustomerToken {
  token: string;
  customerId: string;
  sessionId: string;
}

/**
 * Mint a JWT for an existing customer + session row. UserAuthGuard
 * checks: signature, sub matches Session.userId, role includes
 * 'CUSTOMER', session not revoked / not expired, user.status='ACTIVE'.
 */
async function mintCustomerToken(
  prisma: PrismaClient,
  customerId: string,
): Promise<CustomerToken> {
  const session = await prisma.session.create({
    data: {
      userId: customerId,
      refreshToken: `test-cust-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const token = jwt.sign(
    {
      sub: customerId,
      roles: ['CUSTOMER'],
      sessionId: session.id,
    },
    CUSTOMER_JWT_SECRET,
    { expiresIn: '1h' },
  );
  return { token, customerId, sessionId: session.id };
}

interface SeededOrderReadyForReturn {
  customerId: string;
  sellerId: string;
  productId: string;
  variantId: string;
  masterOrderId: string;
  subOrderId: string;
  orderItemId: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Seed everything up to (but NOT including) a Return. Used by the
 * createReturn-side tests where the API is the one creating the
 * return row. Mirrors seedReceivedReturn but stops before the Return
 * insert.
 */
async function seedDeliveredOrder(
  prisma: PrismaClient,
  opts: { unitPrice?: number; quantity?: number } = {},
): Promise<SeededOrderReadyForReturn> {
  const suffix = randomUUID().slice(0, 8);
  const unitPrice = opts.unitPrice ?? 500;
  const quantity = opts.quantity ?? 1;

  const customer = await prisma.user.create({
    data: {
      firstName: 'Test',
      lastName: `Customer-${suffix}`,
      email: `test-cust-${suffix}@example.test`,
      phone: `9${Math.floor(100_000_000 + Math.random() * 900_000_000)}`,
      passwordHash: '$2b$10$' + 'x'.repeat(53),
      status: 'ACTIVE' as any,
    },
  });
  const seller = await prisma.seller.create({
    data: {
      sellerName: `Test Seller ${suffix}`,
      sellerShopName: `Shop ${suffix}`,
      email: `test-seller-${suffix}@example.test`,
      phoneNumber: `8${Math.floor(100_000_000 + Math.random() * 900_000_000)}`,
      passwordHash: '$2b$10$' + 'x'.repeat(53),
      status: 'ACTIVE' as any,
    } as any,
  });
  const product = await prisma.product.create({
    data: {
      title: `Test Product ${suffix}`,
      slug: `test-product-${suffix}`,
      description: 'Test fixture product',
      productCode: `TST-${suffix}`,
      sellerId: seller.id,
      status: 'ACTIVE' as any,
    } as any,
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `SKU-${suffix}`,
      title: 'Default',
      price: unitPrice,
      stock: 100,
      status: 'ACTIVE' as any,
    } as any,
  });
  const masterOrder = await prisma.masterOrder.create({
    data: {
      orderNumber: `SM-TEST-${suffix.toUpperCase()}`,
      customerId: customer.id,
      shippingAddressSnapshot: {
        firstName: 'Test',
        lastName: 'Customer',
        address1: 'Test Address',
        city: 'Mumbai',
        state: 'MAHARASHTRA',
        pincode: '400001',
        phone: customer.phone,
      } as any,
      totalAmount: unitPrice * quantity,
      itemCount: quantity,
      paymentStatus: 'PAID' as any,
      paymentMethod: 'COD' as any,
      orderStatus: 'DELIVERED' as any,
    },
  });
  const deliveredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const returnWindowEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const subOrder = await prisma.subOrder.create({
    data: {
      masterOrderId: masterOrder.id,
      sellerId: seller.id,
      fulfillmentNodeType: 'SELLER',
      subTotal: unitPrice * quantity,
      paymentStatus: 'PAID' as any,
      fulfillmentStatus: 'DELIVERED' as any,
      acceptStatus: 'ACCEPTED' as any,
      deliveredAt,
      returnWindowEndsAt,
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: {
      subOrderId: subOrder.id,
      productId: product.id,
      variantId: variant.id,
      productTitle: product.title,
      sku: variant.sku,
      quantity,
      unitPrice,
      totalPrice: unitPrice * quantity,
    },
  });
  return {
    customerId: customer.id,
    sellerId: seller.id,
    productId: product.id,
    variantId: variant.id,
    masterOrderId: masterOrder.id,
    subOrderId: subOrder.id,
    orderItemId: orderItem.id,
    unitPrice,
    quantity,
  };
}

async function cleanupDeliveredOrder(
  prisma: PrismaClient,
  fixture: SeededOrderReadyForReturn,
  /** Set when the test caused a Return to be created via the API. */
  createdReturnId?: string,
): Promise<void> {
  if (createdReturnId) {
    await prisma.refundInstruction
      .deleteMany({
        where: { sourceType: 'RETURN' as any, sourceId: createdReturnId },
      })
      .catch(() => undefined);
    await prisma.sellerDebit
      .deleteMany({
        where: { sourceType: 'RETURN' as any, sourceId: createdReturnId },
      })
      .catch(() => undefined);
    await prisma.outboxEvent
      .deleteMany({ where: { aggregateId: createdReturnId } })
      .catch(() => undefined);
    await prisma.auditLog
      .deleteMany({ where: { resourceId: createdReturnId } })
      .catch(() => undefined);
    await prisma.return.delete({ where: { id: createdReturnId } }).catch(() => undefined);
  }
  await prisma.orderItem.delete({ where: { id: fixture.orderItemId } }).catch(() => undefined);
  await prisma.subOrder.delete({ where: { id: fixture.subOrderId } }).catch(() => undefined);
  await prisma.masterOrder.delete({ where: { id: fixture.masterOrderId } }).catch(() => undefined);
  await prisma.productVariant.delete({ where: { id: fixture.variantId } }).catch(() => undefined);
  await prisma.product.delete({ where: { id: fixture.productId } }).catch(() => undefined);
  await prisma.seller.delete({ where: { id: fixture.sellerId } }).catch(() => undefined);
  await prisma.session
    .deleteMany({ where: { userId: fixture.customerId } })
    .catch(() => undefined);
  await prisma.user.delete({ where: { id: fixture.customerId } }).catch(() => undefined);
}

/**
 * Add a second ProductVariant to an existing seeded fixture so an
 * EXCHANGE test can ship that variant as the target instead of the
 * original SKU. Returns the new variantId.
 */
async function seedSecondVariant(
  prisma: PrismaClient,
  productId: string,
  opts: { price: number; suffix?: string } = { price: 500 },
): Promise<{ variantId: string }> {
  const suffix = opts.suffix ?? randomUUID().slice(0, 6);
  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku: `SKU-ALT-${suffix}`,
      title: 'Alternate variant',
      price: opts.price,
      stock: 100,
      status: 'ACTIVE' as any,
    } as any,
  });
  return { variantId: variant.id };
}

interface SeededReturn {
  customerId: string;
  sellerId: string;
  productId: string;
  variantId: string;
  masterOrderId: string;
  subOrderId: string;
  orderItemId: string;
  returnId: string;
  returnItemId: string;
  unitPrice: number;
  quantity: number;
}

async function seedReceivedReturn(
  prisma: PrismaClient,
  opts: {
    unitPrice?: number;
    quantity?: number;
    reasonCategory?: string;
  } = {},
): Promise<SeededReturn> {
  const suffix = randomUUID().slice(0, 8);
  const unitPrice = opts.unitPrice ?? 500;
  const quantity = opts.quantity ?? 1;
  const reasonCategory = opts.reasonCategory ?? 'DEFECTIVE';

  // 1. Customer + admin bcrypt hash placeholder (doesn't need to be real).
  const customer = await prisma.user.create({
    data: {
      firstName: 'Test',
      lastName: `Customer-${suffix}`,
      email: `test-cust-${suffix}@example.test`,
      phone: `9${Math.floor(100_000_000 + Math.random() * 900_000_000)}`,
      passwordHash: '$2b$10$' + 'x'.repeat(53),
      status: 'ACTIVE' as any,
    },
  });

  // 2. Seller.
  const seller = await prisma.seller.create({
    data: {
      sellerName: `Test Seller ${suffix}`,
      sellerShopName: `Shop ${suffix}`,
      email: `test-seller-${suffix}@example.test`,
      phoneNumber: `8${Math.floor(100_000_000 + Math.random() * 900_000_000)}`,
      passwordHash: '$2b$10$' + 'x'.repeat(53),
      status: 'ACTIVE' as any,
    } as any,
  });

  // 3. Product + variant.
  const product = await prisma.product.create({
    data: {
      title: `Test Product ${suffix}`,
      slug: `test-product-${suffix}`,
      description: 'Test fixture product',
      productCode: `TST-${suffix}`,
      sellerId: seller.id,
      status: 'ACTIVE' as any,
    } as any,
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `SKU-${suffix}`,
      title: 'Default',
      price: unitPrice,
      stock: 100,
      status: 'ACTIVE' as any,
    } as any,
  });

  // 4. Master order + sub-order + order item.
  const orderNumber = `SM-TEST-${suffix.toUpperCase()}`;
  const masterOrder = await prisma.masterOrder.create({
    data: {
      orderNumber,
      customerId: customer.id,
      shippingAddressSnapshot: {
        firstName: 'Test',
        lastName: 'Customer',
        address1: 'Test Address',
        city: 'Mumbai',
        state: 'MAHARASHTRA',
        pincode: '400001',
        phone: customer.phone,
      } as any,
      totalAmount: unitPrice * quantity,
      itemCount: quantity,
      paymentStatus: 'PAID' as any,
      paymentMethod: 'COD' as any,
      orderStatus: 'DELIVERED' as any,
    },
  });

  const deliveredAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
  const subOrder = await prisma.subOrder.create({
    data: {
      masterOrderId: masterOrder.id,
      sellerId: seller.id,
      fulfillmentNodeType: 'SELLER',
      subTotal: unitPrice * quantity,
      paymentStatus: 'PAID' as any,
      fulfillmentStatus: 'DELIVERED' as any,
      acceptStatus: 'ACCEPTED' as any,
      deliveredAt,
    },
  });

  const orderItem = await prisma.orderItem.create({
    data: {
      subOrderId: subOrder.id,
      productId: product.id,
      variantId: variant.id,
      productTitle: product.title,
      sku: variant.sku,
      quantity,
      unitPrice,
      totalPrice: unitPrice * quantity,
    },
  });

  // 5. Return at status=RECEIVED so the next API call is QC submission.
  const yearPrefix = new Date().getFullYear();
  const sequenceNumber = String(Date.now()).slice(-6);
  const returnNumber = `RET-${yearPrefix}-${sequenceNumber}`;
  const ret = await prisma.return.create({
    data: {
      returnNumber,
      subOrderId: subOrder.id,
      masterOrderId: masterOrder.id,
      customerId: customer.id,
      status: 'RECEIVED' as any,
      initiatedBy: 'CUSTOMER',
      initiatorId: customer.id,
      receivedAt: new Date(),
      receivedBy: 'SYSTEM',
    },
  });
  const returnItem = await prisma.returnItem.create({
    data: {
      returnId: ret.id,
      orderItemId: orderItem.id,
      quantity,
      reasonCategory: reasonCategory as any,
    },
  });

  return {
    customerId: customer.id,
    sellerId: seller.id,
    productId: product.id,
    variantId: variant.id,
    masterOrderId: masterOrder.id,
    subOrderId: subOrder.id,
    orderItemId: orderItem.id,
    returnId: ret.id,
    returnItemId: returnItem.id,
    unitPrice,
    quantity,
  };
}

async function cleanup(
  prisma: PrismaClient,
  fixture: SeededReturn,
): Promise<void> {
  // Delete in FK order. Cascades on Return → ReturnItem / Status / Evidence.
  // Manually delete the rows the QC flow created (refund instruction,
  // ledger row, audit + outbox entries) so the dev DB doesn't accumulate.
  try {
    await prisma.refundInstruction.deleteMany({
      where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
    });
  } catch {/* best-effort */}
  try {
    await prisma.sellerDebit.deleteMany({
      where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
    });
    await prisma.platformExpense.deleteMany({
      where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
    });
    await prisma.logisticsClaim.deleteMany({
      where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
    });
    await prisma.adminTask.deleteMany({
      where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
    });
  } catch {/* best-effort */}
  try {
    await prisma.refundTransaction.deleteMany({
      where: { returnId: fixture.returnId },
    });
  } catch {/* best-effort */}
  try {
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: fixture.returnId },
    });
  } catch {/* best-effort */}
  try {
    await prisma.auditLog.deleteMany({
      where: { resourceId: fixture.returnId },
    });
  } catch {/* best-effort */}
  // Ledger / refund / outbox cleared above; now drop the order graph.
  // First, find any replacement orders the test created so we can
  // delete them with the original.
  const ret = await prisma.return.findUnique({
    where: { id: fixture.returnId },
    select: { replacementOrderId: true },
  }).catch(() => null);
  await prisma.return.delete({ where: { id: fixture.returnId } }).catch(() => undefined);
  // Delete replacement order graph if one was created (cascade drops
  // sub-orders + items via the FK relation).
  if (ret?.replacementOrderId) {
    await prisma.masterOrder
      .delete({ where: { id: ret.replacementOrderId } })
      .catch(() => undefined);
  }
  await prisma.orderItem.delete({ where: { id: fixture.orderItemId } }).catch(() => undefined);
  await prisma.subOrder.delete({ where: { id: fixture.subOrderId } }).catch(() => undefined);
  await prisma.masterOrder.delete({ where: { id: fixture.masterOrderId } }).catch(() => undefined);
  // Use deleteMany on productId to also catch any extra variants
  // seeded for EXCHANGE tests via seedSecondVariant.
  await prisma.productVariant
    .deleteMany({ where: { productId: fixture.productId } })
    .catch(() => undefined);
  await prisma.product.delete({ where: { id: fixture.productId } }).catch(() => undefined);
  await prisma.seller.delete({ where: { id: fixture.sellerId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: fixture.customerId } }).catch(() => undefined);
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Return QC → liability ledger → refund instruction (E2E)', () => {
  let prisma: PrismaClient;
  let auth: MintedToken | null = null;
  let apiUp = false;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set');
    }
    prisma = new PrismaClient();
    await prisma.$connect();
    apiUp = await reachable();
    if (apiUp) {
      auth = await mintAdminToken(prisma);
    }
  });

  afterAll(async () => {
    if (auth) {
      await prisma.adminSession
        .delete({ where: { id: auth.sessionId } })
        .catch(() => undefined);
    }
    if (prisma) await prisma.$disconnect();
  });

  // Helper — skips the test gracefully when the dev API isn't running.
  // CI without `pnpm dev` running would otherwise see noisy failures
  // for environment reasons rather than real regressions. We can't use
  // `it.skip` at definition time because `apiUp` is set in beforeAll
  // (which runs *after* describe-block evaluation). The runtime check
  // inside the test body avoids that race.
  function maybe(name: string, body: () => Promise<void>) {
    return it(name, async () => {
      if (!apiUp || !auth) {
        // eslint-disable-next-line no-console
        console.warn(
          `[skip] ${name} — API not reachable at ${API_BASE}, or super_admin not seeded`,
        );
        return;
      }
      await body();
    });
  }

  describe('Case 1 — QC_APPROVED + SELLER + FULL_REFUND', () => {
    maybe(
      'creates SellerDebit + RefundInstruction; flips return to QC_APPROVED',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                    qcNotes: 'Looks defective as claimed; approving full refund',
                  },
                ],
                overallNotes: 'integration test — full approval',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Defect confirmed; ship-in-condition seller fault',
              }),
            },
          );
          expect(res.status).toBe(200);

          // Return updated.
          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              status: true,
              liabilityParty: true,
              customerRemedy: true,
              refundAmount: true,
            },
          });
          // Status moves QC_APPROVED → REFUND_PROCESSING (auto-refund) →
          // possibly REFUNDED if the saga ran inline. Any of those is
          // a successful happy-path outcome; only `RECEIVED` (the start
          // state) or `QC_REJECTED` would be a regression.
          expect(['QC_APPROVED', 'REFUND_PROCESSING', 'REFUNDED']).toContain(
            updated?.status,
          );
          expect(updated?.liabilityParty).toBe('SELLER');
          expect(updated?.customerRemedy).toBe('FULL_REFUND');
          expect(Number(updated?.refundAmount)).toBeCloseTo(
            fixture.unitPrice * fixture.quantity,
          );

          // SellerDebit row exists with correct amount.
          const debit = await prisma.sellerDebit.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(debit).toBeTruthy();
          expect(debit?.sellerId).toBe(fixture.sellerId);
          expect(Number(debit?.amountInPaise)).toBe(
            fixture.unitPrice * fixture.quantity * 100,
          );

          // RefundInstruction created with sourceType=RETURN.
          const instruction = await prisma.refundInstruction.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(instruction).toBeTruthy();
          expect(Number(instruction?.amountInPaise)).toBe(
            fixture.unitPrice * fixture.quantity * 100,
          );
          // Status depends on the env-configured threshold:
          //   - REFUND_AUTO_APPROVE_THRESHOLD_PAISE high → SUCCESS / PROCESSING
          //   - threshold = 0 (current dev) → PENDING_APPROVAL
          // Either way, the row exists with the right shape.
          expect(['PENDING_APPROVAL', 'PROCESSING', 'SUCCESS']).toContain(
            instruction?.status,
          );

          // No PlatformExpense, no LogisticsClaim — SELLER liability uses
          // SellerDebit only (matrix invariant).
          const platformExpense = await prisma.platformExpense.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(platformExpense).toBeNull();
          const logisticsClaim = await prisma.logisticsClaim.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(logisticsClaim).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Case 2 — QC_REJECTED → no money flow', () => {
    maybe(
      'creates NO RefundInstruction, NO SellerDebit; return becomes QC_REJECTED',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'REJECTED',
                    qcQuantityApproved: 0,
                    qcNotes:
                      'No defect found; product matches description in original listing',
                  },
                ],
                overallNotes: 'integration test — full rejection',
                // liability/remedy not required for QC_REJECTED — the
                // service skips matrix validation when newStatus is
                // QC_REJECTED.
              }),
            },
          );
          expect(res.status).toBe(200);

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true, refundAmount: true },
          });
          expect(updated?.status).toBe('QC_REJECTED');

          // No money flow.
          const debit = await prisma.sellerDebit.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(debit).toBeNull();
          const instruction = await prisma.refundInstruction.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(instruction).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Case 3 — QC_APPROVED + PLATFORM + GOODWILL_CREDIT → PlatformExpense (GOODWILL)', () => {
    maybe(
      'creates a PlatformExpense with expenseType=GOODWILL; no SellerDebit',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'goodwill — customer experience recovery',
                liabilityParty: 'PLATFORM',
                customerRemedy: 'GOODWILL_CREDIT',
                qcRationale: 'Edge case; comping the customer to retain trust',
                acknowledgeHighRisk: true, // belt-and-braces in case scorer flags
              }),
            },
          );
          expect(res.status).toBe(200);

          // PlatformExpense row with expenseType=GOODWILL.
          const platformExpense = await prisma.platformExpense.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(platformExpense).toBeTruthy();
          expect(platformExpense?.expenseType).toBe('GOODWILL');
          expect(Number(platformExpense?.amountInPaise)).toBe(
            fixture.unitPrice * fixture.quantity * 100,
          );

          // No SellerDebit — goodwill is on the platform, never recovered.
          const debit = await prisma.sellerDebit.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(debit).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Matrix rejection — GOODWILL_CREDIT + SELLER liability is invalid', () => {
    maybe(
      'returns 400; no DB writes; return stays in RECEIVED',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'invalid — goodwill must be platform',
                liabilityParty: 'SELLER',
                customerRemedy: 'GOODWILL_CREDIT',
              }),
            },
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(JSON.stringify(body)).toMatch(/GOODWILL_CREDIT/);

          // Return is unchanged — still RECEIVED.
          const ret = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true, liabilityParty: true, customerRemedy: true },
          });
          expect(ret?.status).toBe('RECEIVED');
          expect(ret?.liabilityParty).toBeNull();
          expect(ret?.customerRemedy).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Case 2 — PARTIALLY_APPROVED + SELLER + PARTIAL_REFUND', () => {
    maybe(
      'creates SellerDebit + RefundInstruction sized to the partial amount only',
      async () => {
        // 2-quantity return; QC approves 1 of 2 → PARTIALLY_APPROVED.
        const fixture = await seedReceivedReturn(prisma, {
          unitPrice: 500,
          quantity: 2,
        });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'PARTIAL',
                    qcQuantityApproved: 1, // 1 of 2 accepted
                    qcNotes: 'One unit defective; the second was undamaged',
                  },
                ],
                overallNotes: 'integration test — partial approval',
                liabilityParty: 'SELLER',
                customerRemedy: 'PARTIAL_REFUND',
                qcRationale:
                  'Partial defect; refunding the bad unit, returning the good one to seller stock',
              }),
            },
          );
          expect(res.status).toBe(200);

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              status: true,
              liabilityParty: true,
              customerRemedy: true,
              refundAmount: true,
            },
          });
          expect([
            'PARTIALLY_APPROVED',
            'REFUND_PROCESSING',
            'REFUNDED',
          ]).toContain(updated?.status);
          expect(updated?.liabilityParty).toBe('SELLER');
          expect(updated?.customerRemedy).toBe('PARTIAL_REFUND');
          // Partial refund = 1 * unitPrice, NOT 2 * unitPrice.
          expect(Number(updated?.refundAmount)).toBeCloseTo(
            fixture.unitPrice * 1,
          );

          // SellerDebit is sized to the partial amount only.
          const debit = await prisma.sellerDebit.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(debit).toBeTruthy();
          expect(Number(debit?.amountInPaise)).toBe(fixture.unitPrice * 1 * 100);

          // RefundInstruction is sized to the partial amount.
          const instruction = await prisma.refundInstruction.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(instruction).toBeTruthy();
          expect(Number(instruction?.amountInPaise)).toBe(
            fixture.unitPrice * 1 * 100,
          );
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Case 3 — QC_APPROVED + LOGISTICS + FULL_REFUND', () => {
    maybe(
      'creates LogisticsClaim with courier metadata; no SellerDebit, no PlatformExpense',
      async () => {
        const fixture = await seedReceivedReturn(prisma, {
          unitPrice: 800,
          reasonCategory: 'DAMAGED_IN_TRANSIT',
        });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                    qcNotes: 'Box dented; product damaged in transit',
                  },
                ],
                overallNotes: 'integration test — courier fault',
                liabilityParty: 'LOGISTICS',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Damage consistent with courier handling, not seller defect',
                logistics: {
                  courierName: 'Bluedart',
                  awbNumber: 'AWB-TEST-12345',
                },
              }),
            },
          );
          expect(res.status).toBe(200);

          // LogisticsClaim row exists with courier metadata.
          const claim = await prisma.logisticsClaim.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(claim).toBeTruthy();
          expect(claim?.courierName).toBe('Bluedart');
          expect(claim?.awbNumber).toBe('AWB-TEST-12345');
          expect(Number(claim?.amountInPaise)).toBe(
            fixture.unitPrice * fixture.quantity * 100,
          );

          // No SellerDebit (courier eats the cost), no PlatformExpense.
          const debit = await prisma.sellerDebit.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(debit).toBeNull();
          const platformExpense = await prisma.platformExpense.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(platformExpense).toBeNull();

          // RefundInstruction still created — customer gets the refund;
          // recovery from courier is async via the LogisticsClaim row.
          const instruction = await prisma.refundInstruction.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(instruction).toBeTruthy();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Matrix rejection — PARTIALLY_APPROVED + FULL_REFUND is invalid', () => {
    maybe(
      'returns 400 when QC outcome is partial but remedy says full',
      async () => {
        const fixture = await seedReceivedReturn(prisma, {
          unitPrice: 500,
          quantity: 2,
        });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'PARTIAL',
                    qcQuantityApproved: 1,
                  },
                ],
                overallNotes: 'invalid combo',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND', // ← invalid for partial QC
              }),
            },
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(JSON.stringify(body)).toMatch(/FULL_REFUND/);

          const ret = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true, liabilityParty: true, customerRemedy: true },
          });
          expect(ret?.status).toBe('RECEIVED');
          expect(ret?.liabilityParty).toBeNull();
          expect(ret?.customerRemedy).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Matrix rejection — QC_APPROVED + PARTIAL_REFUND is invalid', () => {
    maybe(
      'returns 400 when QC fully approves but remedy says partial',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'invalid combo',
                liabilityParty: 'SELLER',
                customerRemedy: 'PARTIAL_REFUND', // ← invalid for full QC
              }),
            },
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(JSON.stringify(body)).toMatch(/PARTIAL_REFUND/);

          const ret = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true },
          });
          expect(ret?.status).toBe('RECEIVED');
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  // ─── Reason-based evidence — POST /customer/returns ────────────────────

  describe('Evidence — DEFECTIVE/WRONG_ITEM/etc. require ≥1 photo', () => {
    maybe(
      'WRONG_ITEM with empty evidence array is rejected at the service layer',
      async () => {
        const fixture = await seedDeliveredOrder(prisma, { unitPrice: 500 });
        const customerAuth = await mintCustomerToken(prisma, fixture.customerId);
        let createdReturnId: string | undefined;
        try {
          const res = await fetch(`${API_BASE}/customer/returns`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${customerAuth.token}`,
            },
            body: JSON.stringify({
              subOrderId: fixture.subOrderId,
              items: [
                {
                  orderItemId: fixture.orderItemId,
                  quantity: fixture.quantity,
                  reasonCategory: 'WRONG_ITEM',
                },
              ],
              forfeitConsent: true,
              evidenceFileUrls: [], // ← empty; should be rejected
              customerNotes: 'Wrong item received',
            }),
          });
          expect(res.status).toBe(400);
          const body = await res.json();
          // Service-level message references photo requirement.
          expect(JSON.stringify(body)).toMatch(/photo|evidence/i);

          // No Return row was created.
          const returns = await prisma.return.findMany({
            where: { customerId: fixture.customerId },
          });
          expect(returns).toHaveLength(0);
        } finally {
          await cleanupDeliveredOrder(prisma, fixture, createdReturnId);
        }
      },
    );
  });

  describe('Evidence — CHANGED_MIND accepts zero photos', () => {
    maybe(
      'CHANGED_MIND with empty evidence array creates the return',
      async () => {
        const fixture = await seedDeliveredOrder(prisma, { unitPrice: 500 });
        const customerAuth = await mintCustomerToken(prisma, fixture.customerId);
        let createdReturnId: string | undefined;
        try {
          const res = await fetch(`${API_BASE}/customer/returns`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${customerAuth.token}`,
            },
            body: JSON.stringify({
              subOrderId: fixture.subOrderId,
              items: [
                {
                  orderItemId: fixture.orderItemId,
                  quantity: fixture.quantity,
                  reasonCategory: 'CHANGED_MIND',
                },
              ],
              forfeitConsent: true,
              evidenceFileUrls: [],
              customerNotes: 'Changed my mind, want to return',
            }),
          });
          // 200 (created) or 201 — both are success shapes; some
          // controllers default to 201, others to 200.
          expect([200, 201]).toContain(res.status);
          const body = await res.json();
          const returnId = body?.data?.id ?? body?.id;
          expect(returnId).toBeTruthy();
          createdReturnId = returnId;

          // Return exists (created by API), with our customer.
          const ret = await prisma.return.findUnique({
            where: { id: returnId },
            select: { customerId: true, status: true },
          });
          expect(ret?.customerId).toBe(fixture.customerId);
          // Status will likely be APPROVED (auto-approval for low-value
          // CHANGED_MIND returns may or may not fire depending on the
          // configured ruleset). REQUESTED is the other valid outcome.
          expect(['REQUESTED', 'APPROVED']).toContain(ret?.status);

          // No ReturnEvidence row created (we didn't upload any).
          const evidence = await prisma.returnEvidence.findMany({
            where: { returnId },
          });
          expect(evidence).toHaveLength(0);
        } finally {
          await cleanupDeliveredOrder(prisma, fixture, createdReturnId);
        }
      },
    );
  });

  // ─── Wallet + ledger idempotency at the boundary ───────────────────────

  // ─── Replacement / exchange (P1.14) ───────────────────────────────────

  describe('Replacement — REPLACEMENT remedy creates a ₹0 order at the same SKU when stock is available', () => {
    maybe(
      'creates replacement MasterOrder, decrements variant stock, flips return to AWAITING_FULFILMENT',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          // Stock starts at 100 from seedDeliveredOrder/seedReceivedReturn.
          const beforeStock = (
            await prisma.productVariant.findUnique({
              where: { id: fixture.variantId },
              select: { stock: true },
            })
          )?.stock;
          expect(beforeStock).toBe(100);

          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'replacement test — same SKU',
                liabilityParty: 'SELLER',
                customerRemedy: 'REPLACEMENT',
                qcRationale: 'Defective; ship customer the same product fresh',
                acknowledgeHighRisk: true,
              }),
            },
          );
          expect(res.status).toBe(200);

          // The replacement-order pipeline runs async via .catch — give
          // it a beat to settle. 200ms is generous; the actual TX
          // typically commits in <50ms locally.
          await new Promise((r) => setTimeout(r, 250));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              status: true,
              customerRemedy: true,
              replacementStatus: true,
              replacementOrderId: true,
            },
          });
          expect(updated?.customerRemedy).toBe('REPLACEMENT');
          expect(updated?.replacementStatus).toBe('AWAITING_FULFILMENT');
          expect(updated?.replacementOrderId).toBeTruthy();

          // Replacement MasterOrder exists at ₹0.
          const repl = await prisma.masterOrder.findUnique({
            where: { id: updated!.replacementOrderId! },
            include: { subOrders: { include: { items: true } } },
          });
          expect(repl).toBeTruthy();
          expect(Number(repl!.totalAmount)).toBe(0);
          expect(repl!.orderNumber).toMatch(/-R$/);
          expect(repl!.subOrders).toHaveLength(1);
          expect(repl!.subOrders[0].items).toHaveLength(1);
          expect(Number(repl!.subOrders[0].items[0].unitPrice)).toBe(0);
          expect(repl!.subOrders[0].items[0].variantId).toBe(fixture.variantId);
          expect(repl!.subOrders[0].items[0].quantity).toBe(fixture.quantity);

          // Stock decremented by quantity.
          const afterStock = (
            await prisma.productVariant.findUnique({
              where: { id: fixture.variantId },
              select: { stock: true },
            })
          )?.stock;
          expect(afterStock).toBe(100 - fixture.quantity);

          // No SellerDebit / RefundInstruction — money doesn't move
          // for a same-SKU replacement.
          const debit = await prisma.sellerDebit.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(debit).toBeNull();
          const instruction = await prisma.refundInstruction.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(instruction).toBeNull();
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Replacement — out of stock falls back to refund', () => {
    maybe(
      'flips replacementStatus to FALLBACK_TO_REFUND when target variant has no stock',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          // Drain the variant's stock so REPLACEMENT can't ship.
          await prisma.productVariant.update({
            where: { id: fixture.variantId },
            data: { stock: 0 },
          });

          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'stock-out fallback test',
                liabilityParty: 'SELLER',
                customerRemedy: 'REPLACEMENT',
                qcRationale: 'Wants replacement but stock is gone',
                acknowledgeHighRisk: true,
              }),
            },
          );
          expect(res.status).toBe(200);

          await new Promise((r) => setTimeout(r, 250));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              replacementStatus: true,
              replacementOrderId: true,
            },
          });
          expect(updated?.replacementStatus).toBe('FALLBACK_TO_REFUND');
          expect(updated?.replacementOrderId).toBeNull();

          // No replacement MasterOrder created; no stock decrement
          // (it stayed at 0).
          const stock = (
            await prisma.productVariant.findUnique({
              where: { id: fixture.variantId },
              select: { stock: true },
            })
          )?.stock;
          expect(stock).toBe(0);

          // AdminTask enqueued so ops can decide refund vs. wait-for-restock.
          const tasks = await prisma.adminTask.findMany({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(tasks.length).toBeGreaterThan(0);
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Exchange — EXACT_MATCH (different SKU, same price, in stock)', () => {
    maybe(
      'creates ₹0 replacement order with the exchange target variant; no partial refund',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Add a second variant on the same product, same price.
        const { variantId: targetVariantId } = await seedSecondVariant(
          prisma,
          fixture.productId,
          { price: 500 },
        );
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'exchange same-price test',
                liabilityParty: 'SELLER',
                customerRemedy: 'EXCHANGE',
                qcRationale: 'Customer wants different colour; same price',
                acknowledgeHighRisk: true,
                exchangeTargetVariantId: targetVariantId,
              }),
            },
          );
          expect(res.status).toBe(200);
          await new Promise((r) => setTimeout(r, 250));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              customerRemedy: true,
              exchangeTargetVariantId: true,
              replacementStatus: true,
              replacementOrderId: true,
            },
          });
          expect(updated?.customerRemedy).toBe('EXCHANGE');
          expect(updated?.exchangeTargetVariantId).toBe(targetVariantId);
          expect(updated?.replacementStatus).toBe('AWAITING_FULFILMENT');
          expect(updated?.replacementOrderId).toBeTruthy();

          // Replacement order shipped at ₹0 with the *target* variant.
          const repl = await prisma.masterOrder.findUnique({
            where: { id: updated!.replacementOrderId! },
            include: { subOrders: { include: { items: true } } },
          });
          expect(Number(repl!.totalAmount)).toBe(0);
          expect(repl!.subOrders[0].items[0].variantId).toBe(targetVariantId);

          // No exchange-diff RefundInstruction (prices match).
          const diffRefund = await prisma.refundInstruction.findUnique({
            where: { idempotencyKey: `return:${fixture.returnId}:exchange-diff` },
          });
          expect(diffRefund).toBeNull();

          // Target variant stock decremented (was 100).
          const targetStock = (
            await prisma.productVariant.findUnique({
              where: { id: targetVariantId },
              select: { stock: true },
            })
          )?.stock;
          expect(targetStock).toBe(100 - fixture.quantity);
        } finally {
          // Drop any partial-refund row created with the exchange-diff
          // idempotency key (unlikely on this happy path but cheap).
          await prisma.refundInstruction
            .delete({
              where: {
                idempotencyKey: `return:${fixture.returnId}:exchange-diff`,
              },
            })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Exchange — COLLECT_FROM_CUSTOMER (different SKU, pricier, in stock)', () => {
    maybe(
      'flips replacement to AWAITING_PAYMENT with diff stamped; no order yet',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Pricier alternate variant — ₹750. Diff = ₹250 = 25_000 paise.
        const { variantId: targetVariantId } = await seedSecondVariant(
          prisma,
          fixture.productId,
          { price: 750 },
        );
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'exchange pricier-target test',
                liabilityParty: 'SELLER',
                customerRemedy: 'EXCHANGE',
                qcRationale:
                  'Customer wants the premium variant; needs to pay the difference',
                acknowledgeHighRisk: true,
                exchangeTargetVariantId: targetVariantId,
              }),
            },
          );
          expect(res.status).toBe(200);
          await new Promise((r) => setTimeout(r, 250));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              replacementStatus: true,
              replacementOrderId: true,
              exchangePriceDiffPaise: true,
            },
          });
          expect(updated?.replacementStatus).toBe('AWAITING_PAYMENT');
          // No order created yet — order creation waits for payment.
          expect(updated?.replacementOrderId).toBeNull();
          // Diff captured for the payment-collection UI.
          expect(Number(updated?.exchangePriceDiffPaise)).toBe(25_000);

          // No partial RefundInstruction (customer pays us, not the
          // other way around).
          const diffRefund = await prisma.refundInstruction.findUnique({
            where: { idempotencyKey: `return:${fixture.returnId}:exchange-diff` },
          });
          expect(diffRefund).toBeNull();

          // AdminTask enqueued so finance/ops can shepherd the
          // payment-collection step until the Razorpay flow lands.
          const tasks = await prisma.adminTask.findMany({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(tasks.length).toBeGreaterThan(0);
          // Stock NOT yet decremented (no order created).
          const targetStock = (
            await prisma.productVariant.findUnique({
              where: { id: targetVariantId },
              select: { stock: true },
            })
          )?.stock;
          expect(targetStock).toBe(100);
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Exchange — out of stock falls back to refund', () => {
    maybe(
      'flips replacementStatus to FALLBACK_TO_REFUND when target variant has no stock',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        const { variantId: targetVariantId } = await seedSecondVariant(
          prisma,
          fixture.productId,
          { price: 500 },
        );
        // Drain target stock.
        await prisma.productVariant.update({
          where: { id: targetVariantId },
          data: { stock: 0 },
        });
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'exchange stock-out fallback',
                liabilityParty: 'SELLER',
                customerRemedy: 'EXCHANGE',
                qcRationale: 'Target variant out of stock',
                acknowledgeHighRisk: true,
                exchangeTargetVariantId: targetVariantId,
              }),
            },
          );
          expect(res.status).toBe(200);
          await new Promise((r) => setTimeout(r, 250));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              replacementStatus: true,
              replacementOrderId: true,
            },
          });
          expect(updated?.replacementStatus).toBe('FALLBACK_TO_REFUND');
          expect(updated?.replacementOrderId).toBeNull();

          // No partial RefundInstruction; original-flow refund path
          // is not auto-triggered here either (admin decides via
          // AdminTask).
          const diffRefund = await prisma.refundInstruction.findUnique({
            where: { idempotencyKey: `return:${fixture.returnId}:exchange-diff` },
          });
          expect(diffRefund).toBeNull();

          const tasks = await prisma.adminTask.findMany({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(tasks.length).toBeGreaterThan(0);
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Exchange — REFUND_TO_CUSTOMER (different SKU, cheaper, in stock)', () => {
    maybe(
      'creates ₹0 replacement order AND a partial RefundInstruction sized to the diff',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Cheaper alternate variant — ₹300. Diff = ₹200.
        const { variantId: targetVariantId } = await seedSecondVariant(
          prisma,
          fixture.productId,
          { price: 300 },
        );
        try {
          const res = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'exchange cheaper-target test',
                liabilityParty: 'SELLER',
                customerRemedy: 'EXCHANGE',
                qcRationale: 'Customer wants cheaper variant; partial refund the diff',
                acknowledgeHighRisk: true,
                exchangeTargetVariantId: targetVariantId,
              }),
            },
          );
          expect(res.status).toBe(200);
          await new Promise((r) => setTimeout(r, 300));

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              replacementStatus: true,
              replacementOrderId: true,
            },
          });
          expect(updated?.replacementStatus).toBe('AWAITING_FULFILMENT');
          expect(updated?.replacementOrderId).toBeTruthy();

          // Partial RefundInstruction exists with the correct diff
          // (₹500 - ₹300 = ₹200 = 20000 paise) and the dedicated
          // exchange-diff idempotency key.
          const diffRefund = await prisma.refundInstruction.findUnique({
            where: {
              idempotencyKey: `return:${fixture.returnId}:exchange-diff`,
            },
          });
          expect(diffRefund).toBeTruthy();
          expect(Number(diffRefund?.amountInPaise)).toBe(20000);
          expect(diffRefund?.sourceType).toBe('RETURN');
          expect(diffRefund?.sourceId).toBe(fixture.returnId);

          // No SellerDebit / no main-flow RefundInstruction (the
          // EXCHANGE remedy doesn't write the seller-side ledger).
          const debit = await prisma.sellerDebit.findFirst({
            where: { sourceType: 'RETURN' as any, sourceId: fixture.returnId },
          });
          expect(debit).toBeNull();
          const mainRefund = await prisma.refundInstruction.findUnique({
            where: { idempotencyKey: `return:${fixture.returnId}` },
          });
          expect(mainRefund).toBeNull();
        } finally {
          await prisma.refundInstruction
            .delete({
              where: {
                idempotencyKey: `return:${fixture.returnId}:exchange-diff`,
              },
            })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  // ─── Safety gates (P1.8 + P1.11) ──────────────────────────────────────

  describe('Seller-response gate — SELLER liability while response is PENDING', () => {
    maybe(
      'returns 400 by default; succeeds with overrideSellerResponseWindow=true',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Open the seller's response window — emulates a return whose
        // reasonCategory triggered the seller-response classifier in
        // createReturn (DEFECTIVE / WRONG_ITEM / etc.).
        await prisma.return.update({
          where: { id: fixture.returnId },
          data: {
            sellerResponseStatus: 'PENDING' as any,
            sellerNotifiedAt: new Date(),
            sellerResponseDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });
        try {
          // 1. Without the override → 400.
          const denied = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'gate test',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'fast-tracked QC; should be blocked',
              }),
            },
          );
          expect(denied.status).toBe(400);
          const deniedBody = await denied.json();
          expect(JSON.stringify(deniedBody)).toMatch(
            /SELLER liability while the seller's response is still PENDING/,
          );
          // Return is unchanged.
          const stillReceived = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true, liabilityParty: true },
          });
          expect(stillReceived?.status).toBe('RECEIVED');
          expect(stillReceived?.liabilityParty).toBeNull();

          // 2. With override → succeeds; audit log records the bypass.
          const allowed = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'gate test — deliberate override',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Seller is unreachable; closing case',
                overrideSellerResponseWindow: true,
              }),
            },
          );
          expect(allowed.status).toBe(200);

          // QC ran; audit log captures the override flag.
          const audits = await prisma.auditLog.findMany({
            where: {
              resourceId: fixture.returnId,
              action: 'return.qc_decided',
            },
          });
          expect(audits.length).toBeGreaterThan(0);
          const newValue = audits[0].newValue as any;
          expect(newValue.overrodeSellerResponseWindow).toBe(true);
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('High-risk acknowledgement gate — refund without ack is blocked', () => {
    maybe(
      'returns 400 when riskScore≥60 + cash refund + no ack; succeeds with acknowledgeHighRisk=true',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Force HIGH risk: simulate that the intake scorer flagged
        // this return at 75 with one of our risk flags. (Real
        // scoring runs at createReturn time; we patch directly to
        // isolate the gate behaviour.)
        await prisma.return.update({
          where: { id: fixture.returnId },
          data: {
            riskScore: 75,
            riskFlags: ['CUSTOMER_ABUSE'] as any,
            riskScoredAt: new Date(),
          },
        });
        try {
          // 1. Without ack → 400 mentioning the risk score + flags.
          const denied = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'high-risk gate test',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Approving without acknowledging risk',
              }),
            },
          );
          expect(denied.status).toBe(400);
          const deniedBody = await denied.json();
          expect(JSON.stringify(deniedBody)).toMatch(/HIGH/);
          expect(JSON.stringify(deniedBody)).toMatch(/CUSTOMER_ABUSE/);

          const stillReceived = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { status: true },
          });
          expect(stillReceived?.status).toBe('RECEIVED');

          // 2. With ack → succeeds; audit log captures both the risk
          //    score at decision time AND the explicit ack flag.
          const allowed = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'high-risk gate test — explicit ack',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Reviewed flags; approving with explicit ack',
                acknowledgeHighRisk: true,
              }),
            },
          );
          expect(allowed.status).toBe(200);

          const audits = await prisma.auditLog.findMany({
            where: {
              resourceId: fixture.returnId,
              action: 'return.qc_decided',
            },
          });
          expect(audits.length).toBeGreaterThan(0);
          const newValue = audits[0].newValue as any;
          expect(newValue.acknowledgedHighRisk).toBe(true);
          expect(newValue.riskScoreAtDecision).toBe(75);
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  // ─── Seller respond endpoint (P1.8) ───────────────────────────────────

  describe('Seller respond endpoint — ACCEPTED / CONTESTED', () => {
    maybe(
      'PATCH /seller/returns/:id/respond flips PENDING→ACCEPTED and audit-logs',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        await prisma.return.update({
          where: { id: fixture.returnId },
          data: {
            sellerResponseStatus: 'PENDING' as any,
            sellerNotifiedAt: new Date(),
            sellerResponseDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });

        // Mint a seller JWT for the seller on this fixture's sub-order.
        const sellerSession = await prisma.sellerSession.create({
          data: {
            sellerId: fixture.sellerId,
            refreshToken: `test-seller-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        const sellerToken = jwt.sign(
          {
            sub: fixture.sellerId,
            roles: ['SELLER'],
            sessionId: sellerSession.id,
          },
          process.env.JWT_SELLER_SECRET ??
            'dev-seller-secret-change-in-production-min32ch',
          { expiresIn: '1h' },
        );

        try {
          const res = await fetch(
            `${API_BASE}/seller/returns/${fixture.returnId}/respond`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sellerToken}`,
              },
              body: JSON.stringify({
                decision: 'ACCEPTED',
                notes: 'Confirmed defect; will refund the customer',
              }),
            },
          );
          expect(res.status).toBe(200);

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              sellerResponseStatus: true,
              sellerRespondedAt: true,
              sellerResponseNotes: true,
            },
          });
          expect(updated?.sellerResponseStatus).toBe('ACCEPTED');
          expect(updated?.sellerRespondedAt).toBeTruthy();
          expect(updated?.sellerResponseNotes).toBe(
            'Confirmed defect; will refund the customer',
          );

          // Audit log captures the response.
          const audits = await prisma.auditLog.findMany({
            where: {
              resourceId: fixture.returnId,
              action: 'return.seller_responded',
            },
          });
          expect(audits.length).toBe(1);
          expect((audits[0].newValue as any).sellerResponseStatus).toBe(
            'ACCEPTED',
          );
        } finally {
          await prisma.sellerSession
            .delete({ where: { id: sellerSession.id } })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );

    maybe(
      'CONTESTED without notes is rejected at the controller; rich CONTESTED+evidence is recorded',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        await prisma.return.update({
          where: { id: fixture.returnId },
          data: {
            sellerResponseStatus: 'PENDING' as any,
            sellerNotifiedAt: new Date(),
            sellerResponseDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });

        const sellerSession = await prisma.sellerSession.create({
          data: {
            sellerId: fixture.sellerId,
            refreshToken: `test-seller-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        const sellerToken = jwt.sign(
          {
            sub: fixture.sellerId,
            roles: ['SELLER'],
            sessionId: sellerSession.id,
          },
          process.env.JWT_SELLER_SECRET ??
            'dev-seller-secret-change-in-production-min32ch',
          { expiresIn: '1h' },
        );

        try {
          // 1. CONTESTED without notes → 400.
          const noNotes = await fetch(
            `${API_BASE}/seller/returns/${fixture.returnId}/respond`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sellerToken}`,
              },
              body: JSON.stringify({ decision: 'CONTESTED' }),
            },
          );
          expect(noNotes.status).toBe(400);

          // 2. CONTESTED with notes + evidence URL → 200.
          const ok = await fetch(
            `${API_BASE}/seller/returns/${fixture.returnId}/respond`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sellerToken}`,
              },
              body: JSON.stringify({
                decision: 'CONTESTED',
                notes:
                  'Item shipped intact; photo from packing line attached',
                evidenceFileUrls: [
                  'https://test.example/proof.jpg',
                ],
              }),
            },
          );
          expect(ok.status).toBe(200);

          const updated = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: { sellerResponseStatus: true },
          });
          expect(updated?.sellerResponseStatus).toBe('CONTESTED');

          // Evidence row was attached as SELLER-uploaded.
          const evidence = await prisma.returnEvidence.findMany({
            where: {
              returnId: fixture.returnId,
              uploadedBy: 'SELLER',
            },
          });
          expect(evidence.length).toBe(1);
          expect(evidence[0].fileUrl).toBe('https://test.example/proof.jpg');
        } finally {
          await prisma.sellerSession
            .delete({ where: { id: sellerSession.id } })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  // ─── Exchange Razorpay payment endpoints ──────────────────────────────

  describe('Exchange payment — verify endpoint guards', () => {
    maybe(
      'rejects mismatched razorpayOrderId with 400 (does NOT mutate state)',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Seed the return into AWAITING_PAYMENT with a known
        // razorpayOrderId so we can assert the controller checks it
        // against the payload.
        await prisma.return.update({
          where: { id: fixture.returnId },
          data: {
            replacementStatus: 'AWAITING_PAYMENT' as any,
            exchangePriceDiffPaise: BigInt(25_000),
            exchangeRazorpayOrderId: 'order_known_real',
          },
        });

        // Mint a customer JWT for the fixture's customer.
        const customerAuth = await mintCustomerToken(prisma, fixture.customerId);

        try {
          const res = await fetch(
            `${API_BASE}/customer/returns/${fixture.returnId}/exchange-payment-verify`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${customerAuth.token}`,
              },
              body: JSON.stringify({
                razorpayOrderId: 'order_DIFFERENT', // ← mismatch
                razorpayPaymentId: 'pay_test',
                razorpaySignature: 'a'.repeat(64),
              }),
            },
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(JSON.stringify(body)).toMatch(
            /Razorpay orderId does not match/,
          );

          // State unchanged.
          const ret = await prisma.return.findUnique({
            where: { id: fixture.returnId },
            select: {
              replacementStatus: true,
              exchangePaymentCompletedAt: true,
            },
          });
          expect(ret?.replacementStatus).toBe('AWAITING_PAYMENT');
          expect(ret?.exchangePaymentCompletedAt).toBeNull();
        } finally {
          await prisma.session
            .deleteMany({ where: { userId: fixture.customerId } })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );

    maybe(
      'rejects when return is not in AWAITING_PAYMENT (state guard)',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        // Leave replacementStatus null (default for non-replacement returns).
        const customerAuth = await mintCustomerToken(prisma, fixture.customerId);
        try {
          const res = await fetch(
            `${API_BASE}/customer/returns/${fixture.returnId}/exchange-payment-verify`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${customerAuth.token}`,
              },
              body: JSON.stringify({
                razorpayOrderId: 'order_x',
                razorpayPaymentId: 'pay_x',
                razorpaySignature: 'a'.repeat(64),
              }),
            },
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(JSON.stringify(body)).toMatch(/not awaiting payment/);
        } finally {
          await prisma.session
            .deleteMany({ where: { userId: fixture.customerId } })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );

    maybe(
      'init endpoint rejects when return is not in AWAITING_PAYMENT',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        const customerAuth = await mintCustomerToken(prisma, fixture.customerId);
        try {
          const res = await fetch(
            `${API_BASE}/customer/returns/${fixture.returnId}/exchange-payment-init`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${customerAuth.token}`,
              },
            },
          );
          expect(res.status).toBe(400);
        } finally {
          await prisma.session
            .deleteMany({ where: { userId: fixture.customerId } })
            .catch(() => undefined);
          await cleanup(prisma, fixture);
        }
      },
    );
  });

  describe('Wallet + ledger idempotency — approve same RefundInstruction twice', () => {
    maybe(
      'second approve is a no-op; one wallet credit, one SellerDebit, one RefundInstruction',
      async () => {
        const fixture = await seedReceivedReturn(prisma, { unitPrice: 500 });
        try {
          // 1. Submit QC → RefundInstruction lands in PENDING_APPROVAL
          //    (env has REFUND_AUTO_APPROVE_THRESHOLD_PAISE=0 in dev,
          //    so any refund queues for finance).
          const qcRes = await fetch(
            `${API_BASE}/admin/returns/${fixture.returnId}/qc-decision`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
              body: JSON.stringify({
                decisions: [
                  {
                    returnItemId: fixture.returnItemId,
                    qcOutcome: 'APPROVED',
                    qcQuantityApproved: fixture.quantity,
                  },
                ],
                overallNotes: 'idempotency test',
                liabilityParty: 'SELLER',
                customerRemedy: 'FULL_REFUND',
                qcRationale: 'Clear seller-side defect',
              }),
            },
          );
          expect(qcRes.status).toBe(200);

          const instruction = await prisma.refundInstruction.findFirst({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(instruction).toBeTruthy();
          // We expect PENDING_APPROVAL given the dev threshold; if a
          // future env change auto-approves, the test still passes
          // because the second approval would still be a no-op.
          // ("already SUCCESS → return as-is" early return.)

          // 2. Approve via the finance endpoint.
          const approve1 = await fetch(
            `${API_BASE}/admin/refund-instructions/${instruction!.id}/approve`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
            },
          );
          expect(approve1.status).toBe(200);

          // 3. Approve AGAIN — should be a no-op (idempotent on
          //    already-SUCCESS). Either 200 (no-op return) or 400
          //    (state guard rejects) is acceptable; what matters is
          //    that the wallet/ledger state doesn't double up.
          const approve2 = await fetch(
            `${API_BASE}/admin/refund-instructions/${instruction!.id}/approve`,
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth!.token}`,
              },
            },
          );
          expect([200, 400]).toContain(approve2.status);

          // 4. Assert exactly ONE wallet transaction for this
          //    instruction's reference (UNIQUE on referenceType +
          //    referenceId + type prevents duplicate credit).
          const walletTxns = await prisma.walletTransaction.findMany({
            where: {
              userId: fixture.customerId,
              referenceType: 'refund',
              referenceId: instruction!.id,
              type: 'REFUND' as any,
            },
          });
          expect(walletTxns).toHaveLength(1);

          // 5. Exactly one SellerDebit row (UNIQUE on sourceType +
          //    sourceId per the Phase-12 ledger schema).
          const debits = await prisma.sellerDebit.findMany({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(debits).toHaveLength(1);

          // 6. Exactly one RefundInstruction row (idempotencyKey =
          //    'return:<id>' UNIQUE).
          const allInstructions = await prisma.refundInstruction.findMany({
            where: {
              sourceType: 'RETURN' as any,
              sourceId: fixture.returnId,
            },
          });
          expect(allInstructions).toHaveLength(1);
          expect(allInstructions[0].status).toBe('SUCCESS');
        } finally {
          await cleanup(prisma, fixture);
        }
      },
    );
  });
});
