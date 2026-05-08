import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'SELLER_ADMIN',
  'SELLER_SUPPORT',
  'SELLER_OPERATIONS',
  'AFFILIATE_ADMIN',
] as const;

type AdminRoleName = (typeof ADMIN_ROLES)[number];

const ADMIN_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
type AdminStatus = (typeof ADMIN_STATUSES)[number];

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

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(args: CreateArgs) {
    if (!args.name?.trim()) throw new BadRequestAppException('name is required');
    if (!args.email?.trim()) throw new BadRequestAppException('email is required');
    if (!args.password || args.password.length < 8) {
      throw new BadRequestAppException('password must be at least 8 characters');
    }
    if (!ADMIN_ROLES.includes(args.role)) {
      throw new BadRequestAppException(`role must be one of: ${ADMIN_ROLES.join(', ')}`);
    }

    const email = args.email.trim().toLowerCase();
    const exists = await this.prisma.admin.findUnique({ where: { email } });
    if (exists) throw new BadRequestAppException('An admin with this email already exists');

    if (args.customRoleIds?.length) {
      const found = await this.prisma.adminCustomRole.findMany({
        where: { id: { in: args.customRoleIds } },
        select: { id: true },
      });
      if (found.length !== args.customRoleIds.length) {
        throw new BadRequestAppException('One or more custom roles not found');
      }
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

    return this.getById(admin.id);
  }

  async update(id: string, requesterId: string, args: UpdateArgs) {
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundAppException('Admin not found');

    // Self-protection: cannot demote/suspend yourself.
    if (id === requesterId) {
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
      throw new BadRequestAppException(`role must be one of: ${ADMIN_ROLES.join(', ')}`);
    }
    if (args.status && !ADMIN_STATUSES.includes(args.status)) {
      throw new BadRequestAppException(`status must be one of: ${ADMIN_STATUSES.join(', ')}`);
    }

    await this.prisma.admin.update({
      where: { id },
      data: {
        name: args.name?.trim(),
        role: args.role as any,
        status: args.status as any,
      },
    });
    return this.getById(id);
  }

  async resetPassword(id: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestAppException('password must be at least 8 characters');
    }
    const exists = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundAppException('Admin not found');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.admin.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async softDelete(id: string, requesterId: string) {
    if (id === requesterId) {
      throw new ForbiddenAppException('You cannot delete your own account');
    }
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundAppException('Admin not found');

    if (target.role === 'SUPER_ADMIN') {
      const remaining = await this.prisma.admin.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
      });
      if (remaining === 0) {
        throw new ForbiddenAppException('Cannot delete the last active Super Admin');
      }
    }

    await this.prisma.admin.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  /**
   * Fetch role assignments for a batch of admin IDs and group them by adminId.
   * AdminRoleAssignment has no Prisma relation to Admin (only to AdminCustomRole),
   * so we resolve manually.
   */
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
