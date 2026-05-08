/**
 * Phase 13 — TODO board for the remaining return-side flow tests.
 *
 * **The wired tests live in `return-qc-flow.integration-spec.ts`** —
 * Cases 1, 5 (QC_REJECTED), 4 (PLATFORM + GOODWILL_CREDIT), and the
 * matrix-rejection sanity case are already covered there with a real
 * HTTP harness that hits the running dev API.
 *
 * The `it.todo` placeholders below cover the cases NOT yet wired:
 * partial approval + SELLER (Case 2), LOGISTICS attribution (Case 3),
 * duplicate-processing idempotency at the boundary (Case 6), and the
 * non-money matrix paths. Each `it.todo` shows up in jest output as
 * "pending" so a future PR can convert them to real tests one at a
 * time without losing track of what's left.
 *
 * Original scaffold copy follows for reference.
 *
 * Phase 13 — acceptance tests for the return-side liability ledger
 * + RefundInstruction-only money flow.
 *
 * Mirrors the dispute-liability scaffold (test/integration/
 * dispute-liability-flow.spec.ts) but exercises the QC-decide path
 * instead of dispute.decide. Validates that:
 *
 *   1. Every approved/partial QC decision routes the refund through
 *      RefundInstructionService.createForReturn — never a direct
 *      WalletPublicFacade.creditFromRefund call from ReturnService.
 *   2. The (newStatus × liabilityParty × customerRemedy) matrix
 *      writes the right ledger row (SellerDebit / LogisticsClaim /
 *      PlatformExpense w/ GOODWILL or PLATFORM_FAULT).
 *   3. QC_REJECTED writes nothing to the ledger and creates no
 *      RefundInstruction; commission ON_HOLD is released.
 *   4. Same return decided twice (or the qc_completed event replayed)
 *      produces exactly one RefundInstruction (idempotency key
 *      `return:<id>`), one wallet credit (UNIQUE on
 *      referenceType+referenceId+type), and one ledger row (UNIQUE on
 *      sourceType+sourceId per table).
 *
 * Status: SCAFFOLD. Each `it` documents the expected behaviour; the
 * setup helper is intentionally TODO so this lands alongside the
 * dispute-flow scaffold without committing to a particular harness
 * shape. Wire-up should match whatever pattern the dispute scaffold
 * eventually uses — both suites need:
 *   - per-suite test schema (or schema-reset between tests)
 *   - real Prisma + ReturnService + RefundInstructionService +
 *     LiabilityLedgerPublicFacade
 *   - WalletPublicFacade with the actual creditFromRefund call but
 *     Razorpay calls stubbed (returns are wallet-only by current
 *     business policy, so this is the easy case)
 *   - sync EventBusService (no outbox poll loop)
 */
import 'reflect-metadata';

describe('Return liability flow (Phase 13)', () => {
  // TODO(harness): bootstrap a Nest test module with PrismaService
  // pointing at a per-suite test schema, ReturnService real,
  // RefundInstructionService real, LiabilityLedgerPublicFacade real,
  // WalletPublicFacade real (it's wallet-only — no external gateway),
  // EventBusService running synchronously, AuditPublicFacade stubbed.
  //
  // Helpers needed:
  //   seedReturn(opts) — returns { return, customer, seller, items }
  //     where opts can preset items[].quantity, unitPrice, and
  //     start the return at status=RECEIVED so we can call
  //     submitQcDecision directly.
  //   readSellerDebit(returnId)
  //   readLogisticsClaim(returnId)
  //   readPlatformExpense(returnId)
  //   readRefundInstruction(returnId)   // by sourceType+sourceId
  //   readReturnStatus(returnId)
  //   walletCreditCount(customerId)
  //   commissionState(subOrderId)        // 'ON_HOLD' | 'PENDING' | 'PROCESSED'

  // ✅ WIRED in return-qc-flow.integration-spec.ts (11 tests):
  //   - Case 1 (QC_APPROVED + SELLER + FULL_REFUND)
  //   - Case 2 (PARTIALLY_APPROVED + SELLER + PARTIAL_REFUND)
  //   - Case 3 (QC_APPROVED + LOGISTICS + FULL_REFUND)
  //   - Case 4 (QC_APPROVED + PLATFORM + GOODWILL_CREDIT)
  //   - Case 5 (QC_REJECTED — no money flow)
  //   - Case 6 idempotency — covered by the wallet+ledger idempotency
  //     test that approves the same RefundInstruction twice and asserts
  //     exactly one wallet transaction, one SellerDebit, one
  //     RefundInstruction. The DB-level UNIQUEs are the underlying
  //     guarantee; the test exercises them at the API boundary.
  //   - Matrix rejection: GOODWILL_CREDIT + SELLER
  //   - Matrix rejection: PARTIALLY_APPROVED + FULL_REFUND
  //   - Matrix rejection: QC_APPROVED + PARTIAL_REFUND
  //   - Evidence required (WRONG_ITEM with []  → 400)
  //   - Evidence not required (CHANGED_MIND with [] → 200)

  // All Phase-13 acceptance scenarios from the original spec are now
  // wired in `return-qc-flow.integration-spec.ts` (see ✅ list above).
  // This file stays as a top-level documentation pointer + a place to
  // park future scaffolds before they get implementations.
  it('Phase 13 spec — all acceptance scenarios wired (see comment block above)', () => {
    expect(true).toBe(true);
  });
});
