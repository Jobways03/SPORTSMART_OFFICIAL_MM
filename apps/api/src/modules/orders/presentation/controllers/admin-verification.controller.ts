import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RolesGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { VerificationQueueService } from '../../application/services/verification-queue.service';
import { RiskScoringService } from '../../application/services/risk-scoring.service';
// Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12. Admin
// CRUD on rule weights/thresholds.
import {
  RiskRuleConfigService,
  OrderRiskReasonCodeKey,
} from '../../application/services/risk-rule-config.service';
import { UpdateRiskRuleDto } from '../dtos/risk-rule.dto';
import {
  ApproveOrderDto,
  BulkApproveGreenDto,
  ForceReleaseDto,
  RejectOrderDto,
} from '../dtos/verification.dto';

@ApiTags('Admin Verification Queue')
@Controller('admin/verification')
// Phase 26 (2026-05-20) — added PermissionsGuard + StepUpGuard to the
// class chain so methods that opt in via @Permissions / @RequiresStepUp
// are actually gated. Pre-Phase-26 the class only wired AdminAuthGuard +
// RolesGuard, so the method-level @Roles('SUPER_ADMIN') on
// force-release / backfill-scores worked, but a @Permissions decorator
// on any method here would have been silent.
//
// Class-level @Permissions('orders.read') is the floor — the verification
// queue is a slice of order data, so read access requires orders.read.
// Write routes additionally declare their own @Permissions which Nest
// merges with the class-level set (request must satisfy BOTH). The
// force-release route additionally requires orders.forceRelease +
// step-up; see below.
//
// Phase 68 (2026-05-22) — every mutating route now declares the
// dedicated orders.verify[.bulk|.rescore] permission (audit Gaps
// #2 + #3 + #14). The class-level orders.read floor remains so a
// caller without verify can still hit the read-only my-tray /
// queue-stats / risk paths, but cannot claim / approve / reject /
// bulk-approve / rescore without the explicit grant. Bulk-approve
// also picks up a 4-per-minute throttle (audit Gap #15) so a
// misbehaving verifier can't drain the queue at 25 × N/min.
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
@Permissions('orders.read')
export class AdminVerificationController {
  constructor(
    private readonly queue: VerificationQueueService,
    private readonly riskScoring: RiskScoringService,
    // Phase 72 — risk-rule tune surface.
    private readonly ruleConfig: RiskRuleConfigService,
  ) {}

  @Post('claim-next')
  @HttpCode(200)
  // Phase 68 (audit Gap #2) — claim is a write to the order row
  // (stamps claim_holder + claim_expires_at). orders.verify gate.
  @Permissions('orders.verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async claimNext(@Req() req: any) {
    const claim = await this.queue.claimNext(req.adminId);
    if (!claim) {
      return {
        success: true,
        message: 'Queue is empty — no orders awaiting verification',
        data: null,
      };
    }
    return {
      success: true,
      message: 'Order claimed',
      data: { id: claim.id },
    };
  }

  @Get('my-tray')
  async myTray(@Req() req: any) {
    const orders = await this.queue.myTray(req.adminId);
    return {
      success: true,
      message: 'My tray retrieved',
      data: orders,
    };
  }

  @Get('queue-stats')
  async queueStats(@Req() req: any) {
    const stats = await this.queue.queueStats(req.adminId);
    return {
      success: true,
      message: 'Queue stats',
      data: stats,
    };
  }

  @Post('orders/:id/release')
  @HttpCode(200)
  // Phase 68 — release is a state mutation; require orders.verify.
  @Permissions('orders.verify')
  async release(@Param('id') id: string, @Req() req: any) {
    await this.queue.release(id, req.adminId);
    return { success: true, message: 'Claim released' };
  }

