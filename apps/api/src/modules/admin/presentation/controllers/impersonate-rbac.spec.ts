// Regression: impersonation must be PERMISSION-gated, not primary-role-gated.
//
// Functional seller-type admins (the d2c / retail / franchise admin portals)
// use primary role STAFF + a custom role for their permissions. The RolesGuard
// only inspects the primary role, so a method-level
// @Roles('SUPER_ADMIN','SELLER_ADMIN') on the impersonate endpoints 403'd them
// ("Forbidden resource") even when their custom role granted *.approve. The
// gate is now the *.approve permission (effective = primary ∪ custom) + step-up.
// These tests assert @Roles is gone and the approve permission remains, so a
// future change that re-adds the role allowlist fails here.

import 'reflect-metadata';
import { ROLES_KEY } from '../../../../core/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../../../core/decorators/permissions.decorator';
import { AdminSellersController } from './admin-sellers.controller';
import { AdminFranchiseController } from '../../../franchise/presentation/controllers/admin-franchise.controller';

const roles = (fn: any) => Reflect.getMetadata(ROLES_KEY, fn);
const perms = (fn: any) => Reflect.getMetadata(PERMISSIONS_KEY, fn);

describe('Impersonation endpoints — permission-gated, not role-gated', () => {
  describe('seller impersonate (d2c / retail admins go through this)', () => {
    it('has NO @Roles allowlist', () => {
      expect(roles(AdminSellersController.prototype.impersonate)).toBeUndefined();
      expect(roles(AdminSellersController.prototype.endImpersonation)).toBeUndefined();
    });
    it('still requires the sellers.approve permission', () => {
      expect(perms(AdminSellersController.prototype.impersonate)).toContain('sellers.approve');
      expect(perms(AdminSellersController.prototype.endImpersonation)).toContain('sellers.approve');
    });
  });

  describe('franchise impersonate', () => {
    it('has NO @Roles allowlist', () => {
      expect(roles(AdminFranchiseController.prototype.impersonate)).toBeUndefined();
      expect(roles(AdminFranchiseController.prototype.endImpersonation)).toBeUndefined();
    });
    it('still requires the franchise.approve permission', () => {
      expect(perms(AdminFranchiseController.prototype.impersonate)).toContain('franchise.approve');
      expect(perms(AdminFranchiseController.prototype.endImpersonation)).toContain('franchise.approve');
    });
  });

  it('the delete endpoints KEEP their @Roles gate (not touched by this fix)', () => {
    // Guard against accidentally stripping @Roles project-wide.
    expect(roles(AdminSellersController.prototype.deleteSeller)).toContain('SUPER_ADMIN');
  });
});
