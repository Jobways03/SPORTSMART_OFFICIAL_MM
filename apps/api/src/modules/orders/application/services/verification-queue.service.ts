import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { OrdersService } from './orders.service';
import { RiskScoringService } from './risk-scoring.service';

// Held by Postgres, not by JS — kept as a constant string so the SQL
// stays readable. Bumping this changes how long an idle verifier holds
// an order before the next claim-next can pick it up.
const CLAIM_TTL_INTERVAL = "15 minutes";

// Hard cap on a single bulk-approve call. The frontend should request
// smaller batches in practice; this is a safety net so a misbehaving
// client can't ask the API to verify hundreds of orders in one request
// (each verify does allocation work that scales linearly).
const BULK_APPROVE_MAX = 25;

@Injectable()
export class VerificationQueueService {
  private readonly logger = new Logger(VerificationQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly audit: AuditPublicFacade,
    private readonly riskScoring: RiskScoringService,
  ) {}

  /**
   * Atomically claim the oldest unclaimed PLACED order for this admin.
   * Uses FOR UPDATE SKIP LOCKED so concurrent verifiers each get a
   * different row instead of serialising on a lock — the same primitive
   * Postgres-backed job queues use. Returns null when the queue is empty.
   *
   * All time math is done in Postgres (`NOW()` and `NOW() + INTERVAL`)
   * so the claim's freshness is always evaluated in the DB's timezone.
   * If we mix `new Date()` from Node with `NOW()` in SQL, the values
   * drift by the offset between server-local time and UTC — every
   * fresh claim looks expired the instant it's written.
   */
  async claimNext(adminId: string): Promise<{ id: string } | null> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM master_orders
        WHERE order_status = 'PLACED'::"OrderStatus"
          AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (candidates.length === 0) return null;
      const id = candidates[0]!.id;

