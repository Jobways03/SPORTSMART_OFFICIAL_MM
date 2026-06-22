import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { AdminPermissionResolver } from '../../../../core/authorization/admin-permission-resolver.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'STAFF',
  'SELLER_SUPPORT',
  'SELLER_OPERATIONS',
  'SELLER_OPS',
  'AFFILIATE_ADMIN',
  'D2C_ADMIN',
  'RETAILER_ADMIN',
  'FRANCHISE_ADMIN',
] as const;

type AdminRoleName = (typeof ADMIN_ROLES)[number];

const ADMIN_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
type AdminStatus = (typeof ADMIN_STATUSES)[number];

interface RequesterContext {
  requesterId: string;
  requesterRole: string;
  ipAddress?: string;
  userAgent?: string;
}

interface ListArgs {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminStatus;
}

interface CreateArgs {
  name: string;
  email: string;
  password: string;
  role: AdminRoleName;
  customRoleIds?: string[];
}

interface UpdateArgs {
  name?: string;
  role?: AdminRoleName;
  status?: AdminStatus;
}

interface AssignmentRow {
  adminId: string;
  role: { id: string; name: string; isSystem: boolean };
}

/**
 * Phase 23 (2026-05-20) — admin user-management service hardening.
 *
 * Every mutation now:
 *   • Takes a `RequesterContext` so the service can defense-in-depth
 *     check the requester role on top of the controller's
 *     @Roles('SUPER_ADMIN') gate. If that gate is ever removed by
 *     mistake the service still refuses to create/promote SUPER_ADMIN
 *     unless the requester is one.
 *   • Writes a row to the unified AuditLog via AuditPublicFacade so
 *     "Admin X promoted Admin Y at T" is queryable.
 *   • Revokes every active AdminSession for the target when the
 *     status transitions to SUSPENDED / INACTIVE (or when the admin
 *     is soft-deleted).
 *   • Scope-checks customRoleIds against the requester's effective
 *     permissions — the requester cannot grant permissions they do
 *     not themselves hold. SUPER_ADMIN bypasses.
 *
 * Password rules are enforced at the DTO level (Phase 23 class DTOs).
 * The service keeps a minimum length check as a defense-in-depth.
 *
 * The legacy `resetPassword()` method is gone: admin password recovery
 * now flows through the public forgot-password OTP endpoint, which
 * eliminates the privilege-escalation path where a SELLER_ADMIN with
 * `roles.write` could reset a SUPER_ADMIN's password.
 */
