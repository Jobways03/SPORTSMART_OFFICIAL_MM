import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Phase 4 (PR 4.3) — Seed example ResourcePolicy rows.
 *
 * These are illustrative defaults that production teams should review
 * and adjust to match their internal financial controls. The seeder
 * upserts by `name` so re-running is idempotent and safe to ship in
 * `npm run db:seed`.
 *
 * Tier-1 caps:
 *   - SELLER_OPERATIONS may credit/debit wallets up to ₹10,000 (1,000,000 paise).
 *   - SELLER_OPERATIONS may not adjust franchise ledger over ₹50,000.
 *   - SUPER_ADMIN has no caps (no DENY rule; ALLOW-by-policy wins via priority).
 */

const POLICIES: Array<{
  name: string;
  description: string;
  effect: 'ALLOW' | 'DENY';
  principalType: 'ROLE' | 'PERMISSION' | 'CUSTOM_ROLE' | 'ANY';
  principalKey: string;
  resourceType: string;
  action: string;
  conditions: Record<string, unknown> | null;
  priority: number;
}> = [
  // ── Wallets ──────────────────────────────────────────────────────
  {
    name: 'super-admin-wallet-credit-allow',
    description: 'SUPER_ADMIN may credit wallets at any amount.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SUPER_ADMIN',
    resourceType: 'wallet',
    action: 'credit',
    conditions: null,
    priority: 200,
  },
  {
    name: 'super-admin-wallet-debit-allow',
    description: 'SUPER_ADMIN may debit wallets at any amount.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SUPER_ADMIN',
    resourceType: 'wallet',
    action: 'debit',
    conditions: null,
    priority: 200,
  },
  {
    name: 'tier-1-wallet-credit-cap-10k',
    description:
      'SELLER_OPERATIONS may credit wallets up to ₹10,000 per transaction.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SELLER_OPERATIONS',
    resourceType: 'wallet',
    action: 'credit',
    conditions: { amountInPaise: { $lte: 1_000_000 } },
    priority: 100,
  },
  {
    name: 'tier-1-wallet-debit-cap-10k',
    description:
      'SELLER_OPERATIONS may debit wallets up to ₹10,000 per transaction.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SELLER_OPERATIONS',
    resourceType: 'wallet',
    action: 'debit',
    conditions: { amountInPaise: { $lte: 1_000_000 } },
    priority: 100,
  },

  // ── Franchise ledger ─────────────────────────────────────────────
  {
    name: 'super-admin-franchise-ledger-adjust-allow',
    description: 'SUPER_ADMIN may adjust the franchise ledger at any amount.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SUPER_ADMIN',
    resourceType: 'franchise-ledger',
    action: 'adjust',
    conditions: null,
    priority: 200,
  },
  {
    name: 'super-admin-franchise-ledger-penalize-allow',
    description: 'SUPER_ADMIN may record a franchise penalty at any amount.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SUPER_ADMIN',
    resourceType: 'franchise-ledger',
    action: 'penalize',
    conditions: null,
    priority: 200,
  },
  {
    name: 'tier-1-franchise-ledger-adjust-cap-50k',
    description:
      'SELLER_OPERATIONS may adjust franchise ledger up to ₹50,000 per entry.',
    effect: 'ALLOW',
    principalType: 'ROLE',
    principalKey: 'SELLER_OPERATIONS',
    resourceType: 'franchise-ledger',
    action: 'adjust',
    conditions: { amount: { $lte: 50_000 } },
    priority: 100,
  },
];

export async function seedResourcePolicies(prisma: PrismaClient): Promise<void> {
  for (const p of POLICIES) {
    const conds =
      p.conditions === null
        ? Prisma.DbNull
        : (p.conditions as Prisma.InputJsonValue);
    await prisma.resourcePolicy.upsert({
      where: { name: p.name },
      create: {
        name: p.name,
        description: p.description,
        effect: p.effect,
        principalType: p.principalType,
        principalKey: p.principalKey,
        resourceType: p.resourceType,
        action: p.action,
        conditions: conds,
        priority: p.priority,
        enabled: true,
      },
      update: {
        description: p.description,
        effect: p.effect,
        principalType: p.principalType,
        principalKey: p.principalKey,
        resourceType: p.resourceType,
        action: p.action,
        conditions: conds,
        priority: p.priority,
      },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedResourcePolicies(prisma)
    .then(() => {
      console.log(`Seeded ${POLICIES.length} resource policies.`);
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed to seed resource policies:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
