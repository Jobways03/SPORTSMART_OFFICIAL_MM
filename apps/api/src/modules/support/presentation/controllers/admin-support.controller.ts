import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { SupportService } from '../../application/services/support.service';
import {
  AssignDto,
  CreateCategoryDto,
  ReplyDto,
  SetPriorityDto,
  SetStatusDto,
  UpdateCategoryDto,
} from '../dtos/support.dtos';

@ApiTags('Support — Admin')
@Controller('admin/support')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Categories CRUD ──────────────────────────────────────────────

  @Get('categories')
  @Permissions('support.read')
  async listCategories() {
    const data = await this.support.listCategories();
    return { success: true, message: 'Categories retrieved', data };
  }

  @Post('categories')
  @Permissions('support.assign')
  async createCategory(@Body() body: CreateCategoryDto) {
    const data = await this.support.createCategory({
      name: body.name,
      description: body.description,
      scopedTo: body.scopedTo,
      sortOrder: body.sortOrder,
    });
    return { success: true, message: 'Category created', data };
  }

  @Patch('categories/:id')
  @Permissions('support.assign')
  async updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
  ) {
    const data = await this.support.updateCategory(id, body);
    return { success: true, message: 'Category updated', data };
  }

  @Delete('categories/:id')
  @Permissions('support.assign')
  async softDeleteCategory(@Param('id') id: string) {
    const data = await this.support.updateCategory(id, { active: false });
    return { success: true, message: 'Category deactivated', data };
  }

  // ── Tickets ──────────────────────────────────────────────────────

  @Get('tickets')
  @Permissions('support.read')
  async listTickets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedAdminId') assignedAdminId?: string,
    @Query('search') search?: string,
  ) {
    let assignedFilter: string | null | undefined = undefined;
    if (assignedAdminId === 'unassigned') assignedFilter = null;
    else if (assignedAdminId) assignedFilter = assignedAdminId;

    const data = await this.support.listTicketsAdmin({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      status: status ? (status as any) : undefined,
      priority: priority ? (priority as any) : undefined,
      assignedAdminId: assignedFilter,
      search: search?.trim() || undefined,
    });
    return { success: true, message: 'Tickets retrieved', data };
  }

  @Get('tickets/:id')
  @Permissions('support.read')
  async getTicket(@Req() req: any, @Param('id') id: string) {
    const data = await this.support.getTicketDetailForActor(id, {
      type: 'ADMIN',
      id: req.adminId,
      isAdmin: true,
    });
    return { success: true, message: 'Ticket retrieved', data };
  }

  @Post('tickets/:id/messages')
  @Permissions('support.reply')
  async reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReplyDto,
  ) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: req.adminId },
      select: { name: true, email: true },
    });
    if (!admin) throw new NotFoundAppException('Admin not found');
    const data = await this.support.reply({
      ticketId: id,
      sender: {
        type: 'ADMIN',
        id: req.adminId,
        name: admin.name || admin.email,
      },
      body: body.body,
      isInternalNote: body.isInternalNote === true,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Patch('tickets/:id/assign')
  @Permissions('support.assign')
  async assign(@Param('id') id: string, @Body() body: AssignDto) {
    const data = await this.support.assign(id, body.adminId ?? null);
    return { success: true, message: 'Ticket assigned', data };
  }

  @Patch('tickets/:id/status')
  @Permissions('support.assign')
  async setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetStatusDto & { resolutionSummary?: string },
  ) {
    if (!body?.status) {
      throw new BadRequestAppException('status is required');
    }
    const data = await this.support.setStatus(
      id,
      body.status,
      req.adminId,
      body.resolutionSummary,
    );
    return { success: true, message: 'Status updated', data };
  }

  @Patch('tickets/:id/priority')
  @Permissions('support.assign')
  async setPriority(@Param('id') id: string, @Body() body: SetPriorityDto) {
    if (!body?.priority) {
      throw new BadRequestAppException('priority is required');
    }
    const data = await this.support.setPriority(id, body.priority);
    return { success: true, message: 'Priority updated', data };
  }

  // ── Promote ticket to dispute ────────────────────────────────────
  // Internal escalation path. Customer never sees the dispute exists —
  // they keep replying on the ticket; admin works the dispute. Message
  // mirroring keeps both sides synced. See docs in DisputeService.

  @Post('tickets/:id/promote-to-dispute')
  @Permissions('support.promoteToDispute')
  async promoteToDispute(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      kind: string;
      severity?: number;
      summary?: string;
      internalNote?: string;
    },
  ) {
    if (!body?.kind) {
      throw new BadRequestAppException('kind is required');
    }
    const allowedKinds = [
      'RETURN_REJECTED',
      'WRONG_ITEM_RECEIVED',
      'DAMAGED_IN_TRANSIT',
      'MISSING_FROM_PARCEL',
      'OTHER',
    ];
    if (!allowedKinds.includes(body.kind)) {
      throw new BadRequestAppException(
        `kind must be one of: ${allowedKinds.join(', ')}`,
      );
    }
    const adminName = req.adminName || req.adminEmail || 'Admin';
    const data = await this.support.promoteToDispute({
      ticketId: id,
      adminId: req.adminId,
      adminName,
      kind: body.kind as any,
      severity: body.severity,
      summary: body.summary,
      internalNote: body.internalNote,
    });
    return { success: true, message: 'Ticket promoted to dispute', data };
  }
}
