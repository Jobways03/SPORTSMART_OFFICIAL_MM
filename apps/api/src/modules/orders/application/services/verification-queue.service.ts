import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { OrdersService } from './orders.service';
import { RiskScoringService, RiskBand } from './risk-scoring.service';

// Phase 68 (2026-05-22) — claim TTL is now env-driven (audit Gap
// #16). The SQL still needs an interval literal — we read the env
// at construction and format it back into a Postgres INTERVAL string.
// Default 15 minutes preserves prior behaviour.
const DEFAULT_CLAIM_TTL_MINUTES = 15;

// Hard cap on a single bulk-approve call. The frontend should request
// smaller batches in practice; this is a safety net so a misbehaving
// client can't ask the API to verify hundreds of orders in one request
// (each verify does allocation work that scales linearly).
//
// Phase 76 (2026-05-22) — env-tunable (audit Gap #16). Default 25
// preserves legacy behaviour; absolute ceiling 50 enforced in the
// constructor so an env typo can't blow up the cap.
const DEFAULT_BULK_APPROVE_MAX = 25;
const ABSOLUTE_BULK_APPROVE_CEILING = 50;

// Phase 76 (audit Gap #6) — concurrency cap for the parallelised
// verify loop. Each verify hits a DB tx + allocation reads; running
// 25 in parallel would saturate the connection pool. 5 gives a ~5x
// speedup vs sequential without monopolising the pool.
const BULK_VERIFY_PARALLELISM = 5;

// Phase 76 (audit Gap #12) — cap the per-reason text bundled into
// the audit metadata blob. A Prisma error stack can be multi-KB;
// 25 of those bloat the audit row. The detailed reason is still in
// the server log + per-order audit (Phase 74's
// OrderVerificationDecision).
const AUDIT_REASON_MAX_CHARS = 200;

/**
 * Phase 76 (2026-05-22) — Phase 75 bulk-approve audit Gap #13.
 * Translate raw Error.message to a stable enum code the UI can
 * branch on. Internal Prisma error stacks ("Foreign key constraint
 * violated: …") were leaking to the verifier surface; the enum
 * keeps the surface stable + private.
 */
function sanitiseReason(err: Error): {
  code:
    | 'ALLOCATION_FAILED'
    | 'PAYMENT_CANCELLED'
    | 'STATUS_TRANSITION_INVALID'
    | 'CLAIM_CONFLICT'
    | 'CONCURRENT_UPDATE'
    | 'STOCK_RACE_LOST'
    | 'UNKNOWN';
  privateMessage: string;
} {
  const m = (err.message ?? '').toLowerCase();
  if (m.includes('held by another verifier') || m.includes('claim')) {
    return { code: 'CLAIM_CONFLICT', privateMessage: err.message };
  }
  if (m.includes('paymentstatus') || m.includes('cancelled order')) {
    return { code: 'PAYMENT_CANCELLED', privateMessage: err.message };
  }
  if (m.includes('transition') || m.includes('fsm')) {
    return { code: 'STATUS_TRANSITION_INVALID', privateMessage: err.message };
  }
  if (m.includes('concurrently') || m.includes('changed concurrently')) {
    return { code: 'CONCURRENT_UPDATE', privateMessage: err.message };
  }
  if (m.includes('serviceable') || m.includes('mapping') || m.includes('allocation')) {
    return { code: 'ALLOCATION_FAILED', privateMessage: err.message };
  }
  if (m.includes('stock') || m.includes('reservation')) {
    return { code: 'STOCK_RACE_LOST', privateMessage: err.message };
  }
  return { code: 'UNKNOWN', privateMessage: err.message };
}

// Phase 73 (2026-05-22) — claim-flow audit Gap #7. Per-verifier
// max-claims cap. Pre-Phase-73 a malicious or buggy verifier could
// hammer claim-next and accumulate the entire PLACED queue in
// their tray, locking it for 15 min × N orders. Default 10 covers
// any realistic shift workload while preventing a mass-claim DoS.
const DEFAULT_MAX_CLAIMS_PER_VERIFIER = 10;

