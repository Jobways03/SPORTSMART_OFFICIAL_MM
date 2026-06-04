import { Injectable, Logger } from '@nestjs/common';
import type { Wallet, WalletTransaction, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ApplyMutationResult,
  CreateTransactionInput,
  ListWalletsFilter,
  ListWalletsPage,
  WalletEntity,
  WalletRepository,
  WalletTransactionEntity,
} from '../../domain/repositories/wallet.repository.interface';

/**
 * Phase 2 (PR 2.2) — bigint↔number marshalling at the storage boundary.
 *
 * The DB stores wallet money as BIGINT (no overflow). The TypeScript
 * service layer stays in `number` (safe up to 2^53−1 paise = ~₹90T) so
 * arithmetic, JSON, and DTOs don't need to learn bigint. These helpers
 * are the only place the two representations meet.
 */
function toWalletEntity(w: Wallet): WalletEntity {
  return { ...w, balanceInPaise: Number(w.balanceInPaise) };
}

function toWalletTransactionEntity(t: WalletTransaction): WalletTransactionEntity {
  return {
    ...t,
    amountInPaise: Number(t.amountInPaise),
    balanceAfterInPaise: Number(t.balanceAfterInPaise),
    balanceBeforeInPaise: Number(t.balanceBeforeInPaise), // Phase 182 (#4)
  };
}

/**
 * Tagged error thrown when the optimistic version check loses to a
 * concurrent writer. The service retries a few times before giving up.
 */
