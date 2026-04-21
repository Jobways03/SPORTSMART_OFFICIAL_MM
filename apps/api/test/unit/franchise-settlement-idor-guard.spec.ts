import 'reflect-metadata';
import { FranchiseEarningsController } from '../../src/modules/franchise/presentation/controllers/franchise-earnings.controller';
import { NotFoundAppException } from '../../src/core/exceptions';

/**
 * Regression test for the settlement-detail IDOR.
 *
 * Before: GET /franchise/earnings/settlements/:id forwarded the id to
 * FranchiseSettlementService.getSettlementDetail(id) without checking
 * that the returned settlement's franchiseId matched the caller's.
 * FranchiseAuthGuard verified the JWT but the controller never asked
 * "is this row yours?", so any franchise could read any other
 * franchise's settlement (including netPayableToFranchise and the
 * full ledger breakdown) just by guessing or iterating UUIDs.
 *
 * After: the controller reads `req.franchiseId` and throws
 * NotFoundAppException (not Forbidden — don't leak existence) when it
 * doesn't match the returned record's franchiseId. The list endpoint
 * was always safe because the service query filters by franchiseId.
 */

describe('FranchiseEarningsController.getSettlementDetail — ownership guard', () => {
  const buildCtrl = (settlement: any) => {
    const commissionService: any = {};
    const settlementService: any = {
      getSettlementDetail: jest.fn().mockResolvedValue(settlement),
    };
    const ctrl = new FranchiseEarningsController(
      commissionService,
      settlementService,
    );
    return { ctrl, settlementService };
  };

  const makeReq = (franchiseId: string) => ({ franchiseId }) as any;

  it('returns the settlement when the caller owns it', async () => {
    const settlement = {
      id: 'settle-1',
      franchiseId: 'fr-A',
      netPayableToFranchise: 10000,
    };
    const { ctrl } = buildCtrl(settlement);

    const res = await ctrl.getSettlementDetail(makeReq('fr-A'), 'settle-1');
    expect(res.success).toBe(true);
    expect(res.data).toBe(settlement);
  });

  it('throws NotFound (not Forbidden) when the settlement belongs to another franchise', async () => {
    const settlement = {
      id: 'settle-1',
      franchiseId: 'fr-VICTIM',
      netPayableToFranchise: 10000,
    };
    const { ctrl } = buildCtrl(settlement);

    await expect(
      ctrl.getSettlementDetail(makeReq('fr-ATTACKER'), 'settle-1'),
    ).rejects.toThrow(NotFoundAppException);
  });

  it('throws NotFound when the service returns null', async () => {
    const { ctrl } = buildCtrl(null);
    await expect(
      ctrl.getSettlementDetail(makeReq('fr-A'), 'nope'),
    ).rejects.toThrow(NotFoundAppException);
  });

  it('does not leak the settlement even in the error path', async () => {
    // The NotFound error message must not echo the target settlement's
    // id or franchise, otherwise an attacker learns which ids exist.
    const settlement = {
      id: 'settle-1',
      franchiseId: 'fr-VICTIM',
    };
    const { ctrl } = buildCtrl(settlement);

    try {
      await ctrl.getSettlementDetail(makeReq('fr-ATTACKER'), 'settle-1');
      fail('expected throw');
    } catch (err: any) {
      expect(err.message).not.toMatch(/fr-VICTIM/);
      expect(err.message).not.toMatch(/settle-1/);
    }
  });
});