@Injectable()
export class VerificationQueueService {
  private readonly logger = new Logger(VerificationQueueService.name);
  // Phase 68 — formatted Postgres INTERVAL literal derived from
  // VERIFICATION_CLAIM_TTL_MINUTES at boot.
  private readonly claimTtlInterval: string;
  // Phase 73 — per-verifier max claims (Gap #7).
  private readonly maxClaimsPerVerifier: number;
  // Phase 76 — env-tunable bulk-approve ceiling (Gap #16).
  private readonly bulkApproveMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly audit: AuditPublicFacade,
    private readonly riskScoring: RiskScoringService,
    private readonly env: EnvService,
    // Phase 73 (audit Gap #11) — domain events on claim transitions.
    private readonly eventBus: EventBusService,
  ) {
    const minutes = Math.max(
      1,
      this.env.getNumber('VERIFICATION_CLAIM_TTL_MINUTES', DEFAULT_CLAIM_TTL_MINUTES),
    );
    this.claimTtlInterval = `${minutes} minutes`;
    this.maxClaimsPerVerifier = Math.max(
      1,
      this.env.getNumber(
        'VERIFICATION_MAX_CLAIMS_PER_VERIFIER',
        DEFAULT_MAX_CLAIMS_PER_VERIFIER,
      ),
    );
    // Phase 76 (audit Gap #16) — env-driven max, capped at the
    // absolute ceiling so an env typo (e.g. 1000) can't blow up
    // the cap.
    this.bulkApproveMax = Math.min(
      ABSOLUTE_BULK_APPROVE_CEILING,
      Math.max(
        1,
        this.env.getNumber(
          'VERIFICATION_BULK_APPROVE_MAX',
          DEFAULT_BULK_APPROVE_MAX,
        ),
      ),
    );
    this.logger.log(
      `Verification claim TTL = ${minutes} minutes (env VERIFICATION_CLAIM_TTL_MINUTES); ` +
        `max claims/verifier = ${this.maxClaimsPerVerifier}; ` +
        `bulk-approve max = ${this.bulkApproveMax}`,
    );
  }

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
  async claimNext(
    adminId: string,
    band?: RiskBand,
  ): Promise<{ id: string } | null> {
    // Phase 73 (audit Gap #7) — enforce per-verifier max claims.
    // Pre-Phase-73 a buggy / malicious verifier could repeatedly
    // call claim-next and lock the entire PLACED queue. The cap
    // counts live claims (claim_expires_at > NOW()) only — stale
    // entries don't block fresh work.
    const liveClaimsCount = await this.prisma.masterOrder.count({
      where: {
        claimedByAdminId: adminId,
        claimExpiresAt: { gt: new Date() },
      },
    });
    if (liveClaimsCount >= this.maxClaimsPerVerifier) {
      throw new BadRequestAppException(
        `You are at the per-verifier claim limit (${this.maxClaimsPerVerifier}). ` +
          `Release one of your existing claims before taking a new order.`,
      );
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Phase 174 (audit #227) — optional band filter so a verifier can
      // "claim next RED" / "claim next CRITICAL" instead of always getting
      // the oldest unclaimed regardless of risk. `band` is a controlled
      // enum (validated at the controller); whitelist it here too before
      // it ever reaches SQL.
      const ALLOWED_BANDS = ['GREEN', 'YELLOW', 'RED', 'CRITICAL'];
      const bandFilter =
        band && ALLOWED_BANDS.includes(band)
          ? `AND verification_risk_band = '${band}'::"OrderRiskBand"`
          : '';
      const candidates = await tx.$queryRawUnsafe<
        { id: string; order_number: string }[]
      >(
        `SELECT id, order_number FROM master_orders
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            ${bandFilter}
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      );
      if (candidates.length === 0) return null;
      const id = candidates[0]!.id;
      const orderNumber = candidates[0]!.order_number;

      await tx.$executeRawUnsafe(
        `UPDATE master_orders
            SET claimed_by_admin_id = $1,
                claimed_at          = NOW(),
                claim_expires_at    = NOW() + INTERVAL '${this.claimTtlInterval}'
          WHERE id = $2`,
        adminId,
        id,
      );
      return { id, orderNumber };
    });

    if (claimed) {
      this.logger.log(`Order ${claimed.id} claimed by admin ${adminId}`);
      // Phase 73 (audit Gap #9) — audit-log every claim acquisition.
      this.audit
        .writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'ORDER_CLAIM_ACQUIRED',
          module: 'orders',
          resource: 'master_order',
          resourceId: claimed.id,
          metadata: {
            orderNumber: claimed.orderNumber,
            ttlInterval: this.claimTtlInterval,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Audit write for ORDER_CLAIM_ACQUIRED failed (order ${claimed.id}): ${(err as Error).message}`,
          ),
        );
      // Phase 73 (audit Gap #11) — emit domain event.
      this.eventBus
        .publish({
          eventName: 'orders.claim.acquired',
          aggregate: 'MasterOrder',
          aggregateId: claimed.id,
          occurredAt: new Date(),
          payload: {
            masterOrderId: claimed.id,
            orderNumber: claimed.orderNumber,
            claimedByAdminId: adminId,
          },
        })
        .catch(() => undefined);
      // Lazily score the order on first claim if it hasn't been scored
      // yet — this way the verifier sees a band on the detail page even
      // for orders that were placed before scoring shipped. Errors are
      // swallowed: a missing score should never block a claim.
      void this.ensureScored(claimed.id).catch(() => {});
    }
    return claimed ? { id: claimed.id } : null;
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
    // Phase 174 (audit #224/#226/#227) — STRICTLY READ-ONLY. This used to
    // lazy-compute + PERSIST a score when the band was null, turning a GET
    // into a DB write (and racing two concurrent viewers into two writes).
    // Scoring now happens at placement (order.master.created handler) and on
    // claim (claimNext -> ensureScored, a mutation); an unscored order here
    // returns a null band and the verifier can trigger an explicit rescore.
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
   * Release a claim the admin holds.
   *
   * Phase 73 (audit Gap #17) — idempotent for expired claims by the
   * original holder. Pre-Phase-73 a verifier who returned to their
   * desk past the 15-min TTL got a 400 trying to release; the only
   * escape was the lazy-expiry overwrite from the next claimer.
   * Now: as long as `claimed_by_admin_id` still matches the caller,
   * the release succeeds regardless of expiry. Other-admin claims
   * still error.
   *
   * Phase 73 (audit Gap #9 + #11 + #14) — writes history row +
   * audit log + emits domain event on every release.
   */
  async release(orderId: string, adminId: string): Promise<void> {
    // Snapshot before update so the history row + audit log carry
    // the original claim metadata. Bail early if the caller doesn't
    // own the claim (or no claim exists).
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        claimedByAdminId: true,
        claimedAt: true,
        claimExpiresAt: true,
      },
    });
    if (!order) {
      throw new NotFoundAppException('Order not found');
    }
    if (!order.claimedByAdminId || order.claimedByAdminId !== adminId) {
      throw new BadRequestAppException(
        'Cannot release: claim is not held by you',
      );
    }
    const releaseReason =
      order.claimExpiresAt && order.claimExpiresAt < new Date()
        ? 'TTL_EXPIRY'
        : 'EXPLICIT_RELEASE';

    await this.prisma.$transaction(async (tx) => {
      // NULL the claim columns regardless of expiry status (idempotent).
      const result = await tx.masterOrder.updateMany({
        where: { id: orderId, claimedByAdminId: adminId },
        data: {
          claimedByAdminId: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      if (result.count === 0) return; // Race lost; nothing to write.

      // History row.
      const durationSeconds = order.claimedAt
        ? Math.max(
            0,
            Math.round((Date.now() - order.claimedAt.getTime()) / 1000),
          )
        : 0;
      await tx.orderClaimHistory.create({
        data: {
          masterOrderId: orderId,
          claimedByAdminId: adminId,
          claimedAt: order.claimedAt ?? new Date(),
          durationSeconds,
          releaseReason: releaseReason as any,
          releasedByAdminId: adminId,
        },
      });
    });

    // Audit log (best-effort) + event.
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'ORDER_CLAIM_RELEASED',
        module: 'orders',
        resource: 'master_order',
        resourceId: orderId,
        metadata: {
          orderNumber: order.orderNumber,
          releaseReason,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write for ORDER_CLAIM_RELEASED failed (order ${orderId}): ${(err as Error).message}`,
        ),
      );
    this.eventBus
      .publish({
        eventName: 'orders.claim.released',
        aggregate: 'MasterOrder',
        aggregateId: orderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: orderId,
          orderNumber: order.orderNumber,
          releasedByAdminId: adminId,
          releaseReason,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Approve the order — verify the claim is still ours, then delegate
   * to the existing verify pipeline (allocation, sub-order routing).
   * Clears the claim columns on success.
   *
   * Phase 68 (audit Gap #11) — verifyOrder itself now writes the
   * ORDER_VERIFIED audit row (via OrdersService). This wrapper
   * forwards the actorContext so the audit row carries the verifier
   * IP / UA. Pre-Phase-68 only bulk-approve audited; single-order
   * approve was invisible in the compliance trail.
   */
  async approve(
    orderId: string,
    adminId: string,
    remarks?: string,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.assertClaimHeldBy(orderId, adminId);
    // Snapshot claim metadata for the history row + event payload.
    const claimSnapshot = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        claimedAt: true,
        verificationRiskBand: true,
      },
    });
    // Phase 174 (bounded enforcement, user-approved) — approving a
    // RED/CRITICAL order requires a written reason (min 10 chars). The queue
    // already gates every order through manual review; this adds friction
    // proportional to risk without auto-blocking the customer. RED/CRITICAL
    // are already excluded from bulk-approve (GREEN-only), so the only way
    // through for a high-risk order is this deliberate, reasoned approval.
    const highBand =
      claimSnapshot?.verificationRiskBand === 'RED' ||
      claimSnapshot?.verificationRiskBand === 'CRITICAL';
    if (highBand && (!remarks || remarks.trim().length < 10)) {
      throw new BadRequestAppException(
        `Approving a ${claimSnapshot?.verificationRiskBand} order requires a reason (min 10 characters)`,
      );
    }
    const data = await this.ordersService.verifyOrder(
      orderId,
      adminId,
      remarks,
      actorContext,
    );
    await this.clearClaimWithHistory({
      orderId,
      adminId,
      claimedAt: claimSnapshot?.claimedAt ?? null,
      orderNumber: claimSnapshot?.orderNumber ?? null,
      reason: 'APPROVED',
    });
    return data;
  }

  /**
   * Reject the order — claim must be ours, then delegate to the
   * existing reject path (cancels the order, restores stock).
   *
   * Phase 68 (audit Gap #11) — writes an ORDER_REJECTED audit row
   * with the verifier identity, claim metadata, and optional
   * remarks. The delegated rejectOrder cancels + restores stock;
   * the audit row captures the verifier decision separately so a
   * future cancellation reason audit can join to it.
   */
  async reject(
    orderId: string,
    adminId: string,
    remarks?: string,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.assertClaimHeldBy(orderId, adminId);
    // Snapshot risk band before reject so the audit row carries
    // "we rejected a RED-banded order with reason X".
    const snapshot = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        orderStatus: true,
        verificationRiskBand: true,
        verificationRiskScore: true,
        claimedAt: true,
      },
    });
    await this.ordersService.rejectOrder(orderId);
    // Phase 73 (Gap #14) — clear claim + write history row via helper.
    await this.clearClaimWithHistory({
      orderId,
      adminId,
      claimedAt: snapshot?.claimedAt ?? null,
      orderNumber: snapshot?.orderNumber ?? null,
      reason: 'REJECTED',
      reasonNote: remarks ?? null,
    });
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'ORDER_REJECTED',
        module: 'orders',
        resource: 'master_order',
        resourceId: orderId,
        oldValue: snapshot
          ? { orderStatus: snapshot.orderStatus }
          : undefined,
        newValue: { orderStatus: 'CANCELLED' },
        metadata: {
          orderNumber: snapshot?.orderNumber ?? null,
          riskBand: snapshot?.verificationRiskBand ?? null,
          riskScore: snapshot?.verificationRiskScore ?? null,
          remarks: remarks ?? null,
        },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) =>
        this.logger.warn(
          `Audit log write for ORDER_REJECTED failed (order ${orderId}): ${(err as Error).message}`,
        ),
      );
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
   * Snapshot for the queue stats banner.
   *
   * Phase 68 (2026-05-22) — `breachedSla` now reads the real
   * verification_deadline_at column (audit Gap #13). Pre-Phase-68
   * it was a 1-hour proxy on created_at; the new column is set at
   * place-order time (COD) and at verify-payment time (ONLINE).
   * Falls back to the created_at + 1h proxy if the deadline column
   * is null (legacy rows pre-backfill).
   */
  async queueStats(adminId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        unclaimed: bigint;
        unclaimed_green: bigint;
        unclaimed_yellow: bigint;
        unclaimed_red: bigint;
        unclaimed_critical: bigint;
        unclaimed_unscored: bigint;
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
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            AND verification_risk_band = 'CRITICAL'
        ) AS unclaimed_critical,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND (claimed_by_admin_id IS NULL OR claim_expires_at < NOW())
            AND verification_risk_band IS NULL
        ) AS unclaimed_unscored,
        COUNT(*) FILTER (
          WHERE claimed_by_admin_id = ${adminId}
            AND claim_expires_at    > NOW()
        ) AS mine,
        COUNT(*) FILTER (
          WHERE order_status = 'PLACED'::"OrderStatus"
            AND COALESCE(verification_deadline_at, created_at + INTERVAL '1 hour') < NOW()
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
      // Phase 174 (audit #227) — surface the CRITICAL cohort + the unscored
      // gap (green+yellow+red+critical no longer silently < unclaimed).
      unclaimedCritical: Number(r?.unclaimed_critical ?? 0),
      unclaimedUnscored: Number(r?.unclaimed_unscored ?? 0),
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
    routedCount: number;
    exceptionQueueCount: number;
    failed: Array<{ orderId: string; orderNumber?: string; reasonCode: string }>;
    approvedIds: { routed: string[]; exceptionQueue: string[] };
    previewIds?: Array<{
      id: string;
      orderNumber: string;
      totalAmount: number;
      riskScore: number | null;
      riskBand: string | null;
      riskReasons: string[];
    }>;
  }> {
    // Phase 76 (audit Gap #16) — env-driven max with absolute ceiling.
    const limit = Math.min(
      Math.max(1, Math.floor(requestedLimit) || 1),
      this.bulkApproveMax,
    );

    if (dryRun) {
      // Phase 76 (audit Gap #17) — rich preview shape so verifier
      // sees order summary + risk reasons before committing.
      const candidates = await this.prisma.$queryRaw<
        Array<{
          id: string;
          orderNumber: string;
          totalAmount: string;
          riskScore: number | null;
          riskBand: string | null;
          riskReasons: any;
        }>
      >`
        SELECT id,
               order_number             AS "orderNumber",
               total_amount::text       AS "totalAmount",
               verification_risk_score  AS "riskScore",
               verification_risk_band   AS "riskBand",
               verification_risk_reasons AS "riskReasons"
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
        routedCount: 0,
        exceptionQueueCount: 0,
        failed: [],
        approvedIds: { routed: [], exceptionQueue: [] },
        previewIds: candidates.map((c) => ({
          id: c.id,
          orderNumber: c.orderNumber,
          totalAmount: Number(c.totalAmount),
          riskScore: c.riskScore,
          riskBand: c.riskBand,
          riskReasons: Array.isArray(c.riskReasons) ? c.riskReasons : [],
        })),
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
              claim_expires_at    = NOW() + INTERVAL '${this.claimTtlInterval}'
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id, order_number`,
      limit,
      adminId,
    );

    // Phase 76 (audit Gap #6 + #20) — parallelised verify loop.
    // Pre-Phase-76 each verify ran sequentially; 25 × ~300ms =
    // ~7.5s blocking call, HTTP timeout risk. Parallelism is
    // bounded at BULK_VERIFY_PARALLELISM (5) so the connection
    // pool doesn't get saturated. The semaphore pattern below
    // gives a ~5× speedup while keeping the response time
    // bounded.
    const routedIds: string[] = [];
    const exceptionQueueIds: string[] = [];
    const failed: Array<{ orderId: string; orderNumber?: string; reasonCode: string }> = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < claimed.length) {
        const idx = cursor++;
        const c = claimed[idx];
        if (!c) continue;
        // Phase 174 (audit #226/#227) — re-check the band right before
        // verify. A manual rescore could have flipped this order
        // GREEN->RED/CRITICAL between the claim SELECT and now; bulk-approve
        // must NEVER auto-verify a non-GREEN order. Release it + record skip.
        const fresh = await this.prisma.masterOrder.findUnique({
          where: { id: c.id },
          select: { verificationRiskBand: true },
        });
        if (fresh?.verificationRiskBand !== 'GREEN') {
          await this.prisma.$executeRaw`
            UPDATE master_orders
               SET claimed_by_admin_id = NULL, claimed_at = NULL, claim_expires_at = NULL
             WHERE id = ${c.id} AND claimed_by_admin_id = ${adminId}
          `;
          failed.push({
            orderId: c.id,
            orderNumber: c.order_number,
            reasonCode: 'BAND_CHANGED',
          });
          this.logger.warn(
            `Bulk-approve skipped ${c.order_number} (${c.id}) — band is now ${fresh?.verificationRiskBand ?? 'NULL'} (changed after claim)`,
          );
          continue;
        }
        try {
          const data: any = await this.ordersService.verifyOrder(c.id, adminId);
          // Phase 76 (audit Gap #19) — admin-scoped claim clear
          // for symmetry with the failure path. SKIP LOCKED makes
          // a cross-admin race nearly impossible, but the guard
          // makes the SQL self-documenting + defence-in-depth.
          await this.prisma.$executeRaw`
            UPDATE master_orders
               SET claimed_by_admin_id = NULL,
                   claimed_at          = NULL,
                   claim_expires_at    = NULL
             WHERE id = ${c.id} AND claimed_by_admin_id = ${adminId}
          `;
          // Phase 76 (audit Gap #18) — bucket by final order
          // status so the response can show "20 routed, 5 in
          // exception queue" instead of one undifferentiated
          // approvedIds list.
          const finalStatus = data?.orderStatus ?? 'ROUTED_TO_SELLER';
          if (finalStatus === 'EXCEPTION_QUEUE') {
            exceptionQueueIds.push(c.id);
          } else {
            routedIds.push(c.id);
          }
        } catch (err) {
          const { code, privateMessage } = sanitiseReason(err as Error);
          await this.prisma.$executeRaw`
            UPDATE master_orders
               SET claimed_by_admin_id = NULL,
                   claimed_at          = NULL,
                   claim_expires_at    = NULL
             WHERE id = ${c.id} AND claimed_by_admin_id = ${adminId}
          `;
          // Phase 76 (audit Gap #13) — return enum code to UI;
          // log full message server-side.
          failed.push({ orderId: c.id, orderNumber: c.order_number, reasonCode: code });
          this.logger.warn(
            `Bulk-approve verify failed for ${c.order_number} (${c.id}) — code=${code}: ${privateMessage}`,
          );
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(BULK_VERIFY_PARALLELISM, claimed.length) },
        () => worker(),
      ),
    );

    const approvedIds = { routed: routedIds, exceptionQueue: exceptionQueueIds };

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
          succeeded: routedIds.length + exceptionQueueIds.length,
          routedCount: routedIds.length,
          exceptionQueueCount: exceptionQueueIds.length,
          failedCount: failed.length,
          approvedIds: {
            routed: routedIds,
            exceptionQueue: exceptionQueueIds,
          },
          // Phase 76 (audit Gap #12) — failure reasons capped to
          // AUDIT_REASON_MAX_CHARS each. The enum code (Gap #13)
          // is the canonical surface anyway; the cap protects
          // the audit table from multi-KB Prisma stack dumps.
          failed: failed.map((f) => ({
            orderId: f.orderId,
            orderNumber: f.orderNumber,
            reasonCode: f.reasonCode,
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

    // Phase 76 (audit Gap #10) — domain event for downstream
    // consumers (BI dashboards, finance reconciliation, ops
    // notifications). Per-order `orders.master.routed` events are
    // emitted by individual verifyOrder calls — this is the bulk
    // summary event.
    this.eventBus
      .publish({
        eventName: 'orders.bulk.approved.green',
        aggregate: 'BulkApproval',
        aggregateId: `bulk-${adminId}-${Date.now()}`,
        occurredAt: new Date(),
        payload: {
          adminId,
          attempted: claimed.length,
          succeeded: routedIds.length + exceptionQueueIds.length,
          routedCount: routedIds.length,
          exceptionQueueCount: exceptionQueueIds.length,
          failedCount: failed.length,
          routedIds,
          exceptionQueueIds,
          failedCodes: failed.map((f) => f.reasonCode),
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    this.logger.log(
      `Admin ${adminId} bulk-approved ${routedIds.length + exceptionQueueIds.length}/${claimed.length} GREEN orders ` +
        `(routed=${routedIds.length}, exception=${exceptionQueueIds.length}, failed=${failed.length})`,
    );

    return {
      attempted: claimed.length,
      succeeded: routedIds.length + exceptionQueueIds.length,
      routedCount: routedIds.length,
      exceptionQueueCount: exceptionQueueIds.length,
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
        orderNumber: true,
        claimedByAdminId: true,
        claimedAt: true,
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
    const previousClaimedAt = order.claimedAt ?? new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - previousClaimedAt.getTime()) / 1000),
    );

    // Phase 73 (audit Gap #14) — clear + write history in one tx.
    await this.prisma.$transaction(async (tx) => {
      await tx.masterOrder.updateMany({
        where: { id: orderId, claimedByAdminId: previousAdminId },
        data: {
          claimedByAdminId: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      await tx.orderClaimHistory.create({
        data: {
          masterOrderId: orderId,
          claimedByAdminId: previousAdminId,
          claimedAt: previousClaimedAt,
          durationSeconds,
          releaseReason: 'FORCE_RELEASE',
          releasedByAdminId: callerAdminId,
          reasonNote: reason.trim(),
        },
      });
    });

    // Phase 73 (audit Gap #11) — emit event.
    this.eventBus
      .publish({
        eventName: 'orders.claim.released',
        aggregate: 'MasterOrder',
        aggregateId: orderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: orderId,
          orderNumber: order.orderNumber,
          previousAdminId,
          releasedByAdminId: callerAdminId,
          releaseReason: 'FORCE_RELEASE',
          reason: reason.trim(),
        },
      })
      .catch(() => undefined);

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

  /**
   * Phase 73 (audit Gaps #9 + #11 + #14) — shared helper used by
   * approve / reject. Clears the claim columns, writes a history
   * row with the supplied release reason, audit-logs the action,
   * and emits the `orders.claim.released` event. Wrapped in a tx
   * so the claim clear + history insert commit together.
   *
   * The verify / reject paths already wrote their own ORDER_VERIFIED /
   * ORDER_REJECTED audit log; this helper writes the
   * ORDER_CLAIM_RELEASED row separately so the claim trail and the
   * verification trail can be filtered independently.
   */
  private async clearClaimWithHistory(input: {
    orderId: string;
    adminId: string;
    claimedAt: Date | null;
    orderNumber: string | null;
    reason: 'APPROVED' | 'REJECTED' | 'EXPLICIT_RELEASE';
    reasonNote?: string | null;
  }): Promise<void> {
    const claimedAt = input.claimedAt ?? new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - claimedAt.getTime()) / 1000),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.masterOrder.updateMany({
        where: { id: input.orderId, claimedByAdminId: input.adminId },
        data: {
          claimedByAdminId: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      await tx.orderClaimHistory.create({
        data: {
          masterOrderId: input.orderId,
          claimedByAdminId: input.adminId,
          claimedAt,
          durationSeconds,
          releaseReason: input.reason as any,
          releasedByAdminId: input.adminId,
          reasonNote: input.reasonNote ?? null,
        },
      });
    });
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action: 'ORDER_CLAIM_RELEASED',
        module: 'orders',
        resource: 'master_order',
        resourceId: input.orderId,
        metadata: {
          orderNumber: input.orderNumber,
          releaseReason: input.reason,
          durationSeconds,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write for ORDER_CLAIM_RELEASED (${input.reason}) failed (order ${input.orderId}): ${(err as Error).message}`,
        ),
      );
    this.eventBus
      .publish({
        eventName: 'orders.claim.released',
        aggregate: 'MasterOrder',
        aggregateId: input.orderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: input.orderId,
          orderNumber: input.orderNumber,
          releasedByAdminId: input.adminId,
          releaseReason: input.reason,
          durationSeconds,
        },
      })
      .catch(() => undefined);
  }

  /* ── Phase 174 — band-filtered list + audited rescore ────────────────── */

  /**
   * Paginated, band-filtered list of PLACED orders in the verification queue
   * (audit #227 headline). Pre-Phase-174 there was no way to "show me the RED
   * orders" — only claim-next (band-agnostic) + bulk-approve (GREEN-only).
   * STRICTLY read-only (never lazy-computes). `band`:
   *   RED | YELLOW | GREEN | CRITICAL — exact band
   *   HIGH       — RED + CRITICAL (triage-first cohort)
   *   RED_YELLOW — YELLOW + RED + CRITICAL (everything non-green/non-null)
   *   UNSCORED   — band IS NULL
   *   ALL/undef  — every PLACED order
   * Highest risk first (CRITICAL→RED→YELLOW→GREEN, nulls last), oldest first
   * within a band.
   */
  async listOrdersByBand(input: {
    band?:
      | 'RED'
      | 'YELLOW'
      | 'GREEN'
      | 'CRITICAL'
      | 'HIGH'
      | 'RED_YELLOW'
      | 'UNSCORED'
      | 'ALL';
    onlyUnclaimed?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      orderNumber: string;
      totalAmount: string;
      paymentMethod: string;
      paymentStatus: string;
      itemCount: number;
      createdAt: Date;
      claimed: boolean;
      riskScore: number | null;
      riskBand: string | null;
      scoredAt: Date | null;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 20)));
    const offset = (page - 1) * limit;

    const where: any = { orderStatus: 'PLACED' };
    switch (input.band) {
      case 'UNSCORED':
        where.verificationRiskBand = null;
        break;
      case 'HIGH':
        where.verificationRiskBand = { in: ['RED', 'CRITICAL'] };
        break;
      case 'RED_YELLOW':
        where.verificationRiskBand = { in: ['YELLOW', 'RED', 'CRITICAL'] };
        break;
      case 'RED':
      case 'YELLOW':
      case 'GREEN':
      case 'CRITICAL':
        where.verificationRiskBand = input.band;
        break;
      // ALL / undefined → no band filter.
    }
    if (input.onlyUnclaimed) {
      where.OR = [
        { claimedByAdminId: null },
        { claimExpiresAt: { lt: new Date() } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.masterOrder.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          totalAmount: true,
          paymentMethod: true,
          paymentStatus: true,
          itemCount: true,
          createdAt: true,
          claimedByAdminId: true,
          claimExpiresAt: true,
          verificationRiskScore: true,
          verificationRiskBand: true,
          verificationScoredAt: true,
        },
        orderBy: [
          { verificationRiskScore: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    const now = new Date();
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        totalAmount: r.totalAmount.toString(),
        paymentMethod: r.paymentMethod,
        paymentStatus: r.paymentStatus,
        itemCount: r.itemCount,
        createdAt: r.createdAt,
        claimed:
          !!r.claimedByAdminId &&
          !!r.claimExpiresAt &&
          r.claimExpiresAt > now,
        riskScore: r.verificationRiskScore,
        riskBand: r.verificationRiskBand,
        scoredAt: r.verificationScoredAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Manual rescore wrapper (audit #226). The OrderRiskScoreHistory row that
   * scoreOrder writes is the domain trail; this additionally lands the admin
   * action in the hash-chained audit_logs (canonical compliance trail) with
   * old→new band + the admin's optional reason — matching how approve /
   * reject / bulk-approve / force-release already audit.
   */
  async rescore(orderId: string, adminId: string, reason?: string) {
    const before = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        verificationRiskBand: true,
        verificationRiskScore: true,
        orderNumber: true,
      },
    });
    const result = await this.riskScoring.rescore(orderId, adminId);
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'ORDER_RISK_RESCORED',
        module: 'orders',
        resource: 'master_order',
        resourceId: orderId,
        oldValue: before
          ? {
              band: before.verificationRiskBand,
              score: before.verificationRiskScore,
            }
          : undefined,
        newValue: { band: result.band, score: result.score },
        metadata: {
          orderNumber: before?.orderNumber ?? null,
          reason: reason ?? null,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write for ORDER_RISK_RESCORED failed (order ${orderId}): ${(err as Error).message}`,
        ),
      );
    return result;
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
