import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { RoleService, RbacActor } from '../../application/services/role.service';
import { PermissionKey } from '../../../../core/authorization/permission-registry';

function actorFromReq(req: Request): RbacActor {
  return {
    adminId: (req as any).adminId,
    adminRole: (req as any).adminRole ?? null,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

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
  async create(@Body() body: CreateRoleDto, @Req() req: Request) {
    const data = await this.service.createRole(body, actorFromReq(req));
    return { success: true, message: 'Role created', data };
  }

  @Patch(':id')
  @Permissions('roles.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
    @Req() req: Request,
  ) {
    const data = await this.service.updateRole(id, body, actorFromReq(req));
    return { success: true, message: 'Role updated', data };
  }

  @Delete(':id')
  @Permissions('roles.write')
  async remove(@Param('id') id: string, @Req() req: Request) {
    await this.service.deleteRole(id, actorFromReq(req));
    return { success: true, message: 'Role deleted' };
  }

  @Post(':roleId/admins/:adminId')
  @Permissions('roles.write')
  async assign(
    @Param('roleId') roleId: string,
    @Param('adminId') adminId: string,
    @Req() req: Request,
  ) {
    const data = await this.service.assignRoleToAdmin(
      adminId,
      roleId,
      actorFromReq(req),
    );
    return { success: true, message: 'Role assigned', data };
  }

  @Delete(':roleId/admins/:adminId')
  @Permissions('roles.write')
  async revoke(
    @Param('roleId') roleId: string,
    @Param('adminId') adminId: string,
    @Req() req: Request,
  ) {
    await this.service.revokeRoleFromAdmin(adminId, roleId, actorFromReq(req));
    return { success: true, message: 'Role revoked' };
  }
}
