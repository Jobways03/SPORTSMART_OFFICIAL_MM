import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';
import { PolicyGuard } from './policy.guard';
import { D2cOnlyGuard, RetailOnlyGuard } from './seller-type.guard';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { AuthorizationAuditService } from '../authorization/authorization-audit.service';
import { AdminPermissionResolver } from '../authorization/admin-permission-resolver.service';
import { RbacOrphanSweepCron } from '../authorization/rbac-orphan-sweep.cron';
import { RbacOrphanEventHandler } from '../authorization/rbac-orphan-event.handler';
import { BlockedWhileImpersonatingGuard } from '../impersonation/blocked-while-impersonating.guard';

/**
 * Phase 4 — Global guards module.
 *
 * Makes PermissionsGuard + RolesGuard + PolicyGuard injectable
 * everywhere without each domain module adding them to its own
 * providers. Per-actor auth guards (UserAuthGuard, AdminAuthGuard,
 * SellerAuthGuard, …) are still per-module providers because they
 * hold per-actor JWT secret lookups; the cross-cutting checkers don't.
 *
 * AdminPermissionResolver (PR 4.6) lives here so AdminAuthGuard can
 * resolve effective permissions per request without each domain
 * module needing to import RoleService from the admin module.
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
    D2cOnlyGuard,
    RetailOnlyGuard,
    PolicyEvaluatorService,
    AuthorizationAuditService,
    AdminPermissionResolver,
    RbacOrphanSweepCron,
    // Phase 24 (2026-05-20) — listens to rbac.orphan_permission_detected
    // events emitted by the sweep cron and surfaces them via logger +
    // unified audit. @OnEvent decorators bind on provider registration.
    RbacOrphanEventHandler,
    // Phase 28 (2026-05-21) — blocks destructive routes when the
    // request is authenticated via an admin impersonation token. Pure
    // metadata-driven guard; reads req.isImpersonation set by the
    // seller / franchise auth guards.
    BlockedWhileImpersonatingGuard,
  ],
  exports: [
    PermissionsGuard,
    RolesGuard,
    PolicyGuard,
    D2cOnlyGuard,
    RetailOnlyGuard,
    PolicyEvaluatorService,
    AuthorizationAuditService,
    AdminPermissionResolver,
    RbacOrphanSweepCron,
    BlockedWhileImpersonatingGuard,
  ],
})
export class GuardsModule {}
