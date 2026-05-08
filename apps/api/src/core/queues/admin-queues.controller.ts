import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../guards';
import { Permissions } from '../decorators/permissions.decorator';
import { BadRequestAppException } from '../exceptions';
import {
  QueueService,
  type QueueResource,
} from './queue.service';

const ALLOWED_RESOURCES: QueueResource[] = ['dispute', 'return', 'ticket'];

/**
 * Phase 6 (PR 6.4) — Admin queue management endpoints.
 *
 * Three URLs share a single controller. Each maps a path-param resource
 * type to QueueService.list. Permissions: every existing per-domain
 * permission key (returns.read / disputes.read / support.read) gates
 * its own queue, so an admin who can already read the underlying
 * domain can read its queue.
 *
 * The summary endpoint (counts per queue) is gated by the union — any
 * one of the three permissions is sufficient. We don't have an
 * AnyOf-permissions matcher in the registry yet, so we rely on the
 * coarser "audit.read" pattern (the audit dashboard already crosses
 * domains). Phase 9 will introduce explicit "any-of" semantics.
 */
@ApiTags('Admin Queues')
@Controller('admin/queues')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminQueuesController {
  constructor(private readonly queues: QueueService) {}

  @Get('summary')
  @Permissions('audit.read')
  async summary() {
    const data = await this.queues.summary();
    return { success: true, message: 'Queue summary', data };
  }

  @Get(':resource')
  async list(
    @Param('resource') resource: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('onlyBreaching') onlyBreaching?: string,
    @Query('minTier') minTier?: string,
  ) {
    if (!ALLOWED_RESOURCES.includes(resource as QueueResource)) {
      throw new BadRequestAppException(
        `Unknown queue resource "${resource}". Allowed: ${ALLOWED_RESOURCES.join(', ')}`,
      );
    }
    if (
      minTier !== undefined &&
      minTier !== 'LOW' &&
      minTier !== 'MEDIUM' &&
      minTier !== 'HIGH'
    ) {
      throw new BadRequestAppException(
        `Unknown minTier "${minTier}". Allowed: LOW, MEDIUM, HIGH`,
      );
    }
    const data = await this.queues.list({
      resource: resource as QueueResource,
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      onlyBreaching: onlyBreaching === 'true',
      minTier: minTier as 'LOW' | 'MEDIUM' | 'HIGH' | undefined,
    });
    return { success: true, message: 'Queue retrieved', data };
  }
}
