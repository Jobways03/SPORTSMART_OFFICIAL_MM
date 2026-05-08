import 'reflect-metadata';
import { CustomerReturnsController } from './customer-returns.controller';
import { SellerReturnsController } from './seller-returns.controller';
import { FranchiseReturnsController } from './franchise-returns.controller';
import {
  UserAuthGuard,
  SellerAuthGuard,
  FranchiseAuthGuard,
} from '../../../../core/guards';

/**
 * Phase 13 — class-level auth-guard configuration tests for the
 * non-admin return controllers.
 *
 * The admin returns controller uses RBAC permission slugs
 * (admin-returns.permissions.spec.ts covers those). The customer /
 * seller / franchise controllers don't use slug-based permissions —
 * the actor IS the resource owner. The risk we want to catch here:
 * "someone removed @UseGuards(...) at the class level and shipped
 * an unauthenticated controller". Reading Nest's GUARDS_METADATA
 * directly catches that deterministically without HTTP setup.
 *
 * Why one combined file: the three controllers share the same
 * structural assertion (one class-level guard binding). Splitting
 * into three files would be churn for no incremental safety.
 */

const GUARDS_METADATA_KEY = '__guards__';

function classGuards(target: any): any[] {
  return Reflect.getMetadata(GUARDS_METADATA_KEY, target) ?? [];
}

describe('Actor-scoped return controllers — class-level guards', () => {
  it('CustomerReturnsController is gated by UserAuthGuard', () => {
    const guards = classGuards(CustomerReturnsController);
    expect(guards).toContain(UserAuthGuard);
  });

  it('SellerReturnsController is gated by SellerAuthGuard', () => {
    const guards = classGuards(SellerReturnsController);
    expect(guards).toContain(SellerAuthGuard);
  });

  it('FranchiseReturnsController is gated by FranchiseAuthGuard', () => {
    const guards = classGuards(FranchiseReturnsController);
    expect(guards).toContain(FranchiseAuthGuard);
  });

  // Cross-check that the guards aren't accidentally cross-wired
  // (e.g. seller controller picking up UserAuthGuard via copy-paste).
  it('guards are not cross-wired across actor surfaces', () => {
    const customerGuards = classGuards(CustomerReturnsController);
    const sellerGuards = classGuards(SellerReturnsController);
    const franchiseGuards = classGuards(FranchiseReturnsController);

    expect(customerGuards).not.toContain(SellerAuthGuard);
    expect(customerGuards).not.toContain(FranchiseAuthGuard);
    expect(sellerGuards).not.toContain(UserAuthGuard);
    expect(sellerGuards).not.toContain(FranchiseAuthGuard);
    expect(franchiseGuards).not.toContain(UserAuthGuard);
    expect(franchiseGuards).not.toContain(SellerAuthGuard);
  });
});
