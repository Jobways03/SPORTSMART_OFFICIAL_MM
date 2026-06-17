/**
 * Production Seed Runner — loads ONLY the reference data a fresh production
 * database needs to be usable, idempotently.
 *
 * Unlike the dev runner (seed.ts), this NEVER loads demo/dev fixtures (catalog,
 * menu, metafields, demo-products, smoke-actors). Those hardcode test passwords
 * and demo SKUs and would pollute a real prod DB — and seed-metafields actively
 * DEACTIVATES any metafield whose category slug it can't resolve, which would
 * silently wreck taxonomy on a prod DB that has no dev categories.
 *
 * Run AFTER `prisma migrate deploy` (the schema must already exist). Every step
 * is upsert / skip-safe, so this is idempotent and safe to re-run.
 *
 * Where it runs:
 *   - Production: the one-shot `<env>-seed` ECS task (infra/aws/terraform/
 *     seed.tf), gated behind RUN_SEED=true in infra/scripts/deploy.sh.
 *   - Locally:  ADMIN_SEED_PASSWORD=… pnpm --filter @sportsmart/api seed:prod
 *
 * Deliberately NOT run here:
 *   - seed-admin-rbac (the granular admin roles): it imports app source
 *     (../../src/core/authorization/permission-registry) which is not present
 *     in the dist-only prod image, so it can't run from the image. The
 *     SUPER_ADMIN created by seed-admin can operate prod meanwhile; wire this
 *     in once it is made image-runnable.
 *   - pincodes: need the 165K-row India-Post CSV, not shipped in the image.
 *   - all dev/demo fixtures.
 */

import { execSync } from 'child_process';
import * as path from 'path';

// Best-effort local .env load. In ECS the task injects env (no .env file) and
// dotenv may be absent from the pruned image — so load it defensively and never
// fail if it is missing.
try {
  (require('dotenv') as { config: (o: { path: string }) => void }).config({
    path: path.join(__dirname, '..', '..', '.env'),
  });
} catch {
  /* dotenv unavailable (pruned prod image) — env is already injected */
}

const seedDir = __dirname;
const rootDir = path.join(__dirname, '..', '..'); // apps/api
const tsNode = path.join('node_modules', '.bin', 'ts-node');

const mask = (url: string | undefined): string =>
  (url ?? '').replace(/:\/\/[^@]*@/, '://***@');

// Reference-only subset. admin / policies / SLA are independent; tax-master
// seeds india_states (nothing here depends on it). All four import only
// @prisma/client (+ bcrypt for admin), so they run from the dist-only image.
const STEPS: ReadonlyArray<{ label: string; script: string }> = [
  { label: 'Admin user + system roles', script: 'seed-admin.ts' },
  { label: 'Resource policies (ABAC)', script: 'seed-resource-policies.ts' },
  { label: 'SLA policies', script: 'seed-sla-policies.ts' },
  { label: 'Tax master (states, HSN, UQC, GST config)', script: 'seed-tax-master.ts' },
];

function run(label: string, script: string): void {
  console.log(`\n${'═'.repeat(64)}\n  ${label}\n${'═'.repeat(64)}\n`);
  try {
    // --transpile-only: skip the redundant type-check at runtime (CI already
    // type-checks the seeds). Each child inherits the injected env (DATABASE_URL,
    // ADMIN_SEED_PASSWORD), so a fresh PrismaClient connects correctly.
    execSync(`${tsNode} --transpile-only "${path.join(seedDir, script)}"`, {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    console.error(`\n❌ ${label} failed — aborting prod seed.\n`);
    process.exit(1);
  }
}

function main(): void {
  console.log('🌱 SPORTSMART — PRODUCTION Seed Runner (reference data only)');
  console.log(`   DATABASE_URL : ${mask(process.env.DATABASE_URL) || '(NOT SET!)'}`);
  console.log(`   steps        : ${STEPS.length} reference seeds`);

  if (!process.env.DATABASE_URL) {
    console.error('\n❌ DATABASE_URL is not set. Aborting.\n');
    process.exit(1);
  }
  // seed-admin hard-exits without this; check up front for a clearer early error.
  if (!process.env.ADMIN_SEED_PASSWORD) {
    console.error(
      '\n❌ ADMIN_SEED_PASSWORD is not set — the bootstrap admin cannot be created.\n' +
        '   In prod, populate it in the <env>/app/external secret, then re-run.\n',
    );
    process.exit(1);
  }

  STEPS.forEach((s, i) => run(`${i + 1}/${STEPS.length}  ${s.label}`, s.script));

  console.log('\n✅ Production reference seed complete.');
  console.log(
    '   Not run here (by design): granular admin RBAC roles (seed-admin-rbac —\n' +
      '   needs app source), pincodes (need the India-Post CSV), and dev fixtures.\n',
  );
}

main();
