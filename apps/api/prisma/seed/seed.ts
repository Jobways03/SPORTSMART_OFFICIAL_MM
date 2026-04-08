/**
 * Master Seed Script
 *
 * Runs all seed scripts in the correct order.
 * Safe to run multiple times — all scripts use upsert/skip logic.
 *
 * Usage:
 *   npx ts-node prisma/seed/seed.ts           # Run all seeds
 *   npx ts-node prisma/seed/seed.ts --skip-pincodes  # Skip heavy pincode import
 *
 * Or via package.json:
 *   pnpm run seed              # All seeds
 *   pnpm run seed:quick        # Skip pincodes (fast)
 *   pnpm run seed:pincodes     # Only pincodes
 *   pnpm run seed:metafields   # Only metafield definitions
 */

import { execSync } from 'child_process';
import * as path from 'path';

const args = process.argv.slice(2);
const skipPincodes = args.includes('--skip-pincodes');

const seedDir = path.join(__dirname);
const rootDir = path.join(__dirname, '..', '..');

function run(label: string, scriptPath: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}\n`);
  try {
    execSync(`npx ts-node "${scriptPath}"`, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch (err) {
    console.error(`\n❌ ${label} failed!\n`);
    process.exit(1);
  }
}

async function main() {
  console.log('🌱 SPORTSMART — Master Seed Runner');
  console.log(`   Skip pincodes: ${skipPincodes ? 'YES' : 'NO'}`);

  // 1. Admin user (must exist for admin operations)
  run('1/4  Admin User', path.join(seedDir, 'seed-admin.ts'));

  // 2. Catalog (categories, brands, option definitions)
  run('2/4  Catalog (Categories, Brands, Options)', path.join(seedDir, 'seed-catalog.ts'));

  // 3. Category metafield definitions (depends on categories)
  run('3/4  Category Metafield Definitions', path.join(seedDir, 'seed-metafields.ts'));

  // 4. Pincodes (heavy — 165K+ rows, optional skip)
  if (skipPincodes) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('  4/4  Pincodes — SKIPPED (--skip-pincodes)');
    console.log(`${'═'.repeat(60)}\n`);
  } else {
    run('4/4  Pincodes (165K+ rows)', path.join(seedDir, 'seed-pincodes.ts'));
  }

  console.log('\n✅ All seeds completed successfully!\n');
}

main();
