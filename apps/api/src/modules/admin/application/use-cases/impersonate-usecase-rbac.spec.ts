// Regression: the impersonate use-cases must NOT re-gate on primary role.
//
// They previously had a "defense-in-depth" check —
//   if (!['SUPER_ADMIN','SELLER_ADMIN'].includes(adminRole)) throw ...
// which 403'd functional seller-type admins (primary role STAFF + a custom
// role granting *.approve) with "You do not have permission to impersonate
// ...". Authorization is the controller's @Permissions('*.approve') gate; the
// role check here was redundant + wrong, so it's removed.
//
// These tests run execute() with adminRole='STAFF' and a non-existent target,
// and assert it proceeds PAST the (removed) role check to the not-found check —
// i.e. it throws "… not found", NOT "do not have permission". A re-added role
// check would throw the permission error first and fail these.

import { AdminImpersonateFranchiseUseCase } from '../../../franchise/application/use-cases/admin-impersonate-franchise.use-case';
import { AdminImpersonateSellerUseCase } from './admin-impersonate-seller.use-case';

const logger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn() }) as any;

describe('Impersonate use-cases — no primary-role gate (permission-gated at controller)', () => {
  it('franchise: STAFF role passes the role layer (reaches "Franchise not found")', async () => {
    const uc = new AdminImpersonateFranchiseUseCase(
      { findById: jest.fn().mockResolvedValue(null) } as any, // franchiseRepo
      {} as any, // adminRepo
      {} as any, // envService
      logger(),
      {} as any, // audit
      {} as any, // eventBus
      {} as any, // redis
    );
    const p = uc.execute({ adminId: 'a1', adminRole: 'STAFF', franchiseId: 'f1' } as any);
    await expect(p).rejects.toThrow('Franchise not found');
    await expect(p).rejects.not.toThrow(/do not have permission/i);
  });

  it('seller: STAFF role passes the role layer (reaches "Seller not found")', async () => {
    const uc = new AdminImpersonateSellerUseCase(
      { findSellerByIdWithSelect: jest.fn().mockResolvedValue(null) } as any, // adminRepo
      {} as any, // envService
      {} as any, // auditService
      logger(),
      {} as any, // audit
      {} as any, // eventBus
      {} as any, // redis
    );
    const p = uc.execute({ adminId: 'a1', adminRole: 'STAFF', sellerId: 's1' } as any);
    await expect(p).rejects.toThrow('Seller not found');
    await expect(p).rejects.not.toThrow(/do not have permission/i);
  });
});
