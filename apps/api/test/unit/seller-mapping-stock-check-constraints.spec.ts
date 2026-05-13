import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 2 (PR 2.4) — stock-invariant CHECK constraints regression guard.
 *
 * Three DB-level CHECK constraints back the seller-product-mapping
 * stock invariants. They mirror the application-layer guards from
 * PR 1.10 (bulk CSV import floor) and the seller-allocation
 * reservation path. The constraints are the defence-in-depth: even
 * a raw-SQL UPDATE bypassing all service guards can't leave the
 * row in an oversold state.
 *
 * Invariants under guard:
 *   1. stock_qty >= 0
 *   2. reserved_qty >= 0
 *   3. reserved_qty <= stock_qty
 *
 * Prisma doesn't model CHECK constraints in the schema, so the only
 * source of truth is the migration SQL. This test reads that file to
 * pin the contract — if a future migration silently drops one of the
 * constraints, the test fails before deploy.
 */

const MIGRATION_SQL_PATH = join(
  __dirname,
  '..',
  '..',
  'prisma',
  'schema',
  'migrations',
  '20260512150000_seller_mapping_stock_check_constraints',
  'migration.sql',
);

const EXPECTED_CONSTRAINTS: Array<{
  name: string;
  expression: RegExp;
}> = [
  {
    name: 'seller_product_mappings_stock_qty_non_negative',
    expression: /"stock_qty"\s*>=\s*0/,
  },
  {
    name: 'seller_product_mappings_reserved_qty_non_negative',
    expression: /"reserved_qty"\s*>=\s*0/,
  },
  {
    name: 'seller_product_mappings_reserved_lte_stock',
    expression: /"reserved_qty"\s*<=\s*"stock_qty"/,
  },
];

describe('seller_product_mappings — stock CHECK constraints (PR 2.4)', () => {
  it.each(EXPECTED_CONSTRAINTS)(
    'migration declares the $name CHECK constraint with the expected predicate',
    ({ name, expression }) => {
      const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
      expect(sql).toContain(`"${name}"`);
      expect(sql).toMatch(expression);
    },
  );

  it('uses NOT VALID so the migration does not scan existing rows', () => {
    // NOT VALID is the operational safety pattern: new writes enforce
    // the invariant immediately, existing rows are grandfathered, and
    // a separate VALIDATE CONSTRAINT pass can clean up legacy data
    // during a maintenance window without locking the table.
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const addConstraints = [...sql.matchAll(/ADD\s+CONSTRAINT\s+"[^"]+"\s+CHECK[^;]+/gi)];
    expect(addConstraints.length).toBeGreaterThanOrEqual(3);
    for (const c of addConstraints) {
      expect(c[0].toUpperCase()).toContain('NOT VALID');
    }
  });

  it('all CHECK constraints target seller_product_mappings (no stray ALTERs on other tables)', () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const alterTables = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/gi)].map(
      (m) => m[1],
    );
    expect(alterTables.length).toBe(3);
    for (const t of alterTables) {
      expect(t).toBe('seller_product_mappings');
    }
  });

  it('Prisma schema carries a comment pointing readers at the constraints', () => {
    // The Prisma schema can't declare CHECK constraints, so the comment
    // is the navigation aid for someone reading the model definition.
    // A regression that drops the comment leaves future maintainers
    // without a pointer to the invariants.
    const schema = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'schema', 'seller-product-mapping.prisma'),
      'utf8',
    );
    expect(schema).toContain('CHECK constraints');
    expect(schema).toMatch(/reserved_qty\s*<=\s*stock_qty/);
  });
});
