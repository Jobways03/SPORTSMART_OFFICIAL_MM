import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminAuthGuard,
  AnyAuthGuard,
  PermissionsGuard,
} from '../guards';
import { Permissions } from '../decorators/permissions.decorator';
import {
  CaseTimelineService,
  type CaseKind,
  type ViewerKind,
} from './case-timeline.service';
import { BadRequestAppException } from '../exceptions';

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
  constructor(private readonly service: CaseTimelineService) {}

  @Get('portal/timeline/:caseKind/:caseId')
  @UseGuards(AnyAuthGuard)
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
  @Permissions('audit.read')
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
    const adminId = (req as any).adminId ?? 'unknown';
    const data = await this.service.getTimeline({
      caseKind: caseKind as CaseKind,
      caseId,
      viewerKind: 'ADMIN' as ViewerKind,
      viewerId: adminId,
    });
    return { success: true, message: 'Timeline retrieved', data };
  }
}
