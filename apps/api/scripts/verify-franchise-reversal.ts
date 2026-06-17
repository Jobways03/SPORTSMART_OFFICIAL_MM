/**
 * End-to-end money verification for the franchise reversal flow.
 *
 * Boots a real Nest application context (real DI, real services), builds a
 * minimal delivered-franchise-order fixture, then exercises the ACTUAL
 * FranchiseReversalService.request() + approve() and asserts the money +
 * inventory effects:
 *   - FranchiseStock.onHandQty incremented by the reversed qty
 *   - OrderItem.reversedQuantity incremented
 *   - a RETURN_REVERSAL FranchiseFinanceLedger entry created (negative earning)
 *   - the original ONLINE_ORDER ledger entry flipped to REVERSED
 *   - approve() is idempotent (a second approve is rejected by the CAS gate)
 *
 * Run: pnpm --filter @sportsmart/api exec ts-node -P tsconfig.json scripts/verify-franchise-reversal.ts
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/bootstrap/database/prisma.service';
import { FranchiseReversalService } from '../src/modules/returns/application/services/franchise-reversal.service';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = '') =>
  results.push({ name, pass, detail });

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const svc = app.get(FranchiseReversalService);

  // ---- Resolve anchors (existing franchise + user; product id need not exist) ----
  const franchise = await prisma.franchisePartner.findFirst({ select: { id: true } });
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!franchise || !user) throw new Error('Need at least one franchise + one user in the DB');
  const franchiseId = franchise.id;

  const productId = randomUUID();
  const variantId = randomUUID();
  const masterOrderId = randomUUID();
  const subOrderId = randomUUID();
  const orderItemId = randomUUID();
  const onlineLedgerId = randomUUID();
  const tag = `VERIFY-${Date.now()}`;

  const UNIT_PRICE = 500; // ₹
  const UNIT_PRICE_PAISE = 50000n;
  const QTY = 2;
  const REVERSE_QTY = 2;
  const START_ON_HAND = 10;

  try {
    // ---- Build fixture ----
    await prisma.masterOrder.create({
      data: {
        id: masterOrderId,
        orderNumber: tag,
        customerId: user.id,
        shippingAddressSnapshot: {},
        totalAmount: UNIT_PRICE * QTY,
        itemCount: 1,
      } as any,
    });
    await prisma.subOrder.create({
      data: {
        id: subOrderId,
        masterOrderId,
        subTotal: UNIT_PRICE * QTY,
        fulfillmentNodeType: 'FRANCHISE',
        franchiseId,
        fulfillmentStatus: 'DELIVERED',
        returnWindowEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        items: {
          create: [
            {
              id: orderItemId,
              productId,
              productTitle: 'Verify Product',
              variantId,
              unitPrice: UNIT_PRICE,
              unitPriceInPaise: UNIT_PRICE_PAISE,
              quantity: QTY,
              totalPrice: UNIT_PRICE * QTY,
              reversedQuantity: 0,
            } as any,
          ],
        },
      } as any,
    });
    await prisma.franchiseStock.create({
      data: {
        franchiseId,
        productId,
        variantId,
        globalSku: tag,
        onHandQty: START_ON_HAND,
        availableQty: START_ON_HAND,
      } as any,
    });
    await prisma.franchiseFinanceLedger.create({
      data: {
        id: onlineLedgerId,
        franchiseId,
        sourceType: 'ONLINE_ORDER',
        sourceId: subOrderId,
        baseAmount: UNIT_PRICE * QTY,
        rate: 0,
        computedAmount: 0,
        platformEarning: 0,
        franchiseEarning: UNIT_PRICE * QTY,
      } as any,
    });

    // ---- 1) request() ----
    const reversal: any = await svc.request({
      franchiseId,
      subOrderId,
      reason: 'verification test reversal',
      items: [{ orderItemId, quantity: REVERSE_QTY }],
    });
    check(
      'request → PENDING_APPROVAL',
      reversal.status === 'PENDING_APPROVAL',
      `status=${reversal.status}`,
    );
    check(
      'request → value snapshot = unitPaise*qty',
      String(reversal.reversalValueInPaise) === String(UNIT_PRICE_PAISE * BigInt(REVERSE_QTY)),
      `value=${reversal.reversalValueInPaise}`,
    );

    // ---- 2) approve() ----
    const approved = await svc.approve({
      reversalId: reversal.id,
      adminId: 'verify-admin',
      adminRole: 'ADMIN',
    });
    check('approve → APPROVED', approved.status === 'APPROVED', JSON.stringify(approved));

    const stockAfter = await prisma.franchiseStock.findFirst({
      where: { franchiseId, productId, variantId },
      select: { onHandQty: true },
    });
    check(
      'stock onHandQty += reversed qty',
      stockAfter?.onHandQty === START_ON_HAND + REVERSE_QTY,
      `onHand ${START_ON_HAND} → ${stockAfter?.onHandQty} (expected ${START_ON_HAND + REVERSE_QTY})`,
    );

    const oiAfter = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: { reversedQuantity: true },
    });
    check(
      'orderItem.reversedQuantity = reversed qty',
      oiAfter?.reversedQuantity === REVERSE_QTY,
      `reversedQuantity=${oiAfter?.reversedQuantity}`,
    );

    const reversalLedger = await prisma.franchiseFinanceLedger.findFirst({
      where: { franchiseId, sourceId: subOrderId, sourceType: 'RETURN_REVERSAL' },
      select: { franchiseEarning: true, baseAmount: true },
    });
    check(
      'RETURN_REVERSAL ledger entry created (negative earning)',
      !!reversalLedger && Number(reversalLedger.franchiseEarning) === -(UNIT_PRICE * REVERSE_QTY),
      `entry=${JSON.stringify(reversalLedger)} expectedEarning=${-(UNIT_PRICE * REVERSE_QTY)}`,
    );

    const originalAfter = await prisma.franchiseFinanceLedger.findUnique({
      where: { id: onlineLedgerId },
      select: { status: true },
    });
    check(
      'original ONLINE_ORDER entry flipped to REVERSED',
      originalAfter?.status === 'REVERSED',
      `status=${originalAfter?.status}`,
    );

    // ---- 3) idempotency: second approve must be rejected by the CAS gate ----
    let secondThrew = false;
    try {
      await svc.approve({ reversalId: reversal.id, adminId: 'verify-admin', adminRole: 'ADMIN' });
    } catch {
      secondThrew = true;
    }
    check('approve is idempotent (second approve rejected)', secondThrew);

    const stockAfter2 = await prisma.franchiseStock.findFirst({
      where: { franchiseId, productId, variantId },
      select: { onHandQty: true },
    });
    check(
      'no double-restock after retried approve',
      stockAfter2?.onHandQty === START_ON_HAND + REVERSE_QTY,
      `onHand=${stockAfter2?.onHandQty}`,
    );
  } finally {
    // ---- Cleanup (best-effort, reverse FK order) ----
    await prisma.franchiseReversalItem.deleteMany({ where: { reversal: { subOrderId } } }).catch(() => {});
    await prisma.franchiseReversal.deleteMany({ where: { subOrderId } }).catch(() => {});
    await prisma.franchiseFinanceLedger.deleteMany({ where: { sourceId: subOrderId } }).catch(() => {});
    await prisma.franchiseStock.deleteMany({ where: { globalSku: tag } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { subOrderId } }).catch(() => {});
    await prisma.subOrder.deleteMany({ where: { id: subOrderId } }).catch(() => {});
    await prisma.masterOrder.deleteMany({ where: { id: masterOrderId } }).catch(() => {});
    await app.close();
  }

  // ---- Report ----
  console.log('\n========== FRANCHISE REVERSAL MONEY VERIFICATION ==========');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  }
  console.log('==========================================================');
  console.log(allPass ? 'RESULT: ALL CHECKS PASSED ✅' : 'RESULT: SOME CHECKS FAILED ❌');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('VERIFICATION SCRIPT ERROR:', err);
  process.exit(2);
});
