import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  ALL_PERMISSION_KEYS,
  PermissionKey,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from './permission-registry';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  /** All registered permission keys with descriptions, for the admin UI. */
  listPermissionCatalog() {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({
      key,
      description,
    }));
  }

  async listRoles() {
    const rows = await this.prisma.adminCustomRole.findMany({
      include: { permissions: true },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permissionKey),
    }));
  }

  async createRole(args: { name: string; description?: string; permissions: PermissionKey[] }) {
    if (!args.name?.trim()) throw new BadRequestAppException('name is required');
    this.validatePermissions(args.permissions);
    return this.prisma.adminCustomRole.create({
      data: {
        name: args.name.trim(),
        description: args.description ?? null,
        isSystem: false,
        permissions: {
          create: args.permissions.map((permissionKey) => ({ permissionKey })),
        },
      },
      include: { permissions: true },
    });
  }

  async updateRole(id: string, args: { description?: string; permissions?: PermissionKey[] }) {
    const role = await this.prisma.adminCustomRole.findUnique({ where: { id } });
    if (!role) throw new NotFoundAppException('Role not found');
    if (role.isSystem && args.permissions) {
      throw new ForbiddenAppException('System roles cannot have their permissions edited');
    }
    if (args.permissions) this.validatePermissions(args.permissions);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.adminCustomRole.update({
        where: { id },
        data: { description: args.description ?? role.description },
      });
      if (args.permissions) {
        await tx.adminCustomRolePermission.deleteMany({ where: { roleId: id } });
        await tx.adminCustomRolePermission.createMany({
          data: args.permissions.map((permissionKey) => ({ roleId: id, permissionKey })),
        });
      }
      return updated;
    });
  }

  async deleteRole(id: string) {
    const role = await this.prisma.adminCustomRole.findUnique({ where: { id } });
    if (!role) throw new NotFoundAppException('Role not found');
    if (role.isSystem) {
      throw new ForbiddenAppException('System roles cannot be deleted');
    }
    return this.prisma.adminCustomRole.delete({ where: { id } });
  }

  async assignRoleToAdmin(adminId: string, roleId: string) {
    return this.prisma.adminRoleAssignment.upsert({
      where: { adminId_roleId: { adminId, roleId } },
      create: { adminId, roleId },
      update: {},
    });
  }

  async revokeRoleFromAdmin(adminId: string, roleId: string) {
    return this.prisma.adminRoleAssignment.deleteMany({
      where: { adminId, roleId },
    });
  }

  /**
   * Returns the union of permissions an admin has, derived from:
   *   1. their default `Admin.role` enum (mapped via SYSTEM_ROLE_PERMISSIONS)
   *   2. any explicit `AdminRoleAssignment` rows
   * Used by RequiresPermissionGuard at every request.
   */
  async resolvePermissionsForAdmin(adminId: string): Promise<Set<string>> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });
    if (!admin) return new Set();

    const fromEnum = SYSTEM_ROLE_PERMISSIONS[admin.role] ?? [];

    const assignments = await this.prisma.adminRoleAssignment.findMany({
      where: { adminId },
      include: { role: { include: { permissions: true } } },
    });
    const fromCustom = assignments.flatMap((a) =>
      a.role.permissions.map((p) => p.permissionKey),
    );

    return new Set<string>([...fromEnum, ...fromCustom]);
  }

  private validatePermissions(perms: PermissionKey[]) {
    for (const p of perms) {
      if (!ALL_PERMISSION_KEYS.includes(p)) {
        throw new BadRequestAppException(`Unknown permission: ${p}`);
      }
    }
  }
}
