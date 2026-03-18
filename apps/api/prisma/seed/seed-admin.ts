import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_NAME = process.env.ADMIN_SEED_NAME || 'Super Admin';
const SEED_EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@sportsmart.com';
const SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'Admin@123';

async function main() {
  console.log('--- Admin Seed Script ---');

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
