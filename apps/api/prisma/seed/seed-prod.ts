/**
 * Production Seed Runner — loads ONLY the reference data a fresh production
 * database needs to be usable, idempotently.
 *
 * Unlike the dev runner (seed.ts), this NEVER loads the demo fixtures that
 * hardcode test passwords / demo SKUs (demo-products, smoke-actors) — they would
 * pollute a real prod DB. It DOES load the real catalog taxonomy (categories +
 * brands) and the category metafield definitions the storefront needs. Metafields
 * run AFTER catalog so they resolve their categories; seed-metafields is
 * idempotent (upsert + mark-inactive, never deletes) and is force-run on prod via
 * FORCE_METAFIELD_SEED (set on the seed task in seed.tf — staging doesn't need it).
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

// Reference subset (no demo products / test users). ORDER MATTERS at the tail:
// seed-catalog creates the category taxonomy + brands, and seed-metafields
// attaches metafield definitions to those categories — so catalog MUST run
// before metafields. admin/policies/SLA/tax/menu are independent. All import
// only @prisma/client (+ bcrypt for admin) and run from the dist-only image.
// NOTE: seed-menu / seed-catalog / seed-metafields recreate-or-upsert their
// reference rows each run, so re-seeding RESETS admin edits to those defaults —
// fine at first bring-up; on an established env run RUN_SEED only when
// intentionally refreshing them.
const STEPS: ReadonlyArray<{ label: string; script: string }> = [
  { label: 'Admin user + system roles', script: 'seed-admin.ts' },
  { label: 'Resource policies (ABAC)', script: 'seed-resource-policies.ts' },
  { label: 'SLA policies', script: 'seed-sla-policies.ts' },
  { label: 'Tax master (states, HSN, UQC, GST config)', script: 'seed-tax-master.ts' },
  { label: 'Storefront navigation menu', script: 'seed-menu.ts' },
  { label: 'Catalog taxonomy (categories + brands)', script: 'seed-catalog.ts' },
  { label: 'Category metafield definitions', script: 'seed-metafields.ts' },
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
