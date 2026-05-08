/**
 * Phase 12 (post-Phase-11) — acceptance tests for the dispute liability
 * + RefundInstruction-only money flow per ADR-016.
 *
 * Scope: validates the matrix at the DisputeService boundary AND that
 * downstream side-effects (RefundInstruction, ledger row, linked-return
 * status) match the matrix. Does NOT exercise the saga's wallet-credit
 * step end-to-end — that's covered by the existing wallet-credit
 * integration tests; here we only assert the RefundInstruction was
 * enqueued with the right shape.
 *
 * Status: SCAFFOLD. Each `it` documents the expected behaviour; the
 * setup helper is left as a TODO so the harness can be wired against
 * the project's preferred test DB strategy (the current integration
 * layout uses fixtures + a per-suite Postgres schema). Once the harness
 * lands these tests cover all 6 cases from the spec the user
 * provided on 2026-05-07 verbatim.
 */
import 'reflect-metadata';

describe('Dispute liability flow (ADR-016)', () => {
  // TODO(harness): bootstrap a Nest test module with PrismaService
  // pointing at a per-suite test schema, RefundInstructionService with
  // the saga's wallet step stubbed (to avoid Razorpay calls in CI),
  // LiabilityLedgerPublicFacade real, EventBusService real (sync),
  // and AuditPublicFacade stubbed.
  //
  // Helpers needed:
  //   seedDispute(opts) — returns { dispute, customer, seller, return? }
  //   readSellerDebit(disputeId)
  //   readLogisticsClaim(disputeId)
  //   readPlatformExpense(disputeId)
  //   readRefundInstruction(disputeId)
  //   readReturnStatus(returnId)
  //   walletCreditCount(customerId)  // direct WalletPublicFacade call count

  it.todo(
    'Case 1 — buyer-favoured + SELLER liability creates RefundInstruction (full) + SellerDebit; no direct wallet call from DisputeService; linked return becomes DISPUTE_OVERTURNED',
  );

  it.todo(
    'Case 2 — partial refund + SELLER liability creates RefundInstruction (partial) + SellerDebit (partial); linked return becomes DISPUTE_PARTIAL_OVERRIDE',
  );

  it.todo(
    'Case 3 — buyer-favoured + LOGISTICS liability creates RefundInstruction + LogisticsClaim; no SellerDebit',
  );

  it.todo(
    'Case 4 — goodwill (RESOLVED_BUYER + GOODWILL_CREDIT + PLATFORM) creates RefundInstruction + PlatformExpense (expenseType=GOODWILL); no SellerDebit, no LogisticsClaim; linked return becomes GOODWILL_CREDITED',
  );

  it.todo(
    'Case 5 — seller-favoured / customer fault (NO_REFUND + CUSTOMER) creates no RefundInstruction, makes no wallet credit, releases commission if ON_HOLD; linked return becomes DISPUTE_CONFIRMED',
  );

  it.todo(
    'Case 6 — duplicate processing: same dispute decided twice (or the disputes.decided event replayed) results in exactly one RefundInstruction (idempotency key dispute:<id>), one wallet credit (WalletTransaction unique on referenceType/referenceId/type), and one ledger row (sourceType+sourceId UNIQUE on each ledger table)',
  );

  describe('Matrix validation (rejects illegal combinations)', () => {
    it.todo('rejects RESOLVED_BUYER + NO_REFUND');
    it.todo('rejects RESOLVED_SPLIT + FULL_REFUND');
    it.todo('rejects RESOLVED_SELLER + FULL_REFUND');
    it.todo('rejects FULL_REFUND with liabilityParty CUSTOMER');
    it.todo('rejects FULL_REFUND with liabilityParty NONE');
    it.todo('rejects GOODWILL_CREDIT with liabilityParty SELLER');
    it.todo('rejects NO_REFUND with positive amountInPaise');
    it.todo('rejects FULL_REFUND with missing amountInPaise');
  });

  describe('Failure handling', () => {
    it.todo(
      'when RefundInstruction creation fails, dispute decision still commits + AdminTask(REFUND_INSTRUCTION_FAILED) is enqueued',
    );
    it.todo(
      'when liability ledger write fails, dispute decision still commits + AdminTask(OTHER) is enqueued',
    );
    it.todo(
      'when linked-return FSM rejects the override transition, dispute decision still commits + warning is logged',
    );
  });
});
