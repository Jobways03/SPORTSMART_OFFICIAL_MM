import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { PermissionsGuard } from '../../../../core/guards/permissions.guard';
import { RolesGuard } from '../../../../core/guards/roles.guard';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { RequiresStepUp } from '../../../../core/step-up/requires-step-up.decorator';
import { StepUpGuard } from '../../../../core/step-up/step-up.guard';
import { AdminUserService } from '../../application/services/admin-user.service';
import { RoleService } from '../../application/services/role.service';
import {
  AdminListQueryDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from '../dtos/admin-user.dto';

/**
 * Phase 23 (2026-05-20) — Admin user management hardening.
 *
 * Audit-driven changes:
 *   • @Roles('SUPER_ADMIN') at the controller level — backend gate
 *     now matches the frontend's `<RequirePermission superAdminOnly>`
 *     wrapper. Pre-Phase-23 any admin with `roles.write` could create
 *     SUPER_ADMINs and promote other admins.
 *   • PermissionsGuard runs in strict mode (env flipped) so the
 *     @Permissions('roles.write') gate also enforces, defense-in-depth.
 *   • @RequiresStepUp on every write route — admin must have a fresh
 *     MFA step-up (5min) before they can mutate other admin records.
 *   • DTOs are class-validator classes; the global ValidationPipe
 *     whitelists + forbids non-whitelisted, so extra fields no longer
 *     pass through.
 *   • Reset-password endpoint REMOVED — admin recovery now goes
 *     through the public forgot-password OTP flow. Eliminates the
 *     "Admin A resets Admin B's password" privilege-escalation path.
 *   • Service receives `requesterRole` so a non-SUPER_ADMIN cannot
 *     touch SUPER_ADMIN rows even if the controller-level guard is
 *     somehow bypassed.
 */
@ApiTags('Admin Users')
@Controller('admin/users')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
@Roles('SUPER_ADMIN')
@Permissions('roles.write')
export class AdminUsersController {
  constructor(
    private readonly userService: AdminUserService,
    private readonly roleService: RoleService,
  ) {}

  @Get()
  async list(@Query() query: AdminListQueryDto) {
    const data = await this.userService.list({
      page: parseInt(query.page || '1', 10) || 1,
      limit: parseInt(query.limit || '20', 10) || 20,
      search: query.search,
      status: query.status,
    });
    return { success: true, message: 'Admin users fetched', data };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const data = await this.userService.getById(id);
    return { success: true, message: 'Admin user fetched', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresStepUp()
  async create(@Body() body: CreateAdminUserDto, @Req() req: Request) {
    const requesterId = (req as any).adminId as string;
    const requesterRole = (req as any).adminRole as string;
    const userAgent = req.headers['user-agent'];
    const data = await this.userService.create(body, {
      requesterId,
      requesterRole,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
    return { success: true, message: 'Admin user created', data };
  }

  @Patch(':id')
  @RequiresStepUp()
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAdminUserDto,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).adminId as string;
    const requesterRole = (req as any).adminRole as string;
    const userAgent = req.headers['user-agent'];
    const data = await this.userService.update(id, body, {
      requesterId,
      requesterRole,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
    return { success: true, message: 'Admin user updated', data };
  }

  @Delete(':id')
  @RequiresStepUp()
  async remove(@Param('id') id: string, @Req() req: Request) {
    const requesterId = (req as any).adminId as string;
    const requesterRole = (req as any).adminRole as string;
    const userAgent = req.headers['user-agent'];
    await this.userService.softDelete(id, {
      requesterId,
      requesterRole,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
    return { success: true, message: 'Admin user deactivated' };
  }

  // Phase 23 (2026-05-20) — POST /admin/users/:id/reset-password removed.
  // Pre-Phase-23 any admin with `roles.write` could reset any other
  // admin's password — including SUPER_ADMIN — then log in as them.
  // Admins now recover via the public forgot-password OTP flow at
  // /admin/auth/forgot-password.

  @Post(':id/roles/:roleId')
  @HttpCode(HttpStatus.CREATED)
  @RequiresStepUp()
  async assignRole(
    @Param('id') adminId: string,
    @Param('roleId') roleId: string,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).adminId as string;
    const requesterRole = (req as any).adminRole as string;
    const userAgent = req.headers['user-agent'];
    await this.roleService.assignRoleToAdmin(adminId, roleId, {
      adminId: requesterId,
      adminRole: requesterRole,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
    const data = await this.userService.getById(adminId);
    return { success: true, message: 'Role assigned', data };
  }

  @Delete(':id/roles/:roleId')
  @RequiresStepUp()
  async revokeRole(
    @Param('id') adminId: string,
    @Param('roleId') roleId: string,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).adminId as string;
    const requesterRole = (req as any).adminRole as string;
    const userAgent = req.headers['user-agent'];
    await this.roleService.revokeRoleFromAdmin(adminId, roleId, {
      adminId: requesterId,
      adminRole: requesterRole,
      ipAddress: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
    const data = await this.userService.getById(adminId);
    return { success: true, message: 'Role revoked', data };
  }
}
