// Phase B (P0.3, P0.4) — Discount redemption reservation service.
//
// Owns the RESERVED → REDEEMED / RELEASED lifecycle on the
// `discount_redemptions` table. Three responsibilities:
//
//   1. Reserve a redemption slot at checkout time, respecting
//      maxUses and onePerCustomer with strict concurrency safety.
//   2. Promote a RESERVED row to REDEEMED on order commit (called
//      from inside the checkout transaction).
//   3. Release a RESERVED row on checkout failure or TTL expiry
//      so other customers can use the coupon.
//
// Concurrency model (Default Decision #8):
//   Reserve uses a Postgres row lock on the parent Discount row
//   (`SELECT ... FOR UPDATE`) inside a Prisma interactive
//   transaction. The lock is held only during the count-and-insert
//   — never across external calls (payment gateways, etc.).
//
// Belt-and-suspenders (security patch 20260508130000):
//   Two partial unique indexes prevent a service-layer race from
//   creating duplicate active redemptions. If a race somehow slips
//   past the row lock, the DB still rejects the duplicate insert
//   with a unique-constraint violation.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DiscountEventsService } from './discount-events.service';
import { DiscountAffiliateUnificationService } from './discount-affiliate-unification.service';

/** Default reservation TTL — Default Decision #3. */
export const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

export interface ReserveInput {
  discountId: string;
  /** Optional — for child-code campaigns (P0.6). Null for legacy single-code discounts. */
  discountCodeId?: string | null;
  /** Snapshot of code-as-typed for audit / debugging. */
  discountCode?: string | null;
  customerId: string;
  /** Computed by the validation step; this is what the customer was promised. */
  discountAmountInPaise: bigint;
  /** Where the redemption came from (CODE / AUTOMATIC / AFFILIATE). */
  source?: 'CODE' | 'AUTOMATIC' | 'AFFILIATE';
  /**
   * Idempotency key from the checkout request. Two reserve() calls
   * with the same key return the same row — never create a second.
   * Required by spec for safe retry semantics.
   */
  idempotencyKey: string;
  /** Optional: override TTL (e.g. tests). */
  ttlMs?: number;
}

export interface ReserveResult {
  redemptionId: string;
  /** True if this call inserted; false if it returned the same row (idempotent). */
  created: boolean;
  expiresAt: Date;
  discountAmountInPaise: bigint;
}

export class ReservationConflictError extends Error {
  constructor(
    public readonly reason:
      | 'MAX_USES_REACHED'
      | 'ALREADY_REDEEMED_BY_CUSTOMER'
      | 'CONCURRENT_RESERVATION',
    message: string,
  ) {
    super(message);
    this.name = 'ReservationConflictError';
  }
}

export class DiscountUnavailableError extends Error {
  constructor(
    public readonly reason:
      | 'NOT_FOUND'
      | 'INACTIVE'
      | 'NOT_STARTED'
      | 'EXPIRED',
    message: string,
  ) {
    super(message);
    this.name = 'DiscountUnavailableError';
  }
}

@Injectable()
export class DiscountReservationService {
  private readonly logger = new Logger(DiscountReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase E (P1.1) — audit + outbox emission on lifecycle
    // transitions. Best-effort; reservation correctness lives in
    // the DB row-lock + partial unique indexes, not in audit.
    private readonly events: DiscountEventsService,
    // Phase F (P2.3) — when the redeemed Discount carries an
    // affiliateId, fire the unification hook so a ReferralAttribution
    // is written + the affiliate-side usedCount stays in sync.
    private readonly affiliateUnification: DiscountAffiliateUnificationService,
  ) {}