      await tx.$executeRawUnsafe(
        `UPDATE master_orders
            SET claimed_by_admin_id = $1,
                claimed_at          = NOW(),
                claim_expires_at    = NOW() + INTERVAL '${CLAIM_TTL_INTERVAL}'
          WHERE id = $2`,
        adminId,
        id,
      );
      return { id };
    });

    if (claimed) {
      this.logger.log(`Order ${claimed.id} claimed by admin ${adminId}`);
      // Lazily score the order on first claim if it hasn't been scored
      // yet — this way the verifier sees a band on the detail page even
      // for orders that were placed before scoring shipped. Errors are
      // swallowed: a missing score should never block a claim.
      void this.ensureScored(claimed.id).catch(() => {});
    }
    return claimed;
  }

  private async ensureScored(orderId: string): Promise<void> {
    const row = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: { verificationRiskBand: true },
    });
    if (row && !row.verificationRiskBand) {
      await this.riskScoring.scoreOrder(orderId);
    }
  }

  /**
   * Read-only fetch of the stored risk row for an order. Used by the
   * detail page to show the band + reasons without rescoring. If no
   * score has been computed yet, this triggers a one-shot computation
   * so the verifier always sees a band.
   */
  async getRiskInfo(orderId: string): Promise<{
    score: number | null;
    band: string | null;
    reasons: string[];
    scoredAt: Date | null;
  }> {
    const row = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        verificationRiskScore: true,
        verificationRiskBand: true,
        verificationRiskReasons: true,
        verificationScoredAt: true,
      },
    });
    if (!row) throw new NotFoundAppException('Order not found');
    if (!row.verificationRiskBand) {
      const computed = await this.riskScoring.scoreOrder(orderId);
      return {
        score: computed.score,
        band: computed.band,
        reasons: computed.reasons,
        scoredAt: new Date(),
      };
    }
    return {
      score: row.verificationRiskScore,
      band: row.verificationRiskBand,
      reasons: Array.isArray(row.verificationRiskReasons)
        ? (row.verificationRiskReasons as string[])
        : [],
      scoredAt: row.verificationScoredAt,
    };
  }

  /**
   * Release a claim the admin holds. Errors if the claim isn't theirs
   * or has already expired — both cases mean someone else has
   * effectively already taken it.
   */
  async release(orderId: string, adminId: string): Promise<void> {
    const result = await this.prisma.$executeRaw`
      UPDATE master_orders
         SET claimed_by_admin_id = NULL,
             claimed_at          = NULL,
             claim_expires_at    = NULL
       WHERE id                  = ${orderId}
         AND claimed_by_admin_id = ${adminId}
         AND claim_expires_at    > NOW()
    `;
    if (result === 0) {
      throw new BadRequestAppException(
        'Cannot release: claim is not held by you or has already expired',
      );
    }
  }

  /**
   * Approve the order — verify the claim is still ours, then delegate
   * to the existing verify pipeline (allocation, sub-order routing).
   * Clears the claim columns on success.
   */
  async approve(orderId: string, adminId: string, remarks?: string) {
    await this.assertClaimHeldBy(orderId, adminId);
    const data = await this.ordersService.verifyOrder(orderId, adminId, remarks);
    await this.prisma.$executeRaw`
      UPDATE master_orders
         SET claimed_by_admin_id = NULL,
             claimed_at          = NULL,
             claim_expires_at    = NULL
       WHERE id = ${orderId}
    `;
    return data;
  }

  /**
   * Reject the order — claim must be ours, then delegate to the
   * existing reject path (cancels the order, restores stock).
   */
  async reject(orderId: string, adminId: string) {
    await this.assertClaimHeldBy(orderId, adminId);
    await this.ordersService.rejectOrder(orderId);
    await this.prisma.$executeRaw`
      UPDATE master_orders
         SET claimed_by_admin_id = NULL,
             claimed_at          = NULL,
             claim_expires_at    = NULL
       WHERE id = ${orderId}
    `;
  }

  /**
   * Orders this admin currently has claimed (claim still live). Used
   * by the verifier's "my tray" view.
   */
  async myTray(adminId: string) {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        orderNumber: string;
        totalAmount: string;
        paymentMethod: string;
        paymentStatus: string;
        orderStatus: string;
        itemCount: number;
        createdAt: Date;
        claimedAt: Date;
        claimExpiresAt: Date;
        riskScore: number | null;
        riskBand: string | null;
      }>
    >`
      SELECT id,
             order_number       AS "orderNumber",
             total_amount::text AS "totalAmount",
             payment_method::text  AS "paymentMethod",
             payment_status::text  AS "paymentStatus",
             order_status::text    AS "orderStatus",
             item_count        AS "itemCount",
             created_at        AS "createdAt",
             claimed_at        AS "claimedAt",
             claim_expires_at  AS "claimExpiresAt",
             verification_risk_score AS "riskScore",
             verification_risk_band  AS "riskBand"
        FROM master_orders
       WHERE claimed_by_admin_id = ${adminId}
         AND claim_expires_at    > NOW()
       ORDER BY claimed_at ASC
    `;
  }

  /**
   * Snapshot for the queue stats banner. `breachedSla` is currently a
   * placeholder — we don't have a verification SLA deadline column
   * yet, so it counts orders sitting in PLACED for over an hour as a
   * proxy. Replace with a real `verificationDeadlineAt` column when
   * that ships.
   */
  async queueStats(adminId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        unclaimed: bigint;
        unclaimed_green: bigint;
        unclaimed_yellow: bigint;
        unclaimed_red: bigint;
        mine: bigint;
        breached_sla: bigint;
        total_today: bigint;
      }>
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
        ) AS unclaimed,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            AND verification_risk_band = 'GREEN'
        ) AS unclaimed_green,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            AND verification_risk_band = 'YELLOW'
        ) AS unclaimed_yellow,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            AND verification_risk_band = 'RED'
        ) AS unclaimed_red,
        COUNT(*) FILTER (
          WHERE claimed_by_admin_id = ${adminId}
            AND claim_expires_at    > NOW()
        ) AS mine,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND created_at < NOW() - INTERVAL '1 hour'
        ) AS breached_sla,
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW())
        ) AS total_today
      FROM master_orders
    `;
    const [r] = rows;
    return {
      unclaimed: Number(r?.unclaimed ?? 0),
      unclaimedGreen: Number(r?.unclaimed_green ?? 0),
      unclaimedYellow: Number(r?.unclaimed_yellow ?? 0),
      unclaimedRed: Number(r?.unclaimed_red ?? 0),
      mine: Number(r?.mine ?? 0),
      breachedSla: Number(r?.breached_sla ?? 0),
      totalToday: Number(r?.total_today ?? 0),
    };
  }

  /* ── Bulk approve (sweep greens) ─────────────────────────────────── */

  /**
   * Sweep up to `limit` unclaimed GREEN orders and verify them in one
   * pass. Two-phase:
   *   1. Atomically claim a batch (single SQL with FOR UPDATE SKIP
   *      LOCKED so concurrent sweeps don't race).
   *   2. For each claimed order, run the existing verify pipeline.
   *      Per-order failures are captured and the failed claim is
   *      released so the order returns to the pool.
   *
   * If `dryRun` is true, the first phase becomes a read-only preview
   * (no claim, no state change) so the UI can show "about to approve
   * N orders, including SM-1, SM-2…" before the verifier confirms.
   *
   * Audit-logged once per bulk call (not per order) — a single sweep
   * is one operator decision.
   */
  async bulkApproveGreen(
    adminId: string,
    requestedLimit: number,
    dryRun: boolean,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    attempted: number;
    succeeded: number;
    failed: Array<{ orderId: string; orderNumber?: string; reason: string }>;
    approvedIds: string[];
    previewIds?: string[];
  }> {
    const limit = Math.min(
      Math.max(1, Math.floor(requestedLimit) || 1),
      BULK_APPROVE_MAX,
    );

    if (dryRun) {
      const candidates = await this.prisma.$queryRaw<
        Array<{ id: string; orderNumber: string }>
      >`
        SELECT id, order_number AS "orderNumber"
          FROM master_orders
         WHERE order_status = 'PLACED'::"OrderStatus"
           AND verification_risk_band = 'GREEN'
           AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
         ORDER BY created_at ASC
         LIMIT ${limit}
      `;
      return {
        attempted: candidates.length,
        succeeded: 0,
        failed: [],
        approvedIds: [],
        previewIds: candidates.map((c) => c.id),
      };
    }

    // Phase 1 — atomic claim.
    const claimed = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; order_number: string }>
    >(
      `WITH candidates AS (
         SELECT id FROM master_orders
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND verification_risk_band = 'GREEN'
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE master_orders
          SET claimed_by_admin_id = $2,
              claimed_at          = NOW(),
              claim_expires_at    = NOW() + INTERVAL '${CLAIM_TTL_INTERVAL}'
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id, order_number`,
      limit,
      adminId,
    );

    const failed: Array<{ orderId: string; orderNumber?: string; reason: string }> = [];
    const approvedIds: string[] = [];

    // Phase 2 — verify each in turn. Failures release the claim so the
    // order goes back to the queue rather than being stuck for 15min.
    for (const c of claimed) {
      try {
        await this.ordersService.verifyOrder(c.id, adminId);
        await this.prisma.$executeRaw`
          UPDATE master_orders
             SET claimed_by_admin_id = NULL,
                 claimed_at          = NULL,
                 claim_expires_at    = NULL
           WHERE id = ${c.id}
        `;
        approvedIds.push(c.id);
      } catch (err) {
        const reason = (err as Error).message || 'Unknown error';
        await this.prisma.$executeRaw`
          UPDATE master_orders
             SET claimed_by_admin_id = NULL,
                 claimed_at          = NULL,
                 claim_expires_at    = NULL
           WHERE id = ${c.id} AND claimed_by_admin_id = ${adminId}
        `;
        failed.push({ orderId: c.id, orderNumber: c.order_number, reason });
        this.logger.warn(
          `Bulk-approve verify failed for ${c.order_number} (${c.id}): ${reason}`,
        );
      }
    }

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'BULK_APPROVE_VERIFICATION_GREEN',
        module: 'orders',
        resource: 'master_order',
        metadata: {
          requestedLimit: limit,
          attempted: claimed.length,
          succeeded: approvedIds.length,
          failedCount: failed.length,
          approvedIds,
          failed: failed.map((f) => ({
            orderId: f.orderId,
            orderNumber: f.orderNumber,
            reason: f.reason,
          })),
        },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit write for BULK_APPROVE_VERIFICATION_GREEN failed: ${(err as Error).message}`,
        ),
      );

    this.logger.log(
      `Admin ${adminId} bulk-approved ${approvedIds.length}/${claimed.length} GREEN orders`,
    );

    return {
      attempted: claimed.length,
      succeeded: approvedIds.length,
      failed,
      approvedIds,
    };
  }

  /* ── Team-lead view ────────────────────────────────────────────────── */

  /**
   * All currently-claimed PLACED orders across the whole team, joined to
   * the holder's name/email. Used by the team-lead dashboard to spot
   * pile-ups and abandoned claims.
   */
  async getTeamStatus() {
    const claims = await this.prisma.$queryRaw<
      Array<{
        id: string;
        orderNumber: string;
        totalAmount: string;
        paymentMethod: string;
        itemCount: number;
        createdAt: Date;
        claimedAt: Date;
        claimExpiresAt: Date;
        adminId: string;
        adminName: string;
        adminEmail: string;
        riskScore: number | null;
        riskBand: string | null;
      }>
    >`
      SELECT mo.id,
             mo.order_number   AS "orderNumber",
             mo.total_amount::text AS "totalAmount",
             mo.payment_method::text AS "paymentMethod",
             mo.item_count     AS "itemCount",
             mo.created_at     AS "createdAt",
             mo.claimed_at     AS "claimedAt",
             mo.claim_expires_at AS "claimExpiresAt",
             a.id              AS "adminId",
             a.name            AS "adminName",
             a.email           AS "adminEmail",
             mo.verification_risk_score AS "riskScore",
             mo.verification_risk_band  AS "riskBand"
        FROM master_orders mo
        JOIN admins a ON a.id = mo.claimed_by_admin_id
       WHERE mo.order_status     = 'PLACED'::"OrderStatus"
         AND mo.claim_expires_at > NOW()
       ORDER BY mo.claimed_at ASC
    `;

    const summaryRows = await this.prisma.$queryRaw<
      Array<{ total_claimed: bigint; active_admins: bigint }>
    >`
      SELECT
        COUNT(*)                                AS total_claimed,
        COUNT(DISTINCT claimed_by_admin_id)     AS active_admins
      FROM master_orders
      WHERE order_status     = 'PLACED'::"OrderStatus"
        AND claim_expires_at > NOW()
    `;
    const [s] = summaryRows;

    return {
      summary: {
        totalClaimed: Number(s?.total_claimed ?? 0),
        activeAdmins: Number(s?.active_admins ?? 0),
      },
      claims,
    };
  }

  /**
   * SUPER_ADMIN-only: forcibly release someone else's claim. Writes an
   * audit log entry so the action is traceable. The caller is expected
   * to have already been authorised by the @Roles guard at the
   * controller layer — this method does not re-check.
   */
  async forceRelease(
    orderId: string,
    callerAdminId: string,
    reason: string,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        claimedByAdminId: true,
        claimExpiresAt: true,
      },
    });
    if (!order) {
      throw new NotFoundAppException('Order not found');
    }
    if (!order.claimedByAdminId) {
      throw new BadRequestAppException('Order is not currently claimed');
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestAppException(
        'A reason (min 3 chars) is required for force-release',
      );
    }

    const previousAdminId = order.claimedByAdminId;
    await this.prisma.$executeRaw`
      UPDATE master_orders
         SET claimed_by_admin_id = NULL,
             claimed_at          = NULL,
             claim_expires_at    = NULL
       WHERE id = ${orderId}
    `;

    this.audit
      .writeAuditLog({
        actorId: callerAdminId,
        actorRole: 'ADMIN',
        action: 'FORCE_RELEASE_VERIFICATION_CLAIM',
        module: 'orders',
        resource: 'master_order',
        resourceId: orderId,
        oldValue: {
          claimedByAdminId: previousAdminId,
          claimExpiresAt: order.claimExpiresAt,
        },
        newValue: { claimedByAdminId: null, claimExpiresAt: null },
        metadata: { reason: reason.trim() },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit write for FORCE_RELEASE_VERIFICATION_CLAIM failed: ${(err as Error).message}`,
        ),
      );

    this.logger.warn(
      `Admin ${callerAdminId} force-released order ${orderId} (was held by ${previousAdminId}): ${reason.trim()}`,
    );
  }

  /* ── Private ───────────────────────────────────────────────────────── */

  /**
   * Throws unless the order exists and is currently claimed by this
   * admin with a live (non-expired) claim. Done as a single SQL query
   * with `NOW()` so the freshness check stays in Postgres time.
   */
  private async assertClaimHeldBy(orderId: string, adminId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        exists: boolean;
        claim_held: boolean;
        claim_live: boolean;
      }>
    >`
      SELECT
        TRUE AS exists,
        (claimed_by_admin_id = ${adminId})  AS claim_held,
        (claim_expires_at    > NOW())       AS claim_live
      FROM master_orders
      WHERE id = ${orderId}
    `;
    if (rows.length === 0) {
      throw new NotFoundAppException('Order not found');
    }
    const [row] = rows;
    if (!row!.claim_held) {
      throw new BadRequestAppException(
        'You do not hold the claim on this order',
      );
    }
    if (!row!.claim_live) {
      throw new BadRequestAppException(
        'Your claim has expired — re-claim the order to continue',
      );
    }
  }
}