  @Patch('orders/:id/approve')
  // Phase 68 (audit Gaps #3 + #19) — orders.verify (was
  // orders.write) + @Idempotent so a retried approve returns the
  // original response instead of FSM-rejecting the duplicate.
  @Permissions('orders.verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async approve(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: ApproveOrderDto,
  ) {
    const data = await this.queue.approve(id, req.adminId, dto.remarks, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return {
      success: true,
      message: 'Order verified and routed to sellers',
      data,
    };
  }

  @Patch('orders/:id/reject')
  // Phase 68 — keep orders.cancel (rejection is a cancellation
  // semantic) AND require orders.verify so a cancel-only admin
  // can't reject from the queue without verifier rights. Nest
  // merges class + method @Permissions with AND semantics, and a
  // route can declare multiple keys with @Permissions(...keys)
  // (any-of) — to require ALL keys we stack two decorators which
  // PermissionsGuard ANDs at lookup time.
  @Permissions('orders.verify', 'orders.cancel')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async reject(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: RejectOrderDto,
  ) {
    await this.queue.reject(id, req.adminId, dto.remarks, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return {
      success: true,
      message: 'Order rejected and cancelled — stock restored',
    };
  }

  /* ── Team-lead view ─────────────────────────────────────────────── */

  @Get('team-status')
  async teamStatus() {
    const data = await this.queue.getTeamStatus();
    return { success: true, message: 'Team status', data };
  }

  /**
   * SUPER_ADMIN-only: forcibly release a claim held by another admin.
   * Records the action + reason in the audit log. Used when a verifier
   * has walked away mid-shift and a lead needs to free up the order
   * before the 15-min auto-release.
   */
  @Post('orders/:id/force-release')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  // Phase 26 (2026-05-20) — defence in depth on top of @Roles.
  // orders.forceRelease is CRITICAL in PERMISSION_RISK so the
  // PermissionsGuard auto-step-up branch would catch this even
  // without an explicit @RequiresStepUp, but we want a tight
  // 60s window for force-release specifically — the default 5min
  // is too loose for an action that overrides another verifier's
  // hold on a held order.
  @Permissions('orders.forceRelease')
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async forceRelease(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: ForceReleaseDto,
  ) {
    await this.queue.forceRelease(id, req.adminId, dto.reason, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return { success: true, message: 'Claim force-released' };
  }

  /* ── Risk scoring ───────────────────────────────────────────────── */

  /**
   * Score every PLACED order whose risk band hasn't been computed yet,
   * plus every order whose score was computed against an older
   * SCORER_VERSION (rule-set bump). Idempotent — already-scored orders
   * at the current version are skipped.
   *
   * Phase 71 (2026-05-22) — Phase 70 audit Gap #16: @Idempotent so
   * two super-admins clicking simultaneously don't trigger two
   * scans (not destructive — the underlying writes are idempotent
   * upserts — but wasteful).
   */
  @Post('backfill-scores')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  @Idempotent()
  async backfillScores() {
    const result = await this.riskScoring.backfillUnscored();
    return {
      success: true,
      message: `Scored ${result.scored} new order${result.scored === 1 ? '' : 's'}; rescored ${result.staleRescored} stale order${result.staleRescored === 1 ? '' : 's'}`,
      data: result,
    };
  }

  @Post('orders/:id/rescore')
  @HttpCode(200)
  // Phase 68 (audit Gap #14) — gate rescore. Pre-Phase-68 any
  // admin with orders.read could flip a RED band to GREEN and
  // sneak the order through the next bulk-approve sweep.
  // Phase 71 (audit Gap #9) — pass req.adminId so the resulting
  // OrderRiskScoreHistory row carries the rescorer's identity
  // and source=MANUAL.
  @Permissions('orders.verify.rescore')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async rescore(@Param('id') id: string, @Req() req: any) {
    const data = await this.riskScoring.rescore(id, req.adminId);
    return { success: true, message: 'Order re-scored', data };
  }

  @Get('orders/:id/risk')
  async getRisk(@Param('id') id: string) {
    const data = await this.queue.getRiskInfo(id);
    return { success: true, message: 'Risk info', data };
  }

  /* ── Bulk approve (sweep greens) ───────────────────────────────── */

  /**
   * Sweep up to N unclaimed GREEN orders and verify them in one pass.
   * Use `dryRun: true` to preview the IDs that would be approved
   * without acting. Hard-capped server-side at 25 per call.
   */
  @Post('bulk-approve-green')
  @HttpCode(200)
  // Phase 68 (audit Gaps #2 + #15) — dedicated permission +
  // throttle. 4 calls/minute × 25 orders = 100 orders/min hard
  // ceiling. A misbehaving / compromised verifier cannot drain
  // the queue in seconds anymore. @Idempotent so a network retry
  // doesn't re-run the sweep against the next batch.
  @Permissions('orders.verify.bulk')
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Idempotent()
  async bulkApproveGreen(
    @Req() req: any,
    @Body() dto: BulkApproveGreenDto,
  ) {
    const data = await this.queue.bulkApproveGreen(
      req.adminId,
      dto.limit ?? 25,
      dto.dryRun === true,
      {
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      },
    );
    const message = dto.dryRun
      ? `${data.attempted} green order${data.attempted === 1 ? '' : 's'} would be approved`
      : `Approved ${data.succeeded}/${data.attempted} green orders ` +
        `(routed: ${data.routedCount}, exception queue: ${data.exceptionQueueCount}, ` +
        `failed: ${data.failed.length})`;
    return { success: true, message, data };
  }

  /* ── Phase 72 — risk-rule tune surface (audit Gap #12) ──────── */

  /**
   * List every risk rule with its current resolved config (DB row
   * if present, hardcoded default otherwise). `usingDefault`
   * indicates whether ops needs to write a row to take ownership.
   *
   * SUPER_ADMIN-only via the role guard; the same permission
   * (`orders.verify.tune_rules`) gates writes.
   */
  @Get('risk-rules')
  @Permissions('orders.verify.tune_rules')
  async listRules() {
    const data = await this.ruleConfig.list();
    return { success: true, message: 'Risk rule configs', data };
  }

  /**
   * Upsert a rule's weight + thresholds. Invalidates the in-memory
   * cache on success; the next scoreOrder uses the new value.
   *
   * Caveat: the cache is process-local. Multi-replica clusters
   * see coherent reads within ~30s on the next load. A future
   * Redis pub-sub trigger would close this; not needed today
   * because ops tuning is rare.
   */
  @Patch('risk-rules/:code')
  @Permissions('orders.verify.tune_rules')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async updateRule(
    @Param('code') code: string,
    @Req() req: any,
    @Body() dto: UpdateRiskRuleDto,
  ) {
    const data = await this.ruleConfig.upsert(
      code as OrderRiskReasonCodeKey,
      {
        scoreDelta: dto.scoreDelta,
        config: dto.config,
        enabled: dto.enabled,
        maskAmounts: dto.maskAmounts,
      },
      req.adminId,
    );
    return { success: true, message: `Rule ${code} updated`, data };
  }
}
