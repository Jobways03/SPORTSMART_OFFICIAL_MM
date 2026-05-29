import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  NotFoundAppException,
  ConflictAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { newInviteToken } from '../auth/franchise-staff-token.util';

interface AddStaffInput {
  name: string;
  email: string;
  phone?: string;
  role: string;
}

interface UpdateStaffInput {
  name?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
}

@Injectable()
export class FranchiseStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('FranchiseStaffService');
  }

  // Phase 159t (audit #9) — fire-and-forget staff-lifecycle audit row.
  private recordAudit(args: {
    actorId: string;
    action: string;
    staffId: string;
    franchiseId: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.audit
      .writeAuditLog({
        actorId: args.actorId,
        actorRole: 'FRANCHISE_OWNER',
        action: args.action,
        module: 'franchise',
        resource: 'FranchiseStaff',
        resourceId: args.staffId,
        oldValue: null,
        newValue: null,
        metadata: { franchiseId: args.franchiseId, ...(args.metadata ?? {}) },
      })
      .catch(() => undefined);
  }

  async listStaff(franchiseId: string) {
    const staff = await this.prisma.franchiseStaff.findMany({
      where: { franchiseId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return staff;
  }

  async addStaff(franchiseId: string, data: AddStaffInput, actorId: string) {
    // Phase 159t (audit #5) — the duplicate check is now scoped to THIS
    // franchise and ignores TERMINATED rows, so it neither leaks whether the
    // email is registered at another franchise (enumeration) nor blocks a
    // re-hire / multi-franchise employee. The partial unique index is the
    // source of truth; the P2002 fallback maps to the same response.
    const existing = await this.prisma.franchiseStaff.findFirst({
      where: { franchiseId, email: data.email, status: { not: 'TERMINATED' } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictAppException(
        'A staff member with this email already exists at your franchise',
      );
    }

    // Phase 159u (B4) — INVITATION flow, NOT an owner-typed password. Create the
    // staff as INVITED with no password + a one-time invite token; the staff
    // activates and sets their OWN password via /franchise/staff/auth/activate.
    // The raw token is returned so it can be delivered to the staff (production:
    // email an activation link to data.email rather than return it here).
    const invite = newInviteToken();

    try {
      const staff = await this.prisma.franchiseStaff.create({
        data: {
          franchiseId,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          // passwordHash null until activation.
          role: data.role as any,
          status: 'INVITED',
          isActive: false,
          inviteTokenHash: invite.hash,
          inviteExpiresAt: invite.expiresAt,
          createdBy: actorId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          isActive: true,
          createdAt: true,
        },
      });

      this.recordAudit({
        actorId,
        action: 'FRANCHISE_STAFF_INVITED',
        staffId: staff.id,
        franchiseId,
        metadata: { role: staff.role },
      });
      this.logger.log(`Staff member invited to franchise ${franchiseId}: ${staff.id}`);

      return { ...staff, inviteToken: invite.raw, inviteExpiresAt: invite.expiresAt };
    } catch (err: any) {
      // P2002 = unique-constraint violation (the per-franchise email partial
      // unique). Map to the same franchise-scoped message — never reveals
      // cross-franchise existence.
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          'A staff member with this email already exists at your franchise',
        );
      }
      throw err;
    }
  }

  async updateStaff(
    franchiseId: string,
    staffId: string,
    data: UpdateStaffInput,
    actorId: string,
  ) {
    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new NotFoundAppException('Staff member not found');
    }

    if (staff.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.role !== undefined) updateData.role = data.role;
    // Phase 159t (audit #12) — keep status + isActive in sync. isActive=false
    // here is a (reversible) SUSPEND; a terminate is removeStaff. A terminated
    // staff can't be silently reactivated via this path.
    if (data.isActive !== undefined) {
      if (staff.status === 'TERMINATED') {
        throw new ConflictAppException(
          'This staff member is terminated; re-add them instead of reactivating',
        );
      }
      updateData.isActive = data.isActive;
      updateData.status = data.isActive ? 'ACTIVE' : 'SUSPENDED';
      if (!data.isActive) {
        updateData.suspendedBy = actorId;
        updateData.suspendedAt = new Date();
      } else {
        updateData.suspendedBy = null;
        updateData.suspendedAt = null;
        updateData.suspensionReason = null;
      }
    }

    const updated = await this.prisma.franchiseStaff.update({
      where: { id: staffId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit the consequential changes (role change, suspend/reactivate).
    if (data.role !== undefined && data.role !== staff.role) {
      this.recordAudit({
        actorId,
        action: 'FRANCHISE_STAFF_ROLE_CHANGED',
        staffId,
        franchiseId,
        metadata: { from: staff.role, to: data.role },
      });
    }
    if (data.isActive !== undefined && data.isActive !== staff.isActive) {
      // Phase 159u (staff-auth) — suspending kills active sessions.
      if (!data.isActive) {
        await this.prisma.franchiseStaffSession.updateMany({
          where: { staffId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      this.recordAudit({
        actorId,
        action: data.isActive ? 'FRANCHISE_STAFF_REACTIVATED' : 'FRANCHISE_STAFF_SUSPENDED',
        staffId,
        franchiseId,
      });
    }
    this.logger.log(`Staff member updated: ${staffId} (franchise ${franchiseId})`);

    return updated;
  }

  async removeStaff(
    franchiseId: string,
    staffId: string,
    actorId: string,
    reason?: string,
  ) {
    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new NotFoundAppException('Staff member not found');
    }

    if (staff.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    // Phase 159t (audit #8/#12) — terminate with actor + reason + timestamp.
    // TERMINATED frees the (franchiseId, email/phone) partial unique so the
    // person can be re-added later (audit #6).
    await this.prisma.franchiseStaff.update({
      where: { id: staffId },
      data: {
        isActive: false,
        status: 'TERMINATED',
        suspendedBy: actorId,
        suspendedAt: new Date(),
        suspensionReason: reason ?? null,
      },
    });

    // Phase 159u (staff-auth) — kill the fired staff's sessions immediately.
    await this.prisma.franchiseStaffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.recordAudit({
      actorId,
      action: 'FRANCHISE_STAFF_TERMINATED',
      staffId,
      franchiseId,
      metadata: { reason: reason ?? null },
    });
    this.logger.log(`Staff member terminated: ${staffId} (franchise ${franchiseId})`);
  }

  async getStaff(franchiseId: string, staffId: string) {
    // Phase 159t (audit #13) — a single franchise-scoped query is the whole
    // safety check. The previous version did an unscoped findUnique + a no-op
    // runtime guard (the select omitted franchiseId, so the comparison always
    // fell through) + then this same re-fetch. Dropped the dead first pass.
    const staff = await this.prisma.franchiseStaff.findFirst({
      where: { id: staffId, franchiseId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        isActive: true,
        createdBy: true,
        suspendedBy: true,
        suspendedAt: true,
        suspensionReason: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!staff) {
      // Same response whether the id doesn't exist or belongs to another
      // franchise — no cross-franchise existence leak.
      throw new NotFoundAppException('Staff member not found');
    }

    return staff;
  }
}
