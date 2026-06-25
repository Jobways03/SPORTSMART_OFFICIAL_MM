import { PrismaClient, TicketActorType } from '@prisma/client';

/**
 * Seed customer support ticket categories.
 *
 * These populate the "Category" dropdown on the storefront Open-a-ticket form
 * (`GET /customer/support/categories` →
 * `ticketCategory.findMany({ where: { active: true, scopedTo IN (CUSTOMER, null) } })`).
 *
 * They are reference data that previously had NO seed or migration source — so
 * a freshly-provisioned DB (e.g. staging) showed an empty category dropdown
 * with only "— Select —". This seed makes them part of the standard pipeline.
 *
 * Idempotent: upserts on the unique `name`, so re-runs update in place and
 * never create duplicates.
 */

const CATEGORIES: Array<{
  name: string;
  description: string;
  scopedTo: TicketActorType;
  sortOrder: number;
}> = [
  {
    name: 'Order not delivered',
    description: 'Package never arrived or is delayed beyond the expected date',
    scopedTo: 'CUSTOMER',
    sortOrder: 10,
  },
  {
    name: 'Wrong / damaged product',
    description:
      'Received a different item, defective product, or damaged in transit',
    scopedTo: 'CUSTOMER',
    sortOrder: 20,
  },
  {
    name: 'Refund / payment',
    description: 'Refund not received, payment failed, or wallet credit issue',
    scopedTo: 'CUSTOMER',
    sortOrder: 30,
  },
  {
    name: 'Coupon / discount',
    description: 'Coupon did not apply, promo code rejected, or pricing mismatch',
    scopedTo: 'CUSTOMER',
    sortOrder: 40,
  },
  {
    name: 'Account / login',
    description: 'Login problems, address or profile updates, password reset',
    scopedTo: 'CUSTOMER',
    sortOrder: 50,
  },
  {
    name: 'Other',
    description: 'Anything that does not fit the categories above',
    scopedTo: 'CUSTOMER',
    sortOrder: 99,
  },
];

export async function seedSupportCategories(prisma: PrismaClient): Promise<void> {
  for (const c of CATEGORIES) {
    await prisma.ticketCategory.upsert({
      where: { name: c.name },
      create: {
        name: c.name,
        description: c.description,
        scopedTo: c.scopedTo,
        sortOrder: c.sortOrder,
        active: true,
      },
      update: {
        // Keep copy/sort in sync on re-run, but don't force-reactivate a
        // category an admin has deliberately deactivated.
        description: c.description,
        scopedTo: c.scopedTo,
        sortOrder: c.sortOrder,
      },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedSupportCategories(prisma)
    .then(() => {
      console.log(`Seeded ${CATEGORIES.length} support ticket categories.`);
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed to seed support categories:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
