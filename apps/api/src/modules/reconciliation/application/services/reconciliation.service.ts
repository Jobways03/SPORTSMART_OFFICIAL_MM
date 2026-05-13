import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DiscrepancyKind,
  DiscrepancyStatus,
  ReconciliationKind,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { toPaise } from '../../../../core/money/money-field-registry';

/**
 * Phase 0 (PR 0.6) — precision-safe Decimal-to-paise conversion for
 * reconciliation comparisons. Uses the canonical `toPaise` (PR 0.4)
 * which is exact for Decimal and string inputs and throws on
 * fractional JS Number.
 *
 * The reconciler reads from the legacy Decimal columns while the
 * paise-sibling backfill (Phase 7) is still rolling out. Once paise
 * columns are populated everywhere, the conversion call sites can be
 * swapped for direct BigInt reads (one-line change per call site).
 */
function decimalToPaise(value: unknown): bigint {
  return toPaise(value) ?? 0n;
}

// Phase 2 (PR 2.3) — `bigintPaiseToInt` is gone. The recon columns are
// now BigInt at the DB level (see migration
// `20260512140000_recon_payment_int_to_bigint`); the clamping helper
// existed only to bridge to the old INT columns. Per-kind runners now
// pass `bigint` straight through to Prisma.

/**
 * Daily reconciliation runs. The runners are intentionally simple — they
 * compare what we expected to receive (orders + their declared totals)
 * vs what was actually settled (paymentStatus=PAID, COD remitted, etc).
 *
 * Phase scope: PAYMENT + COD only get a real implementation. SETTLEMENT
 * and REFUND are scaffolded with the same shape; they hook into the
 * settlement + return modules later (each follows the same pattern).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Run management ──────────────────────────────────────────────

  async startRun(args: {
    kind: ReconciliationKind;
    periodStart: Date;
    periodEnd: Date;
    startedByAdminId?: string;
  }) {
    return this.prisma.reconciliationRun.create({
      data: {
        kind: args.kind,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        startedByAdminId: args.startedByAdminId ?? null,
      },
    });
  }

  async runAndCollect(args: {
    kind: ReconciliationKind;
    periodStart: Date;
    periodEnd: Date;
    startedByAdminId?: string;
  }) {
    const run = await this.startRun(args);
    try {
      const result =
        args.kind === 'PAYMENT'
          ? await this.runPayments(run.id, args.periodStart, args.periodEnd)
          : args.kind === 'COD'
            ? await this.runCod(run.id, args.periodStart, args.periodEnd)
            : args.kind === 'SETTLEMENT'
              ? await this.runSettlement(run.id, args.periodStart, args.periodEnd)
              : args.kind === 'WALLET'
                ? await this.runWallet(run.id)
                : await this.runRefund(run.id, args.periodStart, args.periodEnd);

      const completed = await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalExpected: result.totalExpected,
          totalMatched: result.totalMatched,
          totalDiscrepancies: result.totalDiscrepancies,
          expectedAmountInPaise: result.expectedAmountInPaise,
          matchedAmountInPaise: result.matchedAmountInPaise,
        },
      });

      // Notify ops team if anything needs review. Best-effort: failure
      // here must not undo the run completion.
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
            },
          })
          .catch(() => undefined);
      }

      return completed;
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Reconciliation run ${run.id} failed: ${msg}`);
      return this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), failureReason: msg },
      });
    }
  }

  // ── Per-kind runners ────────────────────────────────────────────

  /**
   * Compare ONLINE orders that should be PAID vs MasterOrder.paymentStatus
   * + razorpayPaymentId presence. A discrepancy is logged when:
   *  - status=PAID but razorpayPaymentId is null (orphan/lost reference)
   *  - status=PENDING for orders past paymentExpiresAt (timeouts)
   */
  private async runPayments(runId: string, start: Date, end: Date) {
    const orders = await this.prisma.masterOrder.findMany({
      where: {
        paymentMethod: 'ONLINE',
        createdAt: { gte: start, lt: end },
      },
      select: {
        id: true, orderNumber: true, totalAmount: true,
        paymentStatus: true, razorpayPaymentId: true,
        paymentExpiresAt: true,
      },
    });

    let matched = 0;
    let discrepancies = 0;
    let expectedAmount = 0n;
    let matchedAmount = 0n;
    const now = new Date();

    for (const o of orders) {
      // Phase 0 (PR 0.6) — precision-safe paise conversion. Previously
      // `Math.round(Number(decimal) * 100)` could drift by 1 paise on
      // values like `999.99`, producing false-positive AMOUNT_MISMATCH
      // discrepancies (or worse, missing real ones).
      const amountPaise = decimalToPaise(o.totalAmount);
      expectedAmount += amountPaise;

      if (o.paymentStatus === 'PAID') {
        if (!o.razorpayPaymentId) {
          await this.recordDiscrepancy({
            runId,
            kind: 'EXPECTED_NOT_FOUND',
            masterOrderId: o.id,
            orderNumber: o.orderNumber,
            expectedInPaise: amountPaise,
            actualInPaise: null,
            description: `Order ${o.orderNumber} marked PAID but no razorpayPaymentId is recorded.`,
          });
          discrepancies++;
        } else {
          matched++;
          matchedAmount += amountPaise;
        }
      } else if (
        o.paymentStatus === 'PENDING' &&
        o.paymentExpiresAt &&
        o.paymentExpiresAt < now
      ) {
        await this.recordDiscrepancy({
          runId,
          kind: 'STATUS_MISMATCH',
          masterOrderId: o.id,
          orderNumber: o.orderNumber,
          expectedInPaise: amountPaise,
          actualInPaise: null,
          description: `Order ${o.orderNumber} payment window expired but status is still PENDING.`,
        });
        discrepancies++;
      }
    }

    return {
      totalExpected: orders.length,
      totalMatched: matched,
      totalDiscrepancies: discrepancies,
      expectedAmountInPaise: expectedAmount,
      matchedAmountInPaise: matchedAmount,
    };
  }

  /** COD: orders that were DELIVERED in the window must be marked COD-collected. */
  private async runCod(runId: string, start: Date, end: Date) {
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

    let matched = 0;
    let discrepancies = 0;
    let expectedAmount = 0n;
    let matchedAmount = 0n;

    for (const so of subOrders) {
      const amountPaise = decimalToPaise(so.subTotal);
      expectedAmount += amountPaise;
      if (so.paymentStatus === 'PAID') {
        matched++;
        matchedAmount += amountPaise;
      } else {
        await this.recordDiscrepancy({
          runId,
          kind: 'STATUS_MISMATCH',
          masterOrderId: so.masterOrderId,
          orderNumber: so.masterOrder.orderNumber,
          expectedInPaise: amountPaise,
          actualInPaise: 0n,
          description:
            `COD sub-order ${so.id} delivered but paymentStatus=${so.paymentStatus}. ` +
            `Has the courier remitted the cash collection?`,
        });
        discrepancies++;
      }
    }

    return {
      totalExpected: subOrders.length,
      totalMatched: matched,
      totalDiscrepancies: discrepancies,
      expectedAmountInPaise: expectedAmount,
      matchedAmountInPaise: matchedAmount,
    };
  }

  /**
   * Settlement runner: for SellerSettlement rows whose status moved
   * to PAID inside the window, verify a `utrReference` exists. A
   * PAID-without-UTR is `EXPECTED_NOT_FOUND` (we marked it paid but
   * have no bank-side proof of disbursement).
   *
   * Also flags settlements that have been APPROVED for >7 days but not
   * PAID — these are stuck in the bank-transfer queue.
   */
  private async runSettlement(runId: string, start: Date, end: Date) {
    const paid = await this.prisma.sellerSettlement.findMany({
      where: { status: 'PAID', paidAt: { gte: start, lt: end } },
      select: {
        id: true, sellerName: true, totalSettlementAmount: true,
        utrReference: true, paidAt: true,
      },
    });

    let matched = 0;
    let discrepancies = 0;
    let expectedAmount = 0n;
    let matchedAmount = 0n;

    for (const s of paid) {
      const amountPaise = decimalToPaise(s.totalSettlementAmount);
      expectedAmount += amountPaise;
      if (s.utrReference) {
        matched++;
        matchedAmount += amountPaise;
      } else {
        await this.recordDiscrepancy({
          runId,
          kind: 'EXPECTED_NOT_FOUND',
          externalRef: s.id,
          expectedInPaise: amountPaise,
          actualInPaise: null,
          description:
            `Seller settlement ${s.id} (${s.sellerName}) marked PAID but no UTR reference is recorded.`,
        });
        discrepancies++;
      }
    }

    // Stuck-approval check — APPROVED >7d ago but never PAID.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stuck = await this.prisma.sellerSettlement.findMany({
      where: { status: 'APPROVED', updatedAt: { lt: sevenDaysAgo } },
      select: { id: true, sellerName: true, totalSettlementAmount: true, updatedAt: true },
    });
    for (const s of stuck) {
      const amountPaise = decimalToPaise(s.totalSettlementAmount);
      await this.recordDiscrepancy({
        runId,
        kind: 'STATUS_MISMATCH',
        externalRef: s.id,
        expectedInPaise: amountPaise,
        actualInPaise: null,
        description:
          `Settlement ${s.id} (${s.sellerName}) APPROVED on ` +
          `${s.updatedAt.toISOString().slice(0, 10)} — over 7 days without PAID transition.`,
      });
      discrepancies++;
      expectedAmount += amountPaise;
    }

    return {
      totalExpected: paid.length + stuck.length,
      totalMatched: matched,
      totalDiscrepancies: discrepancies,
      expectedAmountInPaise: expectedAmount,
      matchedAmountInPaise: matchedAmount,
    };
  }

  /**
   * Refund runner: for Return rows where refundProcessedAt landed in
   * the window, verify the refund actually has a reference.
   *   - refundProcessedAt set + refundReference null → EXPECTED_NOT_FOUND
   *   - declared amount differs from refundAmount when both set →
   *     AMOUNT_MISMATCH (currently best-effort — single-source today)
   */
  private async runRefund(runId: string, start: Date, end: Date) {
    const returns = await this.prisma.return.findMany({
      where: { refundProcessedAt: { gte: start, lt: end } },
      select: {
        id: true, returnNumber: true,
        refundAmount: true, refundReference: true,
      },
    });

    let matched = 0;
    let discrepancies = 0;
    let expectedAmount = 0n;
    let matchedAmount = 0n;

    for (const r of returns) {
      const amountPaise = decimalToPaise(r.refundAmount ?? 0);
      expectedAmount += amountPaise;
      if (!r.refundReference) {
        await this.recordDiscrepancy({
          runId,
          kind: 'EXPECTED_NOT_FOUND',
          externalRef: r.id,
          orderNumber: r.returnNumber,
          expectedInPaise: amountPaise,
          actualInPaise: null,
          description:
            `Return ${r.returnNumber} marked refund-processed but no refundReference is recorded.`,
        });
        discrepancies++;
      } else {
        matched++;
        matchedAmount += amountPaise;
      }
    }

    return {
      totalExpected: returns.length,
      totalMatched: matched,
      totalDiscrepancies: discrepancies,
      expectedAmountInPaise: expectedAmount,
      matchedAmountInPaise: matchedAmount,
    };
  }

  /**
   * Wallet integrity check. For each wallet, verify
   *   sum(WalletTransaction.amountInPaise where status='COMPLETED') == Wallet.balanceInPaise
   * Any drift gets logged as an AMOUNT_MISMATCH discrepancy. Period
   * dates are not used — wallets are point-in-time checks.
   */
  private async runWallet(runId: string) {
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

    let matched = 0;
    let discrepancies = 0;
    let expectedAmount = 0n;
    let matchedAmount = 0n;

    for (const row of drifts) {
      // Phase 0 (PR 0.6) — stay in BigInt space. Previously
      // `Number(row.ledger_sum)` would silently drift for sums above
      // 2^53 paise. The SQL already returns `::bigint`, so the cast is
      // direct.
      const ledger = BigInt(row.ledger_sum ?? 0);
      const balance = BigInt(row.balance_in_paise);
      const absBalance = balance < 0n ? -balance : balance;
      expectedAmount += absBalance;
      if (ledger === balance) {
        matched++;
        matchedAmount += absBalance;
      } else {
        const drift = ledger - balance;
        await this.recordDiscrepancy({
          runId,
          kind: 'AMOUNT_MISMATCH',
          externalRef: row.wallet_id,
          expectedInPaise: balance,
          actualInPaise: ledger,
          description:
            `Wallet ${row.wallet_id} (user ${row.user_id}) balance ` +
            `${balance.toString()} paise but ledger sums to ` +
            `${ledger.toString()} paise (drift ${drift.toString()} paise).`,
        });
        discrepancies++;
      }
    }

    return {
      totalExpected: drifts.length,
      totalMatched: matched,
      totalDiscrepancies: discrepancies,
      expectedAmountInPaise: expectedAmount,
      matchedAmountInPaise: matchedAmount,
    };
  }

  private zeroResult() {
    return {
      totalExpected: 0,
      totalMatched: 0,
      totalDiscrepancies: 0,
      expectedAmountInPaise: 0,
      matchedAmountInPaise: 0,
    };
  }

  // ── Discrepancy management ──────────────────────────────────────

  private async recordDiscrepancy(args: {
    runId: string;
    kind: DiscrepancyKind;
    masterOrderId?: string | null;
    orderNumber?: string | null;
    externalRef?: string | null;
    // Phase 2 (PR 2.3) — bigint after the column widening. The
    // per-kind runners hold paise as bigint locally, so passing it
    // through unchanged removes the previous clamp helper.
    expectedInPaise?: bigint | null;
    actualInPaise?: bigint | null;
    description: string;
  }) {
    return this.prisma.reconciliationDiscrepancy.create({
      data: {
        runId: args.runId,
        kind: args.kind,
        masterOrderId: args.masterOrderId ?? null,
        orderNumber: args.orderNumber ?? null,
        externalRef: args.externalRef ?? null,
        expectedInPaise: args.expectedInPaise ?? null,
        actualInPaise: args.actualInPaise ?? null,
        description: args.description,
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
        orderBy: { startedAt: 'desc' },
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
      include: { discrepancies: { orderBy: { createdAt: 'desc' } } },
    });
    if (!run) throw new NotFoundAppException('Run not found');
    return run;
  }

  async transitionDiscrepancy(args: {
    id: string;
    status: DiscrepancyStatus;
    notes?: string | null;
    adminId?: string;
  }) {
    return this.prisma.reconciliationDiscrepancy.update({
      where: { id: args.id },
      data: {
        status: args.status,
        resolutionNotes: args.notes ?? undefined,
        resolvedByAdminId:
          args.status === 'RESOLVED' || args.status === 'IGNORED'
            ? args.adminId ?? null
            : null,
        resolvedAt:
          args.status === 'RESOLVED' || args.status === 'IGNORED'
            ? new Date()
            : null,
      },
    });
  }

  /** Discrepancies as CSV — used by the export endpoint. */
  async exportDiscrepanciesCsv(runId: string): Promise<string> {
    const run = await this.getRun(runId);
    const header = [
      'discrepancy_id', 'kind', 'status', 'order_number',
      'expected_inr', 'actual_inr', 'description', 'created_at',
    ].join(',');
    const rows = run.discrepancies.map((d) => [
      d.id,
      d.kind,
      d.status,
      d.orderNumber ?? '',
      // Phase 2 (PR 2.3) — bigint /100 isn't valid; the discrepancy
      // columns are BigInt. CSV is human-facing rupees, so Number() at
      // emit time is fine (drift values stay inside JS safe-integer).
      d.expectedInPaise != null ? (Number(d.expectedInPaise) / 100).toFixed(2) : '',
      d.actualInPaise != null ? (Number(d.actualInPaise) / 100).toFixed(2) : '',
      `"${d.description.replace(/"/g, '""')}"`,
      d.createdAt.toISOString(),
    ].join(','));
    return [header, ...rows].join('\n');
  }
}