export class WalletVersionConflictError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} version conflict — concurrent mutation lost`);
    this.name = 'WalletVersionConflictError';
  }
}

@Injectable()
export class PrismaWalletRepository implements WalletRepository {
  private readonly logger = new Logger(PrismaWalletRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string): Promise<WalletEntity> {
    const w = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balanceInPaise: 0n, version: 0 },
      update: {},
    });
    return toWalletEntity(w);
  }

  async findByUserId(userId: string): Promise<WalletEntity | null> {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    return w ? toWalletEntity(w) : null;
  }

  async applyMutation(args: {
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
    transaction: CreateTransactionInput;
  }): Promise<ApplyMutationResult> {
    const { walletId, expectedVersion, newBalanceInPaise, transaction } = args;

    return this.prisma.$transaction(async (tx) => {
      // Conditional update: only succeeds if the version is still what
      // the service read. updateMany returns affected-row count so we
      // can detect lost-update conflicts without a separate SELECT.
      const updated = await tx.wallet.updateMany({
        where: { id: walletId, version: expectedVersion },
        data: {
          balanceInPaise: BigInt(newBalanceInPaise),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new WalletVersionConflictError(walletId);
      }

      const ledgerRow = await tx.walletTransaction.create({
        data: {
          walletId,
          userId: transaction.userId,
          type: transaction.type,
          status: transaction.status ?? 'COMPLETED',
          amountInPaise: BigInt(transaction.amountInPaise),
          balanceAfterInPaise: BigInt(transaction.balanceAfterInPaise),
          // Phase 182 (#4/#5) — derived statement fields: balanceBefore = after −
          // signed amount; direction from the amount sign.
          balanceBeforeInPaise: BigInt(transaction.balanceAfterInPaise) - BigInt(transaction.amountInPaise),
          direction: transaction.amountInPaise >= 0 ? 'CREDIT' : 'DEBIT',
          currency: transaction.currency ?? 'INR', // #9
          referenceNumber: transaction.referenceNumber ?? null, // #8
          referenceType: transaction.referenceType ?? null,
          referenceId: transaction.referenceId ?? null,
          description: transaction.description,
          reason: transaction.reason ?? null, // Phase 183 (#2)
          internalNotes: transaction.internalNotes ?? null,
          createdByAdminId: transaction.createdByAdminId ?? null,
          // Phase 172 (#8/#9) — credit discriminator + expiry onto the ledger.
          creditType: transaction.creditType ?? null,
          expiresAt: transaction.expiresAt ?? null,
        },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: walletId },
      });

      return {
        wallet: toWalletEntity(wallet),
        transaction: toWalletTransactionEntity(ledgerRow),
      };
    });
  }

  async insertPending(input: CreateTransactionInput): Promise<WalletTransactionEntity> {
    const row = await this.prisma.walletTransaction.create({
      data: {
        walletId: input.walletId,
        userId: input.userId,
        type: input.type,
        status: 'PENDING',
        amountInPaise: BigInt(input.amountInPaise),
        balanceAfterInPaise: BigInt(input.balanceAfterInPaise), // == current balance for PENDING
        // Phase 182 — statement fields (balanceBefore reconciled on completion).
        balanceBeforeInPaise: BigInt(input.balanceAfterInPaise) - BigInt(input.amountInPaise),
        direction: input.amountInPaise >= 0 ? 'CREDIT' : 'DEBIT',
        currency: input.currency ?? 'INR',
        referenceNumber: input.referenceNumber ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        description: input.description,
        internalNotes: input.internalNotes ?? null,
        createdByAdminId: input.createdByAdminId ?? null,
        // Phase 172 (#8/#9) — propagate the discriminator + expiry.
        creditType: input.creditType ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return toWalletTransactionEntity(row);
  }

  async completePending(args: {
    transactionId: string;
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
  }): Promise<ApplyMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotent: if the row is already COMPLETED, return it unchanged.
      const existing = await tx.walletTransaction.findUniqueOrThrow({
        where: { id: args.transactionId },
      });
      if (existing.status === 'COMPLETED') {
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { id: args.walletId },
        });
        return {
          wallet: toWalletEntity(wallet),
          transaction: toWalletTransactionEntity(existing),
        };
      }

      const updated = await tx.wallet.updateMany({
        where: { id: args.walletId, version: args.expectedVersion },
        data: {
          balanceInPaise: BigInt(args.newBalanceInPaise),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new WalletVersionConflictError(args.walletId);
      }

      const transaction = await tx.walletTransaction.update({
        where: { id: args.transactionId },
        data: {
          status: 'COMPLETED',
          balanceAfterInPaise: BigInt(args.newBalanceInPaise),
          // Phase 182 — reconcile balanceBefore now that the topup applies.
          balanceBeforeInPaise: BigInt(args.newBalanceInPaise) - existing.amountInPaise,
        },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: args.walletId },
      });
      return {
        wallet: toWalletEntity(wallet),
        transaction: toWalletTransactionEntity(transaction),
      };
    });
  }

  async findTransactionById(id: string): Promise<WalletTransactionEntity | null> {
    const t = await this.prisma.walletTransaction.findUnique({ where: { id } });
    return t ? toWalletTransactionEntity(t) : null;
  }

  async findTransactionByReference(args: {
    referenceType: string;
    referenceId: string;
    type: WalletTransactionType;
  }): Promise<WalletTransactionEntity | null> {
    // The compound unique on (reference_type, reference_id, type) lets
    // Prisma resolve this via a single index lookup.
    const t = await this.prisma.walletTransaction.findFirst({
      where: {
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        type: args.type,
      },
    });
    return t ? toWalletTransactionEntity(t) : null;
  }

  async listTransactions(args: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: WalletTransactionEntity[]; total: number }> {
    const { userId, page, limit } = args;
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where: { userId } }),
    ]);
    return { items: items.map(toWalletTransactionEntity), total };
  }

  // Phase 172 (#9) — every ledger row for a user, oldest-first. Input to the
  // goodwill-expiry replay (computeGoodwillState). A wallet's ledger is small
  // (one row per money movement) so reading it whole is cheap.
  async findAllTransactionsForUser(
    userId: string,
  ): Promise<WalletTransactionEntity[]> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toWalletTransactionEntity);
  }

  // Phase 172 (#9) — distinct user ids holding ≥1 GOODWILL credit already past
  // its expiry. The sweep then replays each user's ledger to lapse what's left.
  async findUserIdsWithExpiredGoodwill(args: {
    now: Date;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        creditType: 'GOODWILL',
        expiresAt: { not: null, lte: args.now },
        lapsedAt: null,
      },
      select: { userId: true },
      distinct: ['userId'],
      take: args.limit,
    });
    return rows.map((r) => r.userId);
  }

  // Phase 172 (#9) — stamp lapsedAt on every expired, not-yet-lapsed GOODWILL
  // lot for a user once the sweep has processed them (so they drop out of the
  // candidate query). Purely a processing marker — balance math is unaffected.
  async markGoodwillLotsLapsed(args: {
    userId: string;
    now: Date;
  }): Promise<number> {
    const res = await this.prisma.walletTransaction.updateMany({
      where: {
        userId: args.userId,
        creditType: 'GOODWILL',
        expiresAt: { not: null, lte: args.now },
        lapsedAt: null,
      },
      data: { lapsedAt: args.now },
    });
    return res.count;
  }

  async listWallets(filter: ListWalletsFilter): Promise<ListWalletsPage> {
    const { page, limit, search, minBalanceInPaise, maxBalanceInPaise, blocked } = filter;
    const skip = (page - 1) * limit;

    const userWhere = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { phoneNumber: { contains: search } },
          ],
        }
      : undefined;

    // Phase 2 (PR 2.2) — balance is BIGINT on disk; coerce the filter
    // bounds at the boundary so Prisma uses the right column type.
    const balanceFilter: Record<string, bigint> = {};
    if (minBalanceInPaise !== undefined) balanceFilter.gte = BigInt(minBalanceInPaise);
    if (maxBalanceInPaise !== undefined) balanceFilter.lte = BigInt(maxBalanceInPaise);

    const where: any = {};
    if (userWhere) where.user = userWhere;
    if (Object.keys(balanceFilter).length) where.balanceInPaise = balanceFilter;
    if (blocked !== undefined) where.isBlocked = blocked;

    const [rows, total] = await Promise.all([
      this.prisma.wallet.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.wallet.count({ where }),
    ]);

    return {
      items: rows.map((w) => ({
        walletId: w.id,
        userId: w.userId,
        userEmail: w.user.email,
        userFullName: `${w.user.firstName} ${w.user.lastName}`.trim(),
        balanceInPaise: Number(w.balanceInPaise),
        currency: w.currency,
        updatedAt: w.updatedAt,
      })),
      page,
      limit,
      total,
    };
  }

  async setBlocked(args: {
    userId: string;
    isBlocked: boolean;
    reason?: string | null;
    adminId?: string | null;
  }): Promise<WalletEntity> {
    // Use upsert so admin can pre-emptively block a wallet that hasn't
    // been touched yet (e.g. a fraudulent signup discovered on review).
    const w = await this.prisma.wallet.upsert({
      where: { userId: args.userId },
      create: {
        userId: args.userId,
        balanceInPaise: 0n,
        version: 0,
        isBlocked: args.isBlocked,
        blockedReason: args.isBlocked ? args.reason ?? null : null,
        blockedAt: args.isBlocked ? new Date() : null,
        blockedByAdminId: args.isBlocked ? args.adminId ?? null : null,
      },
      update: {
        isBlocked: args.isBlocked,
        blockedReason: args.isBlocked ? args.reason ?? null : null,
        blockedAt: args.isBlocked ? new Date() : null,
        blockedByAdminId: args.isBlocked ? args.adminId ?? null : null,
      },
    });
    return toWalletEntity(w);
  }
}
