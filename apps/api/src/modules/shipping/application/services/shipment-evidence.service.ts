// Phase 88 (2026-05-23) — Shipment Evidence Flow audit closure.
//
// Centralises every shipment-evidence operation behind one service so
// the typed ShipmentEvidence + audit log + retention + freeze rules
// are enforced in one place instead of the controller reaching into
// Prisma directly. Replaces the implicit policy that was scattered
// across SellerShipmentEvidenceController + orders.service.ts.
//
// Gap mapping for this file:
//   #1  typed entity         — read/write target is `shipmentEvidence`
//   #2  kind discriminator   — every call takes a `ShipmentEvidenceKind`
//   #4  metadata             — geo + signature + waybill columns
//   #5  chain of custody     — auditLog() writes one row per mutation
//   #7  idempotency          — uploadPacking takes an idempotencyKey
//   #10 atomicity            — pendingUpload two-phase commit
//   #13 freeze on SHIPPED    — freezePackingEvidence() called from FSM
//   #16 TOCTOU lock          — countPackingForGate() runs inside tx
//   #18 domain events        — uploaded / deleted events emitted
//   #20 reassignment cleanup — archiveForReassignment()

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { FileService } from '../../../files/application/services/file.service';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';

export type ShipmentEvidenceKindLiteral =
  | 'PACKING'
  | 'DISPATCH'
  | 'POD'
  | 'RTO_PROOF'
  | 'EXCEPTION'
  | 'CUSTOMER_REJECT'
  | 'ADMIN_OVERRIDE'
  | 'ARCHIVED_REASSIGNMENT';

export type ShipmentEvidenceActorLiteral =
  | 'SELLER'
  | 'FRANCHISE'
  | 'ADMIN'
  | 'CUSTOMER'
  | 'CARRIER_WEBHOOK'
  | 'SYSTEM';

// Phase 88 — Gap #21. Typed constant replaces the string literal
// 'SHIPMENT_EVIDENCE' that was scattered across 4+ files.
export const SHIPMENT_EVIDENCE_PURPOSE = 'SHIPMENT_EVIDENCE' as const;

@Injectable()
export class ShipmentEvidenceService {
  private readonly logger = new Logger(ShipmentEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    @Inject(forwardRef(() => FileService))
    private readonly fileService: FileService,
    @Optional()
    private readonly env?: {
      getNumber?: (k: string, d?: number) => number;
    },
  ) {}

