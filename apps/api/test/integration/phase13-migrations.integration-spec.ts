/**
 * Phase 13 — schema-assertion integration tests for migrations
 * 20260507200000…20260507600000.
 *
 * Each test asserts the DB shape directly via `information_schema`
 * (columns + types) and `pg_constraint` / `pg_indexes` (uniques +
 * indexes) so a drift between code-under-test and the deployed
 * schema fails CI immediately. These tests are the cheap mirror of
 * the heavy "run a real flow" integration tests — they validate
 * the migration ran AND covers what we believe.
 *
 * Run with `pnpm test:e2e` (the e2e jest config picks up
 * `*.integration-spec.ts`). They connect to whatever DATABASE_URL
 * is set in the environment, so point them at a fresh test schema,
 * not prod.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';

describe('Phase 13 — migration shape assertions', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL not set — integration suite needs a live Postgres connection',
      );
    }
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function columnExists(
    table: string,
    column: string,
  ): Promise<{ data_type: string } | undefined> {
    const rows = await prisma.$queryRawUnsafe<{ data_type: string }[]>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      table,
      column,
    );
    return rows[0];
  }

  async function indexExists(
    table: string,
    indexName: string,
  ): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = $1 AND indexname = $2`,
      table,
      indexName,
    );
    return rows.length > 0;
  }

  async function enumValues(typeName: string): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT unnest(enum_range(NULL::"${typeName}"))::text AS v`,
    );
    return rows.map((r) => r.v);
  }

  /**
   * Looks for a UNIQUE artefact (constraint OR unique index — Prisma
   * generates the latter via @@unique) on `table` whose definition
   * mentions every column in `columns`. Returns true if at least
   * one such artefact exists.
   */
  async function hasUniqueOver(
    table: string,
    columns: string[],
  ): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = $1 AND indexdef ILIKE '%UNIQUE%'`,
      table,
    );
    return rows.some((r) =>
      columns.every((c) => r.indexdef.toLowerCase().includes(c)),
    );
  }

  // ─── 20260507200000 — return liability attribution ───────────────

  describe('20260507200000_return_liability_attribution', () => {
    it.each([
      ['liability_party', 'USER-DEFINED'], // Postgres reports enum types as USER-DEFINED
      ['customer_remedy', 'USER-DEFINED'],
      ['qc_rationale', 'text'],
      ['qc_internal_notes', 'text'],
      ['qc_courier_name', 'text'],
      ['qc_awb_number', 'text'],
    ])('returns.%s exists with type %s', async (column, expectedType) => {
      const c = await columnExists('returns', column);
      expect(c).toBeDefined();
      expect(c!.data_type).toBe(expectedType);
    });

    it('returns has indexes on liability_party and customer_remedy', async () => {
      expect(await indexExists('returns', 'returns_liability_party_idx')).toBe(
        true,
      );
      expect(await indexExists('returns', 'returns_customer_remedy_idx')).toBe(
        true,
      );
    });
  });

  // ─── 20260507300000 — seller response lifecycle ──────────────────

  describe('20260507300000_return_seller_response_lifecycle', () => {
    it.each([
      'seller_response_status',
      'seller_notified_at',
      'seller_response_due_at',
      'seller_responded_at',
      'seller_response_notes',
    ])('returns.%s exists', async (column) => {
      const c = await columnExists('returns', column);
      expect(c).toBeDefined();
    });

    it('SellerResponseStatus enum has the expected values', async () => {
      const values = (await enumValues('SellerResponseStatus')).sort();
      expect(values).toEqual(
        ['ACCEPTED', 'CONTESTED', 'EXPIRED', 'NOT_REQUIRED', 'PENDING'].sort(),
      );
    });

    it('returns has the seller-response composite index for cron sweep', async () => {
      expect(
        await indexExists('returns', 'returns_seller_response_status_due_at_idx'),
      ).toBe(true);
    });
  });

  // ─── 20260507400000 — risk scoring ───────────────────────────────

  describe('20260507400000_return_risk_scoring', () => {
    it.each([
      ['risk_score', 'integer'],
      ['risk_flags', 'jsonb'],
      ['risk_scored_at', 'timestamp without time zone'],
    ])('returns.%s exists with type %s', async (column, expectedType) => {
      const c = await columnExists('returns', column);
      expect(c).toBeDefined();
      expect(c!.data_type).toBe(expectedType);
    });
  });

  // ─── 20260507500000 — replacement / exchange ─────────────────────

  describe('20260507500000_return_replacement_exchange', () => {
    it.each([
      'replacement_status',
      'replacement_order_id',
      'exchange_order_id',
      'exchange_target_variant_id',
      'exchange_price_diff_paise',
    ])('returns.%s exists', async (column) => {
      const c = await columnExists('returns', column);
      expect(c).toBeDefined();
    });

    it('ReplacementRequestStatus enum has the expected values', async () => {
      const values = (await enumValues('ReplacementRequestStatus')).sort();
      expect(values).toEqual(
        [
          'AWAITING_FULFILMENT',
          'AWAITING_PAYMENT',
          'CANCELLED',
          'FALLBACK_TO_REFUND',
          'FULFILLED',
          'NONE',
          'PENDING_STOCK_CHECK',
        ].sort(),
      );
    });

    it('CustomerRemedy enum has REPLACEMENT and EXCHANGE values', async () => {
      const values = await enumValues('CustomerRemedy');
      expect(values).toContain('REPLACEMENT');
      expect(values).toContain('EXCHANGE');
    });
  });

  // ─── 20260507600000 — admin task return kinds ────────────────────

  describe('20260507600000_admin_task_return_kinds', () => {
    it('AdminTaskKind enum has RETURN_REFUND_FAILED + RETURN_LIABILITY_LEDGER_BACKFILL', async () => {
      const values = await enumValues('AdminTaskKind');
      expect(values).toContain('RETURN_REFUND_FAILED');
      expect(values).toContain('RETURN_LIABILITY_LEDGER_BACKFILL');
    });
  });

  // ─── Pre-Phase-13 invariants we depend on ─────────────────────────
  //
  // Not owned by Phase 13, but the wallet-idempotency unit test +
  // the saga's idempotency story BOTH lean on them. Asserting here
  // means a future migration that drops a unique can't ship without
  // flipping a red CI light.

  describe('upstream invariants (still required)', () => {
    it('wallet_transactions has UNIQUE (reference_type, reference_id, type)', async () => {
      const ok = await hasUniqueOver('wallet_transactions', [
        'reference_type',
        'reference_id',
        'type',
      ]);
      expect(ok).toBe(true);
    });

    it.each(['seller_debits', 'logistics_claims', 'platform_expenses'])(
      '%s has a UNIQUE over (source_type, source_id)',
      async (table) => {
        const ok = await hasUniqueOver(table, ['source_type', 'source_id']);
        expect(ok).toBe(true);
      },
    );
  });
});