@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly permissionResolver: AdminPermissionResolver,
  ) {}

  async list(args: ListArgs) {
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (args.status) where.status = args.status;
    if (args.search?.trim()) {
      const q = args.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.admin.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.admin.count({ where }),
    ]);

    const assignmentsByAdmin = await this.fetchAssignments(rows.map((r) => r.id));

    return {
      items: rows.map((r) => ({
        ...r,
        customRoles: assignmentsByAdmin.get(r.id) ?? [],
      })),
      page,
      limit,
      total,
    };
  }

  async getById(id: string) {
    const row = await this.prisma.admin.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!row) throw new NotFoundAppException('Admin not found');
    const assignmentsByAdmin = await this.fetchAssignments([row.id]);
    return { ...row, customRoles: assignmentsByAdmin.get(row.id) ?? [] };
  }

  async create(args: CreateArgs, ctx: RequesterContext) {
    if (!args.name?.trim()) throw new BadRequestAppException('name is required');
    if (!args.email?.trim()) throw new BadRequestAppException('email is required');
    if (!args.password || args.password.length < 12) {
      throw new BadRequestAppException(
        'password must be at least 12 characters',
      );
    }
    if (!ADMIN_ROLES.includes(args.role)) {
      throw new BadRequestAppException(
        `role must be one of: ${ADMIN_ROLES.join(', ')}`,
      );
    }

    // Phase 23 (2026-05-20) — requester-role check. Only a SUPER_ADMIN
    // can create another SUPER_ADMIN. Defense-in-depth on top of the
    // controller-level @Roles('SUPER_ADMIN') gate.
    if (args.role === 'SUPER_ADMIN' && ctx.requesterRole !== 'SUPER_ADMIN') {
      throw new ForbiddenAppException(
        'Only a SUPER_ADMIN can create another SUPER_ADMIN.',
      );
    }

    const email = args.email.trim().toLowerCase();
    const exists = await this.prisma.admin.findUnique({ where: { email } });
    if (exists) {
      throw new BadRequestAppException('An admin with this email already exists');
    }

    if (args.customRoleIds?.length) {
      await this.assertCustomRolesAreInScope(
        args.customRoleIds,
        ctx.requesterId,
        ctx.requesterRole,
      );
    }

    const passwordHash = await bcrypt.hash(args.password, 12);

    const admin = await this.prisma.$transaction(async (tx) => {
      const created = await tx.admin.create({
        data: {
          name: args.name.trim(),
          email,
          passwordHash,
          role: args.role as any,
          status: 'ACTIVE',
        },
      });
      if (args.customRoleIds?.length) {
        await tx.adminRoleAssignment.createMany({
          data: args.customRoleIds.map((roleId) => ({
            adminId: created.id,
            roleId,
          })),
        });
      }
      return created;
    });

    this.audit
      .writeAuditLog({
        actorId: ctx.requesterId,
        actorRole: ctx.requesterRole,
        action: 'ADMIN_USER_CREATED',
        module: 'admin',
        resource: 'Admin',
        resourceId: admin.id,
        newValue: {
          email,
          role: args.role,
          customRoleIds: args.customRoleIds ?? [],
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ADMIN_USER_CREATED: ${err}`,
        ),
      );

    return this.getById(admin.id);
  }

  async update(id: string, args: UpdateArgs, ctx: RequesterContext) {
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundAppException('Admin not found');

    // Phase 23 (2026-05-20) — Non-SUPER_ADMIN cannot edit a
    // SUPER_ADMIN row, and cannot promote another admin to SUPER_ADMIN.
    if (
      ctx.requesterRole !== 'SUPER_ADMIN' &&
      (target.role === 'SUPER_ADMIN' || args.role === 'SUPER_ADMIN')
    ) {
      throw new ForbiddenAppException(
        'Only a SUPER_ADMIN can modify a SUPER_ADMIN row or promote to SUPER_ADMIN.',
      );
    }

    // Self-protection: cannot demote/suspend yourself.
    if (id === ctx.requesterId) {
      if (args.role && args.role !== target.role) {
        throw new ForbiddenAppException('You cannot change your own role');
      }
      if (args.status && args.status !== 'ACTIVE') {
        throw new ForbiddenAppException('You cannot deactivate your own account');
      }
    }

    // Last-super-admin protection.
    if (target.role === 'SUPER_ADMIN') {
      const losingSuperAdmin =
        (args.role && args.role !== 'SUPER_ADMIN') ||
        (args.status && args.status !== 'ACTIVE');
      if (losingSuperAdmin) {
        const remaining = await this.prisma.admin.count({
          where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
        });
        if (remaining === 0) {
          throw new ForbiddenAppException(
            'Cannot demote/suspend the last active Super Admin',
          );
        }
      }
    }

    if (args.role && !ADMIN_ROLES.includes(args.role)) {
      throw new BadRequestAppException(
        `role must be one of: ${ADMIN_ROLES.join(', ')}`,
      );
    }
    if (args.status && !ADMIN_STATUSES.includes(args.status)) {
      throw new BadRequestAppException(
        `status must be one of: ${ADMIN_STATUSES.join(', ')}`,
      );
    }

    const oldValue = {
      name: target.name,
      role: target.role,
      status: target.status,
    };

    await this.prisma.admin.update({
      where: { id },
      data: {
        name: args.name?.trim(),
        role: args.role as any,
        status: args.status as any,
      },
    });

    // Phase 23 (2026-05-20) — Suspending / deactivating an admin must
    // also revoke every active session for that admin. The
    // AdminAuthGuard re-checks status on every request and would 401
    // SUSPENDED admins on the next request anyway, but long-running
    // operations launched before the suspend would otherwise continue
    // until completion.
    if (args.status && args.status !== 'ACTIVE') {
      await this.prisma.adminSession.updateMany({
        where: { adminId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    this.audit
      .writeAuditLog({
        actorId: ctx.requesterId,
        actorRole: ctx.requesterRole,
        action: 'ADMIN_USER_UPDATED',
        module: 'admin',
        resource: 'Admin',
        resourceId: id,
        oldValue,
        newValue: {
          name: args.name ?? target.name,
          role: args.role ?? target.role,
          status: args.status ?? target.status,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ADMIN_USER_UPDATED: ${err}`,
        ),
      );

    return this.getById(id);
  }

  async softDelete(id: string, ctx: RequesterContext) {
    if (id === ctx.requesterId) {
      throw new ForbiddenAppException('You cannot delete your own account');
    }
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundAppException('Admin not found');

    // Phase 23 (2026-05-20) — Non-SUPER_ADMIN cannot delete a
    // SUPER_ADMIN row.
    if (
      ctx.requesterRole !== 'SUPER_ADMIN' &&
      target.role === 'SUPER_ADMIN'
    ) {
      throw new ForbiddenAppException(
        'Only a SUPER_ADMIN can deactivate a SUPER_ADMIN account.',
      );
    }

    if (target.role === 'SUPER_ADMIN') {
      const remaining = await this.prisma.admin.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
      });
      if (remaining === 0) {
        throw new ForbiddenAppException(
          'Cannot delete the last active Super Admin',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.admin.update({
        where: { id },
        data: { status: 'INACTIVE' },
      }),
      // Phase 23 (2026-05-20) — revoke active sessions on deactivate.
      this.prisma.adminSession.updateMany({
        where: { adminId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.audit
      .writeAuditLog({
        actorId: ctx.requesterId,
        actorRole: ctx.requesterRole,
        action: 'ADMIN_USER_DEACTIVATED',
        module: 'admin',
        resource: 'Admin',
        resourceId: id,
        oldValue: { status: target.status },
        newValue: { status: 'INACTIVE' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ADMIN_USER_DEACTIVATED: ${err}`,
        ),
      );
  }

  /**
   * Phase 23 (2026-05-20) — Custom-role scope check.
   *
   * The requester cannot assign a custom role whose permission set
   * exceeds the requester's own effective permissions. Without this,
   * a SELLER_ADMIN with `roles.write` could create a custom role
   * containing `payments.refund` (which they themselves don't have)
   * and assign it to an admin — silently bypassing the permission cap.
   *
   * SUPER_ADMIN bypasses because they implicitly hold every permission.
   */
  private async assertCustomRolesAreInScope(
    customRoleIds: string[],
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    const found = await this.prisma.adminCustomRole.findMany({
      where: { id: { in: customRoleIds } },
      include: { permissions: true },
    });
    if (found.length !== customRoleIds.length) {
      throw new BadRequestAppException('One or more custom roles not found');
    }

    if (requesterRole === 'SUPER_ADMIN') return;

    const resolved = await this.permissionResolver.resolve(
      requesterId,
      requesterRole,
    );
    const requesterPerms = new Set(resolved.permissions);

    for (const role of found) {
      for (const p of role.permissions) {
        if (!requesterPerms.has(p.permissionKey)) {
          throw new ForbiddenAppException(
            `Cannot assign custom role "${role.name}" — it grants permission "${p.permissionKey}" which you do not hold.`,
          );
        }
      }
    }
  }

  private async fetchAssignments(
    adminIds: string[],
  ): Promise<Map<string, AssignmentRow['role'][]>> {
    if (adminIds.length === 0) return new Map();
    const rows = await this.prisma.adminRoleAssignment.findMany({
      where: { adminId: { in: adminIds } },
      include: { role: { select: { id: true, name: true, isSystem: true } } },
    });
    const map = new Map<string, AssignmentRow['role'][]>();
    for (const id of adminIds) map.set(id, []);
    for (const r of rows) {
      const arr = map.get(r.adminId) ?? [];
      arr.push(r.role);
      map.set(r.adminId, arr);
    }
    return map;
  }
}
