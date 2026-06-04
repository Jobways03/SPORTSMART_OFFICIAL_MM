// Phase 12 GST — Section 34 credit-note time-bar cron.
//
// Daily 02:30 IST (21:00 UTC previous day) sweep:
//   1. Find returns that have completed QC but haven't been classified
//      yet (creditNoteEligibilityStatus IS NULL), OR have a status that
//      can still flip with the passage of time (REQUIRES_FINANCE_REVIEW
//      when within the approaching-cutoff window).
//   2. For each, ask CreditNoteEligibilityService to classify.
//   3. Persist the decision on the Return row.
//   4. For TIME_BARRED / REQUIRES_FINANCE_REVIEW, upsert an AdminTask
//      under the appropriate kind so finance/ops sees the queue.
//
// Idempotency: the AdminTask unique constraint
// (kind, sourceType, sourceId) prevents duplicate rows on re-run.
// The Return classification update is overwrite-safe — running the
// cron N times produces the same end state.
//
// Cluster safety: wrapped in LeaderElectedCron so N replicas don't
// each scan + write. CronInstrumentationService records the run
// metrics in cron_runs (scanned / eligible / timebarred / review).
//
// See:
//   - docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md
//   - apps/api/src/modules/tax/application/services/credit-note-eligibility.service.ts
//   - apps/api/src/modules/tax/domain/credit-note-time-bar.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  AdminTaskKind,
  CreditNoteEligibilityStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { CreditNoteEligibilityService } from '../services/credit-note-eligibility.service';
import {
  CreditNoteService,
  SYSTEM_CREDIT_NOTE_ACTOR,
  Section34TimeBarredError,
  SourceInvoiceNotFoundError,
} from '../services/credit-note.service';

interface SweepCounts {
  scanned: number;
  eligible: number;
  timeBarred: number;
  requiresReview: number;
  adminTasksOpened: number;
  errors: number;
  // Phase 164 — safety-net retry of credit notes whose synchronous QC-time
  // generation failed (non-timebar). Was a gap: the cron classified
  // eligibility only and never re-issued, so a one-off failure left the
  // return ELIGIBLE-but-uncredited until an admin manually overrode.
  reissued: number;
  reissueFailed: number;
}

@Injectable()
export class TaxCreditNoteTimeBarCron {
  private readonly logger = new Logger(TaxCreditNoteTimeBarCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eligibility: CreditNoteEligibilityService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    // Phase 164 — safety-net re-issue of failed CN generations.
    private readonly creditNote: CreditNoteService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean(
      'TAX_CREDIT_NOTE_TIMEBAR_CRON_ENABLED' as any,
      true,
    );
  }

  private approachingDays(): number {
    return this.env.getNumber(
      'TAX_CREDIT_NOTE_TIMEBAR_APPROACHING_DAYS' as any,
      7,
    );
  }

  private scanLimit(): number {
    return this.env.getNumber(
      'TAX_CREDIT_NOTE_TIMEBAR_SCAN_LIMIT' as any,
      500,
    );
  }

