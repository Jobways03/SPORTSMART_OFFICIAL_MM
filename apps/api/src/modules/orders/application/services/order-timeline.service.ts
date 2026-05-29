import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 84 (2026-05-23) — order timeline / status history.
 *
 * Single recorder for every status-transition event. Every status-
 * mutation method in OrdersService (verify, accept, reject, pack,
 * ship, deliver, cancel, reassign) calls `record(...)` inside its
 * own transaction so the timeline row commits atomically with the
 * state change.
 *
 * Read paths:
 *   • GET /admin/orders/:id/timeline          — all events
 *   • GET /customer/orders/:n/timeline        — visibility-filtered
 *
 * Idempotency: writers that may retry (outbox replay, webhook
 * re-delivery) supply an `idempotencyKey` derived from the source
 * event. The unique index on `idempotency_key` blocks duplicates at
 * the DB layer; the service catches the P2002 and returns the
 * existing row.
 */

export type TimelineActorType =
  | 'SYSTEM'
  | 'ADMIN'
  | 'SELLER'
  | 'FRANCHISE'
  | 'CUSTOMER'
  | 'CARRIER';

export type TimelineVisibility =
  | 'ADMIN_ONLY'
  | 'CUSTOMER_VISIBLE'
  | 'SELLER_VISIBLE'
  | 'FRANCHISE_VISIBLE';

export type OrderTimelineEventType =
  // Master-order lifecycle
  | 'ORDER_PLACED'
  | 'ORDER_PAYMENT_CAPTURED'
  | 'ORDER_VERIFICATION_CLAIMED'
  | 'ORDER_VERIFICATION_RELEASED'
  | 'ORDER_VERIFICATION_AUTO_EXPIRED'
  | 'ORDER_VERIFIED'
  | 'ORDER_REJECTED'
  | 'ORDER_ROUTED_TO_SELLER'
  | 'ORDER_EXCEPTION_QUEUE'
  | 'ORDER_PARTIALLY_SHIPPED'
  | 'ORDER_PARTIALLY_DELIVERED'
  | 'ORDER_PARTIALLY_CANCELLED'
  | 'ORDER_DELIVERED'
  | 'ORDER_CANCELLED'
  // Sub-order lifecycle
  | 'SUBORDER_ASSIGNED'
  | 'SUBORDER_ACCEPTED'
  | 'SUBORDER_REJECTED_MANUAL'
  | 'SUBORDER_REJECTED_AUTO_SLA'
  | 'SUBORDER_REASSIGNED'
  | 'SUBORDER_PACKED'
  | 'SUBORDER_SHIPPED'
  | 'SUBORDER_OUT_FOR_DELIVERY'
  | 'SUBORDER_DELIVERED_WEBHOOK'
  | 'SUBORDER_DELIVERED_MANUAL'
  | 'SUBORDER_NDR_ATTEMPT'
  | 'SUBORDER_CANCELLED_BY_ADMIN'
  // Payment / Refund
  | 'PAYMENT_INTENT_CREATED'
  | 'PAYMENT_CAPTURED'
  | 'PAYMENT_FAILED'
  | 'REFUND_INITIATED'
  | 'REFUND_COMPLETED'
  | 'REFUND_FAILED'
  // Commission / Settlement
  | 'COMMISSION_LOCKED'
  | 'COMMISSION_PAID'
  | 'COMMISSION_REVERSED';

export interface RecordTimelineInput {
  masterOrderId: string;
  subOrderId?: string | null;
  eventType: OrderTimelineEventType;
  oldStatus?: string | null;
  newStatus?: string | null;
  actorType: TimelineActorType;
  actorId?: string | null;
  actorName?: string | null;
  visibility?: TimelineVisibility;
  note?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Stable key for the source event. When supplied, the unique index
   * on (idempotency_key) absorbs retries — a re-publish from the
   * outbox or a Shiprocket webhook re-delivery returns the existing
   * row instead of creating a duplicate.
   */
  idempotencyKey?: string | null;
}

