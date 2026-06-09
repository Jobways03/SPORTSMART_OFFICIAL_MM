/**
 * Makes DELIVERED seller orders commission-eligible NOW, so the seller-earnings
 * + settlement leg can be exercised without waiting out the return window.
 *
 * WHY THIS IS NEEDED (the "missing commission" investigation):
 *   Commission is NOT created at delivery, and it is NOT an unfired event. The
 *   commission processor is a @Cron(EVERY_MINUTE) (CommissionProcessorService)
 *   that runs fine — but it only LOCKS commission for a delivered sub-order once
 *   that order is PAST its return window. Eligibility is:
 *
 *       fulfillmentStatus = DELIVERED
 *       commissionProcessed = false
 *       commissionLockScheduledAt <= now()          ← set at delivery to
 *                                                       deliveredAt + RETURN_WINDOW_DAYS
 *       no live return  (status not in REJECTED, QC_REJECTED, CANCELLED)
 *       no active dispute (status not in RESOLVED_x or CLOSED)
 *
 *   RETURN_WINDOW_DAYS defaults to 14, so a freshly-delivered order is correctly
 *   skipped — you don't pay the seller on an order the customer might still
 *   return. (The cron also has an immediate-lock path used when a return is
 *   terminally rejected; see findSubOrderForImmediateCommission.)
 *
 * WHAT THIS DOES:
 *   Backdates commissionLockScheduledAt to 2h ago so the running cron locks
 *   commission within ~1 minute. It writes via PRISMA on purpose: the column is
 *   `timestamp without time zone`, so a raw SQL `now()` stores the IST wall-clock
 *   which the app then misreads as a future UTC instant (and the row is skipped).
 *   A JS Date through Prisma is written + read consistently. Orders with a live
 *   return / active dispute are left alone — the cron skips them by design.
 *
 * Dev/test ONLY.
 *
 * Env:
 *   COMMISSION_SEED_SELLER_ID   restrict to one seller          (default: all sellers)
 *   COMMISSION_SEED_WAIT        poll ~90s to confirm the lock    (default: true)
 *
 * Run:
 *   pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-commission-eligible.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SELLER_ID = process.env.COMMISSION_SEED_SELLER_ID;
const WAIT = process.env.COMMISSION_SEED_WAIT !== 'false';

async function main() {
  // 2h ago, as a real Date — Prisma writes/reads it as UTC, matching how the
  // cron's `commissionLockScheduledAt <= new Date()` filter compares.
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const where = {
    fulfillmentStatus: 'DELIVERED',
    commissionProcessed: false,
    fulfillmentNodeType: 'SELLER',
    ...(SELLER_ID ? { sellerId: SELLER_ID } : {}),
  } as const;

  const targets = await prisma.subOrder.findMany({
    where: where as any,
    select: { id: true, sellerId: true },
  });
  if (targets.length === 0) {
    console.log(
      'No DELIVERED + unprocessed seller sub-orders found — nothing to make eligible.',
    );
    return;
  }
  const ids = targets.map((t) => t.id);

  const updated = await prisma.subOrder.updateMany({
    where: { id: { in: ids } },
    data: { commissionLockScheduledAt: cutoff },
  });
  console.log(
    `✅ Backdated commissionLockScheduledAt on ${updated.count} delivered seller sub-order(s).`,
  );
  console.log(
    '   The commission processor cron (EVERY_MINUTE) will lock commission for any',
  );
  console.log('   without a live return / active dispute, usually within ~1 minute.');

  if (!WAIT) return;

  process.stdout.write('   Waiting for the cron to lock commission');
  for (let i = 0; i < 18; i++) {
    const n = await prisma.commissionRecord.count({
      where: { subOrderId: { in: ids } },
    });
    if (n > 0) {
      console.log(
        `\n✅ ${n} commission record(s) generated — the seller-earnings + settlement leg can now run.`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
    process.stdout.write('.');
  }
  console.log(
    '\n⚠  No commission after ~90s. Check that the API (with its cron) is running and ' +
      'COMMISSION_PROCESSOR_ENABLED is not false. Orders with a live return/dispute are skipped by design.',
  );
}

main()
  .catch((err) => {
    console.error('seed-commission-eligible failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
