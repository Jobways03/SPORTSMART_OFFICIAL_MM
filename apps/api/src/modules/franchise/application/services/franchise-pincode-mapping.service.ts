import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import type {
  AssignPincodeDto,
  BulkAssignPincodesDto,
} from '../../presentation/dtos/franchise-pincode-mapping.dto';

const WRITABLE_FRANCHISE_STATUSES = ['ACTIVE', 'APPROVED'];
const DEFAULT_PRIORITY = 100;

export interface PincodeMappingActorCtx {
  adminId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 159m — admin pincode → franchise coverage map. Owns assignment,
 * bulk import, deactivation, conflict detection, the append-only history
 * trail, audit logging, and the change event. Routing consumes the mappings
 * separately (seller-allocation.service).
 */
@Injectable()
export class FranchisePincodeMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchisePincodeMappingService');
  }

  /**
   * List a franchise's mappings (active first), each annotated with any OTHER
   * franchises that also actively serve the same pincode (conflict view).
   */
  async list(franchiseId: string) {
    await this.assertFranchiseExists(franchiseId);
    const rows = await this.prisma.franchisePincodeMapping.findMany({
      where: { franchiseId },
      orderBy: [{ isActive: 'desc' }, { pincode: 'asc' }],
    });

    const activePincodes = rows.filter((r) => r.isActive).map((r) => r.pincode);
    const conflicts = activePincodes.length
      ? await this.prisma.franchisePincodeMapping.findMany({
          where: {
            pincode: { in: activePincodes },
            isActive: true,
            franchiseId: { not: franchiseId },
          },
          select: { pincode: true, franchiseId: true, priority: true },
        })
      : [];
    const conflictByPincode = new Map<
      string,
      Array<{ franchiseId: string; priority: number }>
    >();
    for (const c of conflicts) {
      const list = conflictByPincode.get(c.pincode) ?? [];
      list.push({ franchiseId: c.franchiseId, priority: c.priority });
      conflictByPincode.set(c.pincode, list);
    }

    return rows.map((r) => ({
      ...r,
      conflictsWith: conflictByPincode.get(r.pincode) ?? [],
    }));
  }

  /** Assign / update / (de)activate a single pincode for a franchise. */
  async assign(
    franchiseId: string,
    dto: AssignPincodeDto,
    ctx: PincodeMappingActorCtx,
  ) {
    await this.assertWritableFranchise(franchiseId);
    await this.assertPincodeExists(dto.pincode);

    const cleanReason = this.clean(dto.reason);
    const existing = await this.prisma.franchisePincodeMapping.findUnique({
      where: {
        franchiseId_pincode: { franchiseId, pincode: dto.pincode },
      },
    });

    if (
      existing &&
      dto.expectedVersion !== undefined &&
      existing.version !== dto.expectedVersion
    ) {
      throw new ConflictAppException(
        'Pincode mapping changed since you loaded it. Reload and retry.',
      );
    }

    const priority = dto.priority ?? existing?.priority ?? DEFAULT_PRIORITY;
    const isActive = dto.isActive ?? existing?.isActive ?? true;
    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      let result;
      let action: string;
      if (existing) {
        const cas = await tx.franchisePincodeMapping.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            priority,
            isActive,
            reason: cleanReason,
            version: { increment: 1 },
            ...(isActive
              ? { removedAt: null, removedById: null, assignedById: ctx.adminId ?? null, assignedAt: now }
              : { removedAt: now, removedById: ctx.adminId ?? null }),
          },
        });
        if (cas.count === 0) {
          throw new ConflictAppException(
            'Pincode mapping changed concurrently. Reload and retry.',
          );
        }
        action =
          existing.isActive && !isActive
            ? 'DEACTIVATED'
            : !existing.isActive && isActive
              ? 'REACTIVATED'
              : existing.priority !== priority
                ? 'PRIORITY_CHANGED'
                : 'ASSIGNED';
        result = await tx.franchisePincodeMapping.findUnique({
          where: { id: existing.id },
        });
      } else {
        result = await tx.franchisePincodeMapping.create({
          data: {
            franchiseId,
            pincode: dto.pincode,
            priority,
            isActive,
            reason: cleanReason,
            assignedById: ctx.adminId ?? null,
          },
        });
        action = 'ASSIGNED';
      }
      await tx.franchisePincodeMappingEvent.create({
        data: {
          mappingId: result!.id,
          franchiseId,
          pincode: dto.pincode,
          action,
          oldValue: existing
            ? { priority: existing.priority, isActive: existing.isActive }
            : undefined,
          newValue: { priority, isActive },
          reason: cleanReason,
          actorId: ctx.adminId ?? null,
        },
      });
      return result;
    });

    this.writeAudit(ctx, {
      action: 'FRANCHISE_PINCODE_ASSIGNED',
      resourceId: row!.id,
      metadata: { franchiseId, pincode: dto.pincode, priority, isActive },
    });
    this.publish(franchiseId, {
      pincode: dto.pincode,
      action: 'ASSIGN',
      priority,
      isActive,
    });
    return row;
  }

  /**
   * Bulk-assign many pincodes to a franchise at one priority. All-or-nothing:
   * every pincode is validated against the PostOffice catalogue first; if any
   * is unknown the whole batch is rejected (no partial insert).
   */
  async bulkAssign(
    franchiseId: string,
    dto: BulkAssignPincodesDto,
    ctx: PincodeMappingActorCtx,
  ) {
    await this.assertWritableFranchise(franchiseId);

    const pincodes = Array.from(new Set(dto.pincodes));
    const known = await this.prisma.postOffice.findMany({
      where: { pincode: { in: pincodes } },
      distinct: ['pincode'],
      select: { pincode: true },
    });
    const knownSet = new Set(known.map((k) => k.pincode));
    const invalid = pincodes.filter((p) => !knownSet.has(p));
    if (invalid.length > 0) {
      throw new BadRequestAppException(
        `Rejected: ${invalid.length} unknown pincode(s) — e.g. ${invalid
          .slice(0, 5)
          .join(', ')}. No mappings were saved.`,
      );
    }

    const priority = dto.priority ?? DEFAULT_PRIORITY;
    const cleanReason = this.clean(dto.reason);

    await this.prisma.$transaction(async (tx) => {
      for (const pincode of pincodes) {
        await tx.franchisePincodeMapping.upsert({
          where: { franchiseId_pincode: { franchiseId, pincode } },
          create: {
            franchiseId,
            pincode,
            priority,
            isActive: true,
            reason: cleanReason,
            assignedById: ctx.adminId ?? null,
          },
          update: {
            priority,
            isActive: true,
            reason: cleanReason,
            removedAt: null,
            removedById: null,
            assignedById: ctx.adminId ?? null,
            assignedAt: new Date(),
            version: { increment: 1 },
          },
        });
      }
      await tx.franchisePincodeMappingEvent.create({
        data: {
          franchiseId,
          pincode: `${pincodes.length} pincode(s)`,
          action: 'BULK_ASSIGNED',
          newValue: { count: pincodes.length, priority, pincodes },
          reason: cleanReason,
          actorId: ctx.adminId ?? null,
        },
      });
    });

    this.writeAudit(ctx, {
      action: 'FRANCHISE_PINCODE_BULK_ASSIGNED',
      resourceId: franchiseId,
      metadata: { franchiseId, count: pincodes.length, priority },
    });
    this.publish(franchiseId, { action: 'BULK_ASSIGN', count: pincodes.length, priority });
    return { assigned: pincodes.length };
  }

  /** Soft-remove (deactivate) a mapping — row + history retained. */
  async remove(
    franchiseId: string,
    mappingId: string,
    ctx: PincodeMappingActorCtx,
  ) {
    const row = await this.prisma.franchisePincodeMapping.findUnique({
      where: { id: mappingId },
    });
    if (!row || row.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Pincode mapping not found');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.franchisePincodeMapping.update({
        where: { id: mappingId },
        data: {
          isActive: false,
          removedAt: now,
          removedById: ctx.adminId ?? null,
          version: { increment: 1 },
        },
      });
      await tx.franchisePincodeMappingEvent.create({
        data: {
          mappingId,
          franchiseId,
          pincode: row.pincode,
          action: 'REMOVED',
          oldValue: { priority: row.priority, isActive: row.isActive },
          newValue: { isActive: false },
          actorId: ctx.adminId ?? null,
        },
      });
    });

    this.writeAudit(ctx, {
      action: 'FRANCHISE_PINCODE_REMOVED',
      resourceId: mappingId,
      metadata: { franchiseId, pincode: row.pincode },
    });
    this.publish(franchiseId, { pincode: row.pincode, action: 'REMOVE' });
    return { success: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async assertFranchiseExists(franchiseId: string) {
    const f = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true },
    });
    if (!f) throw new NotFoundAppException('Franchise not found');
  }

  private async assertWritableFranchise(franchiseId: string) {
    const f = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true, status: true },
    });
    if (!f) throw new NotFoundAppException('Franchise not found');
    if (!WRITABLE_FRANCHISE_STATUSES.includes(f.status)) {
      throw new ForbiddenAppException(
        `Cannot edit pincode coverage for a franchise in status ${f.status}. Franchise must be ACTIVE or APPROVED.`,
      );
    }
  }

  private async assertPincodeExists(pincode: string) {
    const po = await this.prisma.postOffice.findFirst({
      where: { pincode },
      select: { pincode: true },
    });
    if (!po) {
      throw new BadRequestAppException(
        `Pincode ${pincode} is not a known Indian PIN code.`,
      );
    }
  }

  private clean(s: string | undefined): string | null {
    if (!s) return null;
    return s.replace(/<[^>]*>/g, '').trim() || null;
  }

  private writeAudit(
    ctx: PincodeMappingActorCtx,
    args: { action: string; resourceId: string; metadata: Record<string, unknown> },
  ): void {
    this.audit
      .writeAuditLog({
        actorId: ctx.adminId ?? 'unknown',
        actorRole: 'ADMIN',
        action: args.action,
        module: 'franchise',
        resource: 'FranchisePincodeMapping',
        resourceId: args.resourceId,
        oldValue: null,
        newValue: args.metadata,
        metadata: args.metadata,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      .catch(() => undefined);
  }

  private publish(franchiseId: string, payload: Record<string, unknown>): void {
    this.eventBus
      .publish({
        eventName: 'franchise.pincode_mapping.changed',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: { franchiseId, ...payload },
      })
      .catch(() => undefined);
  }
}
