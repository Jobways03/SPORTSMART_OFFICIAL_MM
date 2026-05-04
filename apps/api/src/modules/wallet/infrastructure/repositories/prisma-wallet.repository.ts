import { Injectable, Logger } from '@nestjs/common';
import type { Wallet, WalletTransaction } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ApplyMutationResult,
  CreateTransactionInput,
  ListWalletsFilter,
  ListWalletsPage,
  WalletRepository,
} from '../../domain/repositories/wallet.repository.interface';

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

  async getOrCreate(userId: string): Promise<Wallet> {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balanceInPaise: 0, version: 0 },
      update: {},
    });
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { userId } });
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
          balanceInPaise: newBalanceInPaise,
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
          amountInPaise: transaction.amountInPaise,
          balanceAfterInPaise: transaction.balanceAfterInPaise,
          referenceType: transaction.referenceType ?? null,
          referenceId: transaction.referenceId ?? null,
          description: transaction.description,
          internalNotes: transaction.internalNotes ?? null,
          createdByAdminId: transaction.createdByAdminId ?? null,
        },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: walletId },
      });

      return { wallet, transaction: ledgerRow };
    });
  }

  async insertPending(input: CreateTransactionInput): Promise<WalletTransaction> {
    return this.prisma.walletTransaction.create({
      data: {
        walletId: input.walletId,
        userId: input.userId,
        type: input.type,
        status: 'PENDING',
        amountInPaise: input.amountInPaise,
        balanceAfterInPaise: input.balanceAfterInPaise, // == current balance for PENDING
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        description: input.description,
        internalNotes: input.internalNotes ?? null,
        createdByAdminId: input.createdByAdminId ?? null,
      },
    });
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
        return { wallet, transaction: existing };
      }

      const updated = await tx.wallet.updateMany({
        where: { id: args.walletId, version: args.expectedVersion },
        data: {
          balanceInPaise: args.newBalanceInPaise,
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
          balanceAfterInPaise: args.newBalanceInPaise,
        },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: args.walletId },
      });
      return { wallet, transaction };
    });
  }

  async findTransactionById(id: string): Promise<WalletTransaction | null> {
    return this.prisma.walletTransaction.findUnique({ where: { id } });
  }

  async listTransactions(args: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: WalletTransaction[]; total: number }> {
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
    return { items, total };
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

    const balanceFilter: Record<string, number> = {};
    if (minBalanceInPaise !== undefined) balanceFilter.gte = minBalanceInPaise;
    if (maxBalanceInPaise !== undefined) balanceFilter.lte = maxBalanceInPaise;

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
        balanceInPaise: w.balanceInPaise,
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
  }): Promise<Wallet> {
    // Use upsert so admin can pre-emptively block a wallet that hasn't
    // been touched yet (e.g. a fraudulent signup discovered on review).
    return this.prisma.wallet.upsert({
      where: { userId: args.userId },
      create: {
        userId: args.userId,
        balanceInPaise: 0,
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
  }
}
