import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 2 (PR 2.3) — recon + payment-mismatch schema regression guard.
 *
 * Six paise columns moved from INTEGER to BIGINT:
 *
 *   reconciliation_runs:
 *     - expected_amount_in_paise
 *     - matched_amount_in_paise
 *
 *   reconciliation_discrepancies:
 *     - expected_in_paise
 *     - actual_in_paise
 *
 *   payment_mismatch_alerts:
 *     - expected_in_paise
 *     - actual_in_paise
 *
 * The schema-as-source-of-truth contract: Prisma model files contain
 * the `BigInt` declaration, migration SQL contains the matching
 * `ALTER COLUMN ... TYPE BIGINT`. Reading the files via fs keeps this
 * regression check in the unit-test tier — no DB required.
 *
 * Why the guard matters: the reconciliation service used to clamp
 * bigint sums down to INT range before writing, which silently lied
 * about daily GMV when totals crossed ₹21M. Phase 2 removed the
 * clamp + widened the column; reverting either side would re-introduce
 * the silent-overflow bug.
 */

const SCHEMA_BASE = join(__dirname, '..', '..', 'prisma', 'schema');

describe('Reconciliation + PaymentMismatch schema — BigInt invariant (PR 2.3)', () => {
  describe('Prisma model files', () => {
    const expectedDeclarations: Array<{ file: string; pattern: RegExp }> = [
      { file: 'reconciliation.prisma', pattern: /expectedAmountInPaise\s+BigInt\b/ },
      { file: 'reconciliation.prisma', pattern: /matchedAmountInPaise\s+BigInt\b/ },
      { file: 'reconciliation.prisma', pattern: /expectedInPaise\s+BigInt\?\s+@map\("expected_in_paise"\)/ },
      { file: 'reconciliation.prisma', pattern: /actualInPaise\s+BigInt\?\s+@map\("actual_in_paise"\)/ },
      { file: 'payments.prisma', pattern: /expectedInPaise\s+BigInt\?\s+@map\("expected_in_paise"\)/ },
      { file: 'payments.prisma', pattern: /actualInPaise\s+BigInt\?\s+@map\("actual_in_paise"\)/ },
    ];

    it.each(expectedDeclarations)(
      'schema/$file matches $pattern',
      ({ file, pattern }) => {
        const source = readFileSync(join(SCHEMA_BASE, file), 'utf8');
        expect(source).toMatch(pattern);
      },
    );

    it('no leftover Int declarations on the migrated columns', () => {
      // A regression that flipped any of the columns back to Int would
      // be a silent data-truncation bug.
      const recon = readFileSync(join(SCHEMA_BASE, 'reconciliation.prisma'), 'utf8');
      const payments = readFileSync(join(SCHEMA_BASE, 'payments.prisma'), 'utf8');
      expect(recon).not.toMatch(/expectedAmountInPaise\s+Int\b/);
      expect(recon).not.toMatch(/matchedAmountInPaise\s+Int\b/);
      expect(recon).not.toMatch(/expectedInPaise\s+Int\b/);
      expect(recon).not.toMatch(/actualInPaise\s+Int\b/);
      expect(payments).not.toMatch(/expectedInPaise\s+Int\b/);
      expect(payments).not.toMatch(/actualInPaise\s+Int\b/);
    });
  });

  describe('Migration SQL', () => {
    const migrationPath = join(
      SCHEMA_BASE,
      'migrations',
      '20260512140000_recon_payment_int_to_bigint',
      'migration.sql',
    );

    it('widens the two reconciliation_runs aggregate columns', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/"reconciliation_runs"[\s\S]*"expected_amount_in_paise"\s+TYPE\s+BIGINT/i);
      expect(sql).toMatch(/"reconciliation_runs"[\s\S]*"matched_amount_in_paise"\s+TYPE\s+BIGINT/i);
    });

    it('widens the two reconciliation_discrepancies money columns', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/"reconciliation_discrepancies"[\s\S]*"expected_in_paise"\s+TYPE\s+BIGINT/i);
      expect(sql).toMatch(/"reconciliation_discrepancies"[\s\S]*"actual_in_paise"\s+TYPE\s+BIGINT/i);
    });

    it('widens the two payment_mismatch_alerts money columns', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/"payment_mismatch_alerts"[\s\S]*"expected_in_paise"\s+TYPE\s+BIGINT/i);
      expect(sql).toMatch(/"payment_mismatch_alerts"[\s\S]*"actual_in_paise"\s+TYPE\s+BIGINT/i);
    });

    it('uses TYPE BIGINT (not TYPE INTEGER or downgrade) on every ALTER', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      const alterTypes = [...sql.matchAll(/ALTER\s+COLUMN\s+"[^"]+"\s+TYPE\s+(\w+)/gi)];
      expect(alterTypes.length).toBeGreaterThanOrEqual(6);
      for (const m of alterTypes) {
        expect(m[1].toUpperCase()).toBe('BIGINT');
      }
    });
  });
});
