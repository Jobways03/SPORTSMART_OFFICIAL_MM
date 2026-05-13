import type {
  Wallet,
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

/**
 * Phase 2 (PR 2.2) — boundary types.
 *
 * The Prisma `Wallet` / `WalletTransaction` types now expose money
 * columns as `bigint` (matching the BIGINT column type). Application
 * code reasoned in `number` for years and the values stay comfortably
 * inside JavaScript's safe-integer range (₹90 trillion), so we
 * marshal at the repo boundary instead of forcing every caller to
 * juggle `bigint`.
 *
 * `WalletEntity` and `WalletTransactionEntity` mirror Prisma's row
 * shape with the money fields re-typed as `number`. The repo
 * implementation `Number(...)` -casts on read and `BigInt(...)`-casts
 * on write; everything outside the repo stays number-typed.
 */
export type WalletEntity = Omit<Wallet, 'balanceInPaise'> & {
  balanceInPaise: number;
};

export type WalletTransactionEntity = Omit<
  WalletTransaction,
  'amountInPaise' | 'balanceAfterInPaise'
> & {
  amountInPaise: number;
  balanceAfterInPaise: number;
};

export interface WalletWithLatest extends WalletEntity {
  transactions: WalletTransactionEntity[];
}

export interface CreateTransactionInput {
  walletId: string;
  userId: string;
  type: WalletTransactionType;
  status?: WalletTransactionStatus;
  amountInPaise: number; // signed: credits +, debits −
  balanceAfterInPaise: number;
  referenceType?: string | null;
  referenceId?: string | null;
  description: string;
  internalNotes?: string | null;
  createdByAdminId?: string | null;
}

export interface ApplyMutationResult {
  wallet: WalletEntity;
  transaction: WalletTransactionEntity;
}

export interface ListWalletsFilter {
  page: number;
  limit: number;
  search?: string;
  /** Min wallet balance in paise (inclusive). */
  minBalanceInPaise?: number;
  /** Max wallet balance in paise (inclusive). */
  maxBalanceInPaise?: number;
  /** Filter to only blocked or only unblocked wallets. */
  blocked?: boolean;
}

export interface ListWalletsItem {
  walletId: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  balanceInPaise: number;
  currency: string;
  updatedAt: Date;
}

export interface ListWalletsPage {
  items: ListWalletsItem[];
  page: number;
  limit: number;
  total: number;
}

export interface WalletRepository {
  /** Lazy: returns existing or creates a fresh row at balance 0. */
  getOrCreate(userId: string): Promise<WalletEntity>;

  findByUserId(userId: string): Promise<WalletEntity | null>;

  /**
   * Atomic: bumps balance by `deltaInPaise` (signed) iff `expectedVersion`
   * still matches, then inserts a ledger row. Returns the updated wallet
   * + the new transaction. Caller passes the new balance pre-computed
   * (service does the arithmetic so it can also enforce non-negative).
   *
   * If the version-conditional UPDATE affects 0 rows (concurrent write
   * landed first) the implementation rejects with a tagged error so the
   * service can retry.
   */
  applyMutation(args: {
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
    transaction: CreateTransactionInput;
  }): Promise<ApplyMutationResult>;

  /**
   * Insert a PENDING ledger row that does NOT change wallet balance.
   * Used when initiating a top-up: we record the intent so we have an
   * id to return + later flip to COMPLETED on signature verify.
   */
  insertPending(input: CreateTransactionInput): Promise<WalletTransactionEntity>;

  /**
   * Flip a PENDING transaction to COMPLETED and apply the balance change
   * atomically. No-ops (returns existing) if already COMPLETED.
   */
  completePending(args: {
    transactionId: string;
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
  }): Promise<ApplyMutationResult>;

  findTransactionById(id: string): Promise<WalletTransactionEntity | null>;

  /**
   * Phase 3 (PR 3.2) — idempotency lookup. Returns the transaction
   * already recorded for a (referenceType, referenceId, type) tuple,
   * if any. Used by `WalletService.credit` to short-circuit duplicate
   * credit calls before they hit the unique index.
   */
  findTransactionByReference(args: {
    referenceType: string;
    referenceId: string;
    type: WalletTransactionType;
  }): Promise<WalletTransactionEntity | null>;

  listTransactions(args: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: WalletTransactionEntity[]; total: number }>;

  listWallets(filter: ListWalletsFilter): Promise<ListWalletsPage>;

  /**
   * Set the wallet's blocked state. Returns the updated wallet.
   * Used by admin block/unblock endpoints. The service is responsible
   * for not letting normal credit/debit calls go through when blocked.
   */
  setBlocked(args: {
    userId: string;
    isBlocked: boolean;
    reason?: string | null;
    adminId?: string | null;
  }): Promise<WalletEntity>;
}
