import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../core/exceptions';
import { MoneyDualWriteHelper } from '../../core/money/money-dual-write.helper';
import { AuditPublicFacade } from '../audit/application/facades/audit-public.facade';
import { SettlementTcsHookService } from '../tax/application/services/settlement-tcs-hook.service';
import { SettlementTds194OHookService } from '../tax/application/services/settlement-tds-194o-hook.service';
import { SellerBankDetailsService } from '../seller/application/services/seller-bank-details.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';
import { toCsv } from '../../core/utils';

/** RBI IFSC format: 4 alpha bank code + '0' + 6 alphanumeric branch code. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

interface ActorContext {
  adminId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Payout batches wrap APPROVED settlements into a bank-export job.
 * Workflow:
 *   1. createBatch(cycleId)       — pulls APPROVED, unbatched SellerSettlements
 *                                    into Payout rows + locks them (payoutBatchId)
 *   2. generateExport(batchId)    — bank CSV (beneficiary/account/IFSC/narration);
 *                                    flips DRAFT → EXPORTED; stores file hash
 *   3. ingestBankResponse(...)    — admin uploads bank confirmation; amount-checks,
 *                                    marks paid + UTR + TCS/TDS + cycle rollup
 *   4. cancelBatch(batchId)       — abort a DRAFT/EXPORTED batch; release the lock
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 7 (PR 7.7) — paise-sibling dual-write for the payout.createMany.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // Phase 151 — audit every money-state op; mirror markSettlementPaid's
    // TCS/TDS compliance side-effects on batch ingest; enrich the bank file
    // with decrypted beneficiary details; publish a batch-created event.
    private readonly audit: AuditPublicFacade,
    private readonly tcsHook: SettlementTcsHookService,
    private readonly tdsHook: SettlementTds194OHookService,
    private readonly bankDetails: SellerBankDetailsService,
    private readonly eventBus: EventBusService,
  ) {}

  async listBatches() {
    return this.prisma.payoutBatch.findMany({
      include: { _count: { select: { payouts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getBatch(id: string) {
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id },
      include: { payouts: true },
    });
    if (!batch) throw new NotFoundAppException('Batch not found');
    return batch;
  }

  private isValidIfsc(ifsc?: string | null): boolean {
    return IFSC_RE.test((ifsc ?? '').toUpperCase());
  }

  /** Human-readable batch reference, e.g. PB-20260526-3F9A2C. */
  private genBatchNumber(): string {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
    return `PB-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  /**
   * Create a payout batch from APPROVED, NOT-YET-BATCHED settlements within the
   * cycle. Phase 3.7 pre-batch gates (KYC / dispute / soft-delete / status) +
   * Phase 151 bank-details gate; eligible settlements are LOCKED into the batch
   * (payoutBatchId) inside the transaction so a second createBatch can't pull
   * the same settlement into a second batch (duplicate-payout guard).
   */
  async createBatch(args: { cycleId: string; actor?: ActorContext }) {
    const settlements = await this.prisma.sellerSettlement.findMany({
      // Phase 151 — payoutBatchId:null so a settlement already locked into a
      // (non-cancelled) batch is never re-pulled.
      where: { cycleId: args.cycleId, status: 'APPROVED', payoutBatchId: null },
    });
    if (settlements.length === 0) {
      throw new BadRequestAppException(
        'No APPROVED, un-batched settlements ready for payout in this cycle',
      );
    }

    const sellerIds = Array.from(new Set(settlements.map((s) => s.sellerId)));
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, verificationStatus: true, isDeleted: true, status: true },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    // Phase 151 — bank-details gate. A VERIFIED seller can still have null /
    // invalid payout details; without account + IFSC the bank rejects the row.
    const bankRows = await this.prisma.sellerBankDetails.findMany({
      where: { sellerId: { in: sellerIds } },
      select: { sellerId: true, ifscCode: true, accountNumberLast4: true },
    });
    const bankBySeller = new Map(bankRows.map((b) => [b.sellerId, b]));

    // Disputes that block payout (OPEN / UNDER_REVIEW). Dispute → SubOrder →
    // sellerId (no Prisma relation on the raw subOrderId column).
    const openDisputes = await this.prisma.dispute.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      select: { id: true, subOrderId: true },
    });
    const openDisputeSubOrderIds = openDisputes
      .map((d) => d.subOrderId)
      .filter((x): x is string => !!x);
    const disputedSubOrders =
      openDisputeSubOrderIds.length > 0
        ? await this.prisma.subOrder.findMany({
            where: { id: { in: openDisputeSubOrderIds }, sellerId: { in: sellerIds } },
            select: { sellerId: true },
          })
        : [];
    const sellersWithOpenDispute = new Set(
      disputedSubOrders.map((s) => s.sellerId).filter((x): x is string => !!x),
    );

    const eligible: typeof settlements = [];
    const skipped: Array<{ settlementId: string; sellerId: string; reason: string }> = [];

    for (const s of settlements) {
      const seller = sellerById.get(s.sellerId);
      const reasons: string[] = [];
      if (!seller || seller.isDeleted) {
        reasons.push('SELLER_DELETED');
      } else {
        if (seller.verificationStatus !== 'VERIFIED') {
          reasons.push(`KYC_NOT_VERIFIED:${seller.verificationStatus}`);
        }
        if (seller.status !== 'ACTIVE') {
          reasons.push(`SELLER_NOT_ACTIVE:${seller.status}`);
        }
      }
      if (sellersWithOpenDispute.has(s.sellerId)) {
        reasons.push('OPEN_DISPUTE');
      }
      // Phase 151 — must have a bank-details row with a valid IFSC + a stored
      // account number (last-4 present ⇒ the encrypted number exists).
      const bank = bankBySeller.get(s.sellerId);
      if (!bank || !bank.accountNumberLast4 || !this.isValidIfsc(bank.ifscCode)) {
        reasons.push('INVALID_BANK_DETAILS');
      }
      if (reasons.length === 0) eligible.push(s);
      else
        skipped.push({
          settlementId: s.id,
          sellerId: s.sellerId,
          reason: reasons.join(','),
        });
    }

    if (eligible.length === 0) {
      throw new BadRequestAppException(
        `All ${settlements.length} APPROVED settlements were blocked: ${skipped
          .slice(0, 5)
          .map((r) => `${r.sellerId}=${r.reason}`)
          .join('; ')}${skipped.length > 5 ? '…' : ''}. Resolve KYC / disputes / bank details and retry.`,
      );
    }

    const eligibleIds = eligible.map((s) => s.id);
    const totalInPaise = eligible.reduce(
      (sum, s) => sum + BigInt(s.totalSettlementAmountInPaise ?? 0),
      0n,
    );

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payoutBatch.create({
        data: {
          status: 'DRAFT',
          batchNumber: this.genBatchNumber(),
          createdByAdminId: args.actor?.adminId ?? null,
          totalAmountInPaise: totalInPaise,
          settlementCount: eligible.length,
        },
      });
      // Phase 151 — LOCK the settlements (CAS on payoutBatchId:null + APPROVED).
      // If the count drops, another batch claimed one mid-flight → abort the
      // whole transaction so a settlement can never land in two batches.
      const locked = await tx.sellerSettlement.updateMany({
        where: { id: { in: eligibleIds }, payoutBatchId: null, status: 'APPROVED' },
        data: { payoutBatchId: created.id },
      });
      if (locked.count !== eligibleIds.length) {
        throw new ConflictAppException(
          'A settlement was claimed by another payout batch during creation. ' +
            'No batch was created — retry.',
        );
      }
      await tx.payout.createMany({
        data: this.moneyDualWrite.applyPaiseMany(
          'payout',
          eligible.map((s) => ({
            batchId: created.id,
            settlementId: s.id,
            sellerId: s.sellerId,
            amount: s.totalSettlementAmount,
            status: 'DRAFT' as const,
          })),
        ),
      });
      return tx.payoutBatch.findUniqueOrThrow({
        where: { id: created.id },
        include: { payouts: true },
      });
    });

    this.audit
      .writeAuditLog({
        actorId: args.actor?.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'PAYOUT_BATCH_CREATED',
        module: 'payouts',
        resource: 'payout_batch',
        resourceId: batch.id,
        newValue: {
          cycleId: args.cycleId,
          batchNumber: batch.batchNumber,
          settlementCount: batch.settlementCount,
          totalAmountInPaise: totalInPaise.toString(),
          skippedCount: skipped.length,
        },
        ipAddress: args.actor?.ipAddress,
        userAgent: args.actor?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (batch created) failed: ${e}`));

    this.eventBus
      .publish({
        eventName: 'payouts.batch.created',
        aggregate: 'PayoutBatch',
        aggregateId: batch.id,
        occurredAt: new Date(),
        payload: {
          batchId: batch.id,
          cycleId: args.cycleId,
          settlementCount: batch.settlementCount,
          totalAmountInPaise: totalInPaise.toString(),
        },
      })
      .catch(() => undefined);

    return { batch, skipped };
  }

  /**
   * Phase 3.7 — payout method routing by amount (UPI ≤ ₹1L, IMPS ≤ ₹2L,
   * else NEFT). The bank picks the actual rail from this hint.
   */
  routePayoutMethod(
    amountInPaise: bigint,
    preferred?: string | null,
  ): 'UPI' | 'IMPS' | 'NEFT' {
    const ONE_LAKH = 100_000_00n;
    const TWO_LAKH = 200_000_00n;
    const amountBased: 'UPI' | 'IMPS' | 'NEFT' =
      amountInPaise <= ONE_LAKH ? 'UPI' : amountInPaise <= TWO_LAKH ? 'IMPS' : 'NEFT';
    // Phase 153 — honour a seller's preferred rail, but only when the amount is
    // valid for it (RBI caps: UPI ≤ ₹1L, IMPS ≤ ₹2L, NEFT any). Otherwise the
    // amount-based default wins (a ₹3L UPI request can't be honoured).
    const pref = (preferred ?? '').trim().toUpperCase();
    if (pref === 'NEFT') return 'NEFT';
    if (pref === 'IMPS' && amountInPaise <= TWO_LAKH) return 'IMPS';
    if (pref === 'UPI' && amountInPaise <= ONE_LAKH) return 'UPI';
    return amountBased;
  }

  /**
   * Generate the bank-upload CSV. Phase 151 — now a real NEFT/IMPS/UPI file:
   * beneficiary_name, account_number (decrypted), ifsc, narration + a
   * batch_reference, built with the shared formula-injection-safe `toCsv`.
   * Stores a sha256 of the exact bytes (tamper evidence) and flips the batch +
   * payouts to EXPORTED inside one transaction.
   */
  async generateExport(batchId: string, actor?: ActorContext): Promise<string> {
    const batch = await this.getBatch(batchId);
    // Phase 153 — DRAFT exports (mutating, first time); EXPORTED allows a
    // read-only RE-DOWNLOAD so an operator who lost the file (browser crash)
    // can recover without an SQL reset. COMPLETED/FAILED/CANCELLED can't export.
    if (!['DRAFT', 'EXPORTED'].includes(batch.status)) {
      throw new BadRequestAppException(
        `Batch must be DRAFT or EXPORTED to download the bank file (got ${batch.status})`,
      );
    }

    const sellerIds = Array.from(new Set(batch.payouts.map((p) => p.sellerId)));
    const settlementIds = batch.payouts.map((p) => p.settlementId);
    const [bankRows, settlements] = await Promise.all([
      this.prisma.sellerBankDetails.findMany({ where: { sellerId: { in: sellerIds } } }),
      this.prisma.sellerSettlement.findMany({
        where: { id: { in: settlementIds } },
        select: { id: true, cycle: { select: { periodStart: true, periodEnd: true } } },
      }),
    ]);
    const bankBySeller = new Map(bankRows.map((b) => [b.sellerId, b]));
    const cycleBySettlement = new Map(settlements.map((s) => [s.id, s.cycle]));

    const headers = [
      'batch_reference',
      'settlement_id',
      'seller_id',
      'beneficiary_name',
      'account_number',
      'ifsc',
      'amount',
      'method',
      'narration',
    ];
    const rows = batch.payouts.map((p) => {
      const bank = bankBySeller.get(p.sellerId);
      const cyc = cycleBySettlement.get(p.settlementId);
      const period = cyc
        ? `${cyc.periodStart.toISOString().slice(0, 10)}_${cyc.periodEnd
            .toISOString()
            .slice(0, 10)}`
        : '';
      return {
        batch_reference: batch.batchNumber ?? batch.id,
        settlement_id: p.settlementId,
        seller_id: p.sellerId,
        beneficiary_name: bank?.accountHolderName ?? '',
        // Decrypt the account number only here, at the boundary of the bank
        // file — it never leaves this method. Empty if (defensively) missing.
        account_number: bank?.accountNumberEnc
          ? this.bankDetails.decrypt(bank.accountNumberEnc)
          : '',
        ifsc: bank?.ifscCode ?? '',
        amount: Number(p.amount).toFixed(2),
        // Phase 153 — honour the seller's preferred rail (within RBI caps).
        method: this.routePayoutMethod(p.amountInPaise, bank?.preferredPayoutMethod),
        narration: `Settlement ${p.settlementId.slice(0, 8)} ${period}`.trim(),
      };
    });

    // Formula-injection-safe (shared util neutralises =/+/-/@ leading cells)
    // + BOM so Excel renders Indic beneficiary names correctly.
    const csv = toCsv(rows, headers, { bom: true });
    const fileHash = createHash('sha256').update(csv).digest('hex');

    // Phase 153 — first export (DRAFT) flips state with a status-CAS so a
    // concurrent export can't double-flip (§8 race); a re-download (EXPORTED)
    // mutates nothing. Either way the access is audited — the file carries
    // every seller's decrypted account number + IFSC (high-value PII).
    let firstExport = false;
    if (batch.status === 'DRAFT') {
      firstExport = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.payoutBatch.updateMany({
          where: { id: batchId, status: 'DRAFT' },
          data: { status: 'EXPORTED', exportedAt: new Date(), fileHash },
        });
        if (flip.count === 0) return false; // raced — another export already won
        await tx.payout.updateMany({
          where: { batchId, status: 'DRAFT' },
          data: { status: 'EXPORTED' },
        });
        return true;
      });
    }

    // On re-download, flag drift: the regenerated file differs from the one
    // first exported (e.g. a seller changed bank details since). The full PII
    // file is deliberately NOT persisted at rest — fileHash gives tamper /
    // drift evidence without retaining account numbers (see report).
    const driftDetected =
      !firstExport && !!batch.fileHash && batch.fileHash !== fileHash;
    if (driftDetected) {
      this.logger.warn(
        `Payout batch ${batchId} re-download differs from the originally-exported ` +
          `file (orig=${batch.fileHash} now=${fileHash}) — seller bank details changed since export.`,
      );
    }

    this.audit
      .writeAuditLog({
        actorId: actor?.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: firstExport ? 'PAYOUT_BATCH_EXPORTED' : 'PAYOUT_BATCH_RE_DOWNLOADED',
        module: 'payouts',
        resource: 'payout_batch',
        resourceId: batchId,
        newValue: {
          batchNumber: batch.batchNumber,
          rowCount: rows.length,
          fileHash,
          ...(firstExport ? {} : { reDownload: true, driftDetected }),
        },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (export) failed: ${e}`));

    return csv;
  }

  /**
   * Ingest a bank response. Phase 0 (PR 0.3) amount-check stays the inner
   * silent-money-loss guard. Phase 151 — on a successful PAID flip this now
   * mirrors markSettlementPaid's compliance side-effects (TCS collected, 194-O
   * TDS withheld, cycle auto-flip to PAID, audit); a FAILED row releases the
   * settlement's payout lock so it can be re-batched.
   */
  async ingestBankResponse(args: {
    batchId: string;
    rows: Array<{
      settlementId: string;
      status: 'PAID' | 'FAILED';
      paidAmountInPaise?: number | bigint;
      utrReference?: string;
      failureReason?: string;
    }>;
    actor?: ActorContext;
    // Phase 152 — import provenance for the BankResponseImport audit row.
    source?: 'FILE_UPLOAD' | 'MANUAL_ENTRY';
    fileHash?: string | null;
    fileName?: string | null;
    // Raw row exactly as received (parallel to rows[] by index) for forensics.
    rawRows?: Array<Record<string, unknown>>;
  }): Promise<{
    batch: Awaited<ReturnType<PayoutService['getBatch']>>;
    mismatches: Array<{ settlementId: string; expectedInPaise: string; actualInPaise: string }>;
    skipped: Array<{ settlementId: string; reason: string }>;
  }> {
    const batch = await this.getBatch(args.batchId);
    if (!['EXPORTED', 'PARTIALLY_PAID'].includes(batch.status)) {
      throw new BadRequestAppException(
        `Batch must be EXPORTED or PARTIALLY_PAID (got ${batch.status})`,
      );
    }

    // Phase 152 — block re-ingesting the same file into the same batch (the
    // DB partial-unique is the backstop; this gives a clean 400 up front).
    if (args.fileHash) {
      const dup = await this.prisma.bankResponseImport.findFirst({
        where: { payoutBatchId: args.batchId, fileHash: args.fileHash },
        select: { id: true, importedAt: true },
      });
      if (dup) {
        throw new BadRequestAppException(
          `This exact file was already ingested into this batch on ${dup.importedAt.toISOString()}. ` +
            'Upload a corrected file or use the manual entry path.',
        );
      }
    }

    const settlementIds = batch.payouts.map((p) => p.settlementId);
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { id: { in: settlementIds } },
      select: { id: true, totalSettlementAmountInPaise: true, cycleId: true },
    });
    const expectedByIdInPaise = new Map<string, bigint>(
      settlements.map((s) => [s.id, s.totalSettlementAmountInPaise]),
    );
    const cycleBySettlement = new Map(settlements.map((s) => [s.id, s.cycleId]));

    const mismatches: Array<{ settlementId: string; expectedInPaise: string; actualInPaise: string }> = [];
    const skipped: Array<{ settlementId: string; reason: string }> = [];
    const paidSettlementIds: string[] = [];
    const affectedCycleIds = new Set<string>();
    // Per-input-row outcome for the BankResponseRow forensic trail.
    const rowRecords: Array<{
      rowIndex: number;
      settlementId: string | null;
      outcome: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      utrReference: string | null;
      failureReason: string | null;
      bankPaidAmountInPaise: bigint | null;
      rawJson: Record<string, unknown>;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < args.rows.length; i++) {
        const r = args.rows[i]!;
        const bankPaid =
          r.paidAmountInPaise !== undefined && r.paidAmountInPaise !== null
            ? BigInt(r.paidAmountInPaise)
            : null;
        const rawJson: Record<string, unknown> = args.rawRows?.[i] ?? {
          settlementId: r.settlementId,
          status: r.status,
          paidAmountInPaise: bankPaid?.toString() ?? null,
          utrReference: r.utrReference ?? null,
          failureReason: r.failureReason ?? null,
        };
        const record = (
          outcome: 'COMPLETED' | 'FAILED' | 'SKIPPED',
          failureReason: string | null,
        ) =>
          rowRecords.push({
            rowIndex: i,
            settlementId: r.settlementId ?? null,
            outcome,
            utrReference: r.utrReference ?? null,
            failureReason,
            bankPaidAmountInPaise: bankPaid,
            rawJson,
          });

        const payout = batch.payouts.find((p) => p.settlementId === r.settlementId);
        // Phase 152 — unknown rows are no longer silently dropped: reported as
        // SKIPPED:NOT_IN_BATCH so the operator sees them.
        if (!payout) {
          skipped.push({ settlementId: r.settlementId, reason: 'NOT_IN_BATCH' });
          record('SKIPPED', 'NOT_IN_BATCH');
          continue;
        }
        // Phase 152 — per-row idempotency: a row already finalised (e.g. a
        // re-uploaded file overlapping a prior import) is skipped, not re-flipped.
        if (payout.status === 'COMPLETED' || payout.status === 'CANCELLED') {
          skipped.push({ settlementId: r.settlementId, reason: `ALREADY_${payout.status}` });
          record('SKIPPED', `ALREADY_${payout.status}`);
          continue;
        }

        let effectiveStatus: 'PAID' | 'FAILED' = r.status;
        let effectiveReason = r.failureReason ?? null;
        if (r.status === 'PAID') {
          if (bankPaid === null) {
            effectiveStatus = 'FAILED';
            effectiveReason = 'BANK_AMOUNT_MISSING:paidAmountInPaise required for PAID rows';
          } else {
            const expected = expectedByIdInPaise.get(r.settlementId);
            if (expected === undefined) {
              effectiveStatus = 'FAILED';
              effectiveReason = `SETTLEMENT_NOT_FOUND:${r.settlementId}`;
            } else {
              const drift = bankPaid > expected ? bankPaid - expected : expected - bankPaid;
              if (drift > 1n) {
                effectiveStatus = 'FAILED';
                effectiveReason = `BANK_AMOUNT_MISMATCH:expected=${expected.toString()} actual=${bankPaid.toString()}`;
                mismatches.push({
                  settlementId: r.settlementId,
                  expectedInPaise: expected.toString(),
                  actualInPaise: bankPaid.toString(),
                });
              }
            }
          }
        }

        // Phase 152 — CAS on status so a row finalised concurrently isn't
        // double-written; also persists the bank-reported amount.
        const upd = await tx.payout.updateMany({
          where: { id: payout.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          data: {
            status: effectiveStatus === 'PAID' ? 'COMPLETED' : 'FAILED',
            utrReference: r.utrReference ?? null,
            failureReason: effectiveReason,
            bankPaidAmountInPaise: bankPaid,
            paidAt: effectiveStatus === 'PAID' ? new Date() : null,
          },
        });
        if (upd.count === 0) {
          skipped.push({ settlementId: r.settlementId, reason: 'ALREADY_FINALISED' });
          record('SKIPPED', 'ALREADY_FINALISED');
          continue;
        }

        if (effectiveStatus === 'PAID') {
          await tx.sellerSettlement.update({
            where: { id: r.settlementId },
            data: {
              status: 'PAID',
              paidAt: new Date(),
              utrReference: r.utrReference ?? null,
              paidByAdminId: args.actor?.adminId ?? null,
              paymentMethod: 'BANK_PAYOUT',
            },
          });
          paidSettlementIds.push(r.settlementId);
          const cid = cycleBySettlement.get(r.settlementId);
          if (cid) affectedCycleIds.add(cid);
          record('COMPLETED', null);
        } else {
          // Phase 151 — release the lock so a failed payout's settlement can be
          // re-batched. Phase 152 — also surface the reason on the settlement
          // (kept APPROVED for reconciliation).
          await tx.sellerSettlement.update({
            where: { id: r.settlementId },
            data: {
              payoutBatchId: null,
              paymentFailureReason: effectiveReason,
            },
          });
          record('FAILED', effectiveReason);
        }
      }

      // Batch rollup.
      const fresh = await tx.payout.findMany({ where: { batchId: args.batchId } });
      const allPaid = fresh.every((p) => p.status === 'COMPLETED');
      const allFailed = fresh.every((p) => p.status === 'FAILED');
      const status = allPaid ? 'COMPLETED' : allFailed ? 'FAILED' : 'PARTIALLY_PAID';
      await tx.payoutBatch.update({ where: { id: args.batchId }, data: { status } });

      // Phase 151 — cycle auto-flip: if every seller + franchise settlement in
      // an affected cycle is now PAID, flip the cycle to PAID (mirrors
      // markSettlementPaid's Phase-146 rollup, counting BOTH child types).
      for (const cycleId of affectedCycleIds) {
        const [sellerPending, franchisePending] = await Promise.all([
          tx.sellerSettlement.count({ where: { cycleId, status: { not: 'PAID' } } }),
          tx.franchiseSettlement.count({ where: { cycleId, status: { not: 'PAID' } } }),
        ]);
        if (sellerPending === 0 && franchisePending === 0) {
          await tx.settlementCycle.updateMany({
            where: { id: cycleId, status: { not: 'PAID' } },
            data: { status: 'PAID' },
          });
        }
      }

      // Phase 152 — persist the import + per-row forensic trail (atomic with
      // the updates above, so the audit record can't drift from the effect).
      const successCount = rowRecords.filter((o) => o.outcome === 'COMPLETED').length;
      const failCount = rowRecords.filter((o) => o.outcome === 'FAILED').length;
      const skippedCount = rowRecords.filter((o) => o.outcome === 'SKIPPED').length;
      const imp = await tx.bankResponseImport.create({
        data: {
          payoutBatchId: args.batchId,
          importedByAdminId: args.actor?.adminId ?? null,
          source: args.source ?? 'MANUAL_ENTRY',
          fileHash: args.fileHash ?? null,
          fileName: args.fileName ?? null,
          rowCount: args.rows.length,
          successCount,
          failCount,
          skippedCount,
        },
      });
      if (rowRecords.length > 0) {
        await tx.bankResponseRow.createMany({
          data: rowRecords.map((o) => ({
            importId: imp.id,
            rowIndex: o.rowIndex,
            rawJson: o.rawJson as any,
            settlementId: o.settlementId,
            outcome: o.outcome,
            utrReference: o.utrReference,
            failureReason: o.failureReason,
            bankPaidAmountInPaise: o.bankPaidAmountInPaise,
          })),
        });
      }
    });

    // Phase 151 — post-commit compliance side-effects (each does its own
    // writes; best-effort + re-runnable via the per-settlement admin endpoints).
    for (const settlementId of paidSettlementIds) {
      try {
        await this.tcsHook.markCollectedOnPay({ settlementId });
      } catch (e) {
        this.logger.warn(`TCS mark-collected failed for ${settlementId}: ${e}`);
      }
      try {
        await this.tdsHook.markWithheldOnPay({ settlementId });
      } catch (e) {
        this.logger.warn(`194-O TDS mark-withheld failed for ${settlementId}: ${e}`);
      }
    }

    this.audit
      .writeAuditLog({
        actorId: args.actor?.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'PAYOUT_BATCH_INGESTED',
        module: 'payouts',
        resource: 'payout_batch',
        resourceId: args.batchId,
        newValue: {
          batchNumber: batch.batchNumber,
          source: args.source ?? 'MANUAL_ENTRY',
          paidCount: paidSettlementIds.length,
          rowCount: args.rows.length,
          mismatchCount: mismatches.length,
          skippedCount: skipped.length,
        },
        ipAddress: args.actor?.ipAddress,
        userAgent: args.actor?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (ingest) failed: ${e}`));

    const refreshed = await this.getBatch(args.batchId);
    return { batch: refreshed, mismatches, skipped };
  }

  /**
   * Phase 151 — abort a DRAFT / EXPORTED batch created in error. Sets the batch
   * + its payouts to CANCELLED and releases the settlements' payout lock so
   * they re-enter the next batch. Blocked once any money has moved
   * (PARTIALLY_PAID / COMPLETED) — use the reversal flow for those.
   */
  async cancelBatch(batchId: string, reason: string, actor?: ActorContext) {
    const safeReason = (reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      throw new BadRequestAppException('A cancel reason (min 3 chars) is required');
    }
    const batch = await this.getBatch(batchId);
    if (!['DRAFT', 'EXPORTED'].includes(batch.status)) {
      throw new BadRequestAppException(
        `Only DRAFT or EXPORTED batches can be cancelled (got ${batch.status}). ` +
          'A batch with paid rows must be unwound via the reversal flow.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerSettlement.updateMany({
        where: { payoutBatchId: batchId },
        data: { payoutBatchId: null },
      });
      await tx.payout.updateMany({ where: { batchId }, data: { status: 'CANCELLED' } });
      await tx.payoutBatch.update({
        where: { id: batchId },
        data: { status: 'CANCELLED', notes: safeReason },
      });
    });

    this.audit
      .writeAuditLog({
        actorId: actor?.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'PAYOUT_BATCH_CANCELLED',
        module: 'payouts',
        resource: 'payout_batch',
        resourceId: batchId,
        oldValue: { status: batch.status },
        newValue: { status: 'CANCELLED', reason: safeReason },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (cancel) failed: ${e}`));

    return this.getBatch(batchId);
  }
}