// Phase 84 — Gap #14. Per-eventType default visibility. Centralised
// so the timeline visibility model lives in one place rather than
// scattered across every writer.
const DEFAULT_VISIBILITY: Record<OrderTimelineEventType, TimelineVisibility> = {
  ORDER_PLACED: 'CUSTOMER_VISIBLE',
  ORDER_PAYMENT_CAPTURED: 'CUSTOMER_VISIBLE',
  ORDER_VERIFICATION_CLAIMED: 'ADMIN_ONLY',
  ORDER_VERIFICATION_RELEASED: 'ADMIN_ONLY',
  ORDER_VERIFICATION_AUTO_EXPIRED: 'ADMIN_ONLY',
  ORDER_VERIFIED: 'CUSTOMER_VISIBLE',
  ORDER_REJECTED: 'CUSTOMER_VISIBLE',
  ORDER_ROUTED_TO_SELLER: 'CUSTOMER_VISIBLE',
  ORDER_EXCEPTION_QUEUE: 'ADMIN_ONLY',
  ORDER_PARTIALLY_SHIPPED: 'CUSTOMER_VISIBLE',
  ORDER_PARTIALLY_DELIVERED: 'CUSTOMER_VISIBLE',
  ORDER_PARTIALLY_CANCELLED: 'CUSTOMER_VISIBLE',
  ORDER_DELIVERED: 'CUSTOMER_VISIBLE',
  ORDER_CANCELLED: 'CUSTOMER_VISIBLE',
  SUBORDER_ASSIGNED: 'SELLER_VISIBLE',
  SUBORDER_ACCEPTED: 'CUSTOMER_VISIBLE',
  SUBORDER_REJECTED_MANUAL: 'CUSTOMER_VISIBLE',
  SUBORDER_REJECTED_AUTO_SLA: 'CUSTOMER_VISIBLE',
  SUBORDER_REASSIGNED: 'CUSTOMER_VISIBLE',
  SUBORDER_PACKED: 'CUSTOMER_VISIBLE',
  SUBORDER_SHIPPED: 'CUSTOMER_VISIBLE',
  SUBORDER_OUT_FOR_DELIVERY: 'CUSTOMER_VISIBLE',
  SUBORDER_DELIVERED_WEBHOOK: 'CUSTOMER_VISIBLE',
  SUBORDER_DELIVERED_MANUAL: 'CUSTOMER_VISIBLE',
  SUBORDER_NDR_ATTEMPT: 'CUSTOMER_VISIBLE',
  SUBORDER_CANCELLED_BY_ADMIN: 'CUSTOMER_VISIBLE',
  PAYMENT_INTENT_CREATED: 'ADMIN_ONLY',
  PAYMENT_CAPTURED: 'CUSTOMER_VISIBLE',
  PAYMENT_FAILED: 'CUSTOMER_VISIBLE',
  REFUND_INITIATED: 'CUSTOMER_VISIBLE',
  REFUND_COMPLETED: 'CUSTOMER_VISIBLE',
  REFUND_FAILED: 'ADMIN_ONLY',
  COMMISSION_LOCKED: 'SELLER_VISIBLE',
  COMMISSION_PAID: 'SELLER_VISIBLE',
  COMMISSION_REVERSED: 'SELLER_VISIBLE',
};

// Phase 84 — Gap #14 customer-friendly labels. Internal English
// reason texts are stripped for customer reads; the label is the
// safe public version.
const CUSTOMER_LABEL: Partial<Record<OrderTimelineEventType, string>> = {
  ORDER_PLACED: 'Order placed',
  ORDER_PAYMENT_CAPTURED: 'Payment received',
  ORDER_VERIFIED: 'Order confirmed',
  ORDER_REJECTED: 'Order could not be processed',
  ORDER_ROUTED_TO_SELLER: 'Finding a seller for your order',
  ORDER_PARTIALLY_SHIPPED: 'Part of your order has shipped',
  ORDER_PARTIALLY_DELIVERED: 'Part of your order has arrived',
  ORDER_PARTIALLY_CANCELLED: 'Part of your order was cancelled',
  ORDER_DELIVERED: 'Order delivered',
  ORDER_CANCELLED: 'Order cancelled',
  SUBORDER_ACCEPTED: 'Seller accepted your order',
  SUBORDER_REJECTED_MANUAL: 'Finding an alternate seller',
  SUBORDER_REJECTED_AUTO_SLA: 'Finding an alternate seller',
  SUBORDER_REASSIGNED: 'Routed to a faster seller',
  SUBORDER_PACKED: 'Your order is packed and ready to ship',
  SUBORDER_SHIPPED: 'Shipped',
  SUBORDER_OUT_FOR_DELIVERY: 'Out for delivery',
  SUBORDER_DELIVERED_WEBHOOK: 'Delivered',
  SUBORDER_DELIVERED_MANUAL: 'Delivered',
  SUBORDER_NDR_ATTEMPT: 'Delivery attempt unsuccessful — courier will retry',
  SUBORDER_CANCELLED_BY_ADMIN: 'Part of your order was cancelled',
  PAYMENT_CAPTURED: 'Payment received',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_INITIATED: 'Refund initiated',
  REFUND_COMPLETED: 'Refund completed',
};

// Phase 84 — Gap #16/#5. Per-eventType customer-safe metadata
// whitelist. Customer reads only see these fields; admin reads see
// the full payload. Defaults to empty (nothing leaks) for any
// eventType not in the map.
const CUSTOMER_METADATA_WHITELIST: Partial<
  Record<OrderTimelineEventType, readonly string[]>
> = {
  SUBORDER_SHIPPED: ['trackingNumber', 'courierName', 'trackingUrl'],
  SUBORDER_OUT_FOR_DELIVERY: ['trackingNumber', 'courierName'],
  SUBORDER_DELIVERED_WEBHOOK: ['deliveredAt'],
  SUBORDER_DELIVERED_MANUAL: ['deliveredAt'],
  REFUND_INITIATED: ['amountInRupees', 'refundMethod'],
  REFUND_COMPLETED: ['amountInRupees', 'refundMethod'],
};

