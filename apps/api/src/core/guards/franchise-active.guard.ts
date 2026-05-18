import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenAppException } from '../exceptions';

/**
 * Gate-keeper for business-action routes that require an ACTIVE
 * franchise account. Sits AFTER `FranchiseAuthGuard` in the
 * `@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)` chain — it
 * reads `request.franchiseStatus` which the auth guard populates.
 *
 * Background: franchise login deliberately lets PENDING partners in
 * so they can complete their profile + KYC submission. But once
 * inside, PENDING partners must not be able to take any business
 * action (POS sales, procurement, catalog edits, order acceptance,
 * payout requests). This guard is the single chokepoint that
 * enforces that — apply it to every "do real work" controller. Skip
 * it on profile-completion + change-password + logout routes (those
 * are explicitly the things a PENDING partner needs to do).
 */
@Injectable()
export class FranchiseActiveGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const status = request.franchiseStatus;

    if (status === 'ACTIVE') return true;

    if (status === 'PENDING_APPROVAL' || status === 'PENDING') {
      throw new ForbiddenAppException(
        'Your franchise account is pending approval. Complete your profile and wait for the admin team to activate it before performing this action.',
      );
    }
    if (status === 'INACTIVE') {
      throw new ForbiddenAppException(
        'Your franchise account is inactive. Contact support to re-activate.',
      );
    }
    // SUSPENDED / DEACTIVATED never reach this guard because the auth
    // guard already rejects them, but be explicit about the fall-through.
    throw new ForbiddenAppException(
      `Franchise account status "${status}" is not authorized for this action`,
    );
  }
}
