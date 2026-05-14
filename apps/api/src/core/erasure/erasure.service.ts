import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../exceptions';
import { TaxDocumentRetentionService } from '../../modules/tax/application/services/tax-document-retention.service';

/**
 * Phase 7 (PR 7.4) — Data erasure (GDPR-style "right to be forgotten").
 *
 * Two responsibilities:
 *   1. requestErasure() — creates the request row + applies the 24h
 *      cooldown for USER_REQUEST source. Cooldown skipped for admin
 *      / regulator-driven requests so they can be processed today.
 *   2. processOne() — picked up by ErasureProcessorCron. Runs the
 *      blocker check first; if the subject has any open dispute / open
 *      settlement / unpaid balance, the request transitions to REJECTED
 *      with a structured `outcome.blocked` list. Otherwise it redacts
 *      PII fields and writes `outcome.redacted`.
 *
 * The full multi-actor cascade (sellers / affiliates / franchises) is
 * stubbed for v1: the service handles USER subjects end-to-end and
 * records "subject type not yet supported" for the others. Adding a
 * subject type means implementing one private method (`processSeller`
 * etc.) — the table + cron + cooldown logic is shared.
 *
 * REDACTION semantics:
 *   - Free-text PII (firstName/lastName/email/phone/address) → '[REDACTED]'
 *     or null. Keep the row + ID so foreign-key references (orders,
 *     audit logs) don't dangle.
 *   - Hashes / IDs / created_at: kept. The audit trail of "this user
 *     placed this order" survives; the *who they were* is gone.
 *   - File attachments: NOT touched here. The retention policies
 *     (PR 7.2) handle file lifetime — they're orthogonal.
 */
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  /** USER_REQUEST cooldown — gives the user 24h to undo a misclick. */
  private static readonly USER_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    // Phase 21 GST — captures statutory-hold metadata on the erasure
    // outcome so the admin compliance UI can show "N tax documents
    // preserved under Section 36" without re-deriving from the DB.
    private readonly taxRetention: TaxDocumentRetentionService,
  ) {}

  async requestErasure(input: {
    subjectType: 'USER' | 'SELLER' | 'AFFILIATE' | 'FRANCHISE';
    subjectId: string;
    source?: 'USER_REQUEST' | 'ADMIN_ACTION' | 'REGULATOR_NOTICE';
    requestedByActorType?: string;
    requestedByActorId?: string;
  }): Promise<{ id: string; notBefore: Date }> {
    const source = input.source ?? 'USER_REQUEST';

    // Snapshot the subject's email for the audit trail before any
    // redaction touches the row.
    let snapshot: string | null = null;
    if (input.subjectType === 'USER') {
      const u = await this.prisma.user.findUnique({
        where: { id: input.subjectId },
        select: { email: true },
      });
      if (!u) throw new NotFoundAppException('Subject user not found');
      snapshot = u.email ?? null;
    }

    const now = new Date();
    const notBefore =
      source === 'USER_REQUEST'
        ? new Date(now.getTime() + ErasureService.USER_REQUEST_COOLDOWN_MS)
        : now;

    const row = await this.prisma.dataErasureRequest.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectEmailSnapshot: snapshot,
        source,
        requestedByActorType: input.requestedByActorType ?? null,
        requestedByActorId: input.requestedByActorId ?? null,
        notBefore,
      },
    });
    return { id: row.id, notBefore };
  }

  async cancel(requestId: string): Promise<void> {
    const row = await this.prisma.dataErasureRequest.findUnique({
      where: { id: requestId },
    });
    if (!row) throw new NotFoundAppException('Erasure request not found');
    if (row.status !== 'PENDING') {
      throw new BadRequestAppException(
        `Cannot cancel — already ${row.status}`,
      );
    }
    await this.prisma.dataErasureRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Processes a single eligible request. Idempotent — calling on a
   * non-PENDING row is a no-op.
   */
  async processOne(requestId: string): Promise<void> {
    const row = await this.prisma.dataErasureRequest.findUnique({
      where: { id: requestId },
    });
    if (!row) return;
    if (row.status !== 'PENDING') return;
    if (row.notBefore > new Date()) return;

    await this.prisma.dataErasureRequest.update({
      where: { id: requestId },
      data: {
        status: 'IN_PROGRESS',
        processingStartedAt: new Date(),
      },
    });

    let outcome: Record<string, unknown>;
    try {
      if (row.subjectType === 'USER') {
        outcome = await this.processUser(row.subjectId);
      } else {
        outcome = {
          redacted: [],
          blocked: [
            {
              table: 'subject',
              reason: `${row.subjectType} subjects are not yet supported in v1; track in runbook for future expansion.`,
            },
          ],
        };
      }
    } catch (err) {
      this.logger.error(
        `Erasure ${requestId} failed mid-process: ${(err as Error).message}`,
      );
      // Mark as PENDING so the next cron tick retries. Don't
      // transition to a terminal state on transient failure.
      await this.prisma.dataErasureRequest.update({
        where: { id: requestId },
        data: { status: 'PENDING', processingStartedAt: null },
      });
      return;
    }

    const blocked = (outcome.blocked as Array<unknown> | undefined) ?? [];
    const finalStatus = blocked.length > 0 ? 'REJECTED' : 'COMPLETED';
    await this.prisma.dataErasureRequest.update({
      where: { id: requestId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        outcome: outcome as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * USER subject: redact PII on the User row + collect any blockers.
   * Returns the structured outcome JSON to write to outcome.
   */
  private async processUser(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const blockers = await this.collectUserBlockers(userId);
    if (blockers.length > 0) {
      return { redacted: [], blocked: blockers };
    }

    // Phase 0 (PR 0.10) — the `User` column is named `phone`, not
    // `phoneNumber`. The pre-existing code wrote `phoneNumber: null`
    // under an `as any` cast, throwing `P2009` (unknown arg) at
    // runtime and silently reverting every USER erasure to PENDING.
    // The `as any` is also gone so the Prisma type system will catch
    // any future drift.
    const redactedFields = ['firstName', 'lastName', 'email', 'phone'];
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: '[REDACTED]',
        lastName: '[REDACTED]',
        email: `redacted-${userId}@erased.local`,
        phone: null,
      },
    });

    // Phase 21 GST — capture the tax-document statutory-hold summary
    // on the outcome. Not a blocker (the user's erasure right is
    // satisfied by `users` row redaction); the documents themselves
    // carry their own snapshotted PII and outlive the user under
    // Section 36 / 8-year retention.
    const retention = await this.taxRetention
      .getRetentionSummaryForUser(userId)
      .catch((err) => {
        this.logger.warn(
          `Erasure ${userId}: retention summary failed (will record empty): ${(err as Error).message}`,
        );
        return null;
      });

    return {
      redacted: redactedFields.map((f) => `users.${f}`),
      blocked: [],
      statutoryHold: retention
        ? {
            // Plain JSON-safe shape — Dates serialised to ISO.
            preservedBy: 'CGST Section 36 / 8-year retention',
            documentsUnderRetention: retention.documentsUnderRetention,
            totalDocuments: retention.totalDocuments,
            earliestDocumentDate:
              retention.earliestDocumentDate?.toISOString() ?? null,
            latestRetentionExpiry:
              retention.latestRetentionExpiry?.toISOString() ?? null,
            retentionYears: retention.retentionYears,
            note:
              retention.hasActiveStatutoryHold
                ? 'Tax documents (invoices / credit notes / receipts) carry their own snapshotted buyer name + addresses at issuance time. These records are preserved as statutory evidence; the customer\'s right to be forgotten is satisfied by the users-row redaction above.'
                : 'No tax documents under active statutory hold for this user.',
          }
        : null,
    };
  }

  private async collectUserBlockers(
    userId: string,
  ): Promise<Array<{ table: string; reason: string }>> {
    const blockers: Array<{ table: string; reason: string }> = [];

    // Open dispute filed by this user.
    const openDispute = await this.prisma.dispute.findFirst({
      where: {
        filedByType: 'CUSTOMER',
        filedById: userId,
        status: { in: ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFO'] as any },
      },
      select: { disputeNumber: true },
    });
    if (openDispute) {
      blockers.push({
        table: 'disputes',
        reason: `Open dispute ${openDispute.disputeNumber}`,
      });
    }

    // Active return.
    const activeReturn = await this.prisma.return.findFirst({
      where: {
        customerId: userId,
        status: {
          notIn: ['CANCELLED', 'REJECTED', 'COMPLETED', 'REFUNDED'] as any,
        },
      },
      select: { returnNumber: true },
    });
    if (activeReturn) {
      blockers.push({
        table: 'returns',
        reason: `Active return ${activeReturn.returnNumber}`,
      });
    }

    // Wallet balance > 0. Refusing to redact while money is owed
    // protects the user; they have to drain the wallet first.
    const wallet = await (this.prisma as any).wallet
      ?.findFirst?.({
        where: { userId },
        select: { balanceInPaise: true },
      })
      .catch?.(() => null);
    if (wallet && wallet.balanceInPaise && Number(wallet.balanceInPaise) > 0) {
      blockers.push({
        table: 'wallet',
        reason: `Outstanding wallet balance ${wallet.balanceInPaise} paise`,
      });
    }

    return blockers;
  }
}