@Injectable()
export class OrderTimelineService {
  private readonly logger = new Logger(OrderTimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a status-transition event. Designed to be called inside
   * the same transaction as the source mutation; pass `tx` so the
   * row commits atomically with the state change.
   *
   * Returns the created (or existing, on idempotency hit) row id.
   */
  async record(
    input: RecordTimelineInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const visibility =
      input.visibility ?? DEFAULT_VISIBILITY[input.eventType] ?? 'ADMIN_ONLY';

    try {
      const row = await client.orderStatusHistory.create({
        data: {
          masterOrderId: input.masterOrderId,
          subOrderId: input.subOrderId ?? null,
          eventType: input.eventType as any,
          oldStatus: input.oldStatus ?? null,
          newStatus: input.newStatus ?? null,
          actorType: input.actorType as any,
          actorId: input.actorId ?? null,
          actorName: input.actorName ?? null,
          visibility: visibility as any,
          note: input.note ?? null,
          reason: input.reason ?? null,
          metadata: (input.metadata ?? undefined) as any,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err: any) {
      // Phase 84 — R3 idempotency on retry. P2002 = unique-constraint
      // violation. If the idempotency key already exists, return the
      // pre-existing row id instead of re-throwing — the source event
      // is the same logical action, so the timeline already reflects
      // it.
      if (err?.code === 'P2002' && input.idempotencyKey) {
        const existing = await client.orderStatusHistory.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          this.logger.debug(
            `Timeline idempotency hit: ${input.eventType} ${input.idempotencyKey}`,
          );
          return existing.id;
        }
      }
      throw err;
    }
  }

  /**
   * Read the timeline for a master order. Admin path returns
   * everything; customer path filters by visibility=CUSTOMER_VISIBLE
   * and strips metadata to the per-eventType whitelist.
   */
  async getTimeline(
    masterOrderId: string,
    opts: {
      audience: 'ADMIN' | 'CUSTOMER';
      limit?: number;
      before?: Date;
      eventType?: OrderTimelineEventType;
    },
  ): Promise<{
    items: Array<any>;
    total: number;
    nextCursor: Date | null;
  }> {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
    const where: any = { masterOrderId };
    if (opts.audience === 'CUSTOMER') {
      where.visibility = 'CUSTOMER_VISIBLE';
    }
    if (opts.before) where.createdAt = { lt: opts.before };
    if (opts.eventType) where.eventType = opts.eventType;

    const [rows, total] = await Promise.all([
      this.prisma.orderStatusHistory.findMany({
        where,
        // (created_at, id) deterministic ordering — id breaks ms-level ties (Gap #10).
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.orderStatusHistory.count({ where }),
    ]);

    const items = rows.map((r) =>
      opts.audience === 'CUSTOMER'
        ? this.toCustomerEvent(r as any)
        : this.toAdminEvent(r as any),
    );
    const nextCursor =
      rows.length === limit && rows.length > 0
        ? (rows[rows.length - 1] as any).createdAt
        : null;
    return { items, total, nextCursor };
  }

  private toAdminEvent(r: any) {
    return {
      id: r.id,
      masterOrderId: r.masterOrderId,
      subOrderId: r.subOrderId,
      eventType: r.eventType,
      oldStatus: r.oldStatus,
      newStatus: r.newStatus,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorName,
      visibility: r.visibility,
      note: r.note,
      reason: r.reason,
      metadata: r.metadata,
      createdAt: r.createdAt,
    };
  }

  private toCustomerEvent(r: any) {
    // Phase 84 — Gaps #5/#16. Customer-safe projection:
    //   • Hide actor name / id (internal staff identifiers).
    //   • Replace `reason` with a friendly label keyed off
    //     eventType (no leakage of internal reason text).
    //   • Filter metadata to the per-eventType whitelist.
    //   • Keep tracking URL + courier in metadata when SHIPPED so
    //     the customer page can render the "Track your order" link.
    const label = CUSTOMER_LABEL[r.eventType as OrderTimelineEventType] ?? null;
    const whitelist =
      CUSTOMER_METADATA_WHITELIST[r.eventType as OrderTimelineEventType] ?? [];
    const safeMetadata =
      r.metadata && typeof r.metadata === 'object'
        ? Object.fromEntries(
            Object.entries(r.metadata).filter(([k]) =>
              (whitelist as readonly string[]).includes(k),
            ),
          )
        : null;
    return {
      id: r.id,
      subOrderId: r.subOrderId,
      eventType: r.eventType,
      label,
      newStatus: r.newStatus,
      metadata: safeMetadata && Object.keys(safeMetadata).length > 0 ? safeMetadata : null,
      createdAt: r.createdAt,
    };
  }
}