  /**
   * Daily 02:00 server-local time. The Section 34 cutoff is
   * end-of-day IST on 30 September of FY+1 — a daily cadence is
   * fine since the cutoff doesn't move within a day. Prod runs in
   * UTC so this fires at 07:30 IST; engineers running locally see
   * it at whatever their machine considers 02:00. The exact wall
   * clock doesn't matter; what matters is "once per day".
   *
   * Body-side TTL: 12h (worst case is a large QC backlog after a
   * marketplace-wide return wave).
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    await this.leader.run(
      'tax-credit-note-timebar',
      12 * 60 * 60,
      async () => {
        try {
          await this.instr.wrap('tax-credit-note-timebar', () =>
            this.runOnce(),
          );
        } catch {
          // already recorded as FAILED in cron_runs
        }
      },
    );
  }

  async runOnce(now: Date = new Date()): Promise<SweepCounts> {
    const counts: SweepCounts = {
      scanned: 0,
      eligible: 0,
      timeBarred: 0,
      requiresReview: 0,
      adminTasksOpened: 0,
      errors: 0,
      reissued: 0,
      reissueFailed: 0,
    };

    const candidates = await this.collectCandidates();
    counts.scanned = candidates.length;
    // Even when there are no NEW classification candidates, the re-issue
    // safety-net must still run (a prior failure could be sitting in the
    // ELIGIBLE-but-uncredited state with nothing new to classify).
    if (candidates.length === 0) {
      await this.reissueEligibleUncredited(now, counts);
      return counts;
    }

    const approachingDays = this.approachingDays();

    for (const r of candidates) {
      try {
        const decision = await this.eligibility.classifyReturn(r.id, {
          now,
          approachingDays,
        });
        await this.persistDecision(r.id, decision, now);
        if (decision.status === 'ELIGIBLE') counts.eligible++;
        else if (decision.status === 'TIME_BARRED') counts.timeBarred++;
        else counts.requiresReview++;

        if (
          decision.status === 'TIME_BARRED' ||
          decision.status === 'REQUIRES_FINANCE_REVIEW'
        ) {
          const opened = await this.upsertAdminTask(
            r.id,
            r.returnNumber,
            decision.status,
            decision.reason,
            now,
          );
          if (opened) counts.adminTasksOpened++;
        }
      } catch (err) {
        counts.errors++;
        this.logger.warn(
          `Sec 34 classification failed for return ${r.returnNumber}: ${(err as Error).message}`,
        );
      }
    }

    // Phase 164 — re-issue safety net after classification.
    await this.reissueEligibleUncredited(now, counts);

    this.logger.log(
      `Sec 34 cron: scanned=${counts.scanned} eligible=${counts.eligible} ` +
        `time_barred=${counts.timeBarred} review=${counts.requiresReview} ` +
        `admin_tasks_opened=${counts.adminTasksOpened} errors=${counts.errors} ` +
        `reissued=${counts.reissued} reissue_failed=${counts.reissueFailed}`,
    );
    return counts;
  }

  /**
   * Phase 164 — safety-net retry. The synchronous QC-completion trigger
   * (return.service) calls CreditNoteService.generateForReturn; on a
   * non-timebar failure it logs and proceeds, leaving the return
   * ELIGIBLE-but-uncredited. Nothing previously re-issued it. Here we find
   * ELIGIBLE returns with no credit note and re-attempt generation
   * (idempotent — the service's advisory lock + delta logic returns the
   * existing CN if one was created in the meantime). Bounded by scanLimit.
   */
  private async reissueEligibleUncredited(
    now: Date,
    counts: SweepCounts,
  ): Promise<void> {
    const eligible = await this.prisma.return.findMany({
      where: {
        creditNoteEligibilityStatus: 'ELIGIBLE',
        qcCompletedAt: { not: null },
        qcDecision: { in: ['APPROVED', 'PARTIAL'] },
      },
      select: { id: true, returnNumber: true },
      orderBy: { qcCompletedAt: 'asc' },
      take: this.scanLimit(),
    });
    if (eligible.length === 0) return;

    for (const r of eligible) {
      // Skip returns that already have a credit note (the common case).
      const existing = await this.prisma.taxDocument.count({
        where: { documentType: 'CREDIT_NOTE', returnId: r.id },
      });
      if (existing > 0) continue;

      try {
        const res = await this.creditNote.generateForReturn(r.id, {
          actorId: SYSTEM_CREDIT_NOTE_ACTOR,
          now,
        });
        if (res.isNew) {
          counts.reissued++;
          this.logger.log(
            `Sec 34 cron re-issued credit note ${res.creditNote.documentNumber} ` +
              `for previously-uncredited return ${r.returnNumber}.`,
          );
        }
      } catch (err) {
        // Time-barred / no-source-invoice are expected terminal states for
        // some rows — they're handled by classification + the wallet route,
        // not by re-issue. Anything else is a real failure worth surfacing.
        if (
          err instanceof Section34TimeBarredError ||
          err instanceof SourceInvoiceNotFoundError
        ) {
          continue;
        }
        counts.reissueFailed++;
        this.logger.warn(
          `Sec 34 cron re-issue failed for return ${r.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Two cohorts:
   *   1. QC-completed returns never classified yet (status IS NULL).
   *   2. Returns already flagged REQUIRES_FINANCE_REVIEW — re-check
   *      in case `now()` has crossed the cutoff and they should
   *      escalate to TIME_BARRED. (ELIGIBLE rows have been handed
   *      to CreditNoteService and shouldn't re-flow through here.)
   */
  private async collectCandidates(): Promise<
    Array<{ id: string; returnNumber: string }>
  > {
    const limit = this.scanLimit();

    const unclassified = await this.prisma.return.findMany({
      where: {
        qcCompletedAt: { not: null },
        creditNoteEligibilityStatus: null,
        // Only returns whose QC outcome will produce a refund need
        // classification; REJECTED never triggers a credit note, and
        // DAMAGED is liability-side (logistics claim, not GST reversal).
        qcDecision: { in: ['APPROVED', 'PARTIAL'] },
      },
      select: { id: true, returnNumber: true },
      orderBy: { qcCompletedAt: 'asc' },
      take: limit,
    });

    const review = await this.prisma.return.findMany({
      where: {
        qcCompletedAt: { not: null },
        creditNoteEligibilityStatus: 'REQUIRES_FINANCE_REVIEW',
      },
      select: { id: true, returnNumber: true },
      orderBy: { qcCompletedAt: 'asc' },
      take: limit,
    });

    return [...unclassified, ...review];
  }

  private async persistDecision(
    returnId: string,
    decision: {
      status: CreditNoteEligibilityStatus;
      reason: string;
    },
    now: Date,
  ): Promise<void> {
    await this.prisma.return.update({
      where: { id: returnId },
      data: {
        creditNoteEligibilityStatus: decision.status,
        creditNoteEligibilityCheckedAt: now,
        creditNoteTimeBarReason: decision.reason,
      },
    });
  }

  /**
   * Idempotent upsert of the finance/ops triage task. The unique
   * constraint on (kind, sourceType, sourceId) means a re-run of
   * the cron after a previous TIME_BARRED classification finds the
   * existing OPEN row and updates only the `reason` text.
   *
   * Returns `true` only on first creation so the cron counter
   * reflects newly-opened tasks, not idempotent no-ops.
   */
  private async upsertAdminTask(
    returnId: string,
    returnNumber: string,
    status: 'TIME_BARRED' | 'REQUIRES_FINANCE_REVIEW',
    reason: string,
    now: Date,
  ): Promise<boolean> {
    const kind: AdminTaskKind =
      status === 'TIME_BARRED'
        ? 'GST_CREDIT_NOTE_TIME_BARRED'
        : 'GST_CREDIT_NOTE_TIME_BAR_APPROACHING';

    const existing = await this.prisma.adminTask.findUnique({
      where: {
        kind_sourceType_sourceId: {
          kind,
          sourceType: 'RETURN',
          sourceId: returnId,
        },
      },
    });
    if (existing) {
      // Only refresh the reason — never reopen a RESOLVED task or
      // overwrite an admin's in-progress claim.
      if (existing.status === 'OPEN' || existing.status === 'CLAIMED') {
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: { reason: `${returnNumber}: ${reason}` },
        });
      }
      return false;
    }

    // SLA: time-barred is finance-critical (refund customer immediately
    // + reconcile platform GST cost), so 24h breach. Approaching is
    // 48h to give ops a chase window before the cutoff lands.
    const slaHours = status === 'TIME_BARRED' ? 24 : 48;
    const slaBreachAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

    await this.prisma.adminTask.create({
      data: {
        kind,
        sourceType: 'RETURN',
        sourceId: returnId,
        reason: `${returnNumber}: ${reason}`,
        slaBreachAt,
      },
    });
    return true;
  }
}
