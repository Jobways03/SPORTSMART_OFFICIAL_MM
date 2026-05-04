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
import type { DisputeKind, DisputeStatus } from '@prisma/client';
import { AdminAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { DisputeService } from '../../application/services/dispute.service';

interface ReplyDto {
  body: string;
  isInternalNote?: boolean;
}

interface AssignDto {
  adminId: string | null;
}

interface DecideDto {
  outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
  rationale: string;
  /** Required for RESOLVED_BUYER and RESOLVED_SPLIT (in paise). */
  amountInPaise?: number;
}

@ApiTags('Disputes — Admin')
@Controller('admin/disputes')
@UseGuards(AdminAuthGuard)
export class AdminDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
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

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getDisputeForActor(id, {
      type: 'ADMIN', id: req.adminId, isAdmin: true,
    });
    return { success: true, message: 'Dispute retrieved', data };
  }

  @Post(':id/messages')
  async reply(@Req() req: any, @Param('id') id: string, @Body() body: ReplyDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: req.adminId }, select: { name: true, email: true },
    });
    if (!admin) throw new NotFoundAppException('Admin not found');
    const data = await this.service.reply({
      disputeId: id,
      sender: { type: 'ADMIN', id: req.adminId, name: admin.name || admin.email },
      body: body.body,
      isInternalNote: body.isInternalNote === true,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Patch(':id/assign')
  async assign(@Param('id') id: string, @Body() body: AssignDto) {
    const data = await this.service.assign(id, body.adminId ?? null);
    return { success: true, message: 'Dispute assigned', data };
  }

  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body() body: { status: DisputeStatus }) {
    if (!body?.status) throw new BadRequestAppException('status is required');
    const data = await this.service.setStatus(id, body.status);
    return { success: true, message: 'Status updated', data };
  }

  @Patch(':id/severity')
  async setSeverity(@Param('id') id: string, @Body() body: { severity: number }) {
    const data = await this.service.setSeverity(id, Number(body.severity));
    return { success: true, message: 'Severity updated', data };
  }

  @Post(':id/decide')
  async decide(@Req() req: any, @Param('id') id: string, @Body() body: DecideDto) {
    if (!body?.outcome || !body?.rationale) {
      throw new BadRequestAppException('outcome and rationale are required');
    }
    const data = await this.service.decide({
      disputeId: id,
      adminId: req.adminId,
      outcome: body.outcome,
      rationale: body.rationale,
      amountInPaise: body.amountInPaise,
    });
    return { success: true, message: 'Decision recorded', data };
  }
}
