import { PrismaClient, AdminRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Seed the two channel-scoped portal admin accounts.
 *
 * Product-catalog channel isolation (the owner-only filter in
 * prisma-product.repository.ts) only takes effect for admins whose ROLE carries
 * a seller-type scope key:
 *   - D2C_ADMIN      → sellers.scope.d2c    → sees only D2C-owned products
 *   - RETAILER_ADMIN → sellers.scope.retail → sees only RETAIL-owned products
 *
 * SUPER_ADMIN / SELLER_OPERATIONS / SELLER_ADMIN are UNRESTRICTED (no scope key)
 * and therefore see EVERY channel's products — which is exactly why an account
 * with one of those roles on the D2C or Retail admin portal sees everything and
 * the isolation appears "broken".
 *
 * This seed guarantees a correctly-scoped login exists for each portal.
 *
 * Idempotent:
 *   - account already present (matched by email) → only its ROLE is corrected to
 *     the scoped value (password and everything else left untouched).
 *   - account missing → created with ADMIN_SEED_PASSWORD.
 *
 * To RE-ROLE your EXISTING portal accounts (recommended — keeps their current
 * login + MFA), point the emails at them:
 *   D2C_ADMIN_SEED_EMAIL=<your existing d2c-admin email>
 *   RETAIL_ADMIN_SEED_EMAIL=<your existing retail-admin email>
 */

const prisma = new PrismaClient();

const PASSWORD = process.env.ADMIN_SEED_PASSWORD;

const PORTAL_ADMINS: { name: string; email: string; role: AdminRole }[] = [
  {
    name: 'D2C Seller Admin',
    email: process.env.D2C_ADMIN_SEED_EMAIL || 'd2c-admin@sportsmart.com',
    role: 'D2C_ADMIN' as AdminRole,
  },
  {
    name: 'Retail Seller Admin',
    email: process.env.RETAIL_ADMIN_SEED_EMAIL || 'retail-admin@sportsmart.com',
    role: 'RETAILER_ADMIN' as AdminRole,
  },
];

async function main() {
  for (const a of PORTAL_ADMINS) {
    const existing = await prisma.admin.findUnique({ where: { email: a.email } });

    if (existing) {
      if (existing.role !== a.role) {
        await prisma.admin.update({
          where: { email: a.email },
          data: { role: a.role },
        });
        console.log(`Re-roled ${a.email}: ${existing.role} → ${a.role}`);
      } else {
        console.log(`${a.email} already ${a.role}. Skipping.`);
      }
      continue;
    }

    if (!PASSWORD) {
      const envVar =
        a.role === 'D2C_ADMIN' ? 'D2C_ADMIN_SEED_EMAIL' : 'RETAIL_ADMIN_SEED_EMAIL';
      console.warn(
        `Skipped creating ${a.email} (${a.role}) — ADMIN_SEED_PASSWORD not set. ` +
          `Set it in .env to create a fresh account, or set ${envVar} to an ` +
          `existing account's email to re-role that one instead.`,
      );
      continue;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await prisma.admin.create({
      data: {
        name: a.name,
        email: a.email,
        passwordHash,
        role: a.role,
        status: 'ACTIVE',
        isSeeded: true,
      },
    });
    console.log(`Created ${a.role} portal admin: ${a.email}`);
  }
}

main()
  .catch((e) => {
    console.error('Portal-admin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
