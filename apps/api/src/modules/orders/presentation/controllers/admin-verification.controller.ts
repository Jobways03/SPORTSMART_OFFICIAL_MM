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
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { VerificationQueueService } from '../../application/services/verification-queue.service';
import { RiskScoringService } from '../../application/services/risk-scoring.service';

@ApiTags('Admin Verification Queue')
@Controller('admin/verification')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminVerificationController {
  constructor(
    private readonly queue: VerificationQueueService,
    private readonly riskScoring: RiskScoringService,
  ) {}

  @Post('claim-next')
  @HttpCode(200)
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
  async release(@Param('id') id: string, @Req() req: any) {
    await this.queue.release(id, req.adminId);
    return { success: true, message: 'Claim released' };
  }

  @Patch('orders/:id/approve')
  async approve(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { remarks?: string },
  ) {
    const data = await this.queue.approve(id, req.adminId, body?.remarks);
    return {
      success: true,
      message: 'Order verified and routed to sellers',
      data,
    };
  }

  @Patch('orders/:id/reject')
  async reject(@Param('id') id: string, @Req() req: any) {
    await this.queue.reject(id, req.adminId);
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
  async forceRelease(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { reason: string },
  ) {
    await this.queue.forceRelease(id, req.adminId, body?.reason ?? '', {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return { success: true, message: 'Claim force-released' };
  }

  /* ── Risk scoring ───────────────────────────────────────────────── */

  /**
   * Score every PLACED order whose risk band hasn't been computed yet.
   * Idempotent — already-scored orders are skipped. Use after deploying
   * a rules change to re-bucket the existing queue.
   */
  @Post('backfill-scores')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  async backfillScores() {
    const result = await this.riskScoring.backfillUnscored();
    return {
      success: true,
      message: `Scored ${result.scored} order${result.scored === 1 ? '' : 's'}`,
      data: result,
    };
  }

  @Post('orders/:id/rescore')
  @HttpCode(200)
  async rescore(@Param('id') id: string) {
    const data = await this.riskScoring.rescore(id);
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
  async bulkApproveGreen(
    @Req() req: any,
    @Body() body: { limit?: number; dryRun?: boolean } = {},
  ) {
    const data = await this.queue.bulkApproveGreen(
      req.adminId,
      body?.limit ?? 25,
      body?.dryRun === true,
      {
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      },
    );
    const message = body?.dryRun
      ? `${data.attempted} green order${data.attempted === 1 ? '' : 's'} would be approved`
      : `Approved ${data.succeeded}/${data.attempted} green orders`;
    return { success: true, message, data };
  }
}