  /**
   * Reserve a redemption slot. Idempotent on `idempotencyKey`.
   *
   * Uses a transaction with `SELECT ... FOR UPDATE` on the parent
   * Discount row. The lock serializes concurrent reservations for
   * the same Discount; the count-and-insert inside the lock can't
   * overshoot maxUses.
   *
   * Throws:
   *   - DiscountUnavailableError(NOT_FOUND/INACTIVE/NOT_STARTED/EXPIRED)
   *   - ReservationConflictError(MAX_USES_REACHED/ALREADY_REDEEMED_BY_CUSTOMER)
   *   - rethrows any other Prisma error
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const ttlMs = input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    return this.prisma.$transaction(async (tx) => {
      // Fast path — idempotency. If a row with this exact key
      // already exists for this (discount, customer), return it.
      // Lookup is on discountCodeId (or discountId for legacy)
      // + customerId + status='RESERVED' + idempotencyKey.
      const existing = await tx.discountRedemption.findFirst({
        where: {
          discountId: input.discountId,
          discountCodeId: input.discountCodeId ?? null,
          customerId: input.customerId,
          idempotencyKey: input.idempotencyKey,
          status: { in: ['RESERVED', 'REDEEMED'] },
        },
      });
      if (existing) {
        return {
          redemptionId: existing.id,
          created: false,
          expiresAt: existing.expiresAt,
          discountAmountInPaise: existing.discountAmountInPaise,
        };
      }

      // Row-lock the parent Discount. Postgres `SELECT FOR UPDATE`
      // serializes concurrent transactions on this exact row, so
      // the count-and-insert below is atomic with respect to other
      // reservers.
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          maxUses: number | null;
          onePerCustomer: boolean;
          status: string;
          startsAt: Date;
          endsAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT id, max_uses AS "maxUses", one_per_customer AS "onePerCustomer",
               status, starts_at AS "startsAt", ends_at AS "endsAt"
        FROM discounts
        WHERE id = ${input.discountId}
        FOR UPDATE
      `);

      if (lockedRows.length === 0) {
        throw new DiscountUnavailableError('NOT_FOUND', 'Discount not found');
      }
      const discount = lockedRows[0];

      // Lifecycle gate. Status DRAFT or EXPIRED must reject
      // immediately; this is a defense-in-depth check (the
      // optimistic validate at coupon-apply time also rejects,
      // but a coupon could expire between apply and reserve).
      const now = new Date();
      if (discount.status === 'DRAFT') {
        throw new DiscountUnavailableError('INACTIVE', 'Discount is in draft');
      }
      if (discount.endsAt && discount.endsAt < now) {
        throw new DiscountUnavailableError('EXPIRED', 'Discount has expired');
      }
      if (discount.startsAt > now) {
        throw new DiscountUnavailableError(
          'NOT_STARTED',
          'Discount is not active yet',
        );
      }

      // onePerCustomer enforcement. Counts active (RESERVED +
      // REDEEMED) rows for this customer + (code or discount).
      if (discount.onePerCustomer) {
        const customerCount = await this.countActiveRedemptionsByCustomer(
          tx,
          input.discountId,
          input.discountCodeId ?? null,
          input.customerId,
        );
        if (customerCount > 0) {
          throw new ReservationConflictError(
            'ALREADY_REDEEMED_BY_CUSTOMER',
            'Customer has already used this coupon',
          );
        }
      }

      // maxUses enforcement. Count all active (RESERVED + REDEEMED)
      // rows. This count is consistent within the lock — no other
      // transaction can insert until we release it.
      if (discount.maxUses !== null && discount.maxUses !== undefined) {
        const totalActive = await tx.discountRedemption.count({
          where: {
            discountId: input.discountId,
            discountCodeId: input.discountCodeId ?? null,
            status: { in: ['RESERVED', 'REDEEMED'] },
          },
        });
        if (totalActive >= discount.maxUses) {
          throw new ReservationConflictError(
            'MAX_USES_REACHED',
            'Coupon usage limit reached',
          );
        }
      }

      // Insert. The DB partial unique indexes (security patch
      // 20260508130000) act as a backstop — if a race somehow
      // slipped past, the insert fails with P2002 and we rethrow
      // as CONCURRENT_RESERVATION.
      try {
        const created = await tx.discountRedemption.create({
          data: {
            discountId: input.discountId,
            discountCodeId: input.discountCodeId ?? null,
            discountCode: input.discountCode ?? null,
            customerId: input.customerId,
            source: input.source ?? 'CODE',
            status: 'RESERVED',
            discountAmountInPaise: input.discountAmountInPaise,
            expiresAt,
            idempotencyKey: input.idempotencyKey,
          },
        });

        // Phase E (P1.1) — emit reservation event after successful
        // INSERT. Inside the tx so a rollback also un-emits. Outbox
        // is transactional — see EventBusService.
        void this.events.emitRedemptionEvent({
          action: 'reserved',
          redemptionId: created.id,
          discountId: input.discountId,
          customerId: input.customerId,
          discountAmountInPaise: input.discountAmountInPaise,
        });

        return {
          redemptionId: created.id,
          created: true,
          expiresAt: created.expiresAt,
          discountAmountInPaise: created.discountAmountInPaise,
        };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ReservationConflictError(
            'CONCURRENT_RESERVATION',
            'Concurrent reservation detected; please retry',
          );
        }
        throw e;
      }
    });
  }

  /**
   * Promote RESERVED → REDEEMED. Called from inside the checkout
   * transaction after the order has been written; the masterOrderId
   * is now known and gets stamped on the redemption.
   *
   * Conditional update — fails if the row isn't RESERVED anymore
   * (e.g., it expired and was released by the cron).
   */
  async redeem(args: {
    redemptionId: string;
    masterOrderId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = args.tx ?? this.prisma;
    const result = await client.discountRedemption.updateMany({
      where: { id: args.redemptionId, status: 'RESERVED' },
      data: {
        status: 'REDEEMED',
        masterOrderId: args.masterOrderId,
        redeemedAt: new Date(),
      },
    });
    if (result.count === 0) {
      // Either already redeemed (idempotent retry) or the
      // reservation expired and was released. Either way, the
      // caller should treat this as a hard failure for this
      // checkout attempt.
      throw new ReservationConflictError(
        'CONCURRENT_RESERVATION',
        'Reservation no longer active; cannot redeem',
      );
    }

    // Phase E (P1.1) — emit redeemed event. We re-fetch lightweight
    // metadata to populate the event payload; the audit row's
    // resourceId is the redemption id which is enough to correlate
    // back to the row.
    // Phase F (P2.3) — also pull affiliateId off the parent Discount
    // so the unification hook can attribute the order without an
    // extra round-trip.
    const row = await client.discountRedemption.findUnique({
      where: { id: args.redemptionId },
      select: {
        discountId: true,
        customerId: true,
        discountAmountInPaise: true,
        discountCode: true,
        discount: { select: { affiliateId: true, code: true } },
      },
    });
    if (row) {
      void this.events.emitRedemptionEvent({
        action: 'redeemed',
        redemptionId: args.redemptionId,
        discountId: row.discountId,
        customerId: row.customerId,
        masterOrderId: args.masterOrderId,
        discountAmountInPaise: row.discountAmountInPaise,
      });

      // Phase F (P2.3) — affiliate attribution. Only fires when the
      // discount represents a unified affiliate coupon; otherwise the
      // hook is a no-op. Best-effort: failures must not block the
      // redemption.
      const affiliateId = row.discount?.affiliateId;
      if (affiliateId) {
        void this.affiliateUnification
          .onUnifiedCouponRedeemed({
            orderId: args.masterOrderId,
            discountId: row.discountId,
            affiliateId,
            couponCode: row.discountCode ?? row.discount?.code ?? null,
            tx: args.tx,
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Release a RESERVED row — checkout failed, payment was abandoned,
   * or the cron expired the reservation. Idempotent; releasing an
   * already-released row is a no-op.
   */
  async release(args: {
    redemptionId: string;
    reason?: 'CHECKOUT_FAILED' | 'PAYMENT_FAILED' | 'EXPIRED' | 'CANCELLED';
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = args.tx ?? this.prisma;
    const status =
      args.reason === 'CANCELLED' ? 'CANCELLED' : 'RELEASED';
    const result = await client.discountRedemption.updateMany({
      where: { id: args.redemptionId, status: 'RESERVED' },
      data: { status, releasedAt: new Date() },
    });

    // Phase E (P1.1) — emit released event only when we actually
    // flipped a row (idempotent retries are no-ops).
    if (result.count > 0) {
      const row = await client.discountRedemption.findUnique({
        where: { id: args.redemptionId },
        select: {
          discountId: true,
          customerId: true,
          masterOrderId: true,
          discountAmountInPaise: true,
        },
      });
      if (row) {
        void this.events.emitRedemptionEvent({
          action: 'released',
          redemptionId: args.redemptionId,
          discountId: row.discountId,
          customerId: row.customerId,
          masterOrderId: row.masterOrderId,
          discountAmountInPaise: row.discountAmountInPaise,
          reason: args.reason,
        });
      }
    }
  }

  /**
   * Cron-driven cleanup of expired RESERVED rows. Default Decision
   * #9 — both lazy (checked at validation/reserve time) and active
   * (this cron) for defense in depth.
   *
   * Returns the count released, for metrics.
   */
  async releaseExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.discountRedemption.updateMany({
      where: { status: 'RESERVED', expiresAt: { lt: now } },
      data: { status: 'RELEASED', releasedAt: now },
    });
    if (result.count > 0) {
      this.logger.log(`Released ${result.count} expired discount reservations`);
    }
    return result.count;
  }

  // ──────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────

  private async countActiveRedemptionsByCustomer(
    tx: Prisma.TransactionClient,
    discountId: string,
    discountCodeId: string | null,
    customerId: string,
  ): Promise<number> {
    return tx.discountRedemption.count({
      where: {
        discountId,
        discountCodeId,
        customerId,
        status: { in: ['RESERVED', 'REDEEMED'] },
      },
    });
  }
}
