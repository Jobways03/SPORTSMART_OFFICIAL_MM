/**
 * Master Seed Runner — provisions a database completely + idempotently.
 *
 * It reads ALL config (DATABASE_URL, DIRECT_URL, ADMIN_SEED_*, PINCODE_CSV_PATH)
 * from apps/api/.env. So to set up a NEW database you only change DATABASE_URL
 * (and DIRECT_URL) in .env, then run ONE command:
 *
 *   pnpm --filter @sportsmart/api seed:fresh   # db push (schema) + ALL seeds
 *   pnpm --filter @sportsmart/api seed         # ALL seeds (schema must exist)
 *   pnpm --filter @sportsmart/api seed:quick   # seeds EXCEPT the 165K pincodes
 *
 * Flags:  --push  (run `prisma db push` first)   --skip-pincodes
 *
 * Order matters: catalog runs before metafields + menu (which reference
 * categories). Every sub-seed is upsert/skip-safe, so re-running is harmless.
 *
 * Connections: `prisma db push` uses DIRECT_URL (the 5432 session connection —
 * the 6543 transaction pooler can't run migrations); the data seeds use
 * DATABASE_URL (the pooler works fine for them).
 *
 * Pincodes need the India-Post directory CSV. The committed prisma/seed/
 * pincodes.csv is a broken symlink in a clean checkout, so this runner
 * auto-detects a real file (PINCODE_CSV_PATH → ~/Desktop/pincodes.csv →
 * prisma/seed/pincodes.csv) and SKIPS the step with a warning if none is found
 * — it never fails the whole run on a missing CSV.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { config as loadEnv } from 'dotenv';

const seedDir = __dirname;
const rootDir = path.join(__dirname, '..', '..'); // apps/api

// Load apps/api/.env so DATABASE_URL etc. are available here AND inherited by
// every child seed process (dotenv does not override vars already in the shell).
loadEnv({ path: path.join(rootDir, '.env') });

const args = process.argv.slice(2);
const skipPincodes = args.includes('--skip-pincodes');
const doPush = args.includes('--push');

const mask = (url?: string) => (url || '').replace(/:\/\/[^@]*@/, '://***@');

function run(label: string, scriptPath: string, extraEnv: NodeJS.ProcessEnv = {}) {
  console.log(`\n${'═'.repeat(64)}\n  ${label}\n${'═'.repeat(64)}\n`);
  try {
    execSync(`npx ts-node "${scriptPath}"`, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
  } catch {
    console.error(`\n❌ ${label} failed!\n`);
    process.exit(1);
  }
}

/** First readable CSV: env override → home Desktop → committed file. */
function resolvePincodeCsv(): string | null {
  const candidates = [
    process.env.PINCODE_CSV_PATH,
    path.join(os.homedir(), 'Desktop', 'pincodes.csv'),
    path.join(seedDir, 'pincodes.csv'),
    path.join(seedDir, 'pincodes 2.csv'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* broken symlink / unreadable — try next */
    }
  }
  return null;
}

function main() {
  console.log('🌱 SPORTSMART — Master Seed Runner');
  console.log(`   DATABASE_URL : ${mask(process.env.DATABASE_URL) || '(NOT SET!)'}`);
  console.log(`   db push first: ${doPush ? 'YES (--push)' : 'no'}`);
  console.log(`   skip pincodes: ${skipPincodes ? 'YES' : 'no'}`);

  if (!process.env.DATABASE_URL) {
    console.error('\n❌ DATABASE_URL is not set (apps/api/.env). Aborting.\n');
    process.exit(1);
  }

  // 0 — schema (optional). Uses DIRECT_URL because migrations/db-push can't run
  // over the transaction pooler.
  if (doPush) {
    const direct = process.env.DIRECT_URL || process.env.DATABASE_URL;
    console.log(`\n${'═'.repeat(64)}\n  0/10  prisma db push (schema)  [${mask(direct)}]\n${'═'.repeat(64)}\n`);
    try {
      execSync('npx prisma db push --skip-generate --accept-data-loss', {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: direct },
      });
    } catch {
      console.error('\n❌ prisma db push failed!\n');
      process.exit(1);
    }
  }

  // 1–9 — reference data (order matters: catalog before metafields + menu).
  run('1/10  Admin user + system roles', path.join(seedDir, 'seed-admin.ts'));
  run('2/10  Scoped portal admins (D2C / Retail)', path.join(seedDir, 'seed-portal-admins.ts'));
  run('3/10  Resource policies (ABAC)', path.join(seedDir, 'seed-resource-policies.ts'));
  run('4/10  SLA policies', path.join(seedDir, 'seed-sla-policies.ts'));
  run('5/10  Tax master (states, HSN, UQC, GST config)', path.join(seedDir, 'seed-tax-master.ts'));
  run('6/10  Catalog (categories, brands, options)', path.join(seedDir, 'seed-catalog.ts'));
  run('7/10  Category metafield definitions', path.join(seedDir, 'seed-metafields.ts'));
  run('8/10  Storefront navigation menu', path.join(seedDir, 'seed-menu.ts'));
  run('9/10  Support ticket categories', path.join(seedDir, 'seed-support-categories.ts'));

  // 8 — pincodes (heavy, needs the India-Post CSV).
  if (skipPincodes) {
    console.log(`\n${'═'.repeat(64)}\n  10/10  Pincodes — SKIPPED (--skip-pincodes)\n${'═'.repeat(64)}\n`);
  } else {
    const csv = resolvePincodeCsv();
    if (!csv) {
      console.warn(
        `\n${'═'.repeat(64)}\n  10/10  Pincodes — SKIPPED (no CSV found)\n${'═'.repeat(64)}\n` +
          `  No India-Post CSV located. Set PINCODE_CSV_PATH in apps/api/.env\n` +
          `  (or place the file at ~/Desktop/pincodes.csv), then run:\n` +
          `      pnpm --filter @sportsmart/api seed:pincodes\n`,
      );
    } else {
      console.log(`  (pincode CSV: ${csv})`);
      run('10/10  Pincodes (165K+ rows)', path.join(seedDir, 'seed-pincodes.ts'), {
        PINCODE_CSV_PATH: csv,
      });
    }
  }

  console.log('\n✅ Master seed complete.\n');
}

main();
