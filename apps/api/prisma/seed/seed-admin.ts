import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SEED_NAME = process.env.ADMIN_SEED_NAME || 'Super Admin';
const SEED_EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@sportsmart.com';
const SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD;

if (!SEED_PASSWORD) {
  console.error('ADMIN_SEED_PASSWORD is required. Set it in .env before seeding.');
  process.exit(1);
}

const SYSTEM_ROLES: { name: UserRole; description: string }[] = [
  { name: UserRole.CUSTOMER, description: 'Customer role' },
  { name: UserRole.SELLER, description: 'Seller role' },
  { name: UserRole.SELLER_STAFF, description: 'Seller staff role' },
  { name: UserRole.ADMIN, description: 'Admin role' },
  { name: UserRole.SUPPORT, description: 'Support staff role' },
  { name: UserRole.AFFILIATE, description: 'Affiliate partner role' },
  { name: UserRole.FRANCHISE, description: 'Franchise partner role' },
];

async function main() {
  console.log('--- Admin & Roles Seed Script ---');

  // ── Seed system roles ──────────────────────────────────────
  console.log('Seeding system roles...');
  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: {
        name: role.name,
        description: role.description,
        isSystem: true,
      },
    });
  }
  const roleCount = await prisma.role.count();
  console.log(`  ${roleCount} roles in database`);

  // ── Seed admin user ────────────────────────────────────────
  const existing = await prisma.admin.findUnique({
    where: { email: SEED_EMAIL },
  });

  if (existing) {
    console.log(`Admin already exists: ${SEED_EMAIL} (id: ${existing.id}). Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  const admin = await prisma.admin.create({
    data: {
      name: SEED_NAME,
      email: SEED_EMAIL,
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isSeeded: true,
    },
  });

  console.log(`Seeded admin created successfully:`);
  console.log(`  ID:    ${admin.id}`);
  console.log(`  Name:  ${admin.name}`);
  console.log(`  Email: ${admin.email}`);
  console.log(`  Role:  ${admin.role}`);
  console.log(`  Status: ${admin.status}`);
}

main()
  .catch((e) => {
    console.error('Admin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
