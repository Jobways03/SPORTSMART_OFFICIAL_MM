import { SetMetadata } from '@nestjs/common';

export const POLICY_METADATA = 'policy:descriptor';

export type PolicyContextSource =
  | 'body'
  | 'params'
  | 'query'
  | 'headers';

export interface PolicyDescriptor {
  resourceType: string;
  action: string;
  /**
   * Per-key context-extraction map. Each key in `context` corresponds to
   * a key the matcher will see when evaluating ResourcePolicy.conditions.
   * Each value is a `<source>.<path>` lookup, e.g. `body.amountInPaise`,
   * `params.returnId`, `body.refundMethod`, `query.tier`.
   *
   * The PolicyEvaluator builds a flat object `{ amountInPaise: 1500000,
   * returnId: 'r_xyz' }` and feeds it to the condition matcher. Routes
   * that need *no* condition lookup (purely role-gated policies) can
   * omit `context`.
   */
  context?: Record<string, `${PolicyContextSource}.${string}`>;
}

/**
 * Marks a route as requiring an ABAC evaluation. Layered on top of
 * @Permissions; @Policy fires only after permissions pass. See ADR-010.
 */
export const Policy = (descriptor: PolicyDescriptor) =>
  SetMetadata(POLICY_METADATA, descriptor);
