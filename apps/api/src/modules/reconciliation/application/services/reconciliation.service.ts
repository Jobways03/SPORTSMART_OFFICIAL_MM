import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DiscrepancyKind,
  DiscrepancyStatus,
  ReconciliationKind,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { toPaise } from '../../../../core/money/money-field-registry';
import { escapeCsvField } from '../../../../core/utils/csv.util';

/**
 * Phase 0 (PR 0.6) — precision-safe Decimal-to-paise conversion for
 * reconciliation comparisons. Uses the canonical `toPaise` (PR 0.4)
 * which is exact for Decimal and string inputs and throws on
 * fractional JS Number.
 */
function decimalToPaise(value: unknown): bigint {
  return toPaise(value) ?? 0n;
}

/** Per-runner aggregate result. */
interface RunnerResult {
  totalExpected: number;
  totalMatched: number;
  totalDiscrepancies: number;
  expectedAmountInPaise: bigint;
  matchedAmountInPaise: bigint;
  /**
   * Phase 173 (#14) — number of independent sub-sections of a runner that
   * threw. A runner with `sectionFailures > 0` but a non-zero amount of
   * successful work yields a PARTIAL run instead of an all-or-nothing FAILED.
   */
  sectionFailures: number;
  /** Concatenated section failure reasons (for the PARTIAL run's failureReason). */
  failureNotes: string[];
}

function emptyResult(): RunnerResult {
  return {
    totalExpected: 0,
    totalMatched: 0,
    totalDiscrepancies: 0,
    expectedAmountInPaise: 0n,
    matchedAmountInPaise: 0n,
    sectionFailures: 0,
    failureNotes: [],
  };
}

const LIVE_STATUSES: ReconciliationStatus[] = ['QUEUED', 'RUNNING'];
const DISCREPANCY_OPEN_STATES: DiscrepancyStatus[] = ['OPEN', 'IN_REVIEW'];

/**
 * Phase 173 (#18) — discrepancy status transition matrix. OPEN and IN_REVIEW
 * are the only states from which a discrepancy may move; RESOLVED / IGNORED are
 * terminal. A transition is only allowed if `to` is in the source state's set.
 */
const DISCREPANCY_TRANSITIONS: Record<DiscrepancyStatus, DiscrepancyStatus[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED', 'IGNORED'],
  IN_REVIEW: ['RESOLVED', 'IGNORED', 'OPEN'],
  RESOLVED: [],
  IGNORED: [],
};

const TERMINAL_DISCREPANCY: DiscrepancyStatus[] = ['RESOLVED', 'IGNORED'];

