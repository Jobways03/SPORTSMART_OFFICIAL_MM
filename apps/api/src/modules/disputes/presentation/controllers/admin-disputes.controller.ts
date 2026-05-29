import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DisputeKind, DisputeStatus } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { requirePermissionOrSoak } from '../../../../core/authorization/require-permission';
import { DisputeService } from '../../application/services/dispute.service';
import {
  AdminReplyMessageDto,
  AssignDisputeDto,
  AttachDisputeContextDto,
  DecideDisputeDto,
  SetDisputeStatusDto,
  SetSeverityDto,
} from '../dtos/admin-dispute.dtos';

@ApiTags('Disputes — Admin')
@Controller('admin/disputes')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  @Get()
  @Permissions('disputes.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('assignedAdminId') assignedAdminId?: string,
    @Query('search') search?: string,
  ) {
    let assignedFilter: string | null | undefined = undefined;
    if (assignedAdminId === 'unassigned') assignedFilter = null;
    else if (assignedAdminId) assignedFilter = assignedAdminId;

    const data = await this.service.listAdmin({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      status: status ? (status as DisputeStatus) : undefined,
      kind: kind ? (kind as DisputeKind) : undefined,
      assignedAdminId: assignedFilter,
      search: search?.trim() || undefined,
    });
    return { success: true, message: 'Disputes retrieved', data };
  }

  // Declared BEFORE :id so the static path isn't captured by the param route.
  @Get('assignable-admins')
  @Permissions('disputes.assign')
  async assignableAdmins() {
    const data = await this.service.listAssignableAdmins();
    return { success: true, message: 'Assignable admins retrieved', data };
  }

  @Get(':id')
  @Permissions('disputes.read')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getDisputeForActor(id, {
      type: 'ADMIN', id: req.adminId, isAdmin: true,
    });
    return { success: true, message: 'Dispute retrieved', data };
  }

  @Post(':id/messages')
  // Phase 0 / H24 — distinct from `disputes.read` (which only lets an
  // admin SEE the thread). Replying is a write, so a read-only support
  // analyst should be blocked here. The new permission goes into the
  // registry alongside `disputes.read` / `disputes.assign`.
  @Permissions('disputes.reply')
  @Idempotent()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async reply(@Req() req: any, @Param('id') id: string, @Body() body: AdminReplyMessageDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: req.adminId }, select: { name: true, email: true },
    });
    if (!admin) throw new NotFoundAppException('Admin not found');
    // Phase 134 — posting an INTERNAL note needs a finer permission than a
    // customer-visible reply. Body-dependent, so it's a runtime soak-aware
    // check rather than a static @Permissions guard.
    if (body.isInternalNote === true) {
      requirePermissionOrSoak({
        req,
        permission: 'disputes.internalNote',
        env: this.env,
        context: 'dispute.internalNote',
      });
    }
    const data = await this.service.reply({
      disputeId: id,
      sender: { type: 'ADMIN', id: req.adminId, name: admin.name || admin.email },
      body: body.body,
      isInternalNote: body.isInternalNote === true,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Patch(':id/assign')
  @Permissions('disputes.assign')
  async assign(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AssignDisputeDto,
  ) {
    const data = await this.service.assign(id, body.adminId ?? null, req.adminId);
    return { success: true, message: 'Dispute assigned', data };
  }

  @Patch(':id/status')
  @Permissions('disputes.statusUpdate')
  async setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetDisputeStatusDto,
  ) {
    const data = await this.service.setStatus(id, body.status, req.adminId);
    return { success: true, message: 'Status updated', data };
  }

  @Patch(':id/severity')
  @Permissions('disputes.assign')
  async setSeverity(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetSeverityDto,
  ) {
    const data = await this.service.setSeverity(id, body.severity, req.adminId);
    return { success: true, message: 'Severity updated', data };
  }

  @Patch(':id/attach-context')
  @Permissions('disputes.statusUpdate')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async attachContext(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AttachDisputeContextDto,
  ) {
    if (!body?.orderNumber && !body?.returnNumber) {
      throw new BadRequestAppException(
        'Provide at least one of orderNumber / returnNumber',
      );
    }
    const data = await this.service.attachContext({
      disputeId: id,
      adminId: req.adminId,
      orderNumber: body.orderNumber,
      returnNumber: body.returnNumber,
    });
    return { success: true, message: 'Context attached', data };
  }

  @Post(':id/decide')
  @Idempotent()
  @Permissions('disputes.decide')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async decide(@Req() req: any, @Param('id') id: string, @Body() body: DecideDisputeDto) {
    // Field presence/shape is enforced by DecideDisputeDto; the service
    // enforces the ADR-016 (outcome × remedy × liability × amount) matrix.
    // Phase 134 — decisions awarding at/above the high-value threshold need a
    // finer permission than ordinary decisions (body-dependent → runtime
    // soak-aware check; the route-level disputes.decide guard still applies).
    const highValueThreshold = this.env.getNumber(
      'DISPUTE_HIGH_VALUE_DECISION_THRESHOLD_PAISE',
      5_000_000,
    );
    if ((body.amountInPaise ?? 0) >= highValueThreshold) {
      requirePermissionOrSoak({
        req,
        permission: 'disputes.decide.high_value',
        env: this.env,
        context: 'dispute.decide.high_value',
      });
    }
    const data = await this.service.decide({
      disputeId: id,
      adminId: req.adminId,
      outcome: body.outcome,
      rationale: body.rationale,
      amountInPaise: body.amountInPaise,
      liabilityParty: body.liabilityParty,
      customerRemedy: body.customerRemedy,
      logistics: body.logistics,
    });
    return { success: true, message: 'Decision recorded', data };
  }
}
