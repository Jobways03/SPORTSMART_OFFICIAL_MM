import { Injectable } from '@nestjs/common';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Authoritative state machine for the Seller.status lifecycle.
 *
 * Historically the transitions lived inline as a const in
 * admin-update-seller-status.use-case.ts. That worked, but any
 * future code path that wants to mutate a seller's status would have
 * had to re-derive or re-inline the rules. Centralising here so the
 * state machine is testable in isolation and there is exactly one
 * place to change when product policy shifts.
 *
 * Terminal-ish state: DEACTIVATED. We allow DEACTIVATED → ACTIVE so
 * an ops mistake can be reversed, but no other inbound edge.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  PENDING_APPROVAL: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED', 'DEACTIVATED'],
  INACTIVE: ['ACTIVE', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

@Injectable()
export class SellerStatusTransitionPolicy {
  canTransition(from: string, to: string): boolean {
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  assertTransition(from: string, to: string): void {
    if (from === to) {
      throw new BadRequestAppException(`Seller is already ${to}`);
    }
    if (!this.canTransition(from, to)) {
      const allowed = ALLOWED_TRANSITIONS[from] ?? [];
      throw new BadRequestAppException(
        `Invalid status transition: ${from} → ${to}. Allowed: ${allowed.join(', ') || '(none)'}`,
      );
    }
  }

  allowedFrom(from: string): readonly string[] {
    return ALLOWED_TRANSITIONS[from] ?? [];
  }
}