/**
 * Daily reconciliation runs — async, concurrency-guarded, audited.
 *
 * Phase 173 hardening (Finance Reconciliation audit):
 *   - Runs are ASYNC (#1): `enqueueRun` inserts a QUEUED row and returns
 *     immediately; `executeRun` does the work in the background and flips the
 *     row to COMPLETED / PARTIAL / FAILED. Clients poll GET /runs/:id.
 *   - At most one LIVE (QUEUED|RUNNING) run per (kind, period) (#2) — enforced
 *     by a partial-unique index + a pre-check; a clash returns 409.
 *   - audit_logs on run start / completion / discrepancy transition / CSV
 *     export (#11).
 *   - CAS on discrepancy transitions (#12) with an explicit state matrix (#18).
 *   - Per-discrepancy severity (#8) + persisted differenceInPaise (#9) +
 *     suggestedAction; precise per-runner DiscrepancyKind (#7).
 *   - Nine reconciliation kinds (#5): PAYMENT/COD/SETTLEMENT/REFUND/WALLET plus
 *     AFFILIATE_PAYOUT/COMMISSION/TDS/TCS.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
  ) {}

  // ── Run management (async) ──────────────────────────────────────

  /**
   * Phase 173 (#1/#2) — accept a run: validate, refuse a concurrent live run
   * for the same (kind, period), insert a QUEUED row, kick the worker off
   * detached, and return the row immediately. The HTTP request does NOT block
   * on the scan.
   */
  /**
   * Validate + concurrency-check + insert a QUEUED run + audit the launch.
   * Shared by the async (enqueueRun) and sync (runAndCollect) paths so the
   * concurrency guard / audit / runNumber logic lives in exactly one place.
   * Does NOT start the scan.
   */
  private async createQueuedRun(args: {
    kind: ReconciliationKind;
    periodStart: Date;
    periodEnd: Date;
    startedByAdminId?: string;
  }) {
    if (
      Number.isNaN(args.periodStart.getTime()) ||
      Number.isNaN(args.periodEnd.getTime())
    ) {
      throw new ConflictAppException('Invalid period dates');
    }
    if (args.periodEnd <= args.periodStart) {
      throw new ConflictAppException('periodEnd must be after periodStart');
    }

    // Pre-check (friendly 409) — the partial-unique index is the race-proof
    // backstop below.
    const live = await this.prisma.reconciliationRun.findFirst({
      where: {
        kind: args.kind,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        status: { in: LIVE_STATUSES },
      },
      select: { id: true },
    });
    if (live) {
      throw new ConflictAppException(
        `A ${args.kind} reconciliation for this period is already in progress (run ${live.id}).`,
      );
    }

    let run;
    try {
      run = await this.prisma.reconciliationRun.create({
        data: {
          kind: args.kind,
          status: 'QUEUED',
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          startedByAdminId: args.startedByAdminId ?? null,
          runNumber: this.generateRunNumber(),
        },
      });
    } catch (err) {
      // Race: two admins cleared the pre-check together; the partial-unique
      // index let exactly one win.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictAppException(
          `A ${args.kind} reconciliation for this period is already in progress.`,
        );
      }
      throw err;
    }

    // Audit the launch (#11) — best-effort, must not block the response.
    void this.audit
      .writeAuditLog({
        actorId: args.startedByAdminId,
        actorRole: args.startedByAdminId ? 'ADMIN' : 'SYSTEM',
        action: 'recon.run.started',
        module: 'reconciliation',
        resource: 'ReconciliationRun',
        resourceId: run.id,
        newValue: {
          kind: args.kind,
          periodStart: args.periodStart.toISOString(),
          periodEnd: args.periodEnd.toISOString(),
          runNumber: run.runNumber,
        },
      })
      .catch(() => undefined);

    return run;
  }

  async enqueueRun(args: {
    kind: ReconciliationKind;
    periodStart: Date;
    periodEnd: Date;
    startedByAdminId?: string;
  }) {
    const run = await this.createQueuedRun(args);

    // Kick off the scan DETACHED — the controller returns the QUEUED row now.
    void this.executeRun(run.id).catch((err) => {
      this.logger.error(
        `Detached reconciliation run ${run.id} crashed: ${(err as Error).message}`,
      );
    });

    return run;
  }

  /**
   * Phase 173 (#1) — the background worker. Flips QUEUED→RUNNING via CAS (so a
   * re-fire / reaper can't double-run it), executes the per-kind runner, and
   * records COMPLETED / PARTIAL / FAILED.
   */
  async executeRun(runId: string): Promise<void> {
    // CAS claim — only the QUEUED→RUNNING winner proceeds.
    const claim = await this.prisma.reconciliationRun.updateMany({
      where: { id: runId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (claim.count === 0) return; // already claimed / not queued

    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) return;

    try {
      const result = await this.dispatch(
        run.kind,
        run.id,
        run.periodStart,
        run.periodEnd,
      );

      // PARTIAL when some sections failed but the run still did useful work.
      const status: ReconciliationStatus =
        result.sectionFailures > 0 ? 'PARTIAL' : 'COMPLETED';

      const completed = await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          totalExpected: result.totalExpected,
          totalMatched: result.totalMatched,
          totalDiscrepancies: result.totalDiscrepancies,
          expectedAmountInPaise: result.expectedAmountInPaise,
          matchedAmountInPaise: result.matchedAmountInPaise,
          failureReason:
            result.failureNotes.length > 0
              ? result.failureNotes.join(' | ').slice(0, 2000)
              : null,
        },
      });

      if (result.totalDiscrepancies > 0) {
        this.eventBus
          .publish({
            eventName: 'reconciliation.discrepancies.found',
            aggregate: 'ReconciliationRun',
            aggregateId: completed.id,
            occurredAt: new Date(),
            payload: {
              runId: completed.id,
              kind: completed.kind,
              periodStart: completed.periodStart,
              periodEnd: completed.periodEnd,
              totalDiscrepancies: result.totalDiscrepancies,
              totalExpected: result.totalExpected,
              startedByAdminId: completed.startedByAdminId,
            },
          })
          .catch(() => undefined);
      }

      void this.audit
        .writeAuditLog({
          actorId: completed.startedByAdminId ?? undefined,
          actorRole: 'SYSTEM',
          action: 'recon.run.completed',
          module: 'reconciliation',
          resource: 'ReconciliationRun',
          resourceId: completed.id,
          newValue: {
            status,
            totalExpected: result.totalExpected,
            totalMatched: result.totalMatched,
            totalDiscrepancies: result.totalDiscrepancies,
          },
        })
        .catch(() => undefined);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Reconciliation run ${run.id} failed: ${msg}`);
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), failureReason: msg },
      });
      void this.audit
        .writeAuditLog({
          actorId: run.startedByAdminId ?? undefined,
          actorRole: 'SYSTEM',
          action: 'recon.run.failed',
          module: 'reconciliation',
          resource: 'ReconciliationRun',
          resourceId: run.id,
          newValue: { failureReason: msg },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Synchronous run — retained for the cron callers (wallet-ledger-recon etc)
   * that want to await completion. Goes through the same async lifecycle so the
   * concurrency guard + audit + PARTIAL handling apply uniformly.
   */
  async runAndCollect(args: {
    kind: ReconciliationKind;
    periodStart: Date;
    periodEnd: Date;
    startedByAdminId?: string;
  }) {
    // Adversarial-review fix (Phase 173): do NOT route through enqueueRun (which
    // kicks executeRun detached) — that left runAndCollect awaiting a SECOND
    // executeRun whose CAS-claim lost to the detached one, so it returned while
    // the row was still RUNNING. Create the QUEUED row, then OWN the single
    // execute() ourselves so the returned row is guaranteed terminal.
    const run = await this.createQueuedRun(args);
    await this.executeRun(run.id);
    return this.prisma.reconciliationRun.findUnique({ where: { id: run.id } });
  }

  private dispatch(
    kind: ReconciliationKind,
    runId: string,
    start: Date,
    end: Date,
  ): Promise<RunnerResult> {
    switch (kind) {
      case 'PAYMENT':
        return this.runPayments(runId, start, end);
      case 'COD':
        return this.runCod(runId, start, end);
      case 'SETTLEMENT':
        return this.runSettlement(runId, start, end);
      case 'REFUND':
        return this.runRefund(runId, start, end);
      case 'WALLET':
        return this.runWallet(runId);
      case 'AFFILIATE_PAYOUT':
        return this.runAffiliatePayout(runId, start, end);
      case 'COMMISSION':
        return this.runCommission(runId, start, end);
      case 'TDS':
        return this.runTds(runId, start, end);
      case 'TCS':
        return this.runTcs(runId, start, end);
      default:
        throw new ConflictAppException(`Unknown reconciliation kind: ${kind}`);
    }
  }

  /** Phase 173 — human-readable run id. */
  private generateRunNumber(): string {
    const year = new Date().getFullYear();
    const suffix = (
      globalThis.crypto?.randomUUID?.() ?? `${process.pid}-${Date.now()}`
    )
      .replace(/-/g, '')
      .slice(0, 10)
      .toUpperCase();
    return `RECON-${year}-${suffix}`;
  }

  /**
   * Phase 173 — severity heuristic (0–100). Higher = more urgent. Driven by the
   * money at stake + the discrepancy class (a missing bank reference on a large
   * disbursement is more urgent than a tiny wallet drift).
   */
  private severityFor(kind: DiscrepancyKind, amountPaise: bigint | null): number {
    const abs = amountPaise == null ? 0n : amountPaise < 0n ? -amountPaise : amountPaise;
    const rupees = Number(abs) / 100;
    let base: number;
    switch (kind) {
      case 'MISSING_UTR':
      case 'PROVIDER_REFERENCE_MISSING':
      case 'MISSING_PAYMENT':
      case 'DUPLICATE_PAYMENT':
      case 'DUPLICATE_REFUND':
        base = 70;
        break;
      case 'SETTLEMENT_MISMATCH':
      case 'AMOUNT_MISMATCH':
      case 'ORPHAN_LEDGER_ENTRY':
        base = 60;
        break;
      case 'EXPECTED_NOT_FOUND':
      case 'MISSING_REFUND':
        base = 55;
        break;
      default:
        base = 45;
    }
    // Money escalation: +10 over ₹10k, +20 over ₹50k, +30 over ₹2L.
    if (rupees >= 200_000) base += 30;
    else if (rupees >= 50_000) base += 20;
    else if (rupees >= 10_000) base += 10;
    return Math.max(0, Math.min(100, base));
  }

  // ── Per-kind runners ────────────────────────────────────────────

  private async runPayments(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const orders = await this.prisma.masterOrder.findMany({
      where: { paymentMethod: 'ONLINE', createdAt: { gte: start, lt: end } },
      select: {
        id: true, orderNumber: true, totalAmount: true,
        paymentStatus: true, razorpayPaymentId: true, paymentExpiresAt: true,
      },
    });

    const res = emptyResult();
    res.totalExpected = orders.length;
    const now = new Date();
    // Phase 173 — DUPLICATE_PAYMENT detection: two orders sharing one
    // razorpayPaymentId is a double-attribution / replay.
    const byPaymentId = new Map<string, string[]>();

    for (const o of orders) {
      const amountPaise = decimalToPaise(o.totalAmount);
      res.expectedAmountInPaise += amountPaise;

      if (o.razorpayPaymentId) {
        const list = byPaymentId.get(o.razorpayPaymentId) ?? [];
        list.push(o.orderNumber);
        byPaymentId.set(o.razorpayPaymentId, list);
      }

      if (o.paymentStatus === 'PAID') {
        if (!o.razorpayPaymentId) {
          await this.recordDiscrepancy({
            runId, kind: 'MISSING_PAYMENT',
            masterOrderId: o.id, orderNumber: o.orderNumber,
            expectedInPaise: amountPaise, actualInPaise: null,
            description: `Order ${o.orderNumber} marked PAID but no razorpayPaymentId is recorded.`,
            suggestedAction: 'Fetch the order from Razorpay; attach the payment id or revert the PAID status.',
          });
          res.totalDiscrepancies++;
        } else {
          res.totalMatched++;
          res.matchedAmountInPaise += amountPaise;
        }
      } else if (
        o.paymentStatus === 'PENDING' &&
        o.paymentExpiresAt &&
        o.paymentExpiresAt < now
      ) {
        await this.recordDiscrepancy({
          runId, kind: 'STATUS_MISMATCH',
          masterOrderId: o.id, orderNumber: o.orderNumber,
          expectedInPaise: amountPaise, actualInPaise: null,
          description: `Order ${o.orderNumber} payment window expired but status is still PENDING.`,
          suggestedAction: 'Run the payment-status poller or expire the order.',
        });
        res.totalDiscrepancies++;
      }
    }

    for (const [payId, orderNums] of byPaymentId) {
      if (orderNums.length > 1) {
        await this.recordDiscrepancy({
          runId, kind: 'DUPLICATE_PAYMENT',
          externalRef: payId, expectedInPaise: null, actualInPaise: null,
          description: `Razorpay payment ${payId} is attributed to ${orderNums.length} orders: ${orderNums.join(', ')}.`,
          suggestedAction: 'Investigate double-attribution; only one order should carry this payment id.',
        });
        res.totalDiscrepancies++;
      }
    }

    return res;
  }

  private async runCod(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const subOrders = await this.prisma.subOrder.findMany({
      where: {
        masterOrder: { paymentMethod: 'COD' },
        fulfillmentStatus: 'DELIVERED',
        deliveredAt: { gte: start, lt: end },
      },
      select: {
        id: true, masterOrderId: true, paymentStatus: true, subTotal: true,
        masterOrder: { select: { orderNumber: true } },
      },
    });

    const res = emptyResult();
    res.totalExpected = subOrders.length;

    for (const so of subOrders) {
      const amountPaise = decimalToPaise(so.subTotal);
      res.expectedAmountInPaise += amountPaise;
      if (so.paymentStatus === 'PAID') {
        res.totalMatched++;
        res.matchedAmountInPaise += amountPaise;
      } else {
        await this.recordDiscrepancy({
          runId, kind: 'STATUS_MISMATCH',
          masterOrderId: so.masterOrderId,
          orderNumber: so.masterOrder.orderNumber,
          expectedInPaise: amountPaise, actualInPaise: 0n,
          description:
            `COD sub-order ${so.id} delivered but paymentStatus=${so.paymentStatus}. ` +
            `Has the courier remitted the cash collection?`,
          suggestedAction: 'Confirm courier remittance, then mark the COD collection paid.',
        });
        res.totalDiscrepancies++;
      }
    }
    return res;
  }

  /**
   * Settlement runner. Two independent sections (#14 PARTIAL surface):
   *   1. PAID settlements in the window without a UTR → MISSING_UTR.
   *   2. APPROVED settlements stuck >7d — Phase 173 (#15) now period-bounded:
   *      only those whose stuck-since timestamp falls inside the run window,
   *      and (#17) deduped against the PAID set so a stuck-then-paid settlement
   *      isn't counted twice.
   */
  private async runSettlement(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const res = emptyResult();
    const paidIds = new Set<string>();

    // Section 1 — PAID without UTR.
    try {
      const paid = await this.prisma.sellerSettlement.findMany({
        where: { status: 'PAID', paidAt: { gte: start, lt: end } },
        select: { id: true, sellerName: true, totalSettlementAmount: true, utrReference: true },
      });
      res.totalExpected += paid.length;
      for (const s of paid) {
        paidIds.add(s.id);
        const amountPaise = decimalToPaise(s.totalSettlementAmount);
        res.expectedAmountInPaise += amountPaise;
        if (s.utrReference) {
          res.totalMatched++;
          res.matchedAmountInPaise += amountPaise;
        } else {
          await this.recordDiscrepancy({
            runId, kind: 'MISSING_UTR',
            externalRef: s.id, expectedInPaise: amountPaise, actualInPaise: null,
            description: `Seller settlement ${s.id} (${s.sellerName}) marked PAID but no UTR reference is recorded.`,
            suggestedAction: 'Obtain the bank UTR and attach it, or revert the PAID status.',
          });
          res.totalDiscrepancies++;
        }
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`paid-without-UTR section failed: ${(err as Error).message}`);
    }

    // Section 2 — APPROVED stuck >7d, bounded to the window (#15), deduped (#17).
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      // Stuck "as of" is min(periodEnd, now-7d); also require the stuck state to
      // have begun within the window so a "last week" run doesn't surface today's.
      const stuckCutoff = end < sevenDaysAgo ? end : sevenDaysAgo;
      const stuck = await this.prisma.sellerSettlement.findMany({
        where: {
          status: 'APPROVED',
          updatedAt: { gte: start, lt: stuckCutoff },
        },
        select: { id: true, sellerName: true, totalSettlementAmount: true, updatedAt: true },
      });
      for (const s of stuck) {
        if (paidIds.has(s.id)) continue; // #17 dedup
        const amountPaise = decimalToPaise(s.totalSettlementAmount);
        res.totalExpected++;
        await this.recordDiscrepancy({
          runId, kind: 'SETTLEMENT_MISMATCH',
          externalRef: s.id, expectedInPaise: amountPaise, actualInPaise: null,
          description:
            `Settlement ${s.id} (${s.sellerName}) APPROVED on ` +
            `${s.updatedAt.toISOString().slice(0, 10)} — over 7 days without PAID transition.`,
          suggestedAction: 'Chase the bank-transfer queue or re-trigger the settlement payout.',
        });
        res.totalDiscrepancies++;
        res.expectedAmountInPaise += amountPaise;
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`stuck-approval section failed: ${(err as Error).message}`);
    }

    return res;
  }

  /**
   * Refund runner. Two independent sections (#14 PARTIAL surface):
   *   1. Legacy `Return` rows marked refund-processed without a refundReference.
   *   2. Phase 173 (#5) — the unified `RefundInstruction` queue (the modern
   *      refund path). An instruction that reached SUCCESS / SETTLED (money sent)
   *      but carries NEITHER a gatewayRefundId (online) NOR a walletTransactionId
   *      (wallet / goodwill) is an orphan: we believe we paid but hold no
   *      downstream reference. The check is method-agnostic, so it never
   *      false-positives on a legitimately wallet-settled or manually-wired
   *      refund (those still carry one of the two references). The live
   *      "GET refund from Razorpay" cross-check the audit also mentions belongs
   *      in the refund-gateway recon cron (Phase 167) — running per-row gateway
   *      calls inside a batch run would re-introduce the very blocking/rate-limit
   *      problem #1 fixed — so it is deliberately NOT done here.
   */
  private async runRefund(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const res = emptyResult();

    // Section 1 — legacy Return rows.
    try {
      const returns = await this.prisma.return.findMany({
        where: { refundProcessedAt: { gte: start, lt: end } },
        select: { id: true, returnNumber: true, refundAmount: true, refundReference: true },
      });
      res.totalExpected += returns.length;
      for (const r of returns) {
        const amountPaise = decimalToPaise(r.refundAmount ?? 0);
        res.expectedAmountInPaise += amountPaise;
        if (!r.refundReference) {
          await this.recordDiscrepancy({
            runId, kind: 'MISSING_REFUND',
            externalRef: r.id, orderNumber: r.returnNumber,
            expectedInPaise: amountPaise, actualInPaise: null,
            description: `Return ${r.returnNumber} marked refund-processed but no refundReference is recorded.`,
            suggestedAction: 'Confirm the gateway refund and attach its reference, or re-run the refund.',
          });
          res.totalDiscrepancies++;
        } else {
          res.totalMatched++;
          res.matchedAmountInPaise += amountPaise;
        }
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`legacy-return refund section failed: ${(err as Error).message}`);
    }

    // Section 2 — Phase 173 (#5) unified RefundInstruction queue.
    try {
      const instructions = await this.prisma.refundInstruction.findMany({
        where: {
          status: { in: ['SUCCESS', 'SETTLED'] },
          processedAt: { gte: start, lt: end },
        },
        select: {
          id: true, customerId: true, amountInPaise: true, status: true,
          gatewayRefundId: true, walletTransactionId: true,
        },
      });
      res.totalExpected += instructions.length;
      for (const ri of instructions) {
        res.expectedAmountInPaise += ri.amountInPaise;
        if (!ri.gatewayRefundId && !ri.walletTransactionId) {
          await this.recordDiscrepancy({
            runId, kind: 'MISSING_REFUND',
            externalRef: ri.id, expectedInPaise: ri.amountInPaise, actualInPaise: null,
            description:
              `RefundInstruction ${ri.id} (customer ${ri.customerId}) is ${ri.status} ` +
              `but has neither a gatewayRefundId nor a walletTransactionId — the refund is marked sent but we hold no reference.`,
            suggestedAction: 'Reconcile with Razorpay / the wallet ledger; attach the missing reference or re-open the refund.',
          });
          res.totalDiscrepancies++;
        } else {
          res.totalMatched++;
          res.matchedAmountInPaise += ri.amountInPaise;
        }
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`refund-instruction section failed: ${(err as Error).message}`);
    }

    return res;
  }

  private async runWallet(runId: string): Promise<RunnerResult> {
    const drifts = await this.prisma.$queryRaw<Array<{
      wallet_id: string;
      user_id: string;
      balance_in_paise: number;
      ledger_sum: bigint | number | null;
    }>>(Prisma.sql`
      SELECT
        w.id              AS wallet_id,
        w.user_id         AS user_id,
        w.balance_in_paise AS balance_in_paise,
        COALESCE(SUM(wt.amount_in_paise) FILTER (WHERE wt.status = 'COMPLETED'), 0)::bigint AS ledger_sum
      FROM wallets w
      LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
      GROUP BY w.id, w.user_id, w.balance_in_paise
    `);

    const res = emptyResult();
    res.totalExpected = drifts.length;

    for (const row of drifts) {
      const ledger = BigInt(row.ledger_sum ?? 0);
      const balance = BigInt(row.balance_in_paise);
      const absBalance = balance < 0n ? -balance : balance;
      res.expectedAmountInPaise += absBalance;
      if (ledger === balance) {
        res.totalMatched++;
        res.matchedAmountInPaise += absBalance;
      } else {
        const drift = ledger - balance;
        await this.recordDiscrepancy({
          runId, kind: 'AMOUNT_MISMATCH',
          externalRef: row.wallet_id,
          expectedInPaise: balance, actualInPaise: ledger,
          description:
            `Wallet ${row.wallet_id} (user ${row.user_id}) balance ` +
            `${balance.toString()} paise but ledger sums to ${ledger.toString()} paise (drift ${drift.toString()} paise).`,
          suggestedAction: 'Replay the wallet ledger; correct the balance or the offending transaction.',
        });
        res.totalDiscrepancies++;
      }
    }
    return res;
  }

  /**
   * Phase 173 (#5) — affiliate payout reconciliation. A PAID payout request in
   * the window must carry a bank transactionRef; APPROVED requests stuck >7d
   * are flagged. Mirrors the seller-settlement logic for the affiliate side.
   */
  private async runAffiliatePayout(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const res = emptyResult();
    // Adversarial-review fix (Phase 173): mirror runSettlement's dedup so a
    // payout that was APPROVED then PAID inside the window (and whose APPROVED
    // updatedAt still falls in range) is not counted twice — once matched in the
    // paid section, once as a stuck SETTLEMENT_MISMATCH.
    const paidIds = new Set<string>();

    try {
      const paid = await this.prisma.affiliatePayoutRequest.findMany({
        where: { status: 'PAID', paidAt: { gte: start, lt: end } },
        select: { id: true, affiliateId: true, netAmount: true, transactionRef: true },
      });
      res.totalExpected += paid.length;
      for (const p of paid) {
        paidIds.add(p.id);
        const amountPaise = decimalToPaise(p.netAmount);
        res.expectedAmountInPaise += amountPaise;
        if (p.transactionRef) {
          res.totalMatched++;
          res.matchedAmountInPaise += amountPaise;
        } else {
          await this.recordDiscrepancy({
            runId, kind: 'MISSING_UTR',
            externalRef: p.id, expectedInPaise: amountPaise, actualInPaise: null,
            description: `Affiliate payout ${p.id} (affiliate ${p.affiliateId}) marked PAID but no transactionRef is recorded.`,
            suggestedAction: 'Attach the bank transfer reference, or revert the PAID status.',
          });
          res.totalDiscrepancies++;
        }
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`affiliate paid-without-ref section failed: ${(err as Error).message}`);
    }

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const stuckCutoff = end < sevenDaysAgo ? end : sevenDaysAgo;
      const stuck = await this.prisma.affiliatePayoutRequest.findMany({
        where: { status: 'APPROVED', updatedAt: { gte: start, lt: stuckCutoff } },
        select: { id: true, affiliateId: true, netAmount: true, updatedAt: true },
      });
      for (const p of stuck) {
        if (paidIds.has(p.id)) continue; // dedup vs the paid section
        const amountPaise = decimalToPaise(p.netAmount);
        res.totalExpected++;
        res.expectedAmountInPaise += amountPaise;
        await this.recordDiscrepancy({
          runId, kind: 'SETTLEMENT_MISMATCH',
          externalRef: p.id, expectedInPaise: amountPaise, actualInPaise: null,
          description: `Affiliate payout ${p.id} (affiliate ${p.affiliateId}) APPROVED on ${p.updatedAt.toISOString().slice(0, 10)} — over 7 days without PAID.`,
          suggestedAction: 'Process the affiliate payout or investigate the stuck request.',
        });
        res.totalDiscrepancies++;
      }
    } catch (err) {
      res.sectionFailures++;
      res.failureNotes.push(`affiliate stuck section failed: ${(err as Error).message}`);
    }

    return res;
  }

  /**
   * Phase 173 (#5) — commission-vs-settlement reconciliation. A PAID commission
   * must link to a payout request (payoutRequestId), and that request must
   * itself be PAID. A PAID commission with no/unpaid payout is an orphan.
   */
  private async runCommission(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const commissions = await this.prisma.affiliateCommission.findMany({
      where: { status: 'PAID', paidAt: { gte: start, lt: end } },
      select: {
        id: true, affiliateId: true, adjustedAmount: true,
        payoutRequestId: true,
        payoutRequest: { select: { id: true, status: true } },
      },
    });

    const res = emptyResult();
    res.totalExpected = commissions.length;

    for (const c of commissions) {
      const amountPaise = decimalToPaise(c.adjustedAmount);
      res.expectedAmountInPaise += amountPaise;
      if (!c.payoutRequestId || !c.payoutRequest) {
        await this.recordDiscrepancy({
          runId, kind: 'ORPHAN_LEDGER_ENTRY',
          externalRef: c.id, expectedInPaise: amountPaise, actualInPaise: null,
          description: `Commission ${c.id} (affiliate ${c.affiliateId}) is PAID but linked to no payout request.`,
          suggestedAction: 'Link the commission to its paying payout request, or correct its status.',
        });
        res.totalDiscrepancies++;
      } else if (c.payoutRequest.status !== 'PAID') {
        await this.recordDiscrepancy({
          runId, kind: 'STATUS_MISMATCH',
          externalRef: c.id, expectedInPaise: amountPaise, actualInPaise: null,
          description: `Commission ${c.id} is PAID but its payout request ${c.payoutRequest.id} is ${c.payoutRequest.status}.`,
          suggestedAction: 'Reconcile the commission status with its payout request status.',
        });
        res.totalDiscrepancies++;
      } else {
        res.totalMatched++;
        res.matchedAmountInPaise += amountPaise;
      }
    }
    return res;
  }

  /**
   * Phase 173 (#5) — §194-O TDS ledger reconciliation. DEPOSITED rows must
   * carry a challan reference; the deducted tdsInPaise must match
   * netSale × rate. Period-bounded on computedAt.
   */
  private async runTds(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const rows = await this.prisma.section194OTdsLedger.findMany({
      where: { computedAt: { gte: start, lt: end }, status: { not: 'REVERSED' } },
      select: {
        id: true, sellerId: true, filingPeriod: true, status: true,
        netSaleInPaise: true, tdsRateBps: true, tdsInPaise: true, challanReference: true,
        // Adversarial-review fix (Phase 173): these legitimately make tdsInPaise
        // diverge from a naive netSale×rate, so the amount check must skip rows
        // that carry an adjustment to avoid false-positive AMOUNT_MISMATCHes.
        adjustmentCarriedForwardInPaise: true, refundReversalInPaise: true,
      },
    });

    const res = emptyResult();
    res.totalExpected = rows.length;

    for (const r of rows) {
      res.expectedAmountInPaise += r.tdsInPaise;
      let flagged = false;

      if (r.status === 'DEPOSITED' && !r.challanReference) {
        await this.recordDiscrepancy({
          runId, kind: 'PROVIDER_REFERENCE_MISSING',
          externalRef: r.id, expectedInPaise: r.tdsInPaise, actualInPaise: null,
          description: `§194-O TDS row ${r.id} (seller ${r.sellerId}, ${r.filingPeriod}) is DEPOSITED but has no challan reference.`,
          suggestedAction: 'Attach the challan reference for the TDS deposit.',
        });
        res.totalDiscrepancies++;
        flagged = true;
      }

      // Amount sanity. round(netSale × rate / 10000) should equal recorded TDS.
      const expectedTds =
        (r.netSaleInPaise * BigInt(r.tdsRateBps) + 5000n) / 10000n;
      const hasAdjustment =
        r.adjustmentCarriedForwardInPaise !== 0n || r.refundReversalInPaise !== 0n;
      if (!hasAdjustment) {
        // No adjustment → the exact relationship must hold (±1 paise rounding).
        const diff = r.tdsInPaise - expectedTds;
        const absDiff = diff < 0n ? -diff : diff;
        if (absDiff > 100n) {
          await this.recordDiscrepancy({
            runId, kind: 'AMOUNT_MISMATCH',
            externalRef: r.id, expectedInPaise: expectedTds, actualInPaise: r.tdsInPaise,
            description: `§194-O TDS row ${r.id}: recorded TDS ${r.tdsInPaise} paise vs computed ${expectedTds} paise (net ${r.netSaleInPaise} @ ${r.tdsRateBps}bps).`,
            suggestedAction: 'Recompute the TDS for this row or investigate the rate/base snapshot.',
          });
          res.totalDiscrepancies++;
          flagged = true;
        }
      } else {
        // Adversarial-review fix (Phase 173): an adjusted row legitimately
        // diverges from the naive netSale×rate (a carry-forward / refund-
        // reversal shifts the base in ways this runner can't reconstruct without
        // replaying the full ledger chain). Skipping the EXACT check avoids false
        // positives, but a fully-blind skip hides gross adjustment-computation
        // bugs. So apply LOOSE bounds instead: TDS must be non-negative, must not
        // exceed the net sale base, and must stay within 2× the naive estimate.
        // These catch "10× too large / negative" corruption without flagging
        // legitimate adjustment shifts.
        const upperBound = expectedTds * 2n;
        if (
          r.tdsInPaise < 0n ||
          r.tdsInPaise > r.netSaleInPaise ||
          (expectedTds > 0n && r.tdsInPaise > upperBound)
        ) {
          await this.recordDiscrepancy({
            runId, kind: 'AMOUNT_MISMATCH',
            externalRef: r.id, expectedInPaise: expectedTds, actualInPaise: r.tdsInPaise,
            description: `§194-O TDS row ${r.id}: recorded TDS ${r.tdsInPaise} paise is implausible vs base ${r.netSaleInPaise} @ ${r.tdsRateBps}bps (row carries an adjustment; loose-bound sanity check failed).`,
            suggestedAction: 'Verify the adjustment computation; the recorded TDS is outside plausible bounds for the base.',
          });
          res.totalDiscrepancies++;
          flagged = true;
        }
      }

      if (!flagged) {
        res.totalMatched++;
        res.matchedAmountInPaise += r.tdsInPaise;
      }
    }
    return res;
  }

  /**
   * Phase 173 (#5) — §52 GST TCS ledger reconciliation. PAID_TO_GOVT rows must
   * carry a payment reference; FILED rows a NIC ARN; the component TCS
   * (cgst+sgst+igst) must sum to totalTcsInPaise. Period-bounded on computedAt.
   */
  private async runTcs(runId: string, start: Date, end: Date): Promise<RunnerResult> {
    const rows = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { computedAt: { gte: start, lt: end }, status: { not: 'REVERSED' } },
      select: {
        id: true, sellerId: true, filingPeriod: true, status: true,
        cgstTcsInPaise: true, sgstTcsInPaise: true, igstTcsInPaise: true,
        totalTcsInPaise: true, nicArn: true, paymentReference: true,
      },
    });

    const res = emptyResult();
    res.totalExpected = rows.length;

    for (const r of rows) {
      res.expectedAmountInPaise += r.totalTcsInPaise;
      let flagged = false;

      if (r.status === 'PAID_TO_GOVT' && !r.paymentReference) {
        await this.recordDiscrepancy({
          runId, kind: 'PROVIDER_REFERENCE_MISSING',
          externalRef: r.id, expectedInPaise: r.totalTcsInPaise, actualInPaise: null,
          description: `TCS row ${r.id} (seller ${r.sellerId ?? '—'}, ${r.filingPeriod}) is PAID_TO_GOVT but has no payment reference.`,
          suggestedAction: 'Attach the government payment reference for the TCS remittance.',
        });
        res.totalDiscrepancies++;
        flagged = true;
      } else if (r.status === 'FILED' && !r.nicArn) {
        await this.recordDiscrepancy({
          runId, kind: 'PROVIDER_REFERENCE_MISSING',
          externalRef: r.id, expectedInPaise: r.totalTcsInPaise, actualInPaise: null,
          description: `TCS row ${r.id} (${r.filingPeriod}) is FILED but has no NIC ARN.`,
          suggestedAction: 'Capture the GSTR-8 ARN for this filed TCS row.',
        });
        res.totalDiscrepancies++;
        flagged = true;
      }

      const componentSum = r.cgstTcsInPaise + r.sgstTcsInPaise + r.igstTcsInPaise;
      if (componentSum !== r.totalTcsInPaise) {
        await this.recordDiscrepancy({
          runId, kind: 'AMOUNT_MISMATCH',
          externalRef: r.id, expectedInPaise: r.totalTcsInPaise, actualInPaise: componentSum,
          description: `TCS row ${r.id}: components (CGST+SGST+IGST=${componentSum}) ≠ total (${r.totalTcsInPaise}) paise.`,
          suggestedAction: 'Recompute the TCS component split for this row.',
        });
        res.totalDiscrepancies++;
        flagged = true;
      }

      if (!flagged) {
        res.totalMatched++;
        res.matchedAmountInPaise += r.totalTcsInPaise;
      }
    }
    return res;
  }

  // ── Discrepancy management ──────────────────────────────────────

  private async recordDiscrepancy(args: {
    runId: string;
    kind: DiscrepancyKind;
    masterOrderId?: string | null;
    orderNumber?: string | null;
    externalRef?: string | null;
    expectedInPaise?: bigint | null;
    actualInPaise?: bigint | null;
    description: string;
    suggestedAction?: string | null;
    severity?: number;
  }) {
    // Phase 173 (#9) — persist the drift when both sides are known.
    const difference =
      args.expectedInPaise != null && args.actualInPaise != null
        ? args.actualInPaise - args.expectedInPaise
        : null;
    const severity =
      args.severity ??
      this.severityFor(args.kind, difference ?? args.expectedInPaise ?? args.actualInPaise ?? null);

    return this.prisma.reconciliationDiscrepancy.create({
      data: {
        runId: args.runId,
        kind: args.kind,
        masterOrderId: args.masterOrderId ?? null,
        orderNumber: args.orderNumber ?? null,
        externalRef: args.externalRef ?? null,
        expectedInPaise: args.expectedInPaise ?? null,
        actualInPaise: args.actualInPaise ?? null,
        differenceInPaise: difference,
        severity,
        description: args.description,
        suggestedAction: args.suggestedAction ?? null,
      },
    });
  }

  async listRuns(filter: {
    page: number;
    limit: number;
    kind?: ReconciliationKind;
    status?: ReconciliationStatus;
  }) {
    const where: Prisma.ReconciliationRunWhereInput = {};
    if (filter.kind) where.kind = filter.kind;
    if (filter.status) where.status = filter.status;
    const skip = (filter.page - 1) * filter.limit;
    const [items, total] = await Promise.all([
      this.prisma.reconciliationRun.findMany({
        where,
        orderBy: { queuedAt: 'desc' },
        skip,
        take: filter.limit,
      }),
      this.prisma.reconciliationRun.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  async getRun(id: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id },
      include: {
        discrepancies: { orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }] },
      },
    });
    if (!run) throw new NotFoundAppException('Run not found');
    return run;
  }

  /**
   * Phase 173 (#12/#18) + Phase 174 (#1/#2/#16) — CAS transition with an
   * explicit state matrix. A transition only succeeds if the row is still in an
   * allowed source state, so two admins racing don't both "win". The CAS flip
   * and the immutable history row are written in ONE transaction (#2), so the
   * audit trail can never diverge from the row. Entering IN_REVIEW (the spec's
   * INVESTIGATING) stamps who/when (#1); a `recon.discrepancy.transitioned`
   * event is published for downstream consumers (#16). Throws Conflict if the
   * row already moved or the transition is illegal. Terminal→OPEN is NOT allowed
   * here — that is `reopenDiscrepancy` (#8), gated by a higher permission.
   */
  async transitionDiscrepancy(args: {
    id: string;
    status: DiscrepancyStatus;
    notes?: string | null;
    adminId?: string;
  }) {
    const current = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id: args.id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundAppException('Discrepancy not found');

    const allowed = DISCREPANCY_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new ConflictAppException(
        `Cannot move discrepancy from ${current.status} to ${args.status}.`,
      );
    }

    const isTerminal = TERMINAL_DISCREPANCY.includes(args.status);
    const enteringReview = args.status === 'IN_REVIEW';
    const now = new Date();

    // Phase 174 (#2/#5) — CAS + immutable history row in ONE transaction.
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.reconciliationDiscrepancy.updateMany({
        where: { id: args.id, status: current.status },
        data: {
          status: args.status,
          resolutionNotes: args.notes ?? undefined,
          // Phase 174 (#1) — stamp who started investigating + when (leave
          // untouched on non-IN_REVIEW transitions).
          investigatingByAdminId: enteringReview ? args.adminId ?? null : undefined,
          investigatingAt: enteringReview ? now : undefined,
          resolvedByAdminId: isTerminal ? args.adminId ?? null : null,
          resolvedAt: isTerminal ? now : null,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictAppException(
          'Discrepancy was modified by another admin — refresh and retry.',
        );
      }
      await tx.discrepancyStatusHistory.create({
        data: {
          discrepancyId: args.id,
          fromStatus: current.status,
          toStatus: args.status,
          actorAdminId: args.adminId ?? null,
          actorRole: args.adminId ? 'ADMIN' : 'SYSTEM',
          notes: args.notes ?? null,
        },
      });
    });

    void this.audit
      .writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'recon.discrepancy.transitioned',
        module: 'reconciliation',
        resource: 'ReconciliationDiscrepancy',
        resourceId: args.id,
        oldValue: { status: current.status },
        newValue: { status: args.status, notes: args.notes ?? null },
      })
      .catch(() => undefined);

    // Phase 174 (#16) — emit for notifications/monitoring consumers.
    this.eventBus
      .publish({
        eventName: 'recon.discrepancy.transitioned',
        aggregate: 'ReconciliationDiscrepancy',
        aggregateId: args.id,
        occurredAt: now,
        payload: {
          discrepancyId: args.id,
          fromStatus: current.status,
          toStatus: args.status,
          adminId: args.adminId ?? null,
        },
      })
      .catch(() => undefined);

    return this.prisma.reconciliationDiscrepancy.findUnique({ where: { id: args.id } });
  }

  /**
   * Phase 174 (#8) — reopen a TERMINAL (RESOLVED/IGNORED) discrepancy back to
   * OPEN. Deliberately separate from `transitionDiscrepancy` (whose matrix makes
   * terminal states final, so a routine resolve can never silently undo a prior
   * one) and gated by the dedicated CRITICAL `recon.discrepancy.reopen`
   * permission. Requires a reason, clears the resolution + investigation stamps,
   * and writes a history row + audit + event — all atomic.
   */
  async reopenDiscrepancy(args: { id: string; reason: string; adminId?: string }) {
    const current = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id: args.id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundAppException('Discrepancy not found');
    if (!TERMINAL_DISCREPANCY.includes(current.status)) {
      throw new ConflictAppException(
        `Only a RESOLVED or IGNORED discrepancy can be reopened (current: ${current.status}).`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.reconciliationDiscrepancy.updateMany({
        where: { id: args.id, status: current.status },
        data: {
          status: 'OPEN',
          resolvedByAdminId: null,
          resolvedAt: null,
          investigatingByAdminId: null,
          investigatingAt: null,
          resolutionNotes: args.reason,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictAppException(
          'Discrepancy was modified by another admin — refresh and retry.',
        );
      }
      await tx.discrepancyStatusHistory.create({
        data: {
          discrepancyId: args.id,
          fromStatus: current.status,
          toStatus: 'OPEN',
          actorAdminId: args.adminId ?? null,
          actorRole: args.adminId ? 'ADMIN' : 'SYSTEM',
          notes: `REOPENED: ${args.reason}`,
        },
      });
    });

    void this.audit
      .writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'recon.discrepancy.reopened',
        module: 'reconciliation',
        resource: 'ReconciliationDiscrepancy',
        resourceId: args.id,
        oldValue: { status: current.status },
        newValue: { status: 'OPEN', reason: args.reason },
      })
      .catch(() => undefined);

    this.eventBus
      .publish({
        eventName: 'recon.discrepancy.transitioned',
        aggregate: 'ReconciliationDiscrepancy',
        aggregateId: args.id,
        occurredAt: now,
        payload: {
          discrepancyId: args.id,
          fromStatus: current.status,
          toStatus: 'OPEN',
          adminId: args.adminId ?? null,
          reopened: true,
        },
      })
      .catch(() => undefined);

    return this.prisma.reconciliationDiscrepancy.findUnique({ where: { id: args.id } });
  }

  /**
   * Phase 174 (#6) — assign / unassign a discrepancy to an investigator (triage
   * ownership). Pass `assignedToAdminId: null` to unassign. Audited but not a
   * status change, so it does not write the status-history table.
   */
  async assignDiscrepancy(args: {
    id: string;
    assignedToAdminId: string | null;
    adminId?: string;
  }) {
    const current = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id: args.id },
      select: { id: true, assignedToAdminId: true },
    });
    if (!current) throw new NotFoundAppException('Discrepancy not found');

    const updated = await this.prisma.reconciliationDiscrepancy.update({
      where: { id: args.id },
      data: {
        assignedToAdminId: args.assignedToAdminId,
        assignedAt: args.assignedToAdminId ? new Date() : null,
      },
    });

    void this.audit
      .writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'recon.discrepancy.assigned',
        module: 'reconciliation',
        resource: 'ReconciliationDiscrepancy',
        resourceId: args.id,
        oldValue: { assignedToAdminId: current.assignedToAdminId },
        newValue: { assignedToAdminId: args.assignedToAdminId },
      })
      .catch(() => undefined);

    return updated;
  }

  /**
   * Phase 174 (#11) — bulk status transition. Each id runs through the SAME
   * `transitionDiscrepancy` path (per-row CAS + history + audit + event), so a
   * concurrent single-row edit can't be clobbered and every row gets its own
   * immutable trail + audit log. Returns a per-id outcome so the UI can show
   * partial success rather than all-or-nothing.
   */
  async bulkTransition(args: {
    ids: string[];
    status: DiscrepancyStatus;
    notes?: string | null;
    adminId?: string;
  }) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of args.ids) {
      try {
        await this.transitionDiscrepancy({
          id,
          status: args.status,
          notes: args.notes,
          adminId: args.adminId,
        });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return {
      total: args.ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /**
   * Phase 174 (#2) — the transition timeline for one discrepancy (newest first),
   * for the detail-page history panel.
   */
  async getDiscrepancyHistory(id: string) {
    const exists = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundAppException('Discrepancy not found');
    return this.prisma.discrepancyStatusHistory.findMany({
      where: { discrepancyId: id },
      orderBy: { occurredAt: 'desc' },
    });
  }

  // ── CSV export (streamed) ───────────────────────────────────────

  /** Phase 173 (#6) — spec-required CSV header. */
  private static readonly CSV_HEADER = [
    'run_id', 'run_number', 'source_type', 'period_start', 'period_end',
    'discrepancy_id', 'discrepancy_kind', 'severity', 'resolution_status',
    'order_number', 'source_reference',
    'expected_inr', 'actual_inr', 'difference_inr',
    'description', 'suggested_action', 'resolution_notes', 'created_at',
  ];

  /**
   * Phase 173 (#13) — stream discrepancies as CSV in cursor batches so a
   * 100k-row run never materialises every row + string in memory. Yields the
   * header line first, then one CSV line per discrepancy. Every field is run
   * through `escapeCsvField` (#3) — the shared CWE-1236 formula-injection guard.
   */
  async *streamDiscrepancyCsv(runId: string): AsyncGenerator<string> {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
      select: {
        id: true, runNumber: true, kind: true, periodStart: true, periodEnd: true,
      },
    });
    if (!run) throw new NotFoundAppException('Run not found');

    yield ReconciliationService.CSV_HEADER.map(escapeCsvField).join(',');

    const BATCH = 1000;
    let cursor: string | undefined;
    const inr = (p: bigint | null) =>
      p != null ? (Number(p) / 100).toFixed(2) : '';

    for (;;) {
      const batch = await this.prisma.reconciliationDiscrepancy.findMany({
        where: { runId },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const d of batch) {
        yield [
          run.id,
          run.runNumber ?? '',
          run.kind,
          run.periodStart.toISOString(),
          run.periodEnd.toISOString(),
          d.id,
          d.kind,
          String(d.severity),
          d.status,
          d.orderNumber ?? '',
          d.externalRef ?? '',
          inr(d.expectedInPaise),
          inr(d.actualInPaise),
          inr(d.differenceInPaise),
          d.description,
          d.suggestedAction ?? '',
          d.resolutionNotes ?? '',
          d.createdAt.toISOString(),
        ]
          .map(escapeCsvField)
          .join(',');
      }
      if (batch.length < BATCH) break;
      cursor = batch[batch.length - 1]!.id;
    }
  }

  /**
   * Phase 173 (#11) — audit a CSV export (sensitive bulk-data download). Called
   * by the controller after streaming starts.
   */
  async auditCsvExport(runId: string, adminId?: string): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'recon.export.csv',
        module: 'reconciliation',
        resource: 'ReconciliationRun',
        resourceId: runId,
      })
      .catch(() => undefined);
  }

  /**
   * Phase 173 — crash-recovery reaper. A run executing in-process when the node
   * crashes is left RUNNING forever; this flips runs that have been RUNNING (or
   * stuck QUEUED) past `staleMinutes` to FAILED so the (kind, period) lock frees.
   */
  async reapStaleRuns(staleMinutes = 60): Promise<number> {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
    // Adversarial-review note (Phase 173): a never-executed QUEUED row keeps its
    // insert-time `startedAt` (schema default now()), and executeRun resets
    // `startedAt` on the QUEUED→RUNNING flip — so BOTH a stuck-QUEUED and a
    // crashed-RUNNING row become reapable `staleMinutes` after they went live.
    // No row is blocked "forever"; the (kind,period) lock frees on the next tick
    // after the window. (The 30-min reaper cron + 60-min default = ≤90 min worst
    // case before a crashed run's lock releases.)
    const res = await this.prisma.reconciliationRun.updateMany({
      where: { status: { in: LIVE_STATUSES }, startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        failureReason: `Run exceeded ${staleMinutes}m without completing (auto-reaped — likely a worker crash).`,
      },
    });
    if (res.count > 0) {
      this.logger.warn(`Reaped ${res.count} stale reconciliation run(s).`);
    }
    return res.count;
  }
}
