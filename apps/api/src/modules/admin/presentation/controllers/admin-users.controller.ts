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
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AdminUserService } from '../../application/services/admin-user.service';
import { RoleService } from '../../application/services/role.service';

interface CreateAdminDto {
  name: string;
  email: string;
  password: string;
  role: 'SUPER_ADMIN' | 'SELLER_ADMIN' | 'SELLER_SUPPORT' | 'SELLER_OPERATIONS' | 'AFFILIATE_ADMIN';
  customRoleIds?: string[];
}

interface UpdateAdminDto {
  name?: string;
  role?: CreateAdminDto['role'];
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

interface ResetPasswordDto {
  newPassword: string;
}

@ApiTags('Admin Users')
@Controller('admin/users')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('roles.write')
export class AdminUsersController {
  constructor(
    private readonly userService: AdminUserService,
    private readonly roleService: RoleService,
  ) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  ) {
    const data = await this.userService.list({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      search,
      status,
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
  async create(@Body() body: CreateAdminDto) {
    const data = await this.userService.create(body);
    return { success: true, message: 'Admin user created', data };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAdminDto,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).adminId as string;
    const data = await this.userService.update(id, requesterId, body);
    return { success: true, message: 'Admin user updated', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const requesterId = (req as any).adminId as string;
    await this.userService.softDelete(id, requesterId);
    return { success: true, message: 'Admin user deactivated' };
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Param('id') id: string, @Body() body: ResetPasswordDto) {
    await this.userService.resetPassword(id, body.newPassword);
    return { success: true, message: 'Password updated' };
  }

  @Post(':id/roles/:roleId')
  @HttpCode(HttpStatus.CREATED)
  async assignRole(
    @Param('id') adminId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.roleService.assignRoleToAdmin(adminId, roleId);
    const data = await this.userService.getById(adminId);
    return { success: true, message: 'Role assigned', data };
  }

  @Delete(':id/roles/:roleId')
  async revokeRole(
    @Param('id') adminId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.roleService.revokeRoleFromAdmin(adminId, roleId);
    const data = await this.userService.getById(adminId);
    return { success: true, message: 'Role revoked', data };
  }
}
