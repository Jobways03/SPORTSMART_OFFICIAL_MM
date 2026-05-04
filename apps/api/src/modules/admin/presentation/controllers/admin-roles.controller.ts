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
import { AdminAuthGuard } from '../../../../core/guards';
import { RoleService } from '../../application/services/role.service';
import { PermissionKey } from '../../application/services/permission-registry';

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
@UseGuards(AdminAuthGuard)
export class AdminRolesController {
  constructor(private readonly service: RoleService) {}

  @Get('permissions')
  async listPermissions() {
    return {
      success: true,
      message: 'Permissions catalog',
      data: this.service.listPermissionCatalog(),
    };
  }

  @Get()
  async listRoles() {
    return {
      success: true,
      message: 'Roles',
      data: await this.service.listRoles(),
    };
  }

  @Post()
  async create(@Body() body: CreateRoleDto) {
    const data = await this.service.createRole(body);
    return { success: true, message: 'Role created', data };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateRoleDto) {
    const data = await this.service.updateRole(id, body);
    return { success: true, message: 'Role updated', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.deleteRole(id);
    return { success: true, message: 'Role deleted' };
  }

  @Post(':roleId/admins/:adminId')
  async assign(@Param('roleId') roleId: string, @Param('adminId') adminId: string) {
    const data = await this.service.assignRoleToAdmin(adminId, roleId);
    return { success: true, message: 'Role assigned', data };
  }

  @Delete(':roleId/admins/:adminId')
  async revoke(@Param('roleId') roleId: string, @Param('adminId') adminId: string) {
    await this.service.revokeRoleFromAdmin(adminId, roleId);
    return { success: true, message: 'Role revoked' };
  }
}
