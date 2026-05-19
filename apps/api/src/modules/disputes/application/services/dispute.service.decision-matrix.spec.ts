/**
 * Follow-up #C12 — behavioural coverage for `validateDecisionMatrix`.
 *
 * The audit flagged the disputes module as critically thin on tests
 * (one spec covering only ref-normalization helpers). The decision
 * matrix is the highest-stakes branch in the module: it enforces the
 * outcome × customerRemedy × liabilityParty invariants that determine
 * who pays for a contested order and what the customer receives. A
 * regression here can mis-route refund liability between platform /
 * seller / logistics — real money, real Section-194O / GST impact.
 *
 * The method is private; we exercise it via a type-cast escape hatch
 * (`as any`) and pass minimal stubbed deps because the matrix logic
 * touches none of them.
 */
import 'reflect-metadata';
import { DisputeService, type DecisionArgs } from './dispute.service';
import { BadRequestAppException } from '../../../../core/exceptions';

type Outcome = DecisionArgs['outcome'];
type Liability = DecisionArgs['liabilityParty'];
type Remedy = DecisionArgs['customerRemedy'];

function build(
  outcome: Outcome,
  remedy: Remedy,
  liability: Liability,
  amountInPaise?: number,
): DecisionArgs {
  return {
    disputeId: 'd-1',
    adminId: 'a-1',
    rationale: 'test',
    outcome,
    customerRemedy: remedy,
    liabilityParty: liability,
    amountInPaise,
  };
}

function makeService(): DisputeService {
  // validateDecisionMatrix is pure (no field reads) so all six deps
  // can be stubbed with null. If the method ever grows a dependency,
  // this constructor call will fail loudly at test boot.
  return new DisputeService(
    null as never, // prisma
    null as never, // eventBus
    null as never, // audit
    null as never, // caseDuplicates
    null as never, // refundInstruction
    null as never, // ledger
  );
}

const callValidate = (svc: DisputeService, args: DecisionArgs) =>
  (svc as unknown as { validateDecisionMatrix: (a: DecisionArgs) => number | null })
    .validateDecisionMatrix(args);

