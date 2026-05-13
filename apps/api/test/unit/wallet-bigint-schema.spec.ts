import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 2 (PR 2.2) — wallet schema regression guard.
 *
 * The three wallet money columns moved from INTEGER to BIGINT. The
 * application's TypeScript boundary code (PrismaWalletRepository) only
 * works correctly when the schema actually uses BigInt — if a future
 * migration silently flips one back to Int, the runtime would either
 * truncate large values or surface confusing Prisma type errors.
 *
 * This test reads the schema files directly so the regression is
 * caught at unit-test time, no DB required.
 */

const SCHEMA_BASE = join(__dirname, '..', '..', 'prisma', 'schema');

describe('Wallet schema — BigInt invariant (PR 2.2)', () => {
  it('wallets.balance_in_paise is declared BigInt (not Int)', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'wallet.prisma'), 'utf8');
    // The line must contain `balanceInPaise BigInt` somewhere; any
    // declaration with `Int ` (note the space) would catch a regression.
    expect(source).toMatch(/balanceInPaise\s+BigInt\b/);
    expect(source).not.toMatch(/balanceInPaise\s+Int\b/);
  });

  it('wallet_transactions.amount_in_paise is declared BigInt', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'wallet.prisma'), 'utf8');
    expect(source).toMatch(/amountInPaise\s+BigInt\b/);
    expect(source).not.toMatch(/amountInPaise\s+Int\b/);
  });

  it('wallet_transactions.balance_after_in_paise is declared BigInt', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'wallet.prisma'), 'utf8');
    expect(source).toMatch(/balanceAfterInPaise\s+BigInt\b/);
    expect(source).not.toMatch(/balanceAfterInPaise\s+Int\b/);
  });

  it('migration SQL widens all three columns to BIGINT', () => {
    const sql = readFileSync(
      join(
        SCHEMA_BASE,
        'migrations',
        '20260512130000_wallet_int_to_bigint',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/"balance_in_paise"\s+TYPE\s+BIGINT/i);
    expect(sql).toMatch(/"amount_in_paise"\s+TYPE\s+BIGINT/i);
    expect(sql).toMatch(/"balance_after_in_paise"\s+TYPE\s+BIGINT/i);
  });
});
