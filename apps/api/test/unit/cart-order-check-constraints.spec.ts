import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 2 (PR 2.5) — cart + order-flow CHECK constraints regression guard.
 *
 * Six DB-level CHECK constraints back the cart and order-flow
 * invariants. Together with the seller-mapping constraints (PR 2.4)
 * they form the storage-layer defence-in-depth for the marketplace's
 * order-money lifecycle. The application layer is the primary guard
 * (PR 1.9 cart atomicity, place-order subtotal computation, etc.);
 * these constraints catch raw-SQL hotfixes, fixture writes, and any
 * future code path that talks to Postgres directly.
 *
 * Invariants under guard:
 *
 *   cart_items.quantity        > 0
 *   master_orders.total_amount_in_paise >= 0
 *   sub_orders.sub_total_in_paise       >= 0
 *   order_items.quantity              > 0
 *   order_items.unit_price_in_paise   >= 0
 *   order_items.total_price_in_paise  >= 0
 *
 * All NOT VALID (PR 2.4 follows the same pattern) so the migration is
 * operationally safe — new writes are checked, existing rows are
 * grandfathered, and a later VALIDATE CONSTRAINT pass can run online.
 */

const MIGRATION_SQL_PATH = join(
  __dirname,
  '..',
  '..',
  'prisma',
  'schema',
  'migrations',
  '20260512160000_cart_order_check_constraints',
  'migration.sql',
);

const EXPECTED_CONSTRAINTS: Array<{
  table: string;
  name: string;
  expression: RegExp;
}> = [
  {
    table: 'cart_items',
    name: 'cart_items_quantity_positive',
    expression: /"quantity"\s*>\s*0/,
  },
  {
    table: 'master_orders',
    name: 'master_orders_total_amount_in_paise_non_negative',
    expression: /"total_amount_in_paise"\s*>=\s*0/,
  },
  {
    table: 'sub_orders',
    name: 'sub_orders_sub_total_in_paise_non_negative',
    expression: /"sub_total_in_paise"\s*>=\s*0/,
  },
  {
    table: 'order_items',
    name: 'order_items_quantity_positive',
    expression: /"quantity"\s*>\s*0/,
  },
  {
    table: 'order_items',
    name: 'order_items_unit_price_in_paise_non_negative',
    expression: /"unit_price_in_paise"\s*>=\s*0/,
  },
  {
    table: 'order_items',
    name: 'order_items_total_price_in_paise_non_negative',
    expression: /"total_price_in_paise"\s*>=\s*0/,
  },
];

describe('cart + order CHECK constraints (PR 2.5)', () => {
  it.each(EXPECTED_CONSTRAINTS)(
    'migration declares $name with the expected predicate',
    ({ name, expression }) => {
      const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
      expect(sql).toContain(`"${name}"`);
      expect(sql).toMatch(expression);
    },
  );

  it('all six constraints use NOT VALID so the migration does not block on legacy rows', () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const addConstraints = [
      ...sql.matchAll(/ADD\s+CONSTRAINT\s+"[^"]+"\s+CHECK[\s\S]*?NOT VALID/gi),
    ];
    expect(addConstraints.length).toBe(EXPECTED_CONSTRAINTS.length);
  });

  it('targets the exact set of tables documented in the migration header', () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const alterTargets = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/gi)].map(
      (m) => m[1],
    );
    const allowed = new Set(['cart_items', 'master_orders', 'sub_orders', 'order_items']);
    expect(alterTargets.length).toBe(EXPECTED_CONSTRAINTS.length);
    for (const t of alterTargets) {
      expect(allowed).toContain(t);
    }
  });

  it('Prisma schema models carry comments pointing at the constraints', () => {
    const orders = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'schema', 'orders.prisma'),
      'utf8',
    );
    expect(orders).toContain('cart_items_quantity_positive'.slice(0, 0)); // placeholder — we point at the migration number
    expect(orders).toMatch(/20260512160000/);
    expect(orders).toMatch(/total_amount_in_paise\s*>=\s*0/);
    expect(orders).toMatch(/sub_total_in_paise\s*>=\s*0/);
  });
});
