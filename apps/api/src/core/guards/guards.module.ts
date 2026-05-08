import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';
import { PolicyGuard } from './policy.guard';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { AuthorizationAuditService } from '../authorization/authorization-audit.service';

/**
 * Phase 4 — Global guards module.
 *
 * Makes PermissionsGuard + RolesGuard + PolicyGuard injectable
 * everywhere without each domain module adding them to its own
 * providers. Per-actor auth guards (UserAuthGuard, AdminAuthGuard,
 * SellerAuthGuard, …) are still per-module providers because they
 * hold per-actor JWT secret lookups; the cross-cutting checkers don't.
 *
 * PolicyEvaluatorService + AuthorizationAuditService are also exported
 * so domain code (e.g. a service that needs to check "would this be
 * allowed?" or to emit an audit row from a non-guard path) can inject
 * them directly.
 */
@Global()
@Module({
  providers: [
    PermissionsGuard,
    RolesGuard,
    PolicyGuard,
    PolicyEvaluatorService,
    AuthorizationAuditService,
  ],
  exports: [
    PermissionsGuard,
    RolesGuard,
    PolicyGuard,
    PolicyEvaluatorService,
    AuthorizationAuditService,
  ],
})
export class GuardsModule {}