describe('DisputeService.validateDecisionMatrix (Follow-up C12)', () => {
  const svc = makeService();

  describe('outcome ↔ remedy compatibility', () => {
    it('accepts RESOLVED_BUYER + FULL_REFUND', () => {
      const out = callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', 50000));
      expect(out).toBe(50000);
    });

    it('accepts RESOLVED_BUYER + GOODWILL_CREDIT (PLATFORM liability)', () => {
      const out = callValidate(svc, build('RESOLVED_BUYER', 'GOODWILL_CREDIT', 'PLATFORM', 12500));
      expect(out).toBe(12500);
    });

    it('accepts RESOLVED_SPLIT + PARTIAL_REFUND', () => {
      const out = callValidate(svc, build('RESOLVED_SPLIT', 'PARTIAL_REFUND', 'LOGISTICS', 30000));
      expect(out).toBe(30000);
    });

    it('accepts RESOLVED_SELLER + NO_REFUND', () => {
      const out = callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'CUSTOMER'));
      expect(out).toBeNull();
    });

    it('rejects RESOLVED_BUYER + NO_REFUND (resolving in buyer favour requires a refund)', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'NO_REFUND', 'CUSTOMER')),
      ).toThrow(BadRequestAppException);
    });

    it('rejects RESOLVED_SELLER + FULL_REFUND (deciding for seller cannot pay the buyer back)', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SELLER', 'FULL_REFUND', 'SELLER', 50000)),
      ).toThrow(BadRequestAppException);
    });

    it('rejects RESOLVED_SPLIT + FULL_REFUND (split implies partial)', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SPLIT', 'FULL_REFUND', 'SELLER', 50000)),
      ).toThrow(BadRequestAppException);
    });
  });

  describe('liability ↔ remedy compatibility', () => {
    it('NO_REFUND requires CUSTOMER or NONE liability — accepts CUSTOMER', () => {
      const out = callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'CUSTOMER'));
      expect(out).toBeNull();
    });

    it('NO_REFUND requires CUSTOMER or NONE liability — accepts NONE', () => {
      const out = callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'NONE'));
      expect(out).toBeNull();
    });

    it('NO_REFUND rejects SELLER liability', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'SELLER')),
      ).toThrow(BadRequestAppException);
    });

    it('GOODWILL_CREDIT requires PLATFORM liability', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'GOODWILL_CREDIT', 'SELLER', 5000)),
      ).toThrow(BadRequestAppException);
    });

    it('FULL_REFUND with CUSTOMER liability is rejected', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'CUSTOMER', 50000)),
      ).toThrow(BadRequestAppException);
    });

    it('PARTIAL_REFUND with NONE liability is rejected', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SPLIT', 'PARTIAL_REFUND', 'NONE', 25000)),
      ).toThrow(BadRequestAppException);
    });

    it('FULL_REFUND accepts SELLER, LOGISTICS, or PLATFORM liability', () => {
      expect(callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', 1))).toBe(1);
      expect(callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'LOGISTICS', 1))).toBe(1);
      expect(callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'PLATFORM', 1))).toBe(1);
    });
  });

  describe('amount validation', () => {
    it('NO_REFUND with amountInPaise > 0 is rejected (the matrix bans paying anything)', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'CUSTOMER', 100)),
      ).toThrow(BadRequestAppException);
    });

    it('NO_REFUND with amountInPaise omitted returns null', () => {
      expect(callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'CUSTOMER'))).toBeNull();
    });

    it('NO_REFUND with amountInPaise=0 returns null (treated as omitted)', () => {
      expect(
        callValidate(svc, build('RESOLVED_SELLER', 'NO_REFUND', 'CUSTOMER', 0)),
      ).toBeNull();
    });

    it('FULL_REFUND requires a positive integer paise amount', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER')),
      ).toThrow(BadRequestAppException);
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', 0)),
      ).toThrow(BadRequestAppException);
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', -100)),
      ).toThrow(BadRequestAppException);
    });

    it('PARTIAL_REFUND requires a positive integer paise amount', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_SPLIT', 'PARTIAL_REFUND', 'SELLER')),
      ).toThrow(BadRequestAppException);
    });

    it('GOODWILL_CREDIT requires a positive integer paise amount', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'GOODWILL_CREDIT', 'PLATFORM')),
      ).toThrow(BadRequestAppException);
    });

    it('non-integer paise (3.5) is rejected — paise must be a whole-number unit', () => {
      expect(() =>
        callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', 3.5)),
      ).toThrow(BadRequestAppException);
    });

    it('integer 1 paise (smallest valid refund) is accepted', () => {
      expect(callValidate(svc, build('RESOLVED_BUYER', 'FULL_REFUND', 'SELLER', 1))).toBe(1);
    });
  });
});

describe('DisputeService.setSeverity range guard (Follow-up C12)', () => {
  // The severity bound is the only synchronous check in setSeverity
  // before it hits the DB; the DB call is mocked away so we exercise
  // just the guard. Note we don't await the success path beyond the
  // throw assertion since the mocked prisma.update returns undefined.
  const svc = makeService();

  it('rejects severity < 1', async () => {
    await expect(svc.setSeverity('d-1', 0)).rejects.toThrow(/severity must be 1-100/i);
    await expect(svc.setSeverity('d-1', -5)).rejects.toThrow(/severity must be 1-100/i);
  });

  it('rejects severity > 100', async () => {
    await expect(svc.setSeverity('d-1', 101)).rejects.toThrow(/severity must be 1-100/i);
    await expect(svc.setSeverity('d-1', 999)).rejects.toThrow(/severity must be 1-100/i);
  });
});
