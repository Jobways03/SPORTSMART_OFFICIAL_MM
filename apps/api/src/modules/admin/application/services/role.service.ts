import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  ALL_PERMISSION_KEYS,
  PermissionKey,
  PERMISSIONS,
} from '../../../../core/authorization/permission-registry';
import { AdminPermissionResolver } from '../../../../core/authorization/admin-permission-resolver.service';

// Actor context for RBAC mutations. The controller pulls these from the
// authenticated request (AdminAuthGuard exposes adminId + adminRole on
// req) and threads them into each service call so the emitted event
// payload carries who did what. ipAddress / userAgent are best-effort
// for the AdminActionAuditHandler to denormalise.
export interface RbacActor {
  adminId: string;
  adminRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: AdminPermissionResolver,
    private readonly eventBus: EventBusService,
  ) {}

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

  async createRole(
    args: { name: string; description?: string; permissions: PermissionKey[] },
    actor?: RbacActor,
  ) {
    if (!args.name?.trim()) throw new BadRequestAppException('name is required');
    this.validatePermissions(args.permissions);
    const created = await this.prisma.adminCustomRole.create({
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
    await this.emitRbacEvent('role.created', 'AdminCustomRole', created.id, actor, {
      roleId: created.id,
      name: created.name,
      description: created.description,
      permissions: args.permissions,
    });
    return created;
  }

  async updateRole(
    id: string,
    args: { description?: string; permissions?: PermissionKey[] },
    actor?: RbacActor,
  ) {
    const role = await this.prisma.adminCustomRole.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundAppException('Role not found');
    if (role.isSystem && args.permissions) {
      throw new ForbiddenAppException('System roles cannot have their permissions edited');
    }
    if (args.permissions) this.validatePermissions(args.permissions);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.adminCustomRole.update({
        where: { id },
        data: { description: args.description ?? role.description },
      });
      if (args.permissions) {
        await tx.adminCustomRolePermission.deleteMany({ where: { roleId: id } });
        await tx.adminCustomRolePermission.createMany({
          data: args.permissions.map((permissionKey) => ({ roleId: id, permissionKey })),
        });
      }
      return u;
    });
    await this.emitRbacEvent('role.updated', 'AdminCustomRole', id, actor, {
      roleId: id,
      name: role.name,
      previousDescription: role.description,
      newDescription: updated.description,
      previousPermissions: role.permissions.map((p) => p.permissionKey),
      newPermissions: args.permissions ?? null,
    });
    return updated;
  }

  async deleteRole(id: string, actor?: RbacActor) {
    const role = await this.prisma.adminCustomRole.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundAppException('Role not found');
    if (role.isSystem) {
      throw new ForbiddenAppException('System roles cannot be deleted');
    }
    const deleted = await this.prisma.adminCustomRole.delete({ where: { id } });
    await this.emitRbacEvent('role.deleted', 'AdminCustomRole', id, actor, {
      roleId: id,
      name: role.name,
      previousPermissions: role.permissions.map((p) => p.permissionKey),
    });
    return deleted;
  }

  async assignRoleToAdmin(adminId: string, roleId: string, actor?: RbacActor) {
    const assignment = await this.prisma.adminRoleAssignment.upsert({
      where: { adminId_roleId: { adminId, roleId } },
      create: { adminId, roleId },
      update: {},
    });
    await this.emitRbacEvent(
      'role_assignment.created',
      'AdminRoleAssignment',
      `${adminId}:${roleId}`,
      actor,
      { targetAdminId: adminId, roleId },
    );
    return assignment;
  }

  async revokeRoleFromAdmin(adminId: string, roleId: string, actor?: RbacActor) {
    const result = await this.prisma.adminRoleAssignment.deleteMany({
      where: { adminId, roleId },
    });
    await this.emitRbacEvent(
      'role_assignment.revoked',
      'AdminRoleAssignment',
      `${adminId}:${roleId}`,
      actor,
      { targetAdminId: adminId, roleId, removedCount: result.count },
    );
    return result;
  }

  /**
   * Publishes an RBAC mutation event with the `admin.action.*` prefix so
   * AdminActionAuditHandler (modules/audit/.../admin-action-audit.handler.ts)
   * persists a row to `admin_action_audit_logs`. The global `@OnEvent('**')`
   * handler also picks it up into `EventLog`. Best-effort — failures here
   * must not roll back the mutation that just succeeded.
   */
  private async emitRbacEvent(
    action: string,
    aggregate: string,
    aggregateId: string,
    actor: RbacActor | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: `admin.action.${action}`,
        aggregate,
        aggregateId,
        occurredAt: new Date(),
        payload: {
          adminId: actor?.adminId,
          actorRole: actor?.adminRole ?? null,
          actionType: `admin.action.${action}`,
          ipAddress: actor?.ipAddress ?? null,
          userAgent: actor?.userAgent ?? null,
          metadata,
        },
      });
    } catch {
      // AdminActionAuditHandler already swallows its own errors; if the
      // bus itself fails we still want the mutation to succeed.
    }
  }

  /**
   * Returns the union of permissions an admin has, derived from:
   *   1. their default `Admin.role` enum (mapped via SYSTEM_ROLE_PERMISSIONS)
   *   2. any explicit `AdminRoleAssignment` rows
   *
   * Delegates to AdminPermissionResolver (PR 4.6) so this method and
   * AdminAuthGuard share the same code path — eliminates the risk of
   * the two paths drifting and the request-time view diverging from
   * what the admin role UI shows.
   */
  async resolvePermissionsForAdmin(adminId: string): Promise<Set<string>> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });
    if (!admin) return new Set();

    const resolved = await this.permissionResolver.resolve(adminId, admin.role);
    return new Set(resolved.permissions);
  }

  private validatePermissions(perms: PermissionKey[]) {
    for (const p of perms) {
      if (!ALL_PERMISSION_KEYS.includes(p)) {
        throw new BadRequestAppException(`Unknown permission: ${p}`);
      }
    }
  }
}
