import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 2 (PR 2.1) — composite-index regression guard.
 *
 * Six composite indexes added to back the hottest query paths:
 *
 *   master_orders:
 *     - (customer_id, created_at DESC)   customer order history page
 *     - (order_status, payment_expires_at)   payment-expiry sweeper crons
 *
 *   sub_orders:
 *     - (accept_status, accept_deadline_at)   acceptance-timeout sweeper (5-min cron)
 *     - (seller_id, accept_status, created_at DESC)   seller dashboard
 *     - (franchise_id, accept_status, created_at DESC)   franchise dashboard
 *
 *   returns:
 *     - (status, created_at DESC)   admin returns queue
 *
 * The schema-as-source-of-truth contract is:
 *   - the Prisma model file contains the `@@index` line
 *   - the migration SQL contains a matching `CREATE INDEX` statement
 *
 * If either is dropped (e.g. someone "tidies up" the model file
 * without realising the index was load-bearing) this test fails
 * before it reaches prod.
 *
 * Test reads files via fs rather than running a real DB query so it
 * stays in the unit-test tier — no Postgres required to enforce
 * the contract.
 */

const SCHEMA_BASE = join(__dirname, '..', '..', 'prisma', 'schema');

const EXPECTED_PRISMA_INDEXES: Array<{
  file: string;
  // A substring (canonicalised whitespace-collapsed) the schema must contain.
  expected: string;
}> = [
  // master_orders
  {
    file: 'orders.prisma',
    expected: '@@index([customerId, createdAt(sort: Desc)])',
  },
  {
    file: 'orders.prisma',
    expected: '@@index([orderStatus, paymentExpiresAt])',
  },
  // sub_orders
  {
    file: 'orders.prisma',
    expected: '@@index([acceptStatus, acceptDeadlineAt])',
  },
  {
    file: 'orders.prisma',
    expected: '@@index([sellerId, acceptStatus, createdAt(sort: Desc)])',
  },
  {
    file: 'orders.prisma',
    expected: '@@index([franchiseId, acceptStatus, createdAt(sort: Desc)])',
  },
  // returns
  {
    file: 'returns.prisma',
    expected: '@@index([status, createdAt(sort: Desc)])',
  },
];

const MIGRATION_SQL_PATH = join(
  SCHEMA_BASE,
  'migrations',
  '20260512120000_phase2_composite_indexes',
  'migration.sql',
);

const EXPECTED_SQL_INDEXES: string[] = [
  'master_orders_customer_id_created_at_idx',
  'master_orders_order_status_payment_expires_at_idx',
  'sub_orders_accept_status_accept_deadline_at_idx',
  'sub_orders_seller_id_accept_status_created_at_idx',
  'sub_orders_franchise_id_accept_status_created_at_idx',
  'returns_status_created_at_idx',
];

function canonicalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

describe('Phase 2 composite indexes (PR 2.1) — schema regression guard', () => {
  describe('Prisma schema files', () => {
    it.each(EXPECTED_PRISMA_INDEXES)(
      'schema/$file contains $expected',
      ({ file, expected }) => {
        const source = canonicalise(readFileSync(join(SCHEMA_BASE, file), 'utf8'));
        expect(source).toContain(canonicalise(expected));
      },
    );
  });

  describe('Migration SQL', () => {
    it.each(EXPECTED_SQL_INDEXES)(
      'migration.sql creates index %s',
      (indexName) => {
        const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
        // CREATE INDEX statements; verify the named index appears.
        expect(sql).toContain(`"${indexName}"`);
      },
    );

    it('all CREATE INDEX statements target the documented set of tables', () => {
      const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
      const allowedTables = new Set(['master_orders', 'sub_orders', 'returns']);
      // Match `ON "<table>"` to extract table names from the migration.
      const onMatches = [...sql.matchAll(/ON\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(onMatches.length).toBeGreaterThan(0);
      for (const tbl of onMatches) {
        expect(allowedTables).toContain(tbl);
      }
    });

    it('uses DESC ordering on the trailing time column for both ORDER-BY-friendly indexes', () => {
      // The two "list-by-date" indexes (customer order history, admin
      // returns queue) need DESC on created_at so the index walk
      // matches the page's natural sort.
      const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
      expect(sql).toMatch(/"master_orders"[^;]*"created_at"\s+DESC/);
      expect(sql).toMatch(/"returns"[^;]*"created_at"\s+DESC/);
    });
  });
});
