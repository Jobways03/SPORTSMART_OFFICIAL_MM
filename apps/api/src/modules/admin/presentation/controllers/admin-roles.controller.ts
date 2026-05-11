import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { RoleService } from '../../application/services/role.service';
import { PermissionKey } from '../../../../core/authorization/permission-registry';

interface CreateRoleDto {
  name: string;
  description?: string;
  permissions: PermissionKey[];
}

interface UpdateRoleDto {
  description?: string;
  permissions?: PermissionKey[];
}

@ApiTags('Admin Roles & Permissions')
@Controller('admin/roles')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminRolesController {
  constructor(private readonly service: RoleService) {}

  @Get('permissions')
  @Permissions('roles.read')
  async listPermissions() {
    return {
      success: true,
      message: 'Permissions catalog',
      data: this.service.listPermissionCatalog(),
    };
  }

  @Get()
  @Permissions('roles.read')
  async listRoles() {
    return {
      success: true,
      message: 'Roles',
      data: await this.service.listRoles(),
    };
  }

  @Post()
  @Permissions('roles.write')
  async create(@Body() body: CreateRoleDto) {
    const data = await this.service.createRole(body);
    return { success: true, message: 'Role created', data };
  }

  @Patch(':id')
  @Permissions('roles.write')
  async update(@Param('id') id: string, @Body() body: UpdateRoleDto) {
    const data = await this.service.updateRole(id, body);
    return { success: true, message: 'Role updated', data };
  }

  @Delete(':id')
  @Permissions('roles.write')
  async remove(@Param('id') id: string) {
    await this.service.deleteRole(id);
    return { success: true, message: 'Role deleted' };
  }

  @Post(':roleId/admins/:adminId')
  @Permissions('roles.write')
  async assign(@Param('roleId') roleId: string, @Param('adminId') adminId: string) {
    const data = await this.service.assignRoleToAdmin(adminId, roleId);
    return { success: true, message: 'Role assigned', data };
  }

  @Delete(':roleId/admins/:adminId')
  @Permissions('roles.write')
  async revoke(@Param('roleId') roleId: string, @Param('adminId') adminId: string) {
    await this.service.revokeRoleFromAdmin(adminId, roleId);
    return { success: true, message: 'Role revoked' };
  }
}
