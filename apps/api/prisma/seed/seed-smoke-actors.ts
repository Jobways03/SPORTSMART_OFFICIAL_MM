/**
 * Seeds deterministic test actors for the smoke suite.
 *
 * Sprint 3 Story 2.1 (initial cut): customer only — unblocks V2 smoke
 * tests for /customer/* endpoints. Future stories will extend with
 * seller / franchise / affiliate fixtures as those flows get smoke
 * coverage.
 *
 * Idempotent: upsert-by-email. Safe to re-run; intentionally NOT gated
 * behind NODE_ENV=production-only because dev resets need it.
 *
 * Credentials are deterministic so smoke tests can hardcode them:
 *   email:    smoke-customer@sportsmart.test
 *   password: SmokeCustomer@123
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SMOKE_CUSTOMER = {
  email: 'smoke-customer@sportsmart.test',
  password: 'SmokeCustomer@123',
  firstName: 'Smoke',
  lastName: 'Customer',
};

const prisma = new PrismaClient();

async function main() {
  // Phase 9 (2026-05-16) — refuse to seed the smoke customer when
  // NODE_ENV=production. The credentials are deterministic + checked
  // into git (so smoke tests can hardcode them) — running this in
  // prod would create a known-password user that anyone with the
  // repo could log in as.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-smoke-actors must not run in production (NODE_ENV=production). The hardcoded password would create a publicly-known login.',
    );
  }

  const passwordHash = await bcrypt.hash(SMOKE_CUSTOMER.password, 12);

  const user = await prisma.user.upsert({
    where: { email: SMOKE_CUSTOMER.email },
    update: {
      // Re-hash on each run so password rotation is deterministic for
      // tests. Other fields kept as-is — don't blow away any test data
      // the operator may have attached (addresses, orders).
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
    },
    create: {
      email: SMOKE_CUSTOMER.email,
      firstName: SMOKE_CUSTOMER.firstName,
      lastName: SMOKE_CUSTOMER.lastName,
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  // UserAuthGuard requires 'CUSTOMER' in the JWT roles array (set at
  // login time by LoginUserUseCase from user.roleAssignments[].role.name).
  // Assign the CUSTOMER role idempotently — seed-admin seeds the Role
  // row itself, so this can fail loudly if the admin seed never ran.
  const customerRole = await prisma.role.findUnique({
    where: { name: 'CUSTOMER' },
  });
  if (!customerRole) {
    throw new Error(
      'Role.name=CUSTOMER not found — run `pnpm --filter @sportsmart/api seed:admin` first',
    );
  }

  await prisma.roleAssignment.upsert({
    where: {
      userId_roleId: { userId: user.id, roleId: customerRole.id },
    },
    update: {},
    create: { userId: user.id, roleId: customerRole.id },
  });

  console.log(`Smoke customer ready: ${user.email} (id=${user.id})`);
  console.log(`  Password: ${SMOKE_CUSTOMER.password}`);
  console.log(`  Roles:    CUSTOMER`);
}

main()
  .catch((err) => {
    console.error('seed-smoke-actors failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
