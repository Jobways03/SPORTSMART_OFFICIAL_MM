import {
  Controller,
  Get,
  Optional,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  PermissionsGuard,
  UserAuthGuard,
} from '../guards';
import { Permissions } from '../decorators/permissions.decorator';
import {
  CaseTimelineService,
  type CaseKind,
  type ViewerKind,
} from './case-timeline.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
} from '../exceptions';
import { AuditPublicFacade } from '../../modules/audit/application/facades/audit-public.facade';

const ALLOWED: CaseKind[] = ['return', 'dispute', 'ticket'];

/**
 * Phase 9 (PR 9.3) — Customer + admin timeline endpoints.
 *
 *   GET /portal/timeline/:caseKind/:caseId
 *      — customer view; ABAC enforced inside the service (cannot
 *        view a case not owned by them).
 *
 *   GET /admin/timeline/:caseKind/:caseId
 *      — admin view; full payload + internal notes; gated by
 *        `<module>.read` permission.
 */
@ApiTags('Case Timeline')
@Controller()
export class PortalTimelineController {
  constructor(
    private readonly service: CaseTimelineService,
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  @Get('portal/timeline/:caseKind/:caseId')
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async customerTimeline(
    @Req() req: Request,
    @Param('caseKind') caseKind: string,
    @Param('caseId') caseId: string,
  ) {
    if (!ALLOWED.includes(caseKind as CaseKind)) {
      throw new BadRequestAppException(
        `Unknown caseKind "${caseKind}". Allowed: ${ALLOWED.join(', ')}`,
      );
    }
    // Was AnyAuthGuard, which sets `req.user`/`authActorId` but NOT
    // `req.userId` — so reading `req.userId` (below) left customerId
    // permanently undefined and every call 400'd. UserAuthGuard is the
    // customer guard: it sets `req.userId`, validates the session against
    // the DB (revoked/expired), and admits customer tokens only — so the
    // ownership check in the service is no longer reachable by a
    // seller/franchise persona. (Same fix as the portal SSE my-cases stream.)
    const customerId = (req as any).userId;
    if (!customerId) {
      throw new BadRequestAppException('User scope required');
    }
    const data = await this.service.getTimeline({
      caseKind: caseKind as CaseKind,
      caseId,
      viewerKind: 'CUSTOMER',
      viewerId: customerId,
    });
    return { success: true, message: 'Timeline retrieved', data };
  }

  @Get('admin/timeline/:caseKind/:caseId')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  // Per-caseKind gate (matches the documented "<module>.read" intent). The old
  // hard-coded @Permissions('audit.read') 403'd the type-scoped seller/franchise
  // admins, who hold returns.read but NOT the broad audit.read. A global
  // audit.read holder still sees every timeline; otherwise the viewer needs the
  // case's OWN read perm — enforced in-handler because @Permissions is AND-only
  // and can't express "audit.read OR returns.read".
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async adminTimeline(
    @Req() req: Request,
    @Param('caseKind') caseKind: string,
    @Param('caseId') caseId: string,
  ) {
    if (!ALLOWED.includes(caseKind as CaseKind)) {
      throw new BadRequestAppException(
        `Unknown caseKind "${caseKind}". Allowed: ${ALLOWED.join(', ')}`,
      );
    }
    // Authorize per caseKind: audit.read (global) OR the case's read permission.
    const viewerPerms: string[] = (req as any).user?.permissions ?? [];
    const readPermByKind: Record<CaseKind, string> = {
      return: 'returns.read',
      dispute: 'disputes.read',
      ticket: 'support.read',
    };
    const caseReadPerm = readPermByKind[caseKind as CaseKind];
    if (
      !viewerPerms.includes('audit.read') &&
      !viewerPerms.includes(caseReadPerm)
    ) {
      throw new ForbiddenAppException(
        `Missing permission to view this ${caseKind} timeline (need audit.read or ${caseReadPerm}).`,
      );
    }
    const adminId = (req as any).adminId ?? 'unknown';
    const data = await this.service.getTimeline({
      caseKind: caseKind as CaseKind,
      caseId,
      viewerKind: 'ADMIN' as ViewerKind,
      viewerId: adminId,
    });
    // Access-log: an admin read a customer's cross-domain case history.
    // module follows the caseKind so it lands in the right audit lane.
    const moduleByKind: Record<CaseKind, string> = {
      return: 'returns',
      dispute: 'disputes',
      ticket: 'support',
    };
    void this.audit
      ?.writeAuditLog({
        actorId: adminId,
        actorType: 'ADMIN',
        action: `${moduleByKind[caseKind as CaseKind]}.timeline.viewed`,
        module: moduleByKind[caseKind as CaseKind],
        resource: 'case_timeline',
        resourceId: `${caseKind}:${caseId}`,
      })
      .catch(() => undefined);
    return { success: true, message: 'Timeline retrieved', data };
  }
}