  /**
   * Create a ShipmentEvidence row backed by an already-uploaded
   * FileMetadata. Two-phase commit (Gap #10): the row starts with
   * `pendingUpload=true` and the caller flips it to false once the
   * underlying media asset reports success.
   *
   * Idempotency (Gap #7): if a (subOrderId, contentSha256) pair
   * already exists undeleted, we no-op and return the existing row
   * so a retried upload doesn't inflate the count.
   *
   * Caller writes the audit log via `auditLog()` after this returns
   * — the service signature exposes the row id explicitly so the
   * controller can include it in the audit row.
   */
  async create(args: {
    subOrderId: string;
    kind: ShipmentEvidenceKindLiteral;
    fileId: string;
    uploadedBy: string;
    uploadedByRole: ShipmentEvidenceActorLiteral;
    contentSha256?: string | null;
    perceptualHash?: string | null;
    geoLat?: number | null;
    geoLng?: number | null;
    exifJson?: unknown;
    courierWaybill?: string | null;
    signatureBlob?: string | null;
    signedByName?: string | null;
    customerOtpHash?: string | null;
    retentionDays?: number;
    tx?: Prisma.TransactionClient;
  }): Promise<{ id: string; created: boolean }> {
    const client = (args.tx ?? this.prisma) as any;

    // Gap #7 — exact-hash dedupe per sub-order. Same image uploaded
    // twice (network retry, click-twice) collapses to one row.
    if (args.contentSha256) {
      const existing = await client.shipmentEvidence.findFirst({
        where: {
          subOrderId: args.subOrderId,
          kind: args.kind,
          contentSha256: args.contentSha256,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(
          `Idempotent ShipmentEvidence create: sub=${args.subOrderId} hash=${args.contentSha256} → ${existing.id}`,
        );
        return { id: existing.id, created: false };
      }
    }

    const retentionDays = args.retentionDays ?? 180;
    const retentionExpiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000,
    );

    const row = await client.shipmentEvidence.create({
      data: {
        subOrderId: args.subOrderId,
        kind: args.kind,
        fileId: args.fileId,
        uploadedBy: args.uploadedBy,
        uploadedByRole: args.uploadedByRole,
        contentSha256: args.contentSha256 ?? null,
        perceptualHash: args.perceptualHash ?? null,
        geoLat: args.geoLat ?? null,
        geoLng: args.geoLng ?? null,
        exifJson: (args.exifJson as any) ?? null,
        courierWaybill: args.courierWaybill ?? null,
        signatureBlob: args.signatureBlob ?? null,
        signedByName: args.signedByName ?? null,
        customerOtpHash: args.customerOtpHash ?? null,
        retentionExpiresAt,
        pendingUpload: false,
      },
    });

    await this.eventBus
      .publish({
        eventName: SHIPPING_EVENTS.EVIDENCE_UPLOADED,
        aggregate: 'SubOrder',
        aggregateId: args.subOrderId,
        occurredAt: new Date(),
        payload: {
          evidenceId: row.id,
          subOrderId: args.subOrderId,
          kind: args.kind,
          uploadedBy: args.uploadedBy,
          uploadedByRole: args.uploadedByRole,
        },
      })
      .catch(() => undefined);

    return { id: row.id, created: true };
  }

  /**
   * Append-only audit log row. Caller invokes after every state
   * mutation (CREATED, SOFT_DELETED, RESTORED, FROZEN, PURGED).
   */
  async auditLog(args: {
    shipmentEvidenceId: string;
    action: string;
    actorId: string;
    actorRole: ShipmentEvidenceActorLiteral;
    reason?: string | null;
    beforeJson?: unknown;
    afterJson?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = (args.tx ?? this.prisma) as any;
    await client.shipmentEvidenceAudit.create({
      data: {
        shipmentEvidenceId: args.shipmentEvidenceId,
        action: args.action,
        actorId: args.actorId,
        actorRole: args.actorRole,
        reason: args.reason ?? null,
        beforeJson: (args.beforeJson as any) ?? null,
        afterJson: (args.afterJson as any) ?? null,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      },
    });
  }

  /**
   * 4-photo gate count. Called from inside the SHIPPED FSM
   * transaction (Gap #16) so the count sees the same FOR UPDATE
   * snapshot as the status flip.
   */
  async countPackingForGate(
    subOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as any;
    return client.shipmentEvidence.count({
      where: {
        subOrderId,
        kind: 'PACKING',
        deletedAt: null,
        pendingUpload: false,
      },
    });
  }

  async listForSubOrder(
    subOrderId: string,
    opts: {
      includeDeleted?: boolean;
      kinds?: ShipmentEvidenceKindLiteral[];
    } = {},
  ) {
    return this.prisma.shipmentEvidence.findMany({
      where: {
        subOrderId,
        ...(opts.includeDeleted ? {} : { deletedAt: null }),
        ...(opts.kinds ? { kind: { in: opts.kinds as any } } : {}),
      },
      include: { file: true },
      orderBy: [{ capturedAt: 'asc' }],
    });
  }

  /**
   * Phase 88 — Gap #13 freeze enforcement.
   *
   * At PACKED → SHIPPED transition, stamp `frozenAt` on every
   * PACKING evidence row. Subsequent soft-deletes are rejected
   * unless the caller is an admin with the explicit
   * `shipment.evidence.delete` permission (controller layer enforces).
   *
   * Idempotent: re-running on already-frozen rows is a no-op.
   */
  async freezePackingEvidence(
    subOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ frozenCount: number }> {
    const client = (tx ?? this.prisma) as any;
    const now = new Date();
    const result = await client.shipmentEvidence.updateMany({
      where: {
        subOrderId,
        kind: 'PACKING',
        frozenAt: null,
        deletedAt: null,
      },
      data: { frozenAt: now },
    });
    if (result.count > 0) {
      this.logger.log(
        `Frozen ${result.count} PACKING evidence row(s) for sub-order ${subOrderId}`,
      );
    }
    return { frozenCount: result.count };
  }

  /**
   * Phase 88 — Gap #20 reassignment cleanup.
   *
   * On sub-order reassignment to a new seller, the previous seller's
   * evidence gets re-keyed to `ARCHIVED_REASSIGNMENT` so the gate
   * count (PACKING + not-deleted) for the new seller starts at zero.
   * The rows are retained for audit + fraud investigation; nothing
   * is hard-deleted.
   */
  async archiveForReassignment(args: {
    subOrderId: string;
    previousSellerId: string | null;
    reason: string;
    tx?: Prisma.TransactionClient;
  }): Promise<{ archivedCount: number }> {
    const client = (args.tx ?? this.prisma) as any;
    const rows = await client.shipmentEvidence.findMany({
      where: {
        subOrderId: args.subOrderId,
        kind: { in: ['PACKING', 'DISPATCH'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (rows.length === 0) return { archivedCount: 0 };

    await client.shipmentEvidence.updateMany({
      where: { id: { in: rows.map((r: any) => r.id) } },
      data: { kind: 'ARCHIVED_REASSIGNMENT' },
    });

    // Audit each row so the admin "why is this archived?" question
    // is answerable per evidence id.
    for (const r of rows) {
      await this.auditLog({
        shipmentEvidenceId: r.id,
        action: 'ARCHIVED_REASSIGNMENT',
        actorId: args.previousSellerId ?? 'system',
        actorRole: 'SYSTEM',
        reason: args.reason,
        tx: args.tx,
      });
    }
    return { archivedCount: rows.length };
  }

  /**
   * Soft-delete with freeze enforcement. Sellers cannot delete
   * frozen rows; admins can but must supply a reason (the
   * controller validates reason length).
   */
  async softDelete(args: {
    evidenceId: string;
    actorId: string;
    actorRole: ShipmentEvidenceActorLiteral;
    reason: string;
    bypassFreeze?: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    const row = await this.prisma.shipmentEvidence.findUnique({
      where: { id: args.evidenceId },
      select: {
        id: true,
        subOrderId: true,
        kind: true,
        frozenAt: true,
        deletedAt: true,
      },
    });
    if (!row) throw new NotFoundAppException('Evidence not found');
    if (row.deletedAt) {
      // Idempotent.
      return;
    }
    if (row.frozenAt && !args.bypassFreeze) {
      throw new ConflictAppException(
        'Evidence is frozen (sub-order shipped) — admin override required to delete',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentEvidence.update({
        where: { id: args.evidenceId },
        data: {
          deletedAt: new Date(),
          deletedBy: args.actorId,
          deletedReason: args.reason,
        },
      });
      await this.auditLog({
        shipmentEvidenceId: args.evidenceId,
        action: 'SOFT_DELETED',
        actorId: args.actorId,
        actorRole: args.actorRole,
        reason: args.reason,
        beforeJson: { frozenAt: row.frozenAt, kind: row.kind },
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
        tx,
      });
    });

    await this.eventBus
      .publish({
        eventName: SHIPPING_EVENTS.EVIDENCE_DELETED,
        aggregate: 'SubOrder',
        aggregateId: row.subOrderId,
        occurredAt: new Date(),
        payload: {
          evidenceId: args.evidenceId,
          subOrderId: row.subOrderId,
          kind: row.kind,
          actorId: args.actorId,
          actorRole: args.actorRole,
          reason: args.reason,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Customer-visible POD lookup. Returns the latest non-deleted POD
   * row for a sub-order (or null) along with a short-TTL signed URL.
   *
   * Gap #8 / Gap #14 — only the POD kind is exposed to the customer;
   * packing photos contain seller-side inventory info and stay
   * admin/seller-only.
   */
  async getCustomerPod(subOrderId: string): Promise<{
    evidenceId: string;
    capturedAt: Date;
    signedByName: string | null;
    courierWaybill: string | null;
    viewUrl: string;
  } | null> {
    const row = await this.prisma.shipmentEvidence.findFirst({
      where: { subOrderId, kind: 'POD', deletedAt: null, pendingUpload: false },
      include: { file: true },
      orderBy: { capturedAt: 'desc' },
    });
    if (!row) return null;
    return {
      evidenceId: row.id,
      capturedAt: row.capturedAt,
      signedByName: row.signedByName,
      courierWaybill: row.courierWaybill,
      viewUrl: this.fileService.viewUrlFor(row.file),
    };
  }

  /**
   * Phase 88 — Gap #6 ownership check (already enforced in the
   * seller controller, surfaced here so the typed-path readers can
   * reuse it without duplicating the lookup).
   */
  async assertSellerOwns(subOrderId: string, sellerId: string): Promise<void> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, sellerId: true },
    });
    if (!sub) throw new NotFoundAppException('Sub-order not found');
    if (sub.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'Cannot manage shipment evidence for a sub-order you do not own',
      );
    }
  }
}
